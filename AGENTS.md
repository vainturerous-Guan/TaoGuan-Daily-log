# AGENTS.md · 项目约定

## 项目简介

纯静态个人网站（HTML + CSS + 原生 JS，无框架、无构建工具），部署于 GitHub Pages，自定义域名 `www.ericzzy.com`。

**品牌名：Stay Real and fun**（2026-09 由「陶关每日记录」更名，全站统一使用，不要再改回）。

## ⚠️ 分工规则（最高优先级，务必遵守）

本仓库按对话职责隔离，各司其职，互不冲突：

| 对话/端 | 职责 | 禁区 |
| --- | --- | --- |
| **KimiCode（stocks 频道）** | 网页结构、样式、框架、布局、组件、代码逻辑、新功能、bug 修复 | 🚫 **禁止修改 `stock-monitor.html` 里的任何股票数据**：持仓（`PORTFOLIO`）、交易（`TRADES`）、资金（`FUND_DATA`）、观察池（`WATCHLIST`）、清仓池（`CLOSED`）、策略（`STRATEGIES`）、作战计划（`PLAN_CARDS`）、指数列表（`INDEX_LIST`） |
| **KimiCode（持仓数据同步对话）** | 按用户指定的本地数据源页面，只同步上述股票数据区到本仓库，并提交、推送到网站 | 不动网页结构、样式与代码逻辑 |
| **KIMI work（每日对话分析）** | 维护本地数据源页面中的股票交易、持仓和资金数据 | 不直接操作本仓库、不负责推送 |

即：stocks 频道改代码不改数据；持仓数据同步对话改数据不改代码；KIMI work 维护本地数据源。任何数据相关需求（"改了仓""今天卖了"）都引导用户到持仓数据同步对话处理。

## 频道结构

- 全站导航顺序：**目标打卡 → 生活日常记录 → 股票监控与分析 → 知识点积累 → 读书笔记**
- `goals.html`（目标打卡）：页签结构（🔁 固定习惯 / 🎯 短期目标 / 🏔 长期计划）。固定习惯与短期目标共用条目结构 `{ id, name, archived, done, completedAt, summary, checkIns:[{ id, date, note, createdAt }], createdAt, updatedAt }`：卡片含新打卡行（日期+备注，同一天可多次）、最近3次打卡、全部记录（可编辑/删除）、归档区；短期目标另有「目标完成情况总结」，总结非空可「完成目标」移入底部「已完成目标」区（可「重新打开」），存 `data/short-goals.json`；固定习惯存 `data/plan-habits.json`；固定习惯页底部有「旧版打卡记录」只读区（2026-11 改版前 `data/plan-daily.json` 按日期的数据，只读不再写入）。长期计划（计划→阶段→任务；阶段状态按子任务自动推导：全完成=✓、有完成=●、否则=○，可点状态圈手动覆盖；任务含可选「完成情况总结」失焦/回车保存；计划可「完成计划」移入底部「已完成计划」区、可「重新打开」），存 `data/plan-long.json`（计划带 `done/completedAt`）
- `daily.html`（生活日常记录，2026-11 起收窄为纯感悟频道）：页签结构（今日感悟 / 全部历史记录）。今日感悟表单只含日期 + 感悟条目（类型：小确幸 happy / 小情绪 low / 其他 other + 文本，可增删），保存只 upsert `insights:[{ id, type, text }]` 字段，同日合并不新增、不清空旧记录其他字段；全部历史记录为拉宽（与股票监控台同宽）的完整表格，保留旧字段列（日期/睡眠/体重/饮食/今日记录/工作/生活流水账/感悟，体重斤公斤切换为只读展示），每条可「查看」（只读弹窗展示旧字段全量）与「编辑」（感悟表单弹窗，仅改 insights），10条/页翻页
- `parenting.html`（陶关亲子手记）：暂不启用，导航与首页入口已隐藏，文件保留
- `reading.html`（读书笔记）：页签结构（📝 读书笔记 / 📖 读过的书）。读书笔记页：登记书籍（登记日期+书名/文名，按登记顺序 date 升序排列，书名防重——重复时红色强提示且禁止保存）；每本书含 内容简介（大输入框、输入防抖自动保存、不限字数）、每章内容概览（多条，每条=章节名+概览，可编辑删除）、金句/关键知识点、感悟（各多条、每条≤100字，可编辑删除）；附件拖拽直存本机项目文件夹 `attachments/reading/`（File System Access API，句柄存 IndexedDB key `readingRootDir`，附件不入仓库，网页只记 name+path，删除附件不动本机文件）。读过的书页：全部已登记图书按登记日期排序，每条只显示登记日期+书名，右侧【详情】（只读弹窗预览全书内容）与【编辑】（跳回读书笔记页并打开该书的编辑表单）。数据存 `data/reading-books.json`
- `stocks.html`：左侧抽屉页签
  - 📊 股票监控 = iframe 内嵌 `stock-monitor.html`（独立页面，数据自给）；全幅出血嵌入：iframe 底边贴合屏幕下沿、背景透明无边框圆角（视觉与本地单页一致），内容在 iframe 内滚动；监控页签隐藏站点页脚；弹窗打开时外层自动对齐 iframe 顶部、关闭恢复滚动位置
  - 📚 交易体系学习：数据存 `data/stock-learning.json`（结构 `{ id, date, name, point, createdAt, updatedAt }`，按日期+时间倒序）
- `stock-monitor.html` 交易明细弹窗：按买入轮次（FIFO 先买先卖）展示，卖出份额按轮次拆分挂载，每轮右侧显示总盈亏；无法匹配的卖出归「—」组
- `stock-monitor.html` 持仓明细：现价/市值/参考盈亏由实时行情结合数据区的成本、数量实时计算（每次「立即查询」刷新）；成本价、持仓数量等持仓数据由持仓数据同步对话维护
- `stock-monitor.html` 行情数据源：腾讯行情 `qt.gtimg.cn`（单请求批量、支持跨域）为主源，东方财富 `push2.eastmoney.com` 为兜底（整批失败或个别标的缺失时逐只回退）；两者统一归一化为东财字段结构（f43/f60/f170/f48）供渲染使用

## 技术约定

- 频道页口令门禁 `js/gate.js`：在除 `index.html` 外的所有页面（含 `stock-monitor.html`）`<head>` 内同步引入；未验证时隐藏正文并显示全屏口令遮罩，口令写死在脚本里（纯静态站无后端，仅防普通访客，查看源码可见）；验证通过后写 localStorage `stayreal_gate_until`（时间戳），本浏览器 7 天内全站频道免验证，跨频道共用；解锁后会重载页面内 iframe（股票监控）使之内层门禁同步解除
- 存储双模式见 `js/storage.js`：GitHub 模式写仓库 `data/*.json`（需令牌），本地模式写 localStorage（key 按文件路径派生，如 `taoguan_records_data_stock_learning_json`）
- 共享工具在 `js/common.js`（toast / 日期 / HTML 转义 / 本地模式提示条），各频道逻辑独立成 `js/<频道>.js`
- CSS 全部在 `css/style.css`；站点设计令牌在 `:root`（--bg / --accent 等）；修改样式优先复用已有类（`.card` `.form-field` `.record-item` …）
- 静态资源引用带 `?v=日期` 缓存清除参数，改动 css/js 后 bump 版本号
- 部署即 push 到 `main`（GitHub Pages 自动发布，全站已启用 HTTPS 强制跳转）
