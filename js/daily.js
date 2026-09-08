// 生活日常记录频道逻辑
(function () {
  "use strict";

  const PREVIEW_LEN = 60;

  let records = [];
  let editingId = null;
  let expandedIds = new Set();
  let saving = false;

  const $ = (sel) => document.querySelector(sel);

  const els = {};

  function cacheEls() {
    els.form = $("#daily-form");
    els.date = $("#record-date");
    els.weekday = $("#weekday-display");
    els.weight = $("#weight");
    els.dailyLog = $("#daily-log");
    els.sleep = $("#sleep");
    els.diet = $("#diet");
    els.work = $("#work");
    els.lifeParenting = $("#life-parenting");
    els.reflections = $("#reflections");
    els.submitBtn = $("#submit-btn");
    els.cancelEditBtn = $("#cancel-edit-btn");
    els.formTitle = $("#form-title");
    els.list = $("#record-list");
    els.emptyHint = $("#empty-hint");
  }

  function newId() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    );
  }

  function readForm() {
    const weightRaw = els.weight.value.trim();
    const weight = weightRaw === "" ? null : Number(weightRaw);
    return {
      date: els.date.value,
      dailyLog: els.dailyLog.value.trim(),
      sleep: els.sleep.value.trim(),
      diet: els.diet.value.trim(),
      weight: weight == null || isNaN(weight) ? null : weight,
      work: els.work.value.trim(),
      lifeParenting: els.lifeParenting.value.trim(),
      reflections: els.reflections.value.trim(),
    };
  }

  function fillForm(rec) {
    els.date.value = rec.date;
    els.dailyLog.value = rec.dailyLog || "";
    els.sleep.value = rec.sleep || "";
    els.diet.value = rec.diet || "";
    els.weight.value = rec.weight == null ? "" : String(rec.weight);
    els.work.value = rec.work || "";
    els.lifeParenting.value = rec.lifeParenting || "";
    els.reflections.value = rec.reflections || "";
    updateWeekday();
  }

  function resetForm() {
    editingId = null;
    els.form.reset();
    els.date.value = Common.todayStr();
    // 今天已有记录时预填，避免空表单覆盖已有数据
    const todayRec = latestRecordOfDate(els.date.value);
    if (todayRec) fillForm(todayRec);
    editingId = todayRec ? todayRec.id : null;
    updateWeekday();
    updateFormMode();
  }

  function updateWeekday() {
    els.weekday.textContent = els.date.value
      ? Common.weekdayOf(els.date.value)
      : "";
  }

  function updateFormMode() {
    if (editingId) {
      els.submitBtn.textContent = "更新记录";
      els.formTitle.textContent = "编辑记录";
      els.cancelEditBtn.hidden = false;
    } else {
      // 所选日期已有记录时提示将进入更新模式
      const rec = latestRecordOfDate(els.date.value);
      els.submitBtn.textContent = rec ? "更新记录" : "保存记录";
      els.formTitle.textContent = "今日记录";
      els.cancelEditBtn.hidden = true;
    }
  }

  function latestRecordOfDate(date) {
    const sameDay = records.filter((r) => r.date === date);
    if (!sameDay.length) return null;
    return sameDay.reduce((a, b) =>
      (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a
    );
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

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    const data = readForm();
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
        records[idx] = Object.assign({}, records[idx], data, {
          updatedAt: now,
        });
      } else {
        const existing = latestRecordOfDate(data.date);
        if (existing) {
          // 该日期已有记录 → 更新它，避免同一天多条重复
          Object.assign(existing, data, { updatedAt: now });
          editingId = existing.id;
        } else {
          records.push(
            Object.assign({ id: newId(), createdAt: now, updatedAt: now }, data)
          );
        }
      }
      await Storage.save(records);
      Common.toast("已保存");
      expandedIds.clear();
      resetForm();
      renderList();
    } catch (err) {
      console.error("保存失败", err);
      Common.toast("保存失败，请检查网络后重试", "error");
      // 回滚内存改动，保留用户已填写内容
      try {
        records = await Storage.load();
      } catch (_) {
        /* 忽略回滚读取失败 */
      }
      renderList();
    } finally {
      setSaving(false);
    }
  }

  function sortRecords() {
    records.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function previewText(rec) {
    const text = rec.dailyLog || "";
    if (text.length <= PREVIEW_LEN) return text;
    return text.slice(0, PREVIEW_LEN) + "…";
  }

  function detailSection(title, content) {
    if (!content && content !== 0) return "";
    return (
      '<div class="detail-section"><h4>' +
      Common.escapeHtml(title) +
      "</h4><p>" +
      Common.escapeHtml(content) +
      "</p></div>"
    );
  }

  function detailHtml(rec) {
    let html = "";
    html += detailSection("一日流水账", rec.dailyLog);
    const habits = [];
    if (rec.sleep) habits.push("睡眠：" + rec.sleep);
    if (rec.diet) habits.push("饮食·含糖饮料/零食：" + rec.diet);
    if (habits.length) html += detailSection("生活习惯", habits.join("\n"));
    if (rec.weight != null) {
      html += detailSection("健康追踪", "体重：" + rec.weight + " kg");
    }
    html += detailSection("工作", rec.work);
    html += detailSection("生活&育儿", rec.lifeParenting);
    html += detailSection("记录或感悟", rec.reflections);
    return html || '<div class="detail-section"><p>（本条记录没有内容）</p></div>';
  }

  function renderList() {
    sortRecords();
    els.list
      .querySelectorAll(".record-item")
      .forEach((node) => node.remove());

    if (!records.length) {
      els.emptyHint.hidden = false;
      return;
    }
    els.emptyHint.hidden = true;

    const today = Common.todayStr();
    const frag = document.createDocumentFragment();
    records.forEach((rec) => {
      const item = document.createElement("article");
      item.className = "record-item";
      item.dataset.id = rec.id;

      const isToday = rec.date === today;
      const isEditing = rec.id === editingId;
      const expanded = expandedIds.has(rec.id);

      let header = "";
      header += '<div class="record-header">';
      header += '<span class="record-date">' + Common.escapeHtml(rec.date) + "</span>";
      header += '<span class="record-meta">' + Common.escapeHtml(Common.weekdayOf(rec.date)) + "</span>";
      if (isToday) header += '<span class="badge-today">今天</span>';
      if (isEditing) header += '<span class="badge-edit">编辑中</span>';
      if (rec.weight != null) {
        header += '<span class="record-meta">体重 ' + Common.escapeHtml(rec.weight) + " kg</span>";
      }
      header += '<div class="record-actions">';
      header += '<button type="button" class="btn btn-small" data-action="toggle">' + (expanded ? "收起" : "查看") + "</button>";
      header += '<button type="button" class="btn btn-small" data-action="edit">编辑</button>';
      header += "</div></div>";
      item.innerHTML = header;

      if (!expanded) {
        const preview = document.createElement("p");
        preview.className = "record-preview";
        preview.textContent = previewText(rec) || "（无流水账内容）";
        item.appendChild(preview);
      } else {
        const detail = document.createElement("div");
        detail.className = "record-detail";
        detail.innerHTML = detailHtml(rec);
        item.appendChild(detail);
      }

      frag.appendChild(item);
    });
    els.list.appendChild(frag);
  }

  function handleListClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const item = btn.closest(".record-item");
    const id = item && item.dataset.id;
    if (!id) return;
    const rec = records.find((r) => r.id === id);
    if (!rec) return;

    if (btn.dataset.action === "toggle") {
      if (expandedIds.has(id)) {
        expandedIds.delete(id);
      } else {
        expandedIds.add(id);
      }
      renderList();
    } else if (btn.dataset.action === "edit") {
      editingId = id;
      fillForm(rec);
      updateFormMode();
      renderList();
      const formCard = document.querySelector(".form-card");
      if (formCard) {
        formCard.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      els.dailyLog.focus({ preventScroll: true });
    }
  }

  function handleDateChange() {
    updateWeekday();
    // 所选日期已有记录时预填并进入更新模式；无记录则退出编辑模式
    const existing = latestRecordOfDate(els.date.value);
    if (existing) {
      fillForm(existing);
      editingId = existing.id;
    } else {
      editingId = null;
    }
    updateFormMode();
  }

  async function init() {
    cacheEls();
    els.date.value = Common.todayStr();
    updateWeekday();
    updateFormMode();

    els.form.addEventListener("submit", handleSubmit);
    els.date.addEventListener("change", handleDateChange);
    els.list.addEventListener("click", handleListClick);
    els.cancelEditBtn.addEventListener("click", () => {
      resetForm();
      renderList();
    });

    try {
      records = await Storage.load();
    } catch (err) {
      console.error("读取记录失败", err);
      records = [];
      Common.toast("读取记录失败，请刷新重试", "error");
    }
    renderList();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
