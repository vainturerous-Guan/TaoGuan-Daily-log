// 知识点积累频道逻辑
// 数据结构：{ id, date, source, point, insight, attachments?, createdAt, updatedAt }
// attachments 每项：{ name, type, size, path? | dataUrl? }（选了本地文件夹存 path，否则内嵌 dataUrl）
// 同一天允许多条，各自独立
(function () {
  "use strict";

  const FILE_PATH = "data/knowledge.json";
  // 附件在本机项目文件夹中的存放位置（以用户选择的项目文件夹为根）
  const ATTACH_SUBDIR = "data/attachments";
  const IDB_NAME = "taoguan-attachments";
  const IDB_STORE = "handles";
  const IDB_ROOT_KEY = "knowledgeRootDir";
  // 未选本地文件夹时附件内嵌进记录，localStorage 容量有限，超过则提示先选文件夹
  const EMBED_LIMIT = 2 * 1024 * 1024;

  let records = [];
  let saving = false;
  let pending = []; // 待保存附件：{ id, file, url }
  let rootDirHandle = null; // 用户选择的项目文件夹句柄（File System Access API）
  let dirReady = false; // 句柄当前是否可读写

  let lightbox = null;

  const els = {};

  function $(sel) {
    return document.querySelector(sel);
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isImageType(type) {
    return /^image\//.test(type || "");
  }

  function isImageAtt(att) {
    if (isImageType(att.type)) return true;
    if (att.dataUrl && att.dataUrl.indexOf("data:image/") === 0) return true;
    if (att.path && /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(att.path)) return true;
    return false;
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

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error("读取文件失败"));
      r.readAsDataURL(file);
    });
  }

  /* ===== 本地项目文件夹（File System Access API，句柄持久化在 IndexedDB） ===== */

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
    Common.toast("附件将保存到本地项目文件夹 " + ATTACH_SUBDIR);
  }

  async function handleFolderBtn() {
    if (!fsSupported()) {
      Common.toast("当前浏览器不支持直接写入本地文件夹，附件将随记录保存", "error");
      return;
    }
    // 已有句柄但权限失效：先尝试直接重新授权
    if (rootDirHandle && !dirReady) {
      try {
        const p = await rootDirHandle.requestPermission({ mode: "readwrite" });
        if (p === "granted") {
          dirReady = true;
          updateFolderStatus();
          Common.toast("已重新授权本地文件夹");
          return;
        }
        Common.toast("未获得文件夹权限，附件将随记录保存", "error");
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
      els.folderStatus.textContent = "附件将随记录一起保存，仍可预览/下载";
      return;
    }
    if (rootDirHandle && dirReady) {
      els.folderBtn.textContent = "更换保存文件夹";
      els.folderStatus.textContent = "附件将保存到本机项目文件夹 " + ATTACH_SUBDIR;
    } else if (rootDirHandle && !dirReady) {
      els.folderBtn.textContent = "重新授权本地文件夹";
      els.folderStatus.textContent = "文件夹权限已失效；不授权则附件随记录保存";
    } else {
      els.folderBtn.textContent = "选择本地保存文件夹";
      els.folderStatus.textContent = "未选择时，附件将随记录一起保存";
    }
  }

  /* ===== 表单附件区 ===== */

  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    files.forEach((file) => {
      pending.push({ id: newId(), file: file, url: URL.createObjectURL(file) });
    });
    renderPending();
  }

  function clearPending() {
    pending.forEach((item) => URL.revokeObjectURL(item.url));
    pending = [];
    renderPending();
  }

  function renderPending() {
    els.attachList.innerHTML = pending
      .map((item) => {
        const isImg = isImageType(item.file.type);
        const icon = isImg
          ? '<img class="attach-thumb" src="' + item.url + '" alt="">'
          : '<span class="attach-thumb attach-thumb-file">📄</span>';
        return (
          '<li class="attach-item">' +
          icon +
          '<span class="attach-name" title="' + Common.escapeHtml(item.file.name) + '">' +
          Common.escapeHtml(item.file.name) +
          "</span>" +
          '<span class="attach-size">' + formatSize(item.file.size) + "</span>" +
          '<button type="button" class="attach-remove" data-id="' + item.id +
          '" aria-label="移除附件">✕</button></li>'
        );
      })
      .join("");
  }

  // 保存时逐条落地：文件夹可用写文件（记录存 path），否则内嵌 dataUrl
  async function buildAttachments(recId) {
    const out = [];
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      const safeName = sanitizeFileName(item.file.name);
      if (dirReady && rootDirHandle) {
        const fileName = recId + "-" + i + "-" + safeName;
        await writeAttachmentFile(fileName, item.file);
        out.push({
          name: item.file.name,
          type: item.file.type || "",
          size: item.file.size,
          path: ATTACH_SUBDIR + "/" + fileName,
        });
      } else {
        out.push({
          name: item.file.name,
          type: item.file.type || "",
          size: item.file.size,
          dataUrl: await readAsDataURL(item.file),
        });
      }
    }
    return out;
  }

  /* ===== 图片预览 lightbox ===== */

  function openLightbox(src, alt) {
    if (!lightbox) {
      lightbox = document.createElement("div");
      lightbox.className = "kl-lightbox";
      lightbox.hidden = true;
      const img = document.createElement("img");
      img.alt = "";
      lightbox.appendChild(img);
      lightbox.addEventListener("click", closeLightbox);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && lightbox && !lightbox.hidden) closeLightbox();
      });
      document.body.appendChild(lightbox);
    }
    const img = lightbox.querySelector("img");
    img.src = src;
    img.alt = alt || "附件图片预览";
    lightbox.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    lightbox.querySelector("img").src = "";
    document.body.classList.remove("modal-open");
  }

  /* ===== 历史记录渲染 ===== */

  function attachmentItemHtml(att, index) {
    const src = att.dataUrl || encodeURI(att.path || "");
    const name = Common.escapeHtml(att.name || "附件" + (index + 1));
    if (src && isImageAtt(att)) {
      return (
        '<figure class="att-image">' +
        '<img src="' + src + '" alt="' + name + '" data-lightbox="' + src + '" loading="lazy">' +
        "<figcaption>" + name + "</figcaption></figure>"
      );
    }
    return (
      '<a class="att-file" href="' + src + '" download="' + name + '">' +
      '<span class="attach-thumb-file">📎</span>' +
      '<span class="att-file-name">' + name + "</span>" +
      '<span class="att-file-size">' + formatSize(att.size) + "</span>" +
      '<span class="att-file-dl">下载</span></a>'
    );
  }

  function attachmentsHtml(rec) {
    const list = Array.isArray(rec.attachments) ? rec.attachments : [];
    if (!list.length) return "";
    return (
      '<div class="knowledge-attachments">' +
      '<div class="knowledge-attachments-label">附件（' + list.length + "）</div>" +
      '<div class="att-grid">' +
      list.map(attachmentItemHtml).join("") +
      "</div></div>"
    );
  }

  function itemHtml(rec, isToday) {
    const head =
      '<div class="knowledge-head">' +
      '<span class="knowledge-date">' + Common.escapeHtml(rec.date) + "</span>" +
      '<span class="knowledge-weekday">' + Common.escapeHtml(Common.weekdayOf(rec.date)) + "</span>" +
      (isToday ? '<span class="badge-today">今天</span>' : "") +
      (rec.source
        ? '<span class="knowledge-source">来源：' + Common.escapeHtml(rec.source) + "</span>"
        : "") +
      "</div>";
    const point =
      '<div class="knowledge-point">' + Common.escapeHtml(rec.point) + "</div>";
    const insight = rec.insight
      ? '<div class="knowledge-insight"><span class="knowledge-insight-label">心得感悟</span>' +
        Common.escapeHtml(rec.insight) + "</div>"
      : "";
    return (
      '<article class="knowledge-item card">' + head + point + insight + attachmentsHtml(rec) + "</article>"
    );
  }

  function renderList() {
    sortRecords();
    const today = Common.todayStr();
    els.list.innerHTML = records
      .map((rec) => itemHtml(rec, rec.date === today))
      .join("");
    els.emptyHint.hidden = records.length > 0;
  }

  /* ===== 表单逻辑 ===== */

  function updateWeekday() {
    els.weekday.textContent = els.date.value
      ? Common.weekdayOf(els.date.value)
      : "";
  }

  function resetForm() {
    els.form.reset();
    els.date.value = Common.todayStr();
    updateWeekday();
    clearPending();
    els.submitBtn.textContent = "保存记录";
  }

  function setSaving(state) {
    saving = state;
    els.submitBtn.disabled = state;
    els.submitBtn.textContent = state ? "保存中…" : "保存记录";
  }

  function sortRecords() {
    records.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    const point = els.point.value.trim();
    if (!point) {
      Common.toast("请填写知识点", "error");
      return;
    }
    if (!els.date.value) {
      Common.toast("请先选择日期", "error");
      return;
    }

    // 未选本地文件夹时走内嵌，容量有限，先给个保护
    if (pending.length && !dirReady) {
      const total = pending.reduce((sum, item) => sum + (item.file.size || 0), 0);
      if (total > EMBED_LIMIT) {
        Common.toast(
          "附件共 " + formatSize(total) + "，偏大。建议先点「选择本地保存文件夹」，否则容易超出浏览器容量",
          "error"
        );
        return;
      }
    }

    setSaving(true);
    try {
      const now = Date.now();
      const recId = newId();
      const attachments = pending.length ? await buildAttachments(recId) : [];
      records.push({
        id: recId,
        date: els.date.value,
        source: els.source.value.trim(),
        point: point,
        insight: els.insight.value.trim(),
        attachments: attachments,
        createdAt: now,
        updatedAt: now,
      });
      await Storage.save(records, FILE_PATH);
      Common.toast("已保存");
      resetForm();
      renderList();
    } catch (err) {
      console.error("保存知识点失败", err);
      Common.toast("保存失败：" + (err && err.message ? err.message : "未知错误"), "error");
      // 回滚内存改动，保留用户已填写内容
      try {
        records = (await Storage.load(FILE_PATH)).filter((r) => r && r.id);
      } catch (_) {
        /* 忽略回滚读取失败 */
      }
      renderList();
    } finally {
      setSaving(false);
    }
  }

  async function init() {
    els.form = $("#knowledge-form");
    els.date = $("#record-date");
    els.weekday = $("#weekday-display");
    els.source = $("#knowledge-source");
    els.point = $("#knowledge-point");
    els.insight = $("#knowledge-insight");
    els.attachArea = $("#attach-area");
    els.attachInput = $("#attach-input");
    els.attachList = $("#attach-list");
    els.folderBtn = $("#attach-folder-btn");
    els.folderStatus = $("#attach-folder-status");
    els.submitBtn = $("#submit-btn");
    els.list = $("#knowledge-list");
    els.loading = $("#knowledge-loading");
    els.emptyHint = $("#empty-hint");

    els.date.value = Common.todayStr();
    updateWeekday();
    els.date.addEventListener("change", updateWeekday);
    els.form.addEventListener("submit", handleSubmit);

    // 附件区：点击选择文件、粘贴图片
    els.attachArea.addEventListener("click", () => els.attachInput.click());
    els.attachInput.addEventListener("change", () => {
      addFiles(els.attachInput.files);
      els.attachInput.value = "";
    });
    els.attachArea.addEventListener("paste", (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    });
    els.attachList.addEventListener("click", (e) => {
      const btn = e.target.closest(".attach-remove");
      if (!btn) return;
      const idx = pending.findIndex((item) => item.id === btn.getAttribute("data-id"));
      if (idx >= 0) {
        URL.revokeObjectURL(pending[idx].url);
        pending.splice(idx, 1);
        renderPending();
      }
    });
    els.folderBtn.addEventListener("click", handleFolderBtn);

    // 历史记录里点击图片放大预览
    els.list.addEventListener("click", (e) => {
      const img = e.target.closest("img[data-lightbox]");
      if (img) openLightbox(img.getAttribute("data-lightbox"), img.alt);
    });

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
      records = raw.filter((r) => r && r.id);
    } catch (err) {
      console.error("读取知识点失败", err);
      records = [];
      Common.toast("读取失败：" + (err && err.message ? err.message : "未知错误"), "error");
    }
    els.loading.hidden = true;
    renderList();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
