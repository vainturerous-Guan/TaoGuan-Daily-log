// 目标打卡频道逻辑
// 数据文件（均顶层数组，直接走 Storage.load/save(filePath)）：
//  data/plan-habits.json  固定习惯：{ id, name, archived, done, false, completedAt: null, summary: "",
//                          checkIns:[{ id, date, note, createdAt }], createdAt, updatedAt }
//  data/short-goals.json  短期目标：结构同上；done/completedAt 用于「完成目标」，summary 为完成情况总结
//  data/plan-long.json    长期计划：{ id, name, done, completedAt,
//                          stages:[{ id, name, manual:null|"pending"|"active"|"done",
//                                    tasks:[{ id, name, done, doneAt, summary }] }],
//                          createdAt, updatedAt }
//  data/plan-daily.json   旧版按日期打卡（2026-11 改版后只读展示，不再写入）
// 阶段状态：manual 有值优先；否则按子任务推导（全完成=done，有完成=active，否则pending）
(function () {
  "use strict";

  const FILES = {
    habits: "data/plan-habits.json",
    short: "data/short-goals.json",
    plans: "data/plan-long.json",
    daily: "data/plan-daily.json",
  };
  const STAGE_ICON = { pending: "○", active: "●", done: "✓" };
  const MANUAL_CYCLE = [null, "pending", "active", "done"];

  let habits = [];
  let shortGoals = [];
  let plans = [];
  let logs = []; // 旧版打卡记录（只读）
  const expandedStages = new Set(); // "planId/stageId"
  let editState = null; // { kind, ... } kind: "item-name"|"checkin"|"plan"|"stage"|"task"
  let addForm = null;   // { kind:"plan"|"stage"|"task", planId, stageId }

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

  /* ---------- 归一化（防脏数据） ---------- */

  // 固定习惯 / 短期目标共用条目结构
  function normalizeItem(it) {
    if (!it || typeof it !== "object") return null;
    const checkIns = Array.isArray(it.checkIns) ? it.checkIns : [];
    return {
      id: str(it.id) || newId(),
      name: str(it.name),
      archived: !!it.archived,
      done: !!it.done,
      completedAt: numOrNull(it.completedAt),
      summary: str(it.summary),
      checkIns: checkIns
        .filter((c) => c && typeof c === "object")
        .map((c) => ({
          id: str(c.id) || newId(),
          date: str(c.date),
          note: str(c.note),
          createdAt: numOrNull(c.createdAt) || Date.now(),
        })),
      createdAt: numOrNull(it.createdAt) || Date.now(),
      updatedAt: numOrNull(it.updatedAt) || Date.now(),
    };
  }

  function normalizePlan(p) {
    if (!p || typeof p !== "object") return null;
    const stages = Array.isArray(p.stages) ? p.stages : [];
    return {
      id: str(p.id) || newId(),
      name: str(p.name),
      done: !!p.done,
      completedAt: numOrNull(p.completedAt),
      stages: stages
        .filter((s) => s && typeof s === "object")
        .map((s) => {
          const tasks = Array.isArray(s.tasks) ? s.tasks : [];
          return {
            id: str(s.id) || newId(),
            name: str(s.name),
            manual: ["pending", "active", "done"].indexOf(s.manual) !== -1 ? s.manual : null,
            tasks: tasks
              .filter((t) => t && typeof t === "object")
              .map((t) => ({
                id: str(t.id) || newId(),
                name: str(t.name),
                done: !!t.done,
                doneAt: numOrNull(t.doneAt),
                summary: str(t.summary),
              })),
          };
        }),
      createdAt: numOrNull(p.createdAt) || Date.now(),
      updatedAt: numOrNull(p.updatedAt) || Date.now(),
    };
  }

  function normalizeLog(l) {
    if (!l || typeof l !== "object") return null;
    const workTasks = Array.isArray(l.workTasks) ? l.workTasks : [];
    const wins = Array.isArray(l.wins) ? l.wins : [];
    return {
      date: str(l.date),
      workTasks: workTasks
        .filter((t) => t && typeof t === "object")
        .map((t) => ({ id: str(t.id) || newId(), name: str(t.name), done: !!t.done })),
      wins: wins
        .filter((w) => w && typeof w === "object")
        .map((w) => ({ id: str(w.id) || newId(), name: str(w.name) })),
    };
  }

  /* ---------- 存储 ---------- */

  function friendlyError(err, action) {
    const status = err && err.status;
    if (status === 401) return action + "失败（401）：浏览器里保存的令牌无效，请点页脚「清除令牌」，然后重新粘贴输入";
    if (status === 403) return action + "失败（403）：令牌权限不足，请重新创建只含本仓库 Contents 读写权限的令牌";
    if (status === 409 || status === 422) return action + "失败（" + status + "）：数据被其他页面更新过，请刷新后重试";
    if (status) return action + "失败（" + status + "），请刷新重试或联系维护者";
    return action + "失败：网络连不上 GitHub，请检查网络后重试";
  }

  function itemsOf(file) {
    return file === "short" ? shortGoals : habits;
  }

  function persistItems(file) {
    return Storage.save(itemsOf(file), FILES[file]).catch((err) => {
      console.error("保存失败", err);
      Common.toast(friendlyError(err, "保存"), "error");
      return reloadAll(true);
    });
  }

  function persistPlans() {
    return Storage.save(plans, FILES.plans).catch((err) => {
      console.error("保存失败", err);
      Common.toast(friendlyError(err, "保存"), "error");
      return reloadAll(true);
    });
  }

  async function reloadAll(silent) {
    try {
      const raw = await Promise.all([
        Storage.load(FILES.habits),
        Storage.load(FILES.short),
        Storage.load(FILES.plans),
        Storage.load(FILES.daily),
      ]);
      habits = raw[0].map(normalizeItem).filter(Boolean);
      shortGoals = raw[1].map(normalizeItem).filter(Boolean);
      plans = raw[2].map(normalizePlan).filter(Boolean);
      logs = raw[3].map(normalizeLog).filter(Boolean);
    } catch (err) {
      console.error("读取打卡数据失败", err);
      habits = [];
      shortGoals = [];
      plans = [];
      logs = [];
      if (!silent) Common.toast(friendlyError(err, "读取"), "error");
    }
    renderItems("habits");
    renderItems("short");
    renderPlans();
    renderLegacy();
  }

  /* ---------- 固定习惯 / 短期目标共用卡片 ---------- */

  function isEditing(kind, ids) {
    if (!editState || editState.kind !== kind) return false;
    const keys = { "item-name": ["file", "id"], checkin: ["file", "itemId", "checkinId"] };
    return (keys[kind] || []).every((k) => editState[k] === ids[k]);
  }

  // 全部打卡按时间倒序（日期倒序，同日按录入倒序）
  function sortedCheckIns(item) {
    return item.checkIns.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function checkInItemHtml(file, item, c, withDelete) {
    if (isEditing("checkin", { file: file, itemId: item.id, checkinId: c.id })) {
      return (
        '<li class="checkin-item">' +
        '<form class="edit-row" data-form="edit-checkin" data-file="' + file + '" data-item-id="' + Common.escapeHtml(item.id) + '" data-checkin-id="' + Common.escapeHtml(c.id) + '">' +
        '<input type="date" class="checkin-edit-date" value="' + Common.escapeHtml(c.date) + '">' +
        '<input type="text" class="checkin-edit-note" value="' + Common.escapeHtml(c.note) + '" placeholder="备注（可选）" maxlength="50">' +
        '<button type="submit" class="btn btn-small">保存</button>' +
        '<button type="button" class="mini-btn" data-action="cancel-edit">取消</button>' +
        "</form></li>"
      );
    }
    return (
      '<li class="checkin-item" data-checkin-id="' + Common.escapeHtml(c.id) + '">' +
      '<span class="checkin-mark">✓</span>' +
      '<span class="checkin-date">' + Common.escapeHtml(c.date) + "</span>" +
      (c.note ? '<span class="checkin-note">' + Common.escapeHtml(c.note) + "</span>" : "") +
      '<span class="check-actions">' +
      '<button type="button" class="mini-btn" data-action="edit-checkin">编辑</button>' +
      (withDelete ? '<button type="button" class="mini-btn" data-action="delete-checkin">删除</button>' : "") +
      "</span></li>"
    );
  }

  function goalCardHtml(file, item) {
    const editingName = isEditing("item-name", { file: file, id: item.id });
    const nameHtml = editingName
      ? '<form class="edit-row" data-form="edit-item" data-file="' + file + '" data-item-id="' + Common.escapeHtml(item.id) + '">' +
        '<input type="text" value="' + Common.escapeHtml(item.name) + '" maxlength="30">' +
        '<button type="submit" class="btn btn-small">保存</button>' +
        '<button type="button" class="mini-btn" data-action="cancel-edit">取消</button>' +
        "</form>"
      : '<span class="goal-name">' + Common.escapeHtml(item.name) + "</span>";

    const sorted = sortedCheckIns(item);
    const recent = sorted.slice(0, 3);
    const recentHtml = recent.length
      ? recent.map((c) => checkInItemHtml(file, item, c, false)).join("")
      : '<li class="check-hint">还没有打卡，做成一次就点一次～</li>';

    const allHtml = sorted.length
      ? sorted.map((c) => checkInItemHtml(file, item, c, true)).join("")
      : '<li class="check-hint">还没有打卡记录</li>';

    // 短期目标：总结 + 完成/重新打开
    let summaryRow = "";
    if (file === "short") {
      const actionBtn = item.done
        ? '<button type="button" class="mini-btn" data-action="reopen-goal">重新打开</button>'
        : item.summary.trim()
          ? '<button type="button" class="mini-btn" data-action="complete-goal">完成目标</button>'
          : "";
      summaryRow =
        '<div class="goal-summary-row">' +
        '<input type="text" class="goal-summary-input" data-field="summary" value="' + Common.escapeHtml(item.summary) + '" placeholder="目标完成情况总结（可选，填写后可点「完成目标」）" maxlength="100">' +
        actionBtn +
        "</div>";
    }

    return (
      '<div class="record-item goal-card' + (item.done ? " is-done" : "") + '" data-file="' + file + '" data-id="' + Common.escapeHtml(item.id) + '">' +
      '<div class="goal-head">' +
      nameHtml +
      (!editingName
        ? '<span class="goal-count">已完成 ' + item.checkIns.length + " 次</span>" +
          '<span class="goal-actions">' +
          (item.archived
            ? '<button type="button" class="mini-btn" data-action="restore-item">恢复</button>' +
              '<button type="button" class="mini-btn" data-action="delete-item">删除</button>'
            : '<button type="button" class="mini-btn" data-action="edit-item-name">编辑</button>' +
              '<button type="button" class="mini-btn" data-action="archive-item">归档</button>') +
          "</span>"
        : "") +
      "</div>" +
      '<form class="goal-checkin-form" data-form="checkin" data-file="' + file + '" data-item-id="' + Common.escapeHtml(item.id) + '">' +
      '<input type="date" class="checkin-date-input" value="' + Common.escapeHtml(Common.todayStr()) + '">' +
      '<input type="text" class="checkin-note-input" placeholder="内容备注，如：练琴第X章（可选）" maxlength="50">' +
      '<button type="submit" class="btn btn-small">✓ 打卡</button>' +
      "</form>" +
      '<ul class="checkin-recent">' + recentHtml + "</ul>" +
      '<details class="checkin-all">' +
      "<summary>全部打卡记录（" + item.checkIns.length + " 次）</summary>" +
      '<ul class="checkin-all-list">' + allHtml + "</ul>" +
      "</details>" +
      summaryRow +
      "</div>"
    );
  }

  function renderItems(file) {
    const items = itemsOf(file);
    const active = items.filter((it) => !it.archived && !it.done);
    const archived = items.filter((it) => it.archived);
    const done = items.filter((it) => !it.archived && it.done);

    const listEl = file === "short" ? els.shortCards : els.habitCards;
    const emptyEl = file === "short" ? els.shortEmpty : els.habitEmpty;
    const archBox = file === "short" ? els.shortArchBox : els.habitArchBox;
    const archEl = file === "short" ? els.shortArch : els.habitArch;
    const doneBox = els.shortDoneBox;
    const doneEl = els.shortDone;
    const doneCount = els.shortDoneCount;

    if (emptyEl) emptyEl.hidden = active.length > 0;
    listEl.innerHTML = active.map((it) => goalCardHtml(file, it)).join("");

    archBox.hidden = !archived.length;
    archEl.innerHTML = archived.map((it) => goalCardHtml(file, it)).join("");

    if (file === "short") {
      doneBox.hidden = !done.length;
      doneCount.textContent = String(done.length);
      doneEl.innerHTML = done.map((it) => goalCardHtml(file, it)).join("");
    }
  }

  /* ---------- 长期计划 ---------- */

  function findPlan(id) {
    return plans.find((p) => p.id === id);
  }

  function findStage(planId, stageId) {
    const plan = findPlan(planId);
    const stage = plan && plan.stages.find((s) => s.id === stageId);
    return { plan: plan, stage: stage };
  }

  function stageStatus(stage) {
    if (stage.manual) return stage.manual;
    if (stage.tasks.length && stage.tasks.every((t) => t.done)) return "done";
    if (stage.tasks.some((t) => t.done)) return "active";
    return "pending";
  }

  function addFormHtml(kind, ref, placeholder) {
    const attrs = Object.keys(ref)
      .map((k) => ' data-' + k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + '="' + Common.escapeHtml(String(ref[k])) + '"')
      .join("");
    return (
      '<form class="inline-add-form add-form" data-form="' + kind + '"' + attrs + '>' +
      '<input type="text" placeholder="' + Common.escapeHtml(placeholder) + '" maxlength="50">' +
      '<button type="submit" class="btn btn-small">保存</button>' +
      '<button type="button" class="mini-btn" data-action="cancel-add">取消</button>' +
      "</form>"
    );
  }

  function taskHtml(plan, stage, task) {
    const editing = isEditing("task", { planId: plan.id, stageId: stage.id, taskId: task.id });
    const nameHtml = editing
      ? editFormHtml("task", { planId: plan.id, stageId: stage.id, taskId: task.id }, task.name, 50)
      : '<span class="check-name">' + Common.escapeHtml(task.name) + "</span>";
    const summaryInput =
      '<input type="text" class="task-summary-input" data-field="task-summary" data-plan-id="' + Common.escapeHtml(plan.id) + '" data-stage-id="' + Common.escapeHtml(stage.id) + '" data-task-id="' + Common.escapeHtml(task.id) + '" value="' + Common.escapeHtml(task.summary) + '" placeholder="完成情况总结（可选，失焦或回车保存）" maxlength="100">';
    return (
      '<li class="check-item task-item' + (task.done ? " done" : "") + '" data-task-id="' + Common.escapeHtml(task.id) + '">' +
      '<button type="button" class="check-toggle" data-action="toggle-task" aria-pressed="' + !!task.done + '">✓</button>' +
      nameHtml +
      (editing
        ? ""
        : '<span class="check-actions">' +
          '<button type="button" class="mini-btn" data-action="edit-task">编辑</button>' +
          '<button type="button" class="mini-btn" data-action="delete-task">删除</button>' +
          "</span>") +
      summaryInput +
      "</li>"
    );
  }

  function editFormHtml(kind, ref, value, maxLength) {
    const attrs = Object.keys(ref)
      .map((k) => ' data-' + k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + '="' + Common.escapeHtml(String(ref[k])) + '"')
      .join("");
    return (
      '<form class="edit-row" data-form="edit" data-edit-kind="' + kind + '"' + attrs + '>' +
      '<input type="text" value="' + Common.escapeHtml(value) + '" maxlength="' + maxLength + '">' +
      '<button type="submit" class="btn btn-small">保存</button>' +
      '<button type="button" class="mini-btn" data-action="cancel-edit">取消</button>' +
      "</form>"
    );
  }

  function stageHtml(plan, stage) {
    const status = stageStatus(stage);
    const key = plan.id + "/" + stage.id;
    const open = expandedStages.has(key);
    const doneCount = stage.tasks.filter((t) => t.done).length;
    const editing = isEditing("stage", { planId: plan.id, stageId: stage.id });
    const nameHtml = editing
      ? editFormHtml("stage", { planId: plan.id, stageId: stage.id }, stage.name, 50)
      : '<span class="stage-name">' + Common.escapeHtml(stage.name) + "</span>";

    let body = "";
    if (open) {
      body =
        '<ul class="task-list">' +
        (stage.tasks.length
          ? stage.tasks.map((t) => taskHtml(plan, stage, t)).join("")
          : '<li class="check-hint">还没有任务，添加几个可勾选的小目标～</li>') +
        "</ul>" +
        (addForm && addForm.kind === "task" && addForm.stageId === stage.id
          ? addFormHtml("add-task", { planId: plan.id, stageId: stage.id }, "添加任务，回车保存")
          : '<button type="button" class="mini-btn" data-action="add-task">＋ 添加任务</button>');
    }

    return (
      '<li class="stage-item" data-stage-id="' + Common.escapeHtml(stage.id) + '" data-status="' + status + '">' +
      '<div class="stage-row">' +
      '<button type="button" class="stage-status is-' + status + '" data-action="cycle-status" ' +
      'title="当前状态：' + (stage.manual ? "手动" : "自动") + '（点击切换：自动 → 未开始 → 进行中 → 已完成）">' +
      STAGE_ICON[status] + "</button>" +
      nameHtml +
      '<span class="stage-count">' + (stage.tasks.length ? doneCount + "/" + stage.tasks.length + " 任务" : "无任务") + "</span>" +
      '<button type="button" class="mini-btn stage-expand" data-action="toggle-stage">' + (open ? "▾ 收起" : "▸ 任务") + "</button>" +
      (editing
        ? ""
        : '<button type="button" class="mini-btn" data-action="edit-stage">编辑</button>' +
          '<button type="button" class="mini-btn" data-action="delete-stage">删除</button>') +
      "</div>" +
      body +
      "</li>"
    );
  }

  function isEditingPlanKind(kind, ids) {
    if (!editState || editState.kind !== kind) return false;
    const keys = { plan: ["planId"], stage: ["planId", "stageId"], task: ["planId", "stageId", "taskId"] };
    return (keys[kind] || []).every((k) => editState[k] === ids[k]);
  }

  function planCardHtml(plan) {
    const doneStages = plan.stages.filter((s) => stageStatus(s) === "done").length;
    const editing = isEditingPlanKind("plan", { planId: plan.id });
    const nameHtml = editing
      ? editFormHtml("plan", { planId: plan.id }, plan.name, 50)
      : '<span class="plan-name">' + Common.escapeHtml(plan.name) + "</span>";

    let body =
      '<ul class="stage-list">' +
      (plan.stages.length
        ? plan.stages.map((s) => stageHtml(plan, s)).join("")
        : '<li class="check-hint">还没有阶段，点「＋ 添加阶段」开始～</li>') +
      "</ul>";
    if (addForm && addForm.kind === "stage" && addForm.planId === plan.id) {
      body += addFormHtml("add-stage", { planId: plan.id }, "阶段名称，如：一阶段：了解基础知识");
    } else {
      body += '<button type="button" class="mini-btn" data-action="add-stage">＋ 添加阶段</button>';
    }

    const doneBadge = plan.done
      ? '<span class="plan-progress plan-done-badge">✅ 已完成 ' + new Date(plan.completedAt).toLocaleDateString("sv-SE") + "</span>"
      : "";
    const headActions = editing
      ? ""
      : '<span class="plan-actions">' +
        (plan.done
          ? '<button type="button" class="mini-btn" data-action="reopen-plan">重新打开</button>'
          : '<button type="button" class="mini-btn" data-action="complete-plan">完成计划</button>') +
        '<button type="button" class="mini-btn" data-action="edit-plan">编辑</button>' +
        '<button type="button" class="mini-btn" data-action="delete-plan">删除</button>' +
        "</span>";

    return (
      '<div class="record-item plan-card' + (plan.done ? " is-done" : "") + '" data-plan-id="' + Common.escapeHtml(plan.id) + '">' +
      '<div class="plan-head">' +
      nameHtml +
      doneBadge +
      '<span class="plan-progress">' + (plan.stages.length ? "✓ " + doneStages + "/" + plan.stages.length + " 阶段" : "未开始") + "</span>" +
      headActions +
      "</div>" +
      body +
      "</div>"
    );
  }

  function renderPlans() {
    els.planList.querySelectorAll(".plan-card").forEach((n) => n.remove());
    els.planDone.querySelectorAll(".plan-card").forEach((n) => n.remove());

    const active = plans.filter((p) => !p.done);
    const done = plans.filter((p) => p.done);
    els.planEmpty.hidden = active.length > 0;
    els.planDoneBox.hidden = !done.length;
    els.planDoneCount.textContent = String(done.length);

    let html = "";
    if (addForm && addForm.kind === "plan") {
      html += '<div class="record-item plan-card">' + addFormHtml("add-plan", {}, "计划名称，如：跟着AI学投资") + "</div>";
    }
    html += active.map(planCardHtml).join("");
    els.planList.insertAdjacentHTML("beforeend", html);
    els.planDone.insertAdjacentHTML("beforeend", done.map(planCardHtml).join(""));
  }

  /* ---------- 旧版打卡记录（只读） ---------- */

  function workCellHtml(log) {
    if (!log.workTasks.length) return '<span class="cell-empty">—</span>';
    const done = log.workTasks.filter((t) => t.done).length;
    const lines =
      '<div class="cell-line"><span class="cell-label">' + done + "/" + log.workTasks.length + " 完成</span></div>" +
      log.workTasks
        .map(
          (t) =>
            '<div class="cell-line' + (t.done ? " line-done" : "") + '">' +
            (t.done ? "✓ " : "○ ") + Common.escapeHtml(t.name) +
            "</div>"
        )
        .join("");
    return '<div class="clamp6" title="' + Common.escapeHtml(log.workTasks.map((t) => (t.done ? "✓ " : "○ ") + t.name).join("\n")) + '">' + lines + "</div>";
  }

  function winsCellHtml(log) {
    if (!log.wins || !log.wins.length) return '<span class="cell-empty">—</span>';
    const lines = log.wins
      .map((w) => '<div class="cell-line">🏆 ' + Common.escapeHtml(w.name) + "</div>")
      .join("");
    return '<div class="clamp6" title="' + Common.escapeHtml(log.wins.map((w) => w.name).join("\n")) + '">' + lines + "</div>";
  }

  function renderLegacy() {
    els.legacyBox.hidden = !logs.length;
    els.legacyRecords.querySelectorAll(".table-wrap").forEach((n) => n.remove());
    if (!logs.length) return;

    const list = logs.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const today = Common.todayStr();
    const rows = list
      .map((log) => {
        const dateHtml =
          '<div class="cell-date">' + Common.escapeHtml(log.date) +
          (log.date === today ? ' <span class="badge-today">今天</span>' : "") + "</div>" +
          '<div class="cell-weekday">' + Common.escapeHtml(Common.weekdayOf(log.date)) + "</div>";
        return (
          "<tr>" +
          "<td>" + dateHtml + "</td>" +
          "<td>" + workCellHtml(log) + "</td>" +
          "<td>" + winsCellHtml(log) + "</td>" +
          "</tr>"
        );
      })
      .join("");

    const wrap = document.createElement("div");
    wrap.className = "table-wrap card";
    wrap.innerHTML =
      '<table class="records-table checkin-table">' +
      "<colgroup>" +
      '<col style="width:18%"><col style="width:42%"><col style="width:40%">' +
      "</colgroup>" +
      "<thead><tr><th>日期</th><th>工作事项</th><th>本周成就</th></tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
      "</table>";
    els.legacyRecords.appendChild(wrap);
  }

  /* ---------- 页签 ---------- */

  function activateTab(name) {
    els.tabs.forEach((tab) => {
      if (tab.dataset.tab === name) tab.setAttribute("aria-current", "true");
      else tab.removeAttribute("aria-current");
    });
    els.panels.habits.hidden = name !== "habits";
    els.panels.short.hidden = name !== "short";
    els.panels.plans.hidden = name !== "plans";
  }

  /* ---------- 事件：习惯 / 短期目标 ---------- */

  function findItem(file, id) {
    return itemsOf(file).find((it) => it.id === id);
  }

  function handleItemAdd(e) {
    e.preventDefault();
    const isShort = e.target.id === "short-form";
    const input = isShort ? els.shortInput : els.habitInput;
    const name = input.value.trim();
    if (!name) return;
    const now = Date.now();
    itemsOf(isShort ? "short" : "habits").push({
      id: newId(),
      name: name.slice(0, 30),
      archived: false,
      done: false,
      completedAt: null,
      summary: "",
      checkIns: [],
      createdAt: now,
      updatedAt: now,
    });
    input.value = "";
    persistItems(isShort ? "short" : "habits");
    renderItems(isShort ? "short" : "habits");
    input.focus();
  }

  // 习惯/目标卡片区（含归档区、已完成区）的点击委托
  function handleItemClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const card = btn.closest("[data-file][data-id]");
    const file = card && card.dataset.file;
    const id = card && card.dataset.id;
    if (!file || !id) return;
    const item = findItem(file, id);
    if (!item) return;

    const checkinEl = btn.closest("[data-checkin-id]");
    const checkinId = checkinEl && checkinEl.dataset.checkinId;

    switch (action) {
      case "edit-item-name":
        editState = { kind: "item-name", file: file, id: id };
        renderItems(file);
        break;
      case "archive-item":
      case "restore-item":
        item.archived = action === "archive-item";
        item.updatedAt = Date.now();
        persistItems(file);
        renderItems(file);
        break;
      case "delete-item":
        if (!window.confirm("确定删除「" + item.name + "」？其打卡记录将一并删除。")) return;
        if (file === "short") shortGoals = shortGoals.filter((it) => it.id !== id);
        else habits = habits.filter((it) => it.id !== id);
        persistItems(file);
        renderItems(file);
        break;
      case "edit-checkin":
        editState = { kind: "checkin", file: file, itemId: id, checkinId: checkinId };
        renderItems(file);
        break;
      case "delete-checkin": {
        const c = item.checkIns.find((x) => x.id === checkinId);
        if (!c) return;
        if (!window.confirm("确定删除这条打卡（" + c.date + (c.note ? " " + c.note : "") + "）？")) return;
        item.checkIns = item.checkIns.filter((x) => x.id !== checkinId);
        item.updatedAt = Date.now();
        persistItems(file);
        renderItems(file);
        break;
      }
      case "complete-goal":
        if (!item.summary.trim()) return;
        if (!window.confirm("确定完成目标「" + item.name + "」？")) return;
        item.done = true;
        item.completedAt = Date.now();
        item.updatedAt = Date.now();
        persistItems(file);
        renderItems(file);
        break;
      case "reopen-goal":
        item.done = false;
        item.completedAt = null;
        item.updatedAt = Date.now();
        persistItems(file);
        renderItems(file);
        break;
      case "cancel-edit":
        editState = null;
        renderItems(file);
        break;
    }
  }

  // 习惯/目标卡片区的表单提交（打卡 / 改名 / 改打卡）
  function handleItemSubmit(e) {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    const kind = form.dataset.form;
    if (kind !== "checkin" && kind !== "edit-item" && kind !== "edit-checkin") return;
    e.preventDefault();
    const file = form.dataset.file;
    const item = file && findItem(file, form.dataset.itemId);
    if (!item) return;

    if (kind === "checkin") {
      const dateInput = form.querySelector(".checkin-date-input");
      const noteInput = form.querySelector(".checkin-note-input");
      const date = dateInput.value || Common.todayStr();
      item.checkIns.push({ id: newId(), date: date, note: noteInput.value.trim(), createdAt: Date.now() });
      item.updatedAt = Date.now();
      noteInput.value = "";
      dateInput.value = Common.todayStr();
      persistItems(file);
      renderItems(file);
      return;
    }

    if (kind === "edit-item") {
      const name = form.querySelector("input").value.trim();
      if (!name) {
        Common.toast("名称不能为空", "error");
        return;
      }
      item.name = name.slice(0, 30);
      item.updatedAt = Date.now();
      editState = null;
      persistItems(file);
      renderItems(file);
      return;
    }

    if (kind === "edit-checkin") {
      const c = item.checkIns.find((x) => x.id === form.dataset.checkinId);
      if (!c) {
        editState = null;
        renderItems(file);
        return;
      }
      const date = form.querySelector(".checkin-edit-date").value || c.date;
      const note = form.querySelector(".checkin-edit-note").value.trim();
      c.date = date;
      c.note = note;
      item.updatedAt = Date.now();
      editState = null;
      persistItems(file);
      renderItems(file);
    }
  }

  // 短期目标总结 / 长期计划任务总结：失焦或回车保存
  function handleSummarySave(e) {
    const input = e.target.closest("input[data-field]");
    if (!input) return;
    const field = input.dataset.field;

    if (field === "summary") {
      const card = input.closest("[data-file][data-id]");
      const item = card && findItem(card.dataset.file, card.dataset.id);
      if (!item) return;
      const value = input.value.trim();
      if (value === item.summary) return;
      item.summary = value;
      item.updatedAt = Date.now();
      persistItems(card.dataset.file);
      renderItems(card.dataset.file);
      return;
    }

    if (field === "task-summary") {
      const found = findStage(input.dataset.planId, input.dataset.stageId);
      const task = found.stage && found.stage.tasks.find((t) => t.id === input.dataset.taskId);
      if (!task) return;
      const value = input.value.trim();
      if (value === task.summary) return;
      task.summary = value;
      if (found.plan) found.plan.updatedAt = Date.now();
      persistPlans();
      Common.toast("已保存");
    }
  }

  /* ---------- 事件：长期计划 ---------- */

  function handleAddPlan() {
    addForm = addForm && addForm.kind === "plan" ? null : { kind: "plan" };
    renderPlans();
    if (addForm) {
      const input = els.planList.querySelector('form[data-form="add-plan"] input');
      if (input) input.focus();
    }
  }

  function handlePlanClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const card = btn.closest("[data-plan-id]");
    const planId = card && card.dataset.planId;
    const stageEl = btn.closest("[data-stage-id]");
    const stageId = stageEl && stageEl.dataset.stageId;

    switch (action) {
      case "cancel-add":
        addForm = null;
        renderPlans();
        break;
      case "edit-plan":
        editState = { kind: "plan", planId: planId };
        renderPlans();
        break;
      case "complete-plan": {
        const plan = findPlan(planId);
        if (!plan) return;
        if (!window.confirm("确定完成计划「" + plan.name + "」？")) return;
        plan.done = true;
        plan.completedAt = Date.now();
        plan.updatedAt = Date.now();
        persistPlans();
        renderPlans();
        break;
      }
      case "reopen-plan": {
        const plan = findPlan(planId);
        if (!plan) return;
        plan.done = false;
        plan.completedAt = null;
        plan.updatedAt = Date.now();
        persistPlans();
        renderPlans();
        break;
      }
      case "delete-plan": {
        const plan = findPlan(planId);
        if (!plan) return;
        if (!window.confirm("确定删除计划「" + plan.name + "」及所有阶段和任务？")) return;
        plans = plans.filter((p) => p.id !== planId);
        expandedStages.forEach((k) => {
          if (k.indexOf(planId + "/") === 0) expandedStages.delete(k);
        });
        persistPlans();
        renderPlans();
        break;
      }
      case "add-stage":
        addForm = addForm && addForm.kind === "stage" && addForm.planId === planId ? null : { kind: "stage", planId: planId };
        renderPlans();
        if (addForm) {
          const input = els.planList.querySelector('form[data-form="add-stage"] input');
          if (input) input.focus();
        }
        break;
      case "add-task":
        addForm = addForm && addForm.kind === "task" && addForm.stageId === stageId ? null : { kind: "task", planId: planId, stageId: stageId };
        renderPlans();
        if (addForm) {
          const input = els.planList.querySelector('form[data-form="add-task"] input');
          if (input) input.focus();
        }
        break;
      case "toggle-stage": {
        const key = planId + "/" + stageId;
        if (expandedStages.has(key)) expandedStages.delete(key);
        else expandedStages.add(key);
        renderPlans();
        break;
      }
      case "cycle-status": {
        const found = findStage(planId, stageId);
        if (!found.stage) return;
        const idx = MANUAL_CYCLE.indexOf(found.stage.manual);
        found.stage.manual = MANUAL_CYCLE[(idx + 1) % MANUAL_CYCLE.length];
        const plan = findPlan(planId);
        if (plan) plan.updatedAt = Date.now();
        persistPlans();
        renderPlans();
        break;
      }
      case "edit-stage":
        editState = { kind: "stage", planId: planId, stageId: stageId };
        renderPlans();
        break;
      case "delete-stage": {
        const plan = findPlan(planId);
        if (!plan) return;
        const stage = plan.stages.find((s) => s.id === stageId);
        if (!stage) return;
        if (!window.confirm("确定删除阶段「" + stage.name + "」及其中任务？")) return;
        plan.stages = plan.stages.filter((s) => s.id !== stageId);
        plan.updatedAt = Date.now();
        expandedStages.delete(planId + "/" + stageId);
        persistPlans();
        renderPlans();
        break;
      }
      case "toggle-task": {
        const found = findStage(planId, stageId);
        const task = found.stage && found.stage.tasks.find((t) => t.id === (btn.closest("[data-task-id]") || {}).dataset.taskId);
        if (!task) return;
        task.done = !task.done;
        task.doneAt = task.done ? Date.now() : null;
        if (found.plan) found.plan.updatedAt = Date.now();
        persistPlans();
        renderPlans();
        break;
      }
      case "edit-task": {
        const taskEl = btn.closest("[data-task-id]");
        editState = { kind: "task", planId: planId, stageId: stageId, taskId: taskEl && taskEl.dataset.taskId };
        renderPlans();
        break;
      }
      case "delete-task": {
        const found = findStage(planId, stageId);
        const taskEl = btn.closest("[data-task-id]");
        const taskId = taskEl && taskEl.dataset.taskId;
        const task = found.stage && found.stage.tasks.find((t) => t.id === taskId);
        if (!task) return;
        if (!window.confirm("确定删除任务「" + task.name + "」？")) return;
        found.stage.tasks = found.stage.tasks.filter((t) => t.id !== taskId);
        if (found.plan) found.plan.updatedAt = Date.now();
        persistPlans();
        renderPlans();
        break;
      }
      case "cancel-edit":
        editState = null;
        renderPlans();
        break;
    }
  }

  function handlePlanSubmit(e) {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    if (kind !== "edit" && kind !== "add-plan" && kind !== "add-stage" && kind !== "add-task") return;
    const input = form.querySelector("input");
    const name = input.value.trim();
    const now = Date.now();

    if (kind === "edit") {
      if (!name) {
        Common.toast("名称不能为空", "error");
        return;
      }
      const plan = findPlan(form.dataset.planId);
      if (form.dataset.editKind === "plan" && plan) {
        plan.name = name;
        plan.updatedAt = now;
      } else if (form.dataset.editKind === "stage" && plan) {
        const stage = plan.stages.find((s) => s.id === form.dataset.stageId);
        if (stage) {
          stage.name = name;
          plan.updatedAt = now;
        }
      } else if (form.dataset.editKind === "task" && plan) {
        const stage = plan.stages.find((s) => s.id === form.dataset.stageId);
        const task = stage && stage.tasks.find((t) => t.id === form.dataset.taskId);
        if (task) {
          task.name = name;
          plan.updatedAt = now;
        }
      }
      editState = null;
      persistPlans();
      renderPlans();
      return;
    }

    if (!name) {
      Common.toast("名称不能为空", "error");
      return;
    }
    if (kind === "add-plan") {
      plans.push({ id: newId(), name: name, done: false, completedAt: null, stages: [], createdAt: now, updatedAt: now });
    } else if (kind === "add-stage") {
      const plan = findPlan(form.dataset.planId);
      if (!plan) return;
      plan.stages.push({ id: newId(), name: name, manual: null, tasks: [] });
      plan.updatedAt = now;
    } else if (kind === "add-task") {
      const found = findStage(form.dataset.planId, form.dataset.stageId);
      if (!found.stage) return;
      found.stage.tasks.push({ id: newId(), name: name, done: false, doneAt: null, summary: "" });
      if (found.plan) found.plan.updatedAt = now;
    }
    addForm = null;
    persistPlans();
    renderPlans();
  }

  /* ---------- 初始化 ---------- */

  function cacheEls() {
    els.habitCards = $("#habit-cards");
    els.habitEmpty = $("#habit-empty");
    els.habitArchBox = $("#habit-archived-box");
    els.habitArch = $("#habit-archived");
    els.habitInput = $("#habit-input");
    els.shortCards = $("#short-cards");
    els.shortEmpty = $("#short-empty");
    els.shortArchBox = $("#short-archived-box");
    els.shortArch = $("#short-archived");
    els.shortInput = $("#short-input");
    els.shortDoneBox = $("#short-done-box");
    els.shortDone = $("#short-done");
    els.shortDoneCount = $("#short-done-count");
    els.legacyBox = $("#legacy-box");
    els.legacyRecords = $("#legacy-records");
    els.planList = $("#plan-list");
    els.planEmpty = $("#plan-empty");
    els.planDoneBox = $("#plan-done-box");
    els.planDone = $("#plan-done");
    els.planDoneCount = $("#plan-done-count");
    els.addPlanBtn = $("#add-plan-btn");
    els.tabs = Array.from(document.querySelectorAll(".page-tab"));
    els.panels = { habits: $("#panel-habits"), short: $("#panel-short"), plans: $("#panel-plans") };
  }

  function init() {
    cacheEls();

    $("#habit-form").addEventListener("submit", handleItemAdd);
    $("#short-form").addEventListener("submit", handleItemAdd);
    document.addEventListener("click", handleItemClick);
    document.addEventListener("submit", handleItemSubmit);
    document.addEventListener("change", handleSummarySave);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches && e.target.matches("input.task-summary-input, input.goal-summary-input")) {
        handleSummarySave(e);
        e.target.blur();
      }
    });

    els.addPlanBtn.addEventListener("click", handleAddPlan);
    els.planList.addEventListener("click", handlePlanClick);
    els.planDone.addEventListener("click", handlePlanClick);
    els.planList.addEventListener("submit", handlePlanSubmit);
    els.planDone.addEventListener("submit", handlePlanSubmit);
    els.tabs.forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));

    reloadAll(false);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
