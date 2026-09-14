// 知识点积累频道逻辑
// 数据结构：{ id, date, source, point, insight, createdAt, updatedAt }
// 同一天允许多条，各自独立
(function () {
  "use strict";

  const FILE_PATH = "data/knowledge.json";

  let records = [];
  let saving = false;

  const els = {};

  function $(sel) {
    return document.querySelector(sel);
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function updateWeekday() {
    els.weekday.textContent = els.date.value
      ? Common.weekdayOf(els.date.value)
      : "";
  }

  function resetForm() {
    els.form.reset();
    els.date.value = Common.todayStr();
    updateWeekday();
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
      '<article class="knowledge-item card">' + head + point + insight + "</article>"
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

    setSaving(true);
    try {
      const now = Date.now();
      records.push({
        id: newId(),
        date: els.date.value,
        source: els.source.value.trim(),
        point: point,
        insight: els.insight.value.trim(),
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
    els.submitBtn = $("#submit-btn");
    els.list = $("#knowledge-list");
    els.loading = $("#knowledge-loading");
    els.emptyHint = $("#empty-hint");

    els.date.value = Common.todayStr();
    updateWeekday();
    els.date.addEventListener("change", updateWeekday);
    els.form.addEventListener("submit", handleSubmit);

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
