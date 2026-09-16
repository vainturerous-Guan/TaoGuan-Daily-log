// 目标打卡频道逻辑
// 数据文件（均顶层数组，直接走 Storage.load/save(filePath)）：
//  data/plan-habits.json  习惯清单：{ id, name, archived, createdAt, updatedAt }
//  data/plan-long.json    长期计划：{ id, name,
//                          stages:[{ id, name, manual:null|"pending"|"active"|"done",
//                                    tasks:[{ id, name, done, doneAt }] }],
//                          createdAt, updatedAt }
//  data/plan-daily.json   每日打卡：{ date, focusHours(null|数字), workTasks:[{ id, name, done }],
//                          habits:{ 习惯id:true }, createdAt, updatedAt }
// 阶段状态：manual 有值优先；否则按子任务推导（全完成=done，有完成=active，否则pending）
(function () {
  "use strict";

  const FILES = {
    habits: "data/plan-habits.json",
    plans: "data/plan-long.json",
    daily: "data/plan-daily.json",
  };
  const FOCUS_GOAL = 3; // 高效时间目标（小时）
  const STAGE_ICON = { pending: "○", active: "●", done: "✓" };
  const MANUAL_CYCLE = [null, "pending", "active", "done"];

  let habits = [];
  let plans = [];
  let logs = [];
  let currentDate = Common.todayStr();
  const expandedStages = new Set(); // "planId/stageId"
  let editState = null; // { kind:"habit"|"work-task"|"plan"|"stage"|"task", id, planId, stageId, taskId }
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

  function normalizeHabit(h) {
    if (!h || typeof h !== "object") return null;
    return {
      id: str(h.id) || newId(),
      name: str(h.name),
      archived: !!h.archived,
      createdAt: numOrNull(h.createdAt) || Date.now(),
      updatedAt: numOrNull(h.updatedAt) || Date.now(),
    };
  }

  function normalizePlan(p) {
    if (!p || typeof p !== "object") return null;
    const stages = Array.isArray(p.stages) ? p.stages : [];
    return {
      id: str(p.id) || newId(),
      name: str(p.name),
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
              })),
          };
        }),
      createdAt: numOrNull(p.createdAt) || Date.now(),
      updatedAt: numOrNull(p.updatedAt) || Date.now(),
    };
  }

  function normalizeLog(l) {
    if (!l || typeof l !== "object") return null;
    const habitsMap = l.habits && typeof l.habits === "object" && !Array.isArray(l.habits) ? l.habits : {};
    const done = {};
    Object.keys(habitsMap).forEach((k) => {
      if (habitsMap[k]) done[str(k)] = true;
    });
    const workTasks = Array.isArray(l.workTasks) ? l.workTasks : [];
    return {
      date: str(l.date),
      focusHours: numOrNull(l.focusHours),
      workTasks: workTasks
        .filter((t) => t && typeof t === "object")
        .map((t) => ({ id: str(t.id) || newId(), name: str(t.name), done: !!t.done })),
      habits: done,
      createdAt: numOrNull(l.createdAt) || Date.now(),
      updatedAt: numOrNull(l.updatedAt) || Date.now(),
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

  function persist(key, arr) {
    return Storage.save(arr, FILES[key]).catch((err) => {
      console.error("保存失败", err);
      Common.toast(friendlyError(err, "保存"), "error");
      return reloadAll(true);
    });
  }

  async function reloadAll(silent) {
    try {
      const raw = await Promise.all([
        Storage.load(FILES.habits),
        Storage.load(FILES.plans),
        Storage.load(FILES.daily),
      ]);
      habits = raw[0].map(normalizeHabit).filter(Boolean);
      plans = raw[1].map(normalizePlan).filter(Boolean);
      logs = raw[2].map(normalizeLog).filter(Boolean);
    } catch (err) {
      console.error("读取打卡数据失败", err);
      habits = [];
      plans = [];
      logs = [];
      if (!silent) Common.toast(friendlyError(err, "读取"), "error");
    }
    renderToday();
    renderPlans();
  }

  /* ---------- 今日打卡 ---------- */

  function logOf(date, create) {
    let log = logs.find((l) => l.date === date);
    if (!log && create) {
      log = { date: date, focusHours: null, workTasks: [], habits: {}, createdAt: Date.now(), updatedAt: Date.now() };
      logs.push(log);
    }
    return log;
  }

  // 一条日志若三项全空，则从列表移除，避免产生空记录
  function pruneLog(log) {
    if (!log) return;
    const empty =
      log.focusHours == null &&
      !log.workTasks.length &&
      !Object.keys(log.habits).length;
    if (empty) {
      const idx = logs.indexOf(log);
      if (idx !== -1) logs.splice(idx, 1);
    }
  }

  function isEditing(kind, ids) {
    if (!editState || editState.kind !== kind) return false;
    const keys = { habit: ["id"], "work-task": ["id"], plan: ["planId"], stage: ["planId", "stageId"], task: ["planId", "stageId", "taskId"] };
    return keys[kind].every((k) => editState[k] === ids[k]);
  }

  function editFormHtml(kind, ref, value, maxLength) {
    const attrs = Object.keys(ref)
      .map((k) => ' data-' + k + '="' + Common.escapeHtml(String(ref[k])) + '"')
      .join("");
    return (
      '<form class="edit-row" data-form="edit" data-edit-kind="' + kind + '"' + attrs + '>' +
      '<input type="text" value="' + Common.escapeHtml(value) + '" maxlength="' + maxLength + '">' +
      '<button type="submit" class="btn btn-small">保存</button>' +
      '<button type="button" class="mini-btn" data-action="cancel-edit">取消</button>' +
      "</form>"
    );
  }

  function checkItemHtml(opts) {
    // opts: { liClass, liAttr, done, toggleAction, name, editing, editKind, editRef, maxLength, actionsHtml }
    const nameHtml = opts.editing
      ? editFormHtml(opts.editKind, opts.editRef, opts.name, opts.maxLength || 50)
      : '<span class="check-name">' + Common.escapeHtml(opts.name) + "</span>";
    return (
      '<li class="check-item' + (opts.done ? " done" : "") + '"' + opts.liAttr + ">" +
      '<button type="button" class="check-toggle" data-action="' + opts.toggleAction + '" aria-pressed="' + !!opts.done + '">✓</button>' +
      nameHtml +
      (opts.editing ? "" : '<span class="check-actions">' + opts.actionsHtml + "</span>") +
      "</li>"
    );
  }

  function renderToday() {
    els.date.value = currentDate;
    els.weekday.textContent = Common.weekdayOf(currentDate);
    els.todayBadge.hidden = currentDate !== Common.todayStr();

    const log = logOf(currentDate, false);
    if (document.activeElement !== els.focusHours) {
      els.focusHours.value = log && log.focusHours != null ? log.focusHours : "";
    }

    // 今日工作事项
    const workItems = log ? log.workTasks : [];
    if (!workItems.length) {
      els.workTasks.innerHTML = '<li class="check-hint">还没有今日事项，在下面添加～</li>';
    } else {
      els.workTasks.innerHTML = workItems
        .map((t) =>
          checkItemHtml({
            liAttr: ' data-id="' + Common.escapeHtml(t.id) + '"',
            done: t.done,
            toggleAction: "toggle-work-task",
            name: t.name,
            editing: isEditing("work-task", { id: t.id }),
            editKind: "work-task",
            editRef: { id: t.id },
            actionsHtml:
              '<button type="button" class="mini-btn" data-action="edit-work-task">编辑</button>' +
              '<button type="button" class="mini-btn" data-action="delete-work-task">删除</button>',
          })
        )
        .join("");
    }

    // 生活习惯（未归档 + 已归档）
    const activeHabits = habits.filter((h) => !h.archived);
    const archivedHabits = habits.filter((h) => h.archived);
    if (!activeHabits.length) {
      els.habitList.innerHTML = '<li class="check-hint">还没有习惯，先添加一个吧～</li>';
    } else {
      els.habitList.innerHTML = activeHabits
        .map((h) => {
          const done = !!(log && log.habits[h.id]);
          return checkItemHtml({
            liAttr: ' data-id="' + Common.escapeHtml(h.id) + '"',
            done: done,
            toggleAction: "toggle-habit",
            name: h.name,
            editing: isEditing("habit", { id: h.id }),
            editKind: "habit",
            editRef: { id: h.id },
            maxLength: 20,
            actionsHtml:
              '<button type="button" class="mini-btn" data-action="edit-habit">编辑</button>' +
              '<button type="button" class="mini-btn" data-action="archive-habit">归档</button>',
          });
        })
        .join("");
    }

    els.archivedBox.hidden = !archivedHabits.length;
    els.archivedList.innerHTML = archivedHabits
      .map(
        (h) =>
          '<li class="check-item" data-id="' + Common.escapeHtml(h.id) + '">' +
          '<span class="check-name">' + Common.escapeHtml(h.name) + "</span>" +
          '<span class="check-actions">' +
          '<button type="button" class="mini-btn" data-action="restore-habit">恢复</button>' +
          '<button type="button" class="mini-btn" data-action="delete-habit">删除</button>' +
          "</span></li>"
      )
      .join("");

    updateTodayMeta();
  }

  function updateTodayMeta() {
    const log = logOf(currentDate, false);
    const activeHabits = habits.filter((h) => !h.archived);
    const workTotal = log ? log.workTasks.length : 0;
    const workDone = log ? log.workTasks.filter((t) => t.done).length : 0;
    const habitDone = log ? activeHabits.filter((h) => log.habits[h.id]).length : 0;
    const parts = ["工作事项 " + workDone + "/" + workTotal, "生活习惯 " + habitDone + "/" + activeHabits.length];
    if (log && log.focusHours != null) {
      parts.push("高效 " + log.focusHours + "h" + (log.focusHours >= FOCUS_GOAL ? " ✓ 达标" : ""));
    }
    els.summary.textContent = "今日完成：" + parts.join(" · ");
    els.focusState.hidden = !(log && log.focusHours != null && log.focusHours >= FOCUS_GOAL);
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
      .map((k) => ' data-' + k + '="' + Common.escapeHtml(String(ref[k])) + '"')
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
      "</li>"
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

  function planCardHtml(plan) {
    const doneStages = plan.stages.filter((s) => stageStatus(s) === "done").length;
    const editing = isEditing("plan", { planId: plan.id });
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

    return (
      '<div class="record-item plan-card" data-plan-id="' + Common.escapeHtml(plan.id) + '">' +
      '<div class="plan-head">' +
      nameHtml +
      '<span class="plan-progress">' + (plan.stages.length ? "✓ " + doneStages + "/" + plan.stages.length + " 阶段" : "未开始") + "</span>" +
      (editing
        ? ""
        : '<span class="plan-actions">' +
          '<button type="button" class="mini-btn" data-action="edit-plan">编辑</button>' +
          '<button type="button" class="mini-btn" data-action="delete-plan">删除</button>' +
          "</span>") +
      "</div>" +
      body +
      "</div>"
    );
  }

  function renderPlans() {
    els.planList.querySelectorAll(".plan-card").forEach((n) => n.remove());
    els.planEmpty.hidden = plans.length > 0;

    let html = "";
    if (addForm && addForm.kind === "plan") {
      html += '<div class="record-item plan-card">' + addFormHtml("add-plan", {}, "计划名称，如：跟着AI学投资") + "</div>";
    }
    html += plans.map(planCardHtml).join("");
    els.planList.insertAdjacentHTML("beforeend", html);
  }

  /* ---------- 事件：今日打卡 ---------- */

  function handleDateChange() {
    currentDate = els.date.value || Common.todayStr();
    renderToday();
  }

  function handleFocusChange() {
    const log = logOf(currentDate, true);
    const v = parseFloat(els.focusHours.value);
    log.focusHours = els.focusHours.value.trim() === "" || isNaN(v) ? null : Math.round(v * 10) / 10;
    log.updatedAt = Date.now();
    pruneLog(log);
    persist("daily", logs);
    updateTodayMeta();
  }

  function handleWorkTaskSubmit(e) {
    e.preventDefault();
    const name = els.workTaskInput.value.trim();
    if (!name) return;
    const log = logOf(currentDate, true);
    log.workTasks.push({ id: newId(), name: name, done: false });
    log.updatedAt = Date.now();
    els.workTaskInput.value = "";
    persist("daily", logs);
    renderToday();
    els.workTaskInput.focus();
  }

  function handleHabitSubmit(e) {
    e.preventDefault();
    const name = els.habitInput.value.trim();
    if (!name) return;
    habits.push({ id: newId(), name: name, archived: false, createdAt: Date.now(), updatedAt: Date.now() });
    els.habitInput.value = "";
    persist("habits", habits);
    renderToday();
    els.habitInput.focus();
  }

  function handleTodayClick(e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const li = btn.closest("[data-id]");
    const id = li && li.dataset.id;

    switch (action) {
      case "toggle-work-task": {
        const log = logOf(currentDate, true);
        const task = log.workTasks.find((t) => t.id === id);
        if (!task) return;
        task.done = !task.done;
        log.updatedAt = Date.now();
        pruneLog(log);
        persist("daily", logs);
        renderToday();
        break;
      }
      case "edit-work-task":
        editState = { kind: "work-task", id: id };
        renderToday();
        break;
      case "delete-work-task": {
        const log = logOf(currentDate, false);
        if (!log) return;
        const idx = log.workTasks.findIndex((t) => t.id === id);
        if (idx === -1) return;
        log.workTasks.splice(idx, 1);
        log.updatedAt = Date.now();
        pruneLog(log);
        persist("daily", logs);
        renderToday();
        break;
      }
      case "toggle-habit": {
        const log = logOf(currentDate, true);
        if (log.habits[id]) delete log.habits[id];
        else log.habits[id] = true;
        log.updatedAt = Date.now();
        pruneLog(log);
        persist("daily", logs);
        renderToday();
        break;
      }
      case "edit-habit":
        editState = { kind: "habit", id: id };
        renderToday();
        break;
      case "archive-habit":
      case "restore-habit": {
        const habit = habits.find((h) => h.id === id);
        if (!habit) return;
        habit.archived = action === "archive-habit";
        habit.updatedAt = Date.now();
        persist("habits", habits);
        renderToday();
        break;
      }
      case "delete-habit": {
        const habit = habits.find((h) => h.id === id);
        if (!habit) return;
        if (!window.confirm("确定删除习惯「" + habit.name + "」？（历史打卡记录不受影响）")) return;
        habits = habits.filter((h) => h.id !== id);
        persist("habits", habits);
        renderToday();
        break;
      }
      case "cancel-edit":
        editState = null;
        renderToday();
        break;
    }
  }

  // 行内编辑提交（工作事项 + 习惯共用，表单 data-form="edit"）
  function handleTodaySubmit(e) {
    const form = e.target.closest('form[data-form="edit"]');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector("input");
    const name = input.value.trim();
    if (!name) {
      Common.toast("名称不能为空", "error");
      return;
    }
    const kind = form.dataset.editKind;
    const id = form.dataset.id;
    let target = null;
    if (kind === "habit") target = habits.find((h) => h.id === id);
    if (kind === "work-task") {
      const log = logOf(currentDate, false);
      target = log && log.workTasks.find((t) => t.id === id);
    }
    if (!target) {
      editState = null;
      renderToday();
      return;
    }
    target.name = kind === "habit" ? name.slice(0, 20) : name;
    if (kind === "habit") {
      target.updatedAt = Date.now();
      persist("habits", habits);
    } else {
      const log = logOf(currentDate, false);
      if (log) log.updatedAt = Date.now();
      persist("daily", logs);
    }
    editState = null;
    renderToday();
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
      case "delete-plan": {
        const plan = findPlan(planId);
        if (!plan) return;
        if (!window.confirm("确定删除计划「" + plan.name + "」及所有阶段和任务？")) return;
        plans = plans.filter((p) => p.id !== planId);
        expandedStages.forEach((k) => {
          if (k.indexOf(planId + "/") === 0) expandedStages.delete(k);
        });
        persist("plans", plans);
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
        persist("plans", plans);
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
        persist("plans", plans);
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
        persist("plans", plans);
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
        persist("plans", plans);
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
      persist("plans", plans);
      renderPlans();
      return;
    }

    if (!name) {
      Common.toast("名称不能为空", "error");
      return;
    }
    if (kind === "add-plan") {
      plans.push({ id: newId(), name: name, stages: [], createdAt: now, updatedAt: now });
    } else if (kind === "add-stage") {
      const plan = findPlan(form.dataset.planId);
      if (!plan) return;
      plan.stages.push({ id: newId(), name: name, manual: null, tasks: [] });
      plan.updatedAt = now;
    } else if (kind === "add-task") {
      const found = findStage(form.dataset.planId, form.dataset.stageId);
      if (!found.stage) return;
      found.stage.tasks.push({ id: newId(), name: name, done: false, doneAt: null });
      if (found.plan) found.plan.updatedAt = now;
    }
    addForm = null;
    persist("plans", plans);
    renderPlans();
  }

  /* ---------- 初始化 ---------- */

  function cacheEls() {
    els.date = $("#checkin-date");
    els.weekday = $("#checkin-weekday");
    els.todayBadge = $("#today-badge");
    els.focusHours = $("#focus-hours");
    els.focusState = $("#focus-state");
    els.workTasks = $("#work-tasks");
    els.workTaskInput = $("#work-task-input");
    els.habitList = $("#habit-list");
    els.habitInput = $("#habit-input");
    els.archivedBox = $("#archived-box");
    els.archivedList = $("#archived-list");
    els.summary = $("#today-summary");
    els.planList = $("#plan-list");
    els.planEmpty = $("#plan-empty");
    els.addPlanBtn = $("#add-plan-btn");
  }

  function init() {
    cacheEls();
    els.date.value = Common.todayStr();

    els.date.addEventListener("change", handleDateChange);
    els.focusHours.addEventListener("change", handleFocusChange);
    $("#work-task-form").addEventListener("submit", handleWorkTaskSubmit);
    $("#habit-form").addEventListener("submit", handleHabitSubmit);
    els.workTasks.addEventListener("click", handleTodayClick);
    els.workTasks.addEventListener("submit", handleTodaySubmit);
    els.habitList.addEventListener("click", handleTodayClick);
    els.habitList.addEventListener("submit", handleTodaySubmit);
    els.archivedList.addEventListener("click", handleTodayClick);
    els.addPlanBtn.addEventListener("click", handleAddPlan);
    els.planList.addEventListener("click", handlePlanClick);
    els.planList.addEventListener("submit", handlePlanSubmit);

    reloadAll(false);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
