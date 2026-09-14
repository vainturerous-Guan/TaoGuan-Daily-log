// 生活日常记录频道逻辑
// 数据结构：{ id, date, summary, sleep:{bedTime,wakeTime}, weight:{night,morning}(kg),
//            diet:{snacks,meals}, todayRecord, work, parenting:{life,mindful,reflection},
//            createdAt, updatedAt }
(function () {
  "use strict";

  const UNIT_KEY = "taoguan_weight_unit"; // 体重显示单位：jin(斤,默认) / kg(公斤)
  const UNIT_LABEL = { jin: "斤", kg: "公斤" };
  const JIN_PER_KG = 2;

  let records = [];
  let editingId = null;
  let saving = false;
  let unit = loadUnit();
  let modal = null; // { overlay, form, fields, recordId }

  const els = {};

  function $(sel) {
    return document.querySelector(sel);
  }

  function loadUnit() {
    try {
      const v = localStorage.getItem(UNIT_KEY);
      return v === "kg" ? "kg" : "jin";
    } catch (e) {
      return "jin";
    }
  }

  function saveUnit() {
    try {
      localStorage.setItem(UNIT_KEY, unit);
    } catch (e) {
      /* 忽略 */
    }
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  // kg → 显示单位（u 缺省为当前单位）
  function kgToDisplay(kg, u) {
    if (kg == null || isNaN(kg)) return "";
    u = u || unit;
    return String(round1(u === "jin" ? kg * JIN_PER_KG : kg));
  }

  // 显示单位 → kg（u 缺省为当前单位，返回 number|null）
  function displayToKg(value, u) {
    const v = parseFloat(value);
    if (isNaN(v)) return null;
    u = u || unit;
    const kg = u === "jin" ? v / JIN_PER_KG : v;
    return Math.round(kg * 100) / 100;
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- 旧结构归一化 ---------- */

  // 从旧文本中提取两个时间点，如 "昨晚 23:30 睡，今早 7 点醒来" → { bedTime: "23:30", wakeTime: "7 点" }
  function splitSleepText(text) {
    const matches = text.match(/\d{1,2}\s*[:：点时]\s*\d{0,2}/g) || [];
    if (matches.length >= 2) return { bedTime: matches[0], wakeTime: matches[1] };
    if (matches.length === 1) return { bedTime: matches[0], wakeTime: "" };
    return { bedTime: text, wakeTime: "" };
  }

  function numOrNull(v) {
    const n = Number(v);
    return v == null || v === "" || isNaN(n) ? null : n;
  }

  function strOrEmpty(v) {
    return typeof v === "string" ? v : v == null ? "" : String(v);
  }

  // 旧结构（dailyLog/sleep 字符串、weight 数字、diet 字符串、lifeParenting/reflections）→ 新结构
  // 幂等：新结构记录原样通过
  function normalizeRecord(rec) {
    if (!rec || typeof rec !== "object") return null;
    const oldParts = [];
    if (strOrEmpty(rec.dailyLog).trim()) oldParts.push(strOrEmpty(rec.dailyLog));
    if (strOrEmpty(rec.reflections).trim()) oldParts.push(strOrEmpty(rec.reflections));

    const sleep =
      rec.sleep && typeof rec.sleep === "object"
        ? { bedTime: strOrEmpty(rec.sleep.bedTime), wakeTime: strOrEmpty(rec.sleep.wakeTime) }
        : splitSleepText(strOrEmpty(rec.sleep).trim());

    const weight =
      rec.weight && typeof rec.weight === "object"
        ? { night: numOrNull(rec.weight.night), morning: numOrNull(rec.weight.morning) }
        : { night: null, morning: numOrNull(rec.weight) }; // 旧单值体重归入早起

    const diet =
      rec.diet && typeof rec.diet === "object"
        ? { snacks: strOrEmpty(rec.diet.snacks), meals: strOrEmpty(rec.diet.meals) }
        : { snacks: strOrEmpty(rec.diet), meals: "" };

    const parenting =
      rec.parenting && typeof rec.parenting === "object"
        ? {
            life: strOrEmpty(rec.parenting.life),
            mindful: strOrEmpty(rec.parenting.mindful),
            reflection: strOrEmpty(rec.parenting.reflection),
          }
        : { life: strOrEmpty(rec.lifeParenting), mindful: "", reflection: "" };

    return {
      id: rec.id || newId(),
      date: rec.date || "",
      summary: strOrEmpty(rec.summary),
      sleep: sleep,
      weight: weight,
      diet: diet,
      todayRecord:
        strOrEmpty(rec.todayRecord).trim() || oldParts.join("\n\n"),
      work: strOrEmpty(rec.work),
      parenting: parenting,
      createdAt: rec.createdAt || Date.now(),
      updatedAt: rec.updatedAt || rec.createdAt || Date.now(),
    };
  }

  /* ---------- 表单字段访问 ---------- */

  // 顶部表单与模态框表单结构一致；模态框克隆的字段 id 带 -m 后缀
  function getFields(root) {
    const q = (id) => root.querySelector("#" + id) || root.querySelector("#" + id + "-m");
    return {
      date: q("record-date"),
      weekday: q("weekday-display"),
      summary: q("summary"),
      bedTime: q("bed-time"),
      wakeTime: q("wake-time"),
      weightNight: q("weight-night"),
      weightMorning: q("weight-morning"),
      dietSnacks: q("diet-snacks"),
      dietMeals: q("diet-meals"),
      todayRecord: q("today-record"),
      work: q("work"),
      pLife: q("parenting-life"),
      pMindful: q("parenting-mindful"),
      pReflection: q("parenting-reflection"),
    };
  }

  function readForm(f) {
    return {
      date: f.date.value,
      summary: f.summary.value.trim(),
      sleep: { bedTime: f.bedTime.value.trim(), wakeTime: f.wakeTime.value.trim() },
      weight: { night: displayToKg(f.weightNight.value), morning: displayToKg(f.weightMorning.value) },
      diet: { snacks: f.dietSnacks.value.trim(), meals: f.dietMeals.value.trim() },
      todayRecord: f.todayRecord.value.trim(),
      work: f.work.value.trim(),
      parenting: {
        life: f.pLife.value.trim(),
        mindful: f.pMindful.value.trim(),
        reflection: f.pReflection.value.trim(),
      },
    };
  }

  function fillForm(f, rec) {
    f.date.value = rec.date;
    f.summary.value = rec.summary || "";
    f.bedTime.value = rec.sleep.bedTime || "";
    f.wakeTime.value = rec.sleep.wakeTime || "";
    f.weightNight.value = kgToDisplay(rec.weight.night);
    f.weightMorning.value = kgToDisplay(rec.weight.morning);
    f.dietSnacks.value = rec.diet.snacks || "";
    f.dietMeals.value = rec.diet.meals || "";
    f.todayRecord.value = rec.todayRecord || "";
    f.work.value = rec.work || "";
    f.pLife.value = rec.parenting.life || "";
    f.pMindful.value = rec.parenting.mindful || "";
    f.pReflection.value = rec.parenting.reflection || "";
    if (f.weekday) {
      f.weekday.textContent = rec.date ? Common.weekdayOf(rec.date) : "";
    }
  }

  function clearForm(f) {
    f.summary.value = "";
    f.bedTime.value = "";
    f.wakeTime.value = "";
    f.weightNight.value = "";
    f.weightMorning.value = "";
    f.dietSnacks.value = "";
    f.dietMeals.value = "";
    f.todayRecord.value = "";
    f.work.value = "";
    f.pLife.value = "";
    f.pMindful.value = "";
    f.pReflection.value = "";
  }

  function updateUnitLabels() {
    document.querySelectorAll(".unit-label").forEach((el) => {
      el.textContent = UNIT_LABEL[unit];
    });
    document.querySelectorAll(".unit-toggle button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.unit === unit);
    });
  }

  // 切换单位时，把表单里已填数字从旧单位换算为新单位
  function convertWeightInputs(fromUnit, toUnit) {
    [getFields(els.form), modal && modal.form ? getFields(modal.form) : null]
      .filter(Boolean)
      .forEach((f) => {
        [f.weightNight, f.weightMorning].forEach((input) => {
          const kg = displayToKg(input.value, fromUnit);
          input.value = kg == null ? "" : kgToDisplay(kg, toUnit);
        });
      });
  }

  function setUnit(next) {
    if (next !== "jin" && next !== "kg") return;
    if (next === unit) return;
    const prev = unit;
    convertWeightInputs(prev, next);
    unit = next;
    saveUnit();
    updateUnitLabels();
    renderList();
  }

  /* ---------- 顶部表单逻辑 ---------- */

  function latestRecordOfDate(date) {
    const sameDay = records.filter((r) => r.date === date);
    if (!sameDay.length) return null;
    return sameDay.reduce((a, b) => ((b.updatedAt || 0) > (a.updatedAt || 0) ? b : a));
  }

  function updateFormMode() {
    if (editingId) {
      els.submitBtn.textContent = "更新记录";
      els.formTitle.textContent = "编辑记录";
      els.cancelEditBtn.hidden = false;
    } else {
      const rec = latestRecordOfDate(els.fields.date.value);
      els.submitBtn.textContent = rec ? "更新记录" : "保存记录";
      els.formTitle.textContent = "今日记录";
      els.cancelEditBtn.hidden = true;
    }
  }

  function resetForm() {
    editingId = null;
    els.form.reset();
    els.fields.date.value = Common.todayStr();
    clearForm(els.fields);
    // 今天已有记录时预填，避免空表单覆盖已有数据
    const todayRec = latestRecordOfDate(els.fields.date.value);
    if (todayRec) fillForm(els.fields, todayRec);
    editingId = todayRec ? todayRec.id : null;
    updateWeekday();
    updateFormMode();
  }

  function updateWeekday() {
    els.fields.weekday.textContent = els.fields.date.value
      ? Common.weekdayOf(els.fields.date.value)
      : "";
  }

  function setSaving(state) {
    saving = state;
    els.submitBtn.disabled = state;
    if (state) {
      els.submitBtn.textContent = "保存中…";
    } else {
      updateFormMode();
    }
  }

  async function persist() {
    await Storage.save(records);
  }

  // 把底层错误翻译成用户能看懂、且带排查线索的提示
  function friendlyError(err, action) {
    const status = err && err.status;
    if (status === 401) return action + "失败（401）：浏览器里保存的令牌无效，请点页脚「清除令牌」，然后重新粘贴输入";
    if (status === 403) return action + "失败（403）：令牌权限不足，请重新创建只含本仓库 Contents 读写权限的令牌";
    if (status === 409 || status === 422) return action + "失败（" + status + "）：数据被其他页面更新过，请刷新后重试";
    if (status) return action + "失败（" + status + "），请刷新重试或联系维护者";
    return action + "失败：网络连不上 GitHub，请检查网络后重试";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    const data = readForm(els.fields);
    if (!data.date) {
      Common.toast("请先选择日期", "error");
      return;
    }

    setSaving(true);
    try {
      const now = Date.now();
      if (editingId) {
        const idx = records.findIndex((r) => r.id === editingId);
        if (idx === -1) throw new Error("记录不存在");
        records[idx] = Object.assign({}, records[idx], data, { updatedAt: now });
      } else {
        const existing = latestRecordOfDate(data.date);
        if (existing) {
          // 该日期已有记录 → 更新它，避免同一天多条重复
          Object.assign(existing, data, { updatedAt: now });
          editingId = existing.id;
        } else {
          records.push(Object.assign({ id: newId(), createdAt: now, updatedAt: now }, data));
        }
      }
      await persist();
      Common.toast("已保存");
      resetForm();
      renderList();
    } catch (err) {
      console.error("保存失败", err);
      Common.toast(friendlyError(err, "保存"), "error");
      // 回滚内存改动，保留用户已填写内容
      try {
        records = (await Storage.load()).map(normalizeRecord).filter(Boolean);
      } catch (_) {
        /* 忽略回滚读取失败 */
      }
      renderList();
    } finally {
      setSaving(false);
    }
  }

  function handleDateChange() {
    updateWeekday();
    // 所选日期已有记录时预填并进入更新模式；无记录则退出编辑模式
    const existing = latestRecordOfDate(els.fields.date.value);
    if (existing) {
      fillForm(els.fields, existing);
      editingId = existing.id;
    } else {
      editingId = null;
    }
    updateFormMode();
  }

  /* ---------- 历史记录表格 ---------- */

  function sortRecords() {
    records.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function escapeAttr(s) {
    return Common.escapeHtml(s).replace(/"/g, "&quot;");
  }

  function clampCell(html, fullText) {
    if (!fullText || !fullText.trim()) return '<span class="cell-empty">—</span>';
    return (
      '<div class="clamp3" title="' + escapeAttr(fullText) + '">' + html + "</div>"
    );
  }

  function labeledLines(parts) {
    // parts: [{label, text}] → 带小标签的行
    return parts
      .filter((p) => p.text && p.text.trim())
      .map(
        (p) =>
          '<div class="cell-line"><span class="cell-label">' +
          Common.escapeHtml(p.label) +
          '</span>' +
          Common.escapeHtml(p.text) +
          "</div>"
      )
      .join("");
  }

  function cellSleepHtml(rec) {
    const lines = [];
    if (rec.sleep.bedTime) lines.push("昨晚" + rec.sleep.bedTime + "睡");
    if (rec.sleep.wakeTime) lines.push("今早" + rec.sleep.wakeTime + "起");
    const html = lines
      .map((l) => '<div class="cell-line">' + Common.escapeHtml(l) + "</div>")
      .join("");
    return clampCell(html, lines.join("\n"));
  }

  function cellWeightHtml(rec) {
    const label = UNIT_LABEL[unit];
    const lines = [];
    if (rec.weight.night != null) lines.push("睡前 " + kgToDisplay(rec.weight.night) + label);
    if (rec.weight.morning != null) lines.push("早起 " + kgToDisplay(rec.weight.morning) + label);
    const html = lines
      .map((l) => '<div class="cell-line">' + Common.escapeHtml(l) + "</div>")
      .join("");
    return clampCell(html, lines.join("\n"));
  }

  function cellDietHtml(rec) {
    const full = [rec.diet.snacks, rec.diet.meals].filter((s) => s && s.trim()).join("\n");
    return clampCell(
      labeledLines([
        { label: "零食·饮料 ", text: rec.diet.snacks },
        { label: "正餐 ", text: rec.diet.meals },
      ]),
      full
    );
  }

  function cellParentingHtml(rec) {
    const full = [rec.parenting.life, rec.parenting.mindful, rec.parenting.reflection]
      .filter((s) => s && s.trim())
      .join("\n");
    return clampCell(
      labeledLines([
        { label: "生活&育儿 ", text: rec.parenting.life },
        { label: "正念 ", text: rec.parenting.mindful },
        { label: "反思 ", text: rec.parenting.reflection },
      ]),
      full
    );
  }

  function rowHtml(rec, isToday) {
    const dateHtml =
      '<div class="cell-date">' +
      Common.escapeHtml(rec.date) +
      (isToday ? ' <span class="badge-today">今天</span>' : "") +
      "</div>" +
      '<div class="cell-weekday">' + Common.escapeHtml(Common.weekdayOf(rec.date)) + "</div>" +
      (rec.summary
        ? '<div class="cell-summary clamp2" title="' + escapeAttr(rec.summary) + '">' +
          Common.escapeHtml(rec.summary) + "</div>"
        : "");

    const todayHtml = rec.todayRecord
      ? '<div class="clamp3" title="' + escapeAttr(rec.todayRecord) + '">' +
        Common.escapeHtml(rec.todayRecord) + "</div>"
      : '<span class="cell-empty">—</span>';
    const workHtml = rec.work
      ? '<div class="clamp3" title="' + escapeAttr(rec.work) + '">' +
        Common.escapeHtml(rec.work) + "</div>"
      : '<span class="cell-empty">—</span>';

    return (
      '<tr data-id="' + escapeAttr(rec.id) + '">' +
      '<td class="col-date">' + dateHtml + "</td>" +
      '<td class="col-sleep">' + cellSleepHtml(rec) + "</td>" +
      '<td class="col-weight">' + cellWeightHtml(rec) + "</td>" +
      '<td class="col-diet">' + cellDietHtml(rec) + "</td>" +
      '<td class="col-today">' + todayHtml + "</td>" +
      '<td class="col-work">' + workHtml + "</td>" +
      '<td class="col-parenting">' + cellParentingHtml(rec) + "</td>" +
      '<td class="col-actions"><button type="button" class="btn btn-small" data-action="edit">编辑</button></td>' +
      "</tr>"
    );
  }

  function renderList() {
    sortRecords();
    els.list.querySelectorAll(".table-wrap").forEach((n) => n.remove());

    if (!records.length) {
      els.emptyHint.hidden = false;
      return;
    }
    els.emptyHint.hidden = true;

    const today = Common.todayStr();
    const rows = records.map((rec) => rowHtml(rec, rec.date === today)).join("");

    const wrap = document.createElement("div");
    wrap.className = "table-wrap card";
    wrap.innerHTML =
      '<table class="records-table">' +
      "<colgroup>" +
      '<col class="col-date"><col class="col-sleep"><col class="col-weight"><col class="col-diet">' +
      '<col class="col-today"><col class="col-work"><col class="col-parenting"><col class="col-actions">' +
      "</colgroup>" +
      "<thead><tr>" +
      "<th>日期</th><th>睡眠</th><th>体重</th><th>饮食</th>" +
      "<th>今日记录</th><th>工作</th><th>生活和育儿</th><th>操作</th>" +
      "</tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
      "</table>";
    els.list.appendChild(wrap);
  }

  /* ---------- 编辑模态框 ---------- */

  function buildModal() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.hidden = true;

    const box = document.createElement("div");
    box.className = "modal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "编辑记录");

    const head = document.createElement("div");
    head.className = "modal-head";
    const title = document.createElement("h3");
    title.textContent = "编辑记录";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "modal-close";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.textContent = "✕";
    head.appendChild(title);
    head.appendChild(closeBtn);

    // 克隆顶部表单，保证字段布局完全一致
    const form = els.form.cloneNode(true);
    form.removeAttribute("id");
    form.querySelectorAll("[id]").forEach((el) => {
      const old = el.id;
      el.id = old + "-m";
      form.querySelectorAll('label[for="' + old + '"]').forEach((l) =>
        l.setAttribute("for", el.id)
      );
    });
    const submitBtn = form.querySelector("#submit-btn-m");
    const cancelBtn = form.querySelector("#cancel-edit-btn-m");
    submitBtn.textContent = "更新记录";
    cancelBtn.hidden = false;
    cancelBtn.textContent = "取消";

    const body = document.createElement("div");
    body.className = "modal-body";
    body.appendChild(form);
    box.appendChild(head);
    box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    modal = { overlay: overlay, form: form, fields: getFields(form), recordId: null };

    closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    cancelBtn.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal && !modal.overlay.hidden) closeModal();
    });
    form.addEventListener("submit", handleModalSubmit);
    modal.fields.date.addEventListener("change", () => {
      modal.fields.weekday.textContent = modal.fields.date.value
        ? Common.weekdayOf(modal.fields.date.value)
        : "";
    });
  }

  function openEditModal(rec) {
    if (!modal) buildModal();
    modal.recordId = rec.id;
    fillForm(modal.fields, rec);
    modal.overlay.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeModal() {
    if (!modal) return;
    modal.overlay.hidden = true;
    modal.recordId = null;
    document.body.classList.remove("modal-open");
  }

  async function handleModalSubmit(e) {
    e.preventDefault();
    const rec = records.find((r) => r.id === modal.recordId);
    if (!rec) {
      closeModal();
      return;
    }
    const data = readForm(modal.fields);
    if (!data.date) {
      Common.toast("请先选择日期", "error");
      return;
    }
    const submitBtn = modal.form.querySelector("#submit-btn-m");
    submitBtn.disabled = true;
    submitBtn.textContent = "保存中…";
    try {
      Object.assign(rec, data, { updatedAt: Date.now() });
      await persist();
      Common.toast("已保存");
      closeModal();
      renderList();
    } catch (err) {
      console.error("保存失败", err);
      Common.toast(friendlyError(err, "保存"), "error");
      try {
        records = (await Storage.load()).map(normalizeRecord).filter(Boolean);
      } catch (_) {
        /* 忽略 */
      }
      renderList();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "更新记录";
    }
  }

  function handleListClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn || btn.dataset.action !== "edit") return;
    const tr = btn.closest("tr");
    const id = tr && tr.dataset.id;
    const rec = records.find((r) => r.id === id);
    if (!rec) return;
    openEditModal(rec);
  }

  /* ---------- 初始化 ---------- */

  function cacheEls() {
    els.form = $("#daily-form");
    els.fields = getFields(els.form);
    els.submitBtn = $("#submit-btn");
    els.cancelEditBtn = $("#cancel-edit-btn");
    els.formTitle = $("#form-title");
    els.list = $("#record-list");
    els.emptyHint = $("#empty-hint");
  }

  async function init() {
    cacheEls();
    els.fields.date.value = Common.todayStr();
    updateUnitLabels();
    updateWeekday();
    updateFormMode();

    els.form.addEventListener("submit", handleSubmit);
    els.fields.date.addEventListener("change", handleDateChange);
    els.list.addEventListener("click", handleListClick);
    els.cancelEditBtn.addEventListener("click", () => {
      resetForm();
      renderList();
    });
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".unit-toggle button[data-unit]");
      if (btn) setUnit(btn.dataset.unit);
    });

    try {
      const raw = await Storage.load();
      records = raw.map(normalizeRecord).filter(Boolean);
    } catch (err) {
      console.error("读取记录失败", err);
      records = [];
      Common.toast(friendlyError(err, "读取"), "error");
    }
    renderList();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
