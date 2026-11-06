// 生活日常记录频道逻辑（2026-11 起收窄为纯感悟频道）
// 今日表单只记录感悟：{ date, insights:[{ id, type:"happy"|"low"|"other", text }] }
// 历史数据结构保留旧字段完整展示（只读）：{ id, date, summary, sleep:{bedTime,wakeTime},
//   weight:{night,morning}(kg), diet:{snacks,meals}, todayRecord, work,
//   parenting:{life,lifeMindful,mindful,reflection}, insights, createdAt, updatedAt }
// 保存只 upsert insights 字段，旧记录其他字段原样保留；感悟类型显示名：小确幸/小情绪/其他
(function () {
  "use strict";

  const UNIT_KEY = "taoguan_weight_unit"; // 体重显示单位：jin(斤,默认) / kg（历史记录只读展示用）
  const UNIT_LABEL = { jin: "斤", kg: "公斤" };
  const JIN_PER_KG = 2;
  const INSIGHT_LABEL = { happy: "小确幸", low: "小情绪", other: "其他" };
  const INSIGHT_TYPES = ["happy", "low", "other"];

  let records = [];
  let editingId = null;
  let saving = false;
  let unit = loadUnit();
  let modal = null; // 编辑弹窗 { overlay, form, fields, recordId }
  let viewModal = null; // 只读查看弹窗 { overlay, body }
  let historyPage = 1;
  const PAGE_SIZE = 10; // 全部历史记录每页条数
  const RECENT_DAYS = 5; // 近N日记录

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

  // kg → 显示单位（历史记录只读展示用）
  function kgToDisplay(kg, u) {
    if (kg == null || isNaN(kg)) return "";
    u = u || unit;
    return String(round1(u === "jin" ? kg * JIN_PER_KG : kg));
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ---------- 归一化（防脏数据；旧结构向后兼容） ---------- */

  function numOrNull(v) {
    const n = Number(v);
    return v == null || v === "" || isNaN(n) ? null : n;
  }

  function strOrEmpty(v) {
    return typeof v === "string" ? v : v == null ? "" : String(v);
  }

  function normalizeInsight(it) {
    if (!it || typeof it !== "object") return null;
    const text = strOrEmpty(it.text).trim();
    if (!text) return null;
    return {
      id: strOrEmpty(it.id) || newId(),
      type: INSIGHT_TYPES.indexOf(it.type) !== -1 ? it.type : "happy",
      text: strOrEmpty(it.text),
    };
  }

  // 旧结构（dailyLog/sleep 字符串、weight 数字等）→ 新结构；纯感悟记录（无旧字段）同样安全通过
  function normalizeRecord(rec) {
    if (!rec || typeof rec !== "object") return null;
    const oldParts = [];
    if (strOrEmpty(rec.dailyLog).trim()) oldParts.push(strOrEmpty(rec.dailyLog));
    if (strOrEmpty(rec.reflections).trim()) oldParts.push(strOrEmpty(rec.reflections));

    const sleep =
      rec.sleep && typeof rec.sleep === "object"
        ? { bedTime: strOrEmpty(rec.sleep.bedTime), wakeTime: strOrEmpty(rec.sleep.wakeTime) }
        : { bedTime: "", wakeTime: "" };

    const weight =
      rec.weight && typeof rec.weight === "object"
        ? { night: numOrNull(rec.weight.night), morning: numOrNull(rec.weight.morning) }
        : { night: null, morning: null };

    const diet =
      rec.diet && typeof rec.diet === "object"
        ? { snacks: strOrEmpty(rec.diet.snacks), meals: strOrEmpty(rec.diet.meals) }
        : { snacks: "", meals: "" };

    const parenting =
      rec.parenting && typeof rec.parenting === "object"
        ? {
            life: strOrEmpty(rec.parenting.life),
            lifeMindful: strOrEmpty(rec.parenting.lifeMindful),
            mindful: strOrEmpty(rec.parenting.mindful),
            reflection: strOrEmpty(rec.parenting.reflection),
          }
        : { life: "", lifeMindful: "", mindful: "", reflection: "" };

    return {
      id: rec.id || newId(),
      date: rec.date || "",
      summary: strOrEmpty(rec.summary),
      sleep: sleep,
      weight: weight,
      diet: diet,
      todayRecord: strOrEmpty(rec.todayRecord).trim() || oldParts.join("\n\n"),
      work: strOrEmpty(rec.work),
      parenting: parenting,
      insights: (Array.isArray(rec.insights) ? rec.insights : [])
        .map(normalizeInsight)
        .filter(Boolean),
      createdAt: rec.createdAt || Date.now(),
      updatedAt: rec.updatedAt || rec.createdAt || Date.now(),
    };
  }

  /* ---------- 感悟条目（顶部表单与编辑弹窗共用） ---------- */

  function insightsListEl(form) {
    return form.querySelector("#insights-list") || form.querySelector("#insights-list-m");
  }

  function syncInsightsFromDom(form) {
    const list = insightsListEl(form);
    if (!list || !form.__insights) return;
    list.querySelectorAll(".insight-entry").forEach((entry) => {
      const it = form.__insights.find((x) => x.id === entry.dataset.iid);
      if (!it) return;
      const typeSel = entry.querySelector(".insight-type");
      const ta = entry.querySelector("textarea");
      if (typeSel) it.type = INSIGHT_TYPES.indexOf(typeSel.value) !== -1 ? typeSel.value : "happy";
      if (ta) it.text = ta.value;
    });
  }

  function renderInsights(form) {
    const list = insightsListEl(form);
    if (!list) return;
    const items = form.__insights || [];
    list.innerHTML = items
      .map(
        (it) =>
          '<div class="insight-entry" data-iid="' + Common.escapeHtml(it.id) + '">' +
          '<select class="insight-type" aria-label="感悟类型">' +
          INSIGHT_TYPES.map(
            (t) =>
              '<option value="' + t + '"' + (it.type === t ? " selected" : "") + ">" +
              INSIGHT_LABEL[t] + "</option>"
          ).join("") +
          "</select>" +
          '<textarea rows="2" placeholder="记录这一刻…">' + Common.escapeHtml(it.text) + "</textarea>" +
          '<button type="button" class="mini-btn insight-del">删除</button>' +
          "</div>"
      )
      .join("");
  }

  /* ---------- 表单字段访问（今日表单与编辑弹窗结构一致，弹窗 id 带 -m 后缀） ---------- */

  function getFields(root) {
    const q = (id) => root.querySelector("#" + id) || root.querySelector("#" + id + "-m");
    return {
      date: q("record-date"),
      weekday: q("weekday-display"),
    };
  }

  function readForm(f, form) {
    syncInsightsFromDom(form);
    return {
      date: f.date.value,
      insights: (form.__insights || [])
        .map((it) => normalizeInsight(it))
        .filter(Boolean),
    };
  }

  function fillForm(f, rec, form) {
    f.date.value = rec.date;
    if (f.weekday) {
      f.weekday.textContent = rec.date ? Common.weekdayOf(rec.date) : "";
    }
    form.__insights = (rec.insights || []).map((it) => ({
      id: it.id || newId(),
      type: INSIGHT_TYPES.indexOf(it.type) !== -1 ? it.type : "happy",
      text: it.text,
    }));
    renderInsights(form);
  }

  function clearForm(f, form) {
    form.__insights = [];
    renderInsights(form);
  }

  function updateUnitLabels() {
    document.querySelectorAll(".unit-label").forEach((el) => {
      el.textContent = UNIT_LABEL[unit];
    });
    document.querySelectorAll(".unit-toggle button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.unit === unit);
    });
  }

  function setUnit(next) {
    if (next !== "jin" && next !== "kg") return;
    if (next === unit) return;
    unit = next;
    saveUnit();
    updateUnitLabels();
    renderList();
    renderHistory();
  }

  /* ---------- 顶部表单逻辑 ---------- */

  function latestRecordOfDate(date) {
    const sameDay = records.filter((r) => r.date === date);
    if (!sameDay.length) return null;
    return sameDay.reduce((a, b) => ((b.updatedAt || 0) > (a.updatedAt || 0) ? b : a));
  }

  function updateFormMode() {
    if (editingId) {
      els.submitBtn.textContent = "更新感悟";
      els.formTitle.textContent = "编辑感悟";
      els.cancelEditBtn.hidden = false;
    } else {
      const rec = latestRecordOfDate(els.fields.date.value);
      els.submitBtn.textContent = rec ? "更新感悟" : "保存感悟";
      els.formTitle.textContent = "今日感悟";
      els.cancelEditBtn.hidden = true;
    }
  }

  function resetForm() {
    editingId = null;
    els.form.reset();
    els.fields.date.value = Common.todayStr();
    clearForm(els.fields, els.form);
    // 今天已有记录时预填感悟，避免空表单覆盖已有数据
    const todayRec = latestRecordOfDate(els.fields.date.value);
    if (todayRec) fillForm(els.fields, todayRec, els.form);
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
    const data = readForm(els.fields, els.form);
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
        // 只更新 insights，其他字段原样保留
        records[idx].insights = data.insights;
        records[idx].updatedAt = now;
      } else {
        const existing = latestRecordOfDate(data.date);
        if (existing) {
          // 该日期已有记录 → 只合并感悟，不新增、不清空旧字段
          existing.insights = data.insights;
          existing.updatedAt = now;
          editingId = existing.id;
        } else {
          records.push(
            normalizeRecord(Object.assign({ id: newId(), createdAt: now, updatedAt: now }, data))
          );
        }
      }
      await persist();
      Common.toast("已保存");
      resetForm();
      renderList();
      renderHistory();
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
    // 所选日期已有记录时预填感悟并进入更新模式；无记录则退出编辑模式
    const existing = latestRecordOfDate(els.fields.date.value);
    if (existing) {
      fillForm(els.fields, existing, els.form);
      editingId = existing.id;
    } else {
      clearForm(els.fields, els.form);
      editingId = null;
    }
    updateFormMode();
  }

  /* ---------- 历史记录表格（保留旧字段完整只读展示） ---------- */

  function sortRecords() {
    records.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  function escapeAttr(s) {
    return Common.escapeHtml(s).replace(/"/g, "&quot;");
  }

  function clampCell(html, fullText, clampCls) {
    if (!fullText || !fullText.trim()) return '<span class="cell-empty">—</span>';
    return (
      '<div class="' + (clampCls || "clamp3") + '" title="' + escapeAttr(fullText) + '">' + html + "</div>"
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

  function cellSleepHtml(rec, clampCls) {
    const lines = [];
    if (rec.sleep.bedTime) lines.push("昨晚" + rec.sleep.bedTime + "睡");
    if (rec.sleep.wakeTime) lines.push("今早" + rec.sleep.wakeTime + "起");
    const html = lines
      .map((l) => '<div class="cell-line">' + Common.escapeHtml(l) + "</div>")
      .join("");
    return clampCell(html, lines.join("\n"), clampCls);
  }

  function cellWeightHtml(rec, clampCls) {
    const label = UNIT_LABEL[unit];
    const lines = [];
    if (rec.weight.night != null) lines.push("睡前 " + kgToDisplay(rec.weight.night) + label);
    if (rec.weight.morning != null) lines.push("早起 " + kgToDisplay(rec.weight.morning) + label);
    const html = lines
      .map((l) => '<div class="cell-line">' + Common.escapeHtml(l) + "</div>")
      .join("");
    return clampCell(html, lines.join("\n"), clampCls);
  }

  function cellDietHtml(rec, clampCls) {
    const full = [rec.diet.snacks, rec.diet.meals].filter((s) => s && s.trim()).join("\n");
    return clampCell(
      labeledLines([
        { label: "零食·饮料 ", text: rec.diet.snacks },
        { label: "正餐 ", text: rec.diet.meals },
      ]),
      full,
      clampCls
    );
  }

  function cellParentingHtml(rec, clampCls) {
    const full = [rec.parenting.life, rec.parenting.lifeMindful, rec.parenting.mindful, rec.parenting.reflection]
      .filter((s) => s && s.trim())
      .join("\n");
    return clampCell(
      labeledLines([
        { label: "流水账 ", text: rec.parenting.life },
        { label: "生活正念 ", text: rec.parenting.lifeMindful },
        { label: "育儿正念 ", text: rec.parenting.mindful },
        { label: "反思 ", text: rec.parenting.reflection },
      ]),
      full,
      clampCls
    );
  }

  // 感悟列：类型名前缀，最多3行截断（与其他列一致）
  function cellInsightsHtml(rec, clampCls) {
    const items = rec.insights || [];
    if (!items.length) return '<span class="cell-empty">—</span>';
    const html = items
      .map(
        (it) =>
          '<div class="cell-line"><span class="cell-label">' +
          Common.escapeHtml(INSIGHT_LABEL[it.type] || INSIGHT_LABEL.happy) +
          '</span>' +
          Common.escapeHtml(it.text) + "</div>"
      )
      .join("");
    const full = items
      .map((it) => (INSIGHT_LABEL[it.type] || "小确幸") + " " + it.text)
      .join("\n");
    return clampCell(html, full, clampCls);
  }

  function rowHtml(rec, isToday, wide) {
    const clampCls = wide ? "clamp6" : "clamp3";
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
      ? '<div class="' + clampCls + '" title="' + escapeAttr(rec.todayRecord) + '">' +
        Common.escapeHtml(rec.todayRecord) + "</div>"
      : '<span class="cell-empty">—</span>';
    const workHtml = rec.work
      ? '<div class="' + clampCls + '" title="' + escapeAttr(rec.work) + '">' +
        Common.escapeHtml(rec.work) + "</div>"
      : '<span class="cell-empty">—</span>';

    return (
      '<tr data-id="' + escapeAttr(rec.id) + '">' +
      '<td class="col-date">' + dateHtml + "</td>" +
      '<td class="col-sleep">' + cellSleepHtml(rec, clampCls) + "</td>" +
      '<td class="col-weight">' + cellWeightHtml(rec, clampCls) + "</td>" +
      '<td class="col-diet">' + cellDietHtml(rec, clampCls) + "</td>" +
      '<td class="col-today">' + todayHtml + "</td>" +
      '<td class="col-work">' + workHtml + "</td>" +
      '<td class="col-parenting">' + cellParentingHtml(rec, clampCls) + "</td>" +
      '<td class="col-insights">' + cellInsightsHtml(rec, clampCls) + "</td>" +
      '<td class="col-actions">' +
      '<button type="button" class="btn btn-small" data-action="view">查看</button>' +
      '<button type="button" class="btn btn-small" data-action="edit">编辑</button>' +
      "</td>" +
      "</tr>"
    );
  }

  function buildTableHtml(rowsHtml) {
    return (
      '<table class="records-table">' +
      "<colgroup>" +
      '<col class="col-date"><col class="col-sleep"><col class="col-weight"><col class="col-diet">' +
      '<col class="col-today"><col class="col-work"><col class="col-parenting"><col class="col-insights"><col class="col-actions">' +
      "</colgroup>" +
      "<thead><tr>" +
      "<th>日期</th><th>睡眠</th><th>体重</th><th>饮食</th>" +
      "<th>今日记录</th><th>工作</th><th>生活流水账</th><th>感悟</th><th>操作</th>" +
      "</tr></thead>" +
      "<tbody>" + rowsHtml + "</tbody>" +
      "</table>"
    );
  }

  // 近N个自然日的起始日期（含今天），如 2026-09-13
  function recentCutoff(n) {
    const d = new Date(Common.todayStr() + "T00:00:00");
    d.setDate(d.getDate() - (n - 1));
    return (
      d.getFullYear() +
      "-" + String(d.getMonth() + 1).padStart(2, "0") +
      "-" + String(d.getDate()).padStart(2, "0")
    );
  }

  function renderList() {
    sortRecords();
    els.list.querySelectorAll(".table-wrap").forEach((n) => n.remove());

    const cutoff = recentCutoff(RECENT_DAYS);
    const recent = records.filter((r) => r.date >= cutoff);
    if (!recent.length) {
      els.emptyHint.hidden = false;
      return;
    }
    els.emptyHint.hidden = true;

    const today = Common.todayStr();
    const wrap = document.createElement("div");
    wrap.className = "table-wrap card";
    wrap.innerHTML = buildTableHtml(recent.map((rec) => rowHtml(rec, rec.date === today, false)).join(""));
    els.list.appendChild(wrap);
  }

  // 全部历史记录：与股票监控台同宽，10条/页翻页
  function renderHistory() {
    sortRecords();
    els.historyList.querySelectorAll(".table-wrap").forEach((n) => n.remove());

    if (!records.length) {
      els.historyEmpty.hidden = false;
      els.historyPager.hidden = true;
      return;
    }
    els.historyEmpty.hidden = true;

    const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
    if (historyPage > pageCount) historyPage = pageCount;
    const start = (historyPage - 1) * PAGE_SIZE;
    const pageRows = records.slice(start, start + PAGE_SIZE);

    const today = Common.todayStr();
    const wrap = document.createElement("div");
    wrap.className = "table-wrap card";
    wrap.innerHTML = buildTableHtml(pageRows.map((rec) => rowHtml(rec, rec.date === today, true)).join(""));
    els.historyList.appendChild(wrap);

    els.historyPager.hidden = pageCount <= 1;
    els.pageInfo.textContent =
      "第 " + historyPage + " / " + pageCount + " 页 · 共 " + records.length + " 条";
  }

  /* ---------- 页签 ---------- */

  function activateTab(name) {
    els.tabs.forEach((tab) => {
      if (tab.dataset.tab === name) tab.setAttribute("aria-current", "true");
      else tab.removeAttribute("aria-current");
    });
    els.panels.today.hidden = name !== "today";
    els.panels.history.hidden = name !== "history";
    els.main.classList.toggle("main-wide", name === "history");
    if (name === "history") renderHistory();
  }

  /* ---------- 只读查看弹窗（旧字段完整展示） ---------- */

  function viewSection(title, contentHtml, fullText) {
    if (!contentHtml) return "";
    return (
      '<div class="detail-section"><h4>' + Common.escapeHtml(title) + "</h4>" +
      '<div class="clamp6" title="' + escapeAttr(fullText || "") + '">' + contentHtml + "</div></div>"
    );
  }

  function viewBodyHtml(rec) {
    const label = UNIT_LABEL[unit];
    let html = "";
    html += viewSection(
      "日期",
      '<p>' + Common.escapeHtml(rec.date) + " " + Common.escapeHtml(Common.weekdayOf(rec.date)) + "</p>",
      rec.date
    );
    html += viewSection("今日一句话总结", rec.summary ? "<p>" + Common.escapeHtml(rec.summary) + "</p>" : "", rec.summary);

    const sleepLines = [];
    if (rec.sleep.bedTime) sleepLines.push("昨晚 " + rec.sleep.bedTime + " 睡");
    if (rec.sleep.wakeTime) sleepLines.push("今早 " + rec.sleep.wakeTime + " 起");
    html += viewSection("睡眠", labeledLines([{ label: "", text: sleepLines.join("\n") }]), sleepLines.join("\n"));

    const weightLines = [];
    if (rec.weight.night != null) weightLines.push("睡前 " + kgToDisplay(rec.weight.night) + label);
    if (rec.weight.morning != null) weightLines.push("早起 " + kgToDisplay(rec.weight.morning) + label);
    html += viewSection("体重", labeledLines([{ label: "", text: weightLines.join("\n") }]), weightLines.join("\n"));

    html += viewSection(
      "饮食",
      labeledLines([
        { label: "零食·饮料 ", text: rec.diet.snacks },
        { label: "正餐 ", text: rec.diet.meals },
      ]),
      [rec.diet.snacks, rec.diet.meals].filter(Boolean).join("\n")
    );

    html += viewSection("今日记录", rec.todayRecord ? "<p>" + Common.escapeHtml(rec.todayRecord) + "</p>" : "", rec.todayRecord);
    html += viewSection("工作", rec.work ? "<p>" + Common.escapeHtml(rec.work) + "</p>" : "", rec.work);

    const lifeFull = [rec.parenting.life, rec.parenting.lifeMindful, rec.parenting.mindful, rec.parenting.reflection]
      .filter((s) => s && s.trim())
      .join("\n");
    html += viewSection(
      "生活流水账",
      labeledLines([
        { label: "流水账 ", text: rec.parenting.life },
        { label: "生活正念 ", text: rec.parenting.lifeMindful },
        { label: "育儿正念 ", text: rec.parenting.mindful },
        { label: "反思与提升 ", text: rec.parenting.reflection },
      ]),
      lifeFull
    );

    const insightFull = (rec.insights || [])
      .map((it) => (INSIGHT_LABEL[it.type] || "小确幸") + " " + it.text)
      .join("\n");
    html += viewSection(
      "生活感悟",
      (rec.insights || []).length
        ? labeledLines(
            (rec.insights || []).map((it) => ({
              label: (INSIGHT_LABEL[it.type] || "小确幸") + " ",
              text: it.text,
            }))
          )
        : "",
      insightFull
    );

    return html || '<div class="detail-section"><p>（本条记录没有内容）</p></div>';
  }

  function buildViewModal() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.hidden = true;
    const box = document.createElement("div");
    box.className = "modal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "查看记录");
    const head = document.createElement("div");
    head.className = "modal-head";
    const title = document.createElement("h3");
    title.textContent = "查看记录";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "modal-close";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.textContent = "✕";
    head.appendChild(title);
    head.appendChild(closeBtn);
    const body = document.createElement("div");
    body.className = "modal-body view-modal-body";
    box.appendChild(head);
    box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    viewModal = { overlay: overlay, body: body };
    closeBtn.addEventListener("click", closeViewModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeViewModal();
    });
  }

  function openViewModal(rec) {
    if (!viewModal) buildViewModal();
    viewModal.body.innerHTML = viewBodyHtml(rec);
    viewModal.overlay.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closeViewModal() {
    if (!viewModal) return;
    viewModal.overlay.hidden = true;
    document.body.classList.remove("modal-open");
  }

  /* ---------- 编辑弹窗（只编辑感悟，保存时仅更新 insights 字段） ---------- */

  function buildModal() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.hidden = true;

    const box = document.createElement("div");
    box.className = "modal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "编辑感悟");

    const head = document.createElement("div");
    head.className = "modal-head";
    const title = document.createElement("h3");
    title.textContent = "编辑感悟";
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
    submitBtn.textContent = "更新感悟";
    cancelBtn.hidden = false;
    cancelBtn.textContent = "取消";
    // 编辑弹窗中日期只读（只更新感悟，不改变记录归属日期）
    modalDateReadonly(form);

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
      if (e.key !== "Escape") return;
      if (modal && !modal.overlay.hidden) closeModal();
      else if (viewModal && !viewModal.overlay.hidden) closeViewModal();
    });
    form.addEventListener("submit", handleModalSubmit);
  }

  function modalDateReadonly(form) {
    const dateInput = form.querySelector("#record-date-m");
    if (dateInput) dateInput.readOnly = true;
  }

  function openEditModal(rec) {
    if (!modal) buildModal();
    modal.recordId = rec.id;
    fillForm(modal.fields, rec, modal.form);
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
    const data = readForm(modal.fields, modal.form);
    const submitBtn = modal.form.querySelector("#submit-btn-m");
    submitBtn.disabled = true;
    submitBtn.textContent = "保存中…";
    try {
      // 只更新 insights，旧记录其他字段（睡眠/体重等）原样保留
      rec.insights = data.insights;
      rec.updatedAt = Date.now();
      await persist();
      Common.toast("已保存");
      closeModal();
      renderList();
      renderHistory();
    } catch (err) {
      console.error("保存失败", err);
      Common.toast(friendlyError(err, "保存"), "error");
      try {
        records = (await Storage.load()).map(normalizeRecord).filter(Boolean);
      } catch (_) {
        /* 忽略回滚读取失败 */
      }
      renderList();
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "更新感悟";
    }
  }

  function handleListClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const tr = btn.closest("tr");
    const id = tr && tr.dataset.id;
    const rec = records.find((r) => r.id === id);
    if (!rec) return;
    if (btn.dataset.action === "view") openViewModal(rec);
    else if (btn.dataset.action === "edit") openEditModal(rec);
  }

  /* ---------- 初始化 ---------- */

  function cacheEls() {
    els.main = $("#main");
    els.tabs = Array.from(document.querySelectorAll(".page-tab"));
    els.panels = { today: $("#panel-today"), history: $("#panel-history") };
    els.form = $("#daily-form");
    els.fields = getFields(els.form);
    els.submitBtn = $("#submit-btn");
    els.cancelEditBtn = $("#cancel-edit-btn");
    els.formTitle = $("#form-title");
    els.list = $("#record-list");
    els.emptyHint = $("#empty-hint");
    els.historyList = $("#history-list");
    els.historyEmpty = $("#history-empty");
    els.historyPager = $("#history-pager");
    els.pageInfo = $("#page-info");
  }

  async function init() {
    cacheEls();
    els.form.__insights = [];
    renderInsights(els.form);
    els.fields.date.value = Common.todayStr();
    updateUnitLabels();
    updateWeekday();
    updateFormMode();

    els.form.addEventListener("submit", handleSubmit);
    els.fields.date.addEventListener("change", handleDateChange);
    els.list.addEventListener("click", handleListClick);
    els.historyList.addEventListener("click", handleListClick);
    els.tabs.forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
    els.historyPager.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-page]");
      if (!btn) return;
      if (btn.dataset.page === "prev" && historyPage > 1) historyPage -= 1;
      if (btn.dataset.page === "next") historyPage += 1;
      renderHistory();
    });
    els.cancelEditBtn.addEventListener("click", () => {
      resetForm();
      renderList();
    });
    // 全站委托：单位切换、感悟添加/删除/类型切换（今日表单与编辑弹窗克隆通用）
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".unit-toggle button[data-unit]");
      if (btn) {
        setUnit(btn.dataset.unit);
        return;
      }
      const addBtn = e.target.closest("#add-insight-btn, #add-insight-btn-m");
      if (addBtn) {
        const form = addBtn.closest("form");
        if (!form) return;
        syncInsightsFromDom(form);
        form.__insights = form.__insights || [];
        form.__insights.push({ id: newId(), type: "happy", text: "" });
        renderInsights(form);
        const entries = insightsListEl(form).querySelectorAll(".insight-entry");
        const last = entries[entries.length - 1];
        if (last) last.querySelector("textarea").focus();
        return;
      }
      const delBtn = e.target.closest(".insight-del");
      if (delBtn) {
        const entry = delBtn.closest(".insight-entry");
        const form = delBtn.closest("form");
        if (!entry || !form) return;
        syncInsightsFromDom(form);
        form.__insights = (form.__insights || []).filter((it) => it.id !== entry.dataset.iid);
        renderInsights(form);
      }
    });
    document.addEventListener("change", (e) => {
      if (e.target.matches && e.target.matches(".insight-entry .insight-type")) {
        const entry = e.target.closest(".insight-entry");
        const form = e.target.closest("form");
        if (!entry || !form || !form.__insights) return;
        const it = form.__insights.find((x) => x.id === entry.dataset.iid);
        if (it) it.type = INSIGHT_TYPES.indexOf(e.target.value) !== -1 ? e.target.value : "happy";
      }
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
