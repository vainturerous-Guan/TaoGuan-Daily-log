// 读书笔记频道逻辑
// 数据结构：{ id, date(登记日期), name(书名/文名), intro(内容简介),
//            quotes:[{ id, text(≤100字), createdAt }],
//            thoughts:[{ id, text(≤100字), createdAt }],
//            attachments:[{ id, name, path, size, savedAt }],
//            createdAt, updatedAt }
// 书单按登记顺序排列（date 升序，同日期按 createdAt 升序）
// 附件：File System Access API 直写本机项目文件夹 attachments/reading/（不入仓库），
//       记录里只存路径；删除附件只移除记录，不动本机文件
(function () {
  "use strict";

  const FILE_PATH = "data/reading-books.json";
  // 附件在本机项目文件夹中的存放位置（以用户选择的项目文件夹为根）
  const ATTACH_SUBDIR = "attachments/reading";
  const IDB_NAME = "taoguan-attachments";
  const IDB_STORE = "handles";
  const IDB_ROOT_KEY = "readingRootDir";
  // 本机项目绝对路径（用于「打开所在文件夹」，可按实际位置修改）
  const DEFAULT_PROJECT_BASE = "/Users/wanqiu/Documents/kimi/KimiCode/ericzzy_com";
  const BASE_PATH_KEY = "taoguan_reading_project_base";
  const NOTE_MAX = 100; // 金句/感悟每条字数上限

  let books = [];
  let editingBookId = null;   // 正在编辑书名的书 id
  let editingNote = null;     // { bookId, field:"quotes"|"thoughts", noteId }
  const introDrafts = {};     // bookId → 内容简介未保存草稿
  let introTimer = null;

  let rootDirHandle = null; // 用户选择的项目文件夹句柄（File System Access API）
  let dirReady = false;     // 句柄当前是否可读写

  const els = {};

  function $(sel) {
    return document.querySelector(sel);
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function str(v) {
    return typeof v === "string" ? v : v == null ? "" : String(v);
  }

  function numOrNull(v) {
    const n = Number(v);
    return v == null || v === "" || isNaN(n) ? null : n;
  }

  function escapeAttr(s) {
    return Common.escapeHtml(s).replace(/"/g, "&quot;");
  }

  function sanitizeFileName(name) {
    const cleaned = String(name || "").replace(/[\\/:*?"<>|]/g, "_").trim();
    return cleaned || "file";
  }

  function formatSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }

  function findBook(id) {
    return books.find((b) => b.id === id);
  }

  /* ---------- 归一化（防脏数据） ---------- */

  function normalizeNotes(arr) {
    return (Array.isArray(arr) ? arr : [])
      .filter((n) => n && typeof n === "object")
      .map((n) => ({ id: str(n.id) || newId(), text: str(n.text).slice(0, NOTE_MAX), createdAt: numOrNull(n.createdAt) || Date.now() }));
  }

  function normalizeAttachments(arr) {
    return (Array.isArray(arr) ? arr : [])
      .filter((a) => a && typeof a === "object")
      .map((a) => ({
        id: str(a.id) || newId(),
        name: str(a.name) || "附件",
        path: str(a.path),
        size: numOrNull(a.size),
        savedAt: numOrNull(a.savedAt) || Date.now(),
      }));
  }

  function normalizeBook(b) {
    if (!b || typeof b !== "object") return null;
    return {
      id: str(b.id) || newId(),
      date: str(b.date),
      name: str(b.name),
      intro: str(b.intro),
      quotes: normalizeNotes(b.quotes),
      thoughts: normalizeNotes(b.thoughts),
      attachments: normalizeAttachments(b.attachments),
      createdAt: numOrNull(b.createdAt) || Date.now(),
      updatedAt: numOrNull(b.updatedAt) || Date.now(),
    };
  }

  /* ---------- 存储 ---------- */

  async function saveBooks() {
    try {
      await Storage.save(books, FILE_PATH);
    } catch (err) {
      console.error("保存读书笔记失败", err);
      Common.toast("保存失败：" + (err && err.message ? err.message : "未知错误"), "error");
      try {
        books = (await Storage.load(FILE_PATH)).map(normalizeBook).filter(Boolean);
      } catch (_) {
        /* 忽略回滚读取失败 */
      }
      renderList();
    }
  }

  /* ---------- 本地项目文件夹（File System Access API，句柄持久化在 IndexedDB） ---------- */

  function fsSupported() {
    return typeof window.showDirectoryPicker === "function";
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("打开本地索引失败"));
    });
  }

  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function ensureAttachDir(root) {
    let cur = root;
    for (const part of ATTACH_SUBDIR.split("/")) {
      cur = await cur.getDirectoryHandle(part, { create: true });
    }
    return cur;
  }

  async function writeAttachmentFile(fileName, blob) {
    const dir = await ensureAttachDir(rootDirHandle);
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  async function refreshDirState() {
    dirReady = false;
    if (rootDirHandle) {
      try {
        dirReady =
          (await rootDirHandle.queryPermission({ mode: "readwrite" })) === "granted";
      } catch (err) {
        dirReady = false;
      }
    }
    updateFolderStatus();
  }

  async function pickFolder() {
    let handle;
    try {
      handle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (err) {
      if (err && err.name === "AbortError") return; // 用户取消
      throw err;
    }
    // 友好提示：所选文件夹最好就是项目文件夹（里面有 index.html）
    try {
      await handle.getFileHandle("index.html");
    } catch (err) {
      Common.toast("所选文件夹中没有找到 index.html，请确认是项目文件夹", "error");
    }
    rootDirHandle = handle;
    await idbSet(IDB_ROOT_KEY, handle);
    await ensureAttachDir(handle);
    dirReady = true;
    updateFolderStatus();
    Common.toast("附件将保存到本机项目文件夹 " + ATTACH_SUBDIR + "/");
  }

  async function handleFolderBtn() {
    if (!fsSupported()) {
      Common.toast("当前浏览器不支持直接写入本地文件夹，请用 Chrome/Edge 打开本页", "error");
      return;
    }
    if (rootDirHandle && !dirReady) {
      try {
        const p = await rootDirHandle.requestPermission({ mode: "readwrite" });
        if (p === "granted") {
          dirReady = true;
          updateFolderStatus();
          Common.toast("已重新授权本地文件夹");
          return;
        }
        Common.toast("未获得文件夹权限，附件无法保存到本地", "error");
      } catch (err) {
        console.error("重新授权失败", err);
        Common.toast("授权失败：" + (err && err.message ? err.message : "未知错误"), "error");
      }
      return;
    }
    try {
      await pickFolder();
    } catch (err) {
      console.error("选择文件夹失败", err);
      Common.toast("选择文件夹失败：" + (err && err.message ? err.message : "未知错误"), "error");
    }
  }

  function updateFolderStatus() {
    if (!fsSupported()) {
      els.folderBtn.textContent = "浏览器不支持本地文件夹";
      els.folderBtn.disabled = true;
      els.folderStatus.textContent = "请用 Chrome/Edge 打开本页才能直写本地文件夹";
      return;
    }
    if (rootDirHandle && dirReady) {
      els.folderBtn.textContent = "更换保存文件夹";
      els.folderStatus.textContent = "附件将保存到本机项目文件夹 " + ATTACH_SUBDIR + "/";
    } else if (rootDirHandle && !dirReady) {
      els.folderBtn.textContent = "重新授权本地文件夹";
      els.folderStatus.textContent = "文件夹权限已失效，需重新授权";
    } else {
      els.folderBtn.textContent = "选择本地保存文件夹";
      els.folderStatus.textContent = "未选择时附件无法保存到本地";
    }
  }

  function openAttachFolder() {
    const base = (els.projectBase.value.trim() || DEFAULT_PROJECT_BASE).replace(/\/+$/, "");
    const abs = base + "/" + ATTACH_SUBDIR;
    let w = null;
    try {
      w = window.open("file://" + abs, "_blank");
    } catch (err) {
      w = null;
    }
    if (w) {
      Common.toast("正在打开 " + abs);
    } else {
      Common.toast("浏览器拦截了本地文件夹链接，请手动打开：" + abs, "error");
    }
  }

  /* ---------- 内容简介自动保存 ---------- */

  function applyIntroDrafts() {
    if (introTimer) {
      clearTimeout(introTimer);
      introTimer = null;
    }
    Object.keys(introDrafts).forEach((id) => {
      const book = findBook(id);
      if (book) {
        book.intro = introDrafts[id];
        book.updatedAt = Date.now();
      }
    });
    Object.keys(introDrafts).forEach((k) => delete introDrafts[k]);
  }

  function onIntroInput(target) {
    introDrafts[target.dataset.bookId] = target.value;
    if (introTimer) clearTimeout(introTimer);
    introTimer = setTimeout(() => {
      applyIntroDrafts();
      saveBooks();
    }, 800);
  }

  function onIntroCommit() {
    applyIntroDrafts();
    saveBooks();
  }

  /* ---------- 附件 ---------- */

  async function addAttachments(bookId, fileList) {
    const book = findBook(bookId);
    const files = Array.from(fileList || []).filter((f) => f);
    if (!book || !files.length) return;
    if (!fsSupported()) {
      Common.toast("当前浏览器不支持直写本地文件夹，请用 Chrome/Edge 打开本页", "error");
      return;
    }
    if (!rootDirHandle || !dirReady) {
      Common.toast("请先选择本地保存文件夹");
      await handleFolderBtn();
      if (!rootDirHandle || !dirReady) {
        Common.toast("未选择文件夹，附件未保存", "error");
        return;
      }
    }
    applyIntroDrafts();
    try {
      for (const file of files) {
        const safeName = sanitizeFileName(file.name);
        const fileName = bookId.slice(0, 8) + "-" + Date.now().toString(36) + "-" + safeName;
        await writeAttachmentFile(fileName, file);
        // 按上传顺序追加
        book.attachments.push({
          id: newId(),
          name: file.name,
          path: ATTACH_SUBDIR + "/" + fileName,
          size: file.size || 0,
          savedAt: Date.now(),
        });
      }
      book.updatedAt = Date.now();
      await saveBooks();
      renderList();
      Common.toast("附件已保存到本机 " + ATTACH_SUBDIR + "/");
    } catch (err) {
      console.error("保存附件失败", err);
      Common.toast("保存附件失败：" + (err && err.message ? err.message : "未知错误"), "error");
    }
  }

  function deleteAttachment(bookId, attId) {
    const book = findBook(bookId);
    if (!book) return;
    const idx = book.attachments.findIndex((a) => a.id === attId);
    if (idx === -1) return;
    book.attachments.splice(idx, 1);
    book.updatedAt = Date.now();
    saveBooks();
    renderList();
    Common.toast("已移除附件链接（本机文件保留）");
  }

  async function openAttachment(bookId, attId) {
    const book = findBook(bookId);
    const att = book && book.attachments.find((a) => a.id === attId);
    if (!att) return;
    if (rootDirHandle && dirReady) {
      try {
        const dir = await ensureAttachDir(rootDirHandle);
        const fh = await dir.getFileHandle(att.path.split("/").pop());
        const f = await fh.getFile();
        const url = URL.createObjectURL(f);
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
      } catch (err) {
        console.error("通过本地文件夹打开失败", err);
      }
    }
    // 兜底：按记录的相对路径访问（本地起服务打开本页时可用）
    window.open(encodeURI(att.path), "_blank");
  }

  /* ---------- 渲染 ---------- */

  function sortBooks() {
    books.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function noteItemsHtml(book, field) {
    const list = book[field];
    if (!list.length) {
      return '<li class="check-hint">' + (field === "quotes" ? "还没有金句，添加第一条吧～" : "还没有感悟，读到哪里记到哪里～") + "</li>";
    }
    return list
      .map((n) => {
        const editing =
          editingNote && editingNote.bookId === book.id && editingNote.field === field && editingNote.noteId === n.id;
        if (editing) {
          return (
            '<li class="note-item"><form class="edit-row" data-form="edit-note" data-book-id="' + book.id +
            '" data-field="' + field + '" data-note-id="' + n.id + '">' +
            '<input type="text" maxlength="' + NOTE_MAX + '" value="' + escapeAttr(n.text) + '">' +
            '<button type="submit" class="btn btn-small">保存</button>' +
            '<button type="button" class="mini-btn" data-action="cancel-edit-note">取消</button></form></li>'
          );
        }
        return (
          '<li class="note-item"><span class="note-text">' + Common.escapeHtml(n.text) + "</span>" +
          '<span class="note-actions">' +
          '<button type="button" class="mini-btn" data-action="edit-note" data-field="' + field + '" data-note-id="' + n.id + '">编辑</button>' +
          '<button type="button" class="mini-btn" data-action="delete-note" data-field="' + field + '" data-note-id="' + n.id + '">删除</button>' +
          "</span></li>"
        );
      })
      .join("");
  }

  function noteSectionHtml(book, field, label, placeholder) {
    return (
      '<div class="form-field book-section">' +
      "<label>" + label + ' <span class="field-limit">每条≤' + NOTE_MAX + "字</span></label>" +
      '<ul class="note-list">' + noteItemsHtml(book, field) + "</ul>" +
      '<form class="inline-add-form" data-form="add-note" data-book-id="' + book.id + '" data-field="' + field + '">' +
      '<input type="text" maxlength="' + NOTE_MAX + '" placeholder="' + Common.escapeHtml(placeholder) + '">' +
      '<button type="submit" class="btn btn-small">添加</button></form></div>'
    );
  }

  function attachListHtml(book) {
    if (!book.attachments.length) {
      return '<li class="check-hint">还没有附件，把文件拖到上方虚线区域即可保存到本机文件夹～</li>';
    }
    return book.attachments
      .map(
        (att) =>
          '<li class="attach-item" data-att-id="' + att.id + '">' +
          '<span class="attach-thumb attach-thumb-file">📄</span>' +
          '<a class="attach-name" href="' + encodeURI(att.path) + '" data-open-att="' + att.id + '" title="点击打开">' +
          Common.escapeHtml(att.name) + "</a>" +
          '<code class="attach-path" title="保存地址（本机项目内）">' + Common.escapeHtml(att.path) + "</code>" +
          (att.size != null ? '<span class="attach-size">' + formatSize(att.size) + "</span>" : "") +
          '<button type="button" class="attach-remove" data-action="delete-attachment" aria-label="移除附件">✕</button></li>'
      )
      .join("");
  }

  function bookHtml(book) {
    let head;
    if (editingBookId === book.id) {
      head =
        '<form class="edit-book-form" data-form="edit-book" data-book-id="' + book.id + '">' +
        '<input type="date" value="' + escapeAttr(book.date) + '" required>' +
        '<input type="text" value="' + escapeAttr(book.name) + '" maxlength="100" required>' +
        '<button type="submit" class="btn btn-small">保存</button>' +
        '<button type="button" class="mini-btn" data-action="cancel-edit-book">取消</button></form>';
    } else {
      head =
        '<div class="book-head">' +
        '<span class="book-date">' + Common.escapeHtml(book.date) + "</span>" +
        '<span class="book-weekday">' + Common.escapeHtml(Common.weekdayOf(book.date)) + "</span>" +
        '<h3 class="book-title">' + Common.escapeHtml(book.name) + "</h3>" +
        '<span class="book-head-actions">' +
        '<button type="button" class="mini-btn" data-action="edit-book">编辑</button>' +
        '<button type="button" class="mini-btn" data-action="delete-book">删除</button>' +
        "</span></div>";
    }

    return (
      '<article class="record-item book-card" data-book-id="' + book.id + '">' +
      head +
      '<div class="form-field book-section">' +
      '<label>内容简介 <span class="field-hint">改动后自动保存</span></label>' +
      '<textarea class="book-intro" rows="5" data-book-id="' + book.id + '" placeholder="这本书讲了什么？为什么值得读？">' +
      Common.escapeHtml(book.intro) + "</textarea></div>" +
      noteSectionHtml(book, "quotes", "金句 / 关键知识点", "录入一条金句或关键知识点，回车保存") +
      noteSectionHtml(book, "thoughts", "感悟", "当下的一点想法，回车保存") +
      '<div class="form-field book-section">' +
      "<label>附件</label>" +
      '<div class="attach-area" tabindex="0" role="button" aria-label="添加附件">' +
      '<span class="attach-area-icon">📎</span>' +
      '<span class="attach-area-text">把文件拖到这里，或点击选择（直接保存到本机项目文件夹）</span>' +
      '<input type="file" class="attach-input" multiple hidden></div>' +
      '<ul class="attach-list">' + attachListHtml(book) + "</ul></div>" +
      "</article>"
    );
  }

  function renderList() {
    sortBooks();
    els.list.innerHTML = books.map(bookHtml).join("");
    els.emptyHint.hidden = books.length > 0;
  }

  /* ---------- 事件：登记新书 ---------- */

  function updateWeekday() {
    els.weekday.textContent = els.date.value ? Common.weekdayOf(els.date.value) : "";
  }

  async function handleAddBook(e) {
    e.preventDefault();
    const name = els.nameInput.value.trim();
    if (!els.date.value) {
      Common.toast("请先选择登记日期", "error");
      return;
    }
    if (!name) {
      Common.toast("请填写书名/文名", "error");
      return;
    }
    applyIntroDrafts();
    const now = Date.now();
    books.push({
      id: newId(),
      date: els.date.value,
      name: name,
      intro: "",
      quotes: [],
      thoughts: [],
      attachments: [],
      createdAt: now,
      updatedAt: now,
    });
    await saveBooks();
    els.nameInput.value = "";
    renderList();
    Common.toast("已添加「" + name + "」");
  }

  /* ---------- 事件：书单（委托） ---------- */

  function deleteBook(bookId) {
    const book = findBook(bookId);
    if (!book) return;
    if (!window.confirm("确定删除「" + book.name + "」？金句、感悟与附件记录将一并移除（本机附件文件保留）。")) return;
    applyIntroDrafts();
    delete introDrafts[bookId];
    books = books.filter((b) => b.id !== bookId);
    if (editingBookId === bookId) editingBookId = null;
    saveBooks();
    renderList();
  }

  function deleteNote(bookId, field, noteId) {
    const book = findBook(bookId);
    if (!book) return;
    book[field] = book[field].filter((n) => n.id !== noteId);
    book.updatedAt = Date.now();
    saveBooks();
    renderList();
  }

  function handleListClick(e) {
    const attLink = e.target.closest && e.target.closest("[data-open-att]");
    if (attLink) {
      e.preventDefault();
      const card = attLink.closest("[data-book-id]");
      openAttachment(card && card.dataset.bookId, attLink.dataset.openAtt);
      return;
    }

    const btn = e.target.closest && e.target.closest("[data-action]");
    if (!btn) {
      // 点击虚线区域 = 选择文件
      const area = e.target.closest && e.target.closest(".attach-area");
      if (area) {
        const input = area.querySelector("input[type=file]");
        if (input) input.click();
      }
      return;
    }

    const action = btn.dataset.action;
    const card = btn.closest("[data-book-id]");
    const bookId = card && card.dataset.bookId;

    switch (action) {
      case "edit-book":
        applyIntroDrafts();
        editingBookId = bookId;
        renderList();
        break;
      case "cancel-edit-book":
        editingBookId = null;
        renderList();
        break;
      case "delete-book":
        deleteBook(bookId);
        break;
      case "edit-note":
        applyIntroDrafts();
        editingNote = { bookId: bookId, field: btn.dataset.field, noteId: btn.dataset.noteId };
        renderList();
        break;
      case "cancel-edit-note":
        editingNote = null;
        renderList();
        break;
      case "delete-note":
        applyIntroDrafts();
        deleteNote(bookId, btn.dataset.field, btn.dataset.noteId);
        break;
      case "delete-attachment": {
        const item = btn.closest("[data-att-id]");
        applyIntroDrafts();
        deleteAttachment(bookId, item && item.dataset.attId);
        break;
      }
    }
  }

  async function handleListSubmit(e) {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    const bookId = form.dataset.bookId;
    const book = findBook(bookId);
    const now = Date.now();

    if (kind === "add-note") {
      const input = form.querySelector("input");
      const text = input.value.trim().slice(0, NOTE_MAX);
      if (!text) return;
      if (!book) return;
      applyIntroDrafts();
      book[form.dataset.field].push({ id: newId(), text: text, createdAt: now });
      book.updatedAt = now;
      await saveBooks();
      renderList();
      return;
    }

    if (kind === "edit-note") {
      const input = form.querySelector("input");
      const text = input.value.trim().slice(0, NOTE_MAX);
      if (!text) {
        Common.toast("内容不能为空", "error");
        return;
      }
      if (!book) return;
      const note = book[form.dataset.field].find((n) => n.id === form.dataset.noteId);
      if (note) {
        applyIntroDrafts();
        note.text = text;
        book.updatedAt = now;
        editingNote = null;
        await saveBooks();
        renderList();
      }
      return;
    }

    if (kind === "edit-book") {
      const dateInput = form.querySelector("input[type=date]");
      const nameInput = form.querySelector("input[type=text]");
      const name = nameInput.value.trim();
      if (!dateInput.value) {
        Common.toast("请先选择登记日期", "error");
        return;
      }
      if (!name) {
        Common.toast("请填写书名/文名", "error");
        return;
      }
      if (book) {
        applyIntroDrafts();
        book.date = dateInput.value;
        book.name = name;
        book.updatedAt = now;
        editingBookId = null;
        await saveBooks();
        renderList();
      }
    }
  }

  function handleListInput(e) {
    if (e.target.classList && e.target.classList.contains("book-intro")) {
      onIntroInput(e.target);
    }
  }

  function handleListChange(e) {
    if (e.target.classList && e.target.classList.contains("book-intro")) {
      onIntroCommit();
      return;
    }
    if (e.target.classList && e.target.classList.contains("attach-input")) {
      const card = e.target.closest("[data-book-id]");
      const files = e.target.files;
      e.target.value = "";
      addAttachments(card && card.dataset.bookId, files);
    }
  }

  function handleListDragOver(e) {
    const area = e.target.closest && e.target.closest(".attach-area");
    if (!area) return;
    e.preventDefault();
    area.classList.add("dragover");
  }

  function handleListDragLeave(e) {
    const area = e.target.closest && e.target.closest(".attach-area");
    if (area && (!e.relatedTarget || !area.contains(e.relatedTarget))) {
      area.classList.remove("dragover");
    }
  }

  function handleListDrop(e) {
    const area = e.target.closest && e.target.closest(".attach-area");
    if (!area) return;
    e.preventDefault();
    area.classList.remove("dragover");
    const card = area.closest("[data-book-id]");
    addAttachments(card && card.dataset.bookId, e.dataTransfer.files);
  }

  /* ---------- 初始化 ---------- */

  function cacheEls() {
    els.form = $("#book-form");
    els.date = $("#book-date");
    els.weekday = $("#weekday-display");
    els.nameInput = $("#book-name");
    els.submitBtn = $("#submit-btn");
    els.folderBtn = $("#folder-btn");
    els.openFolderBtn = $("#open-folder-btn");
    els.folderStatus = $("#folder-status");
    els.projectBase = $("#project-base");
    els.list = $("#book-list");
    els.loading = $("#loading-hint");
    els.emptyHint = $("#empty-hint");
  }

  function loadProjectBase() {
    let saved = "";
    try {
      saved = localStorage.getItem(BASE_PATH_KEY) || "";
    } catch (err) {
      saved = "";
    }
    els.projectBase.value = saved || DEFAULT_PROJECT_BASE;
  }

  async function init() {
    cacheEls();
    els.date.value = Common.todayStr();
    updateWeekday();
    els.date.addEventListener("change", updateWeekday);
    els.form.addEventListener("submit", handleAddBook);
    els.folderBtn.addEventListener("click", handleFolderBtn);
    els.openFolderBtn.addEventListener("click", openAttachFolder);
    loadProjectBase();
    els.projectBase.addEventListener("change", () => {
      try {
        localStorage.setItem(BASE_PATH_KEY, els.projectBase.value.trim());
      } catch (err) {
        /* 忽略 */
      }
    });

    els.list.addEventListener("click", handleListClick);
    els.list.addEventListener("submit", handleListSubmit);
    els.list.addEventListener("input", handleListInput);
    els.list.addEventListener("change", handleListChange);
    els.list.addEventListener("dragover", handleListDragOver);
    els.list.addEventListener("dragleave", handleListDragLeave);
    els.list.addEventListener("drop", handleListDrop);

    // 恢复上次选择的项目文件夹句柄
    try {
      rootDirHandle = (await idbGet(IDB_ROOT_KEY)) || null;
    } catch (err) {
      console.error("读取文件夹句柄失败", err);
      rootDirHandle = null;
    }
    await refreshDirState();

    try {
      const raw = await Storage.load(FILE_PATH);
      books = raw.map(normalizeBook).filter(Boolean);
    } catch (err) {
      console.error("读取读书笔记失败", err);
      books = [];
      Common.toast("读取失败：" + (err && err.message ? err.message : "未知错误"), "error");
    }
    els.loading.hidden = true;
    renderList();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
