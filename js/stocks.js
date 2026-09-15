// 股票监控与分析频道逻辑
// 1) 左侧抽屉页签切换：股票监控（iframe 承载 stock-monitor.html）/ 交易体系学习
// 2) 交易体系学习：{ id, date, name, point, createdAt, updatedAt }
//    存 data/stock-learning.json（GitHub 模式）/ localStorage（本地模式），复用 Storage 模块
(function () {
  "use strict";

  const FILE_PATH = "data/stock-learning.json";

  let records = [];
  let saving = false;
  const els = {};

  function $(sel) {
    return document.querySelector(sel);
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ===== 抽屉页签 ===== */

  function activateTab(name) {
    els.tabs.forEach((tab) => {
      if (tab.getAttribute("data-tab") === name) {
        tab.setAttribute("aria-current", "true");
      } else {
        tab.removeAttribute("aria-current");
      }
    });
    Object.keys(els.panels).forEach((key) => {
      els.panels[key].hidden = key !== name;
    });
  }

  function closeDrawer() {
    els.drawer.classList.remove("open");
    els.drawerToggle.setAttribute("aria-expanded", "false");
    els.overlay.hidden = true;
  }

  function initTabsAndDrawer() {
    els.drawerToggle = $("#drawer-toggle");
    els.drawer = $("#stocks-drawer");
    els.overlay = $("#drawer-overlay");
    els.tabs = Array.from(document.querySelectorAll(".drawer-tab"));
    els.panels = {
      monitor: $("#panel-monitor"),
      learning: $("#panel-learning"),
    };

    els.drawerToggle.addEventListener("click", () => {
      const open = els.drawer.classList.toggle("open");
      els.drawerToggle.setAttribute("aria-expanded", String(open));
      els.overlay.hidden = !open;
    });
    els.overlay.addEventListener("click", closeDrawer);

    els.tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        activateTab(tab.getAttribute("data-tab"));
        closeDrawer();
      });
    });

    activateTab("monitor");
  }

  /* ===== 交易体系学习 ===== */

  function sortRecords() {
    records.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return hh + ":" + mm;
  }

  function itemHtml(rec, isToday) {
    return (
      '<article class="record-item card">' +
      '<div class="record-header">' +
      '<span class="record-date">' + Common.escapeHtml(rec.date) + "</span>" +
      '<span class="record-meta">' + Common.escapeHtml(Common.weekdayOf(rec.date)) + "</span>" +
      (isToday ? '<span class="badge-today">今天</span>' : "") +
      (rec.name ? '<span class="learning-name-tag">' + Common.escapeHtml(rec.name) + "</span>" : "") +
      '<span class="learning-time">' + fmtTime(rec.createdAt) + "</span>" +
      "</div>" +
      '<div class="record-preview">' + Common.escapeHtml(rec.point) + "</div>" +
      "</article>"
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

  function updateWeekday() {
    els.weekday.textContent = els.date.value
      ? Common.weekdayOf(els.date.value)
      : "";
  }

  function setSaving(state) {
    saving = state;
    els.submitBtn.disabled = state;
    els.submitBtn.textContent = state ? "保存中…" : "保存记录";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    const name = els.name.value.trim();
    const point = els.point.value.trim();
    if (!name) {
      Common.toast("请填写名称", "error");
      return;
    }
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
        name: name,
        point: point,
        createdAt: now,
        updatedAt: now,
      });
      await Storage.save(records, FILE_PATH);
      Common.toast("已保存");
      els.form.reset();
      els.date.value = Common.todayStr();
      updateWeekday();
      renderList();
    } catch (err) {
      console.error("保存学习记录失败", err);
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
    initTabsAndDrawer();

    els.form = $("#learning-form");
    els.date = $("#learning-date");
    els.weekday = $("#learning-weekday");
    els.name = $("#learning-name");
    els.point = $("#learning-point");
    els.submitBtn = $("#learning-submit");
    els.list = $("#learning-list");
    els.loading = $("#learning-loading");
    els.emptyHint = $("#learning-empty");

    els.date.value = Common.todayStr();
    updateWeekday();
    els.date.addEventListener("change", updateWeekday);
    els.form.addEventListener("submit", handleSubmit);

    try {
      const raw = await Storage.load(FILE_PATH);
      records = raw.filter((r) => r && r.id);
    } catch (err) {
      console.error("读取学习记录失败", err);
      records = [];
      Common.toast("读取失败：" + (err && err.message ? err.message : "未知错误"), "error");
    }
    els.loading.hidden = true;
    renderList();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
