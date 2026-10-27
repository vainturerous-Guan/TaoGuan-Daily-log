# AGENTS.md · 项目约定

## 项目简介

纯静态个人网站（HTML + CSS + 原生 JS，无框架、无构建工具），部署于 GitHub Pages，自定义域名 `www.ericzzy.com`。

**品牌名：Stay Real and fun**（2026-09 由「陶关每日记录」更名，全站统一使用，不要再改回）。

## ⚠️ 两端分工规则（最高优先级，务必遵守）

本仓库由两端协作维护，各司其职，互不冲突：

| 端 | 职责 | 禁区 |
| --- | --- | --- |
| **KimiCode（本端，CLI 编码助手）** | 网页结构、样式、框架、布局、组件、代码逻辑、新功能、bug 修复 | 🚫 **禁止修改 `stock-monitor.html` 里的任何股票数据**：持仓（`PORTFOLIO`）、交易（`TRADES`）、资金（`FUND_DATA`）、观察池（`WATCHLIST`）、清仓池（`CLOSED`）、策略（`STRATEGIES`）、作战计划（`PLAN_CARDS`）、指数列表（`INDEX_LIST`） |
| **KIMI work（另一端，每日对话分析）** | 维护股票交易情况、持仓情况、资金数据（只改上述数据区） | 不动网页结构、样式与代码逻辑 |

即：KimiCode 改代码不改数据；KIMI work 改数据不改代码。任何数据相关需求（"改了仓""今天卖了"）都引导用户去 KIMI work 处理。

## 频道结构

- 全站导航顺序：**生活日常记录 → 目标打卡 → 股票监控与分析 → 知识点积累 → 读书笔记**
- `goals.html`（目标打卡）：页签结构（本周打卡 / 长期计划 / 打卡历史）。本周打卡（本周工作事项、生活习惯清单，均打勾划线；高效时间栏已下线，`plan-daily.json` 的 focusHours 为历史兼容字段）；长期计划（计划→阶段→任务；阶段状态按子任务自动推导：全完成=✓、有完成=●、否则=○，可点状态圈手动覆盖）；打卡历史（按日期列表展示每次打卡完成情况，点「编辑」跳回本周打卡载入该日期）；数据存 `data/plan-habits.json`（习惯清单，含归档）、`data/plan-long.json`（长期计划）、`data/plan-daily.json`（按日期 upsert，每日一条）
- `daily.html`（生活日常记录）：页签结构（今日记录 / 全部历史记录）。今日记录页含表单 + 近5日记录（原列宽样式）；全部历史记录为拉宽（与股票监控台同宽）的完整表格，10条/页翻页
- `parenting.html`（陶关亲子手记）：暂不启用，导航与首页入口已隐藏，文件保留
- `reading.html`（读书笔记）：页签结构（📝 读书笔记 / 📖 读过的书）。读书笔记页：登记书籍（登记日期+书名/文名，按登记顺序 date 升序排列，书名防重——重复时红色强提示且禁止保存）；每本书含 内容简介（大输入框、输入防抖自动保存、不限字数）、每章内容概览（多条，每条=章节名+概览，可编辑删除）、金句/关键知识点、感悟（各多条、每条≤100字，可编辑删除）；附件拖拽直存本机项目文件夹 `attachments/reading/`（File System Access API，句柄存 IndexedDB key `readingRootDir`，附件不入仓库，网页只记 name+path，删除附件不动本机文件）。读过的书页：全部已登记图书按登记日期排序，每条只显示登记日期+书名，右侧【详情】（只读弹窗预览全书内容）与【编辑】（跳回读书笔记页并打开该书的编辑表单）。数据存 `data/reading-books.json`
- `stocks.html`：左侧抽屉页签
  - 📊 股票监控 = iframe 内嵌 `stock-monitor.html`（独立页面，数据自给）；iframe 高度自适应内容（js/stocks.js 里 ResizeObserver 实现），整页由外层滚动，无框内滚动条；弹窗打开时外层自动对齐 iframe 顶部、关闭恢复滚动位置
  - 📚 交易体系学习：数据存 `data/stock-learning.json`（结构 `{ id, date, name, point, createdAt, updatedAt }`，按日期+时间倒序）
- `stock-monitor.html` 交易明细弹窗：按买入轮次（FIFO 先买先卖）展示，卖出份额按轮次拆分挂载，每轮右侧显示总盈亏；无法匹配的卖出归「—」组
- `stock-monitor.html` 行情数据源：腾讯行情 `qt.gtimg.cn`（单请求批量、支持跨域）为主源，东方财富 `push2.eastmoney.com` 为兜底（整批失败或个别标的缺失时逐只回退）；两者统一归一化为东财字段结构（f43/f60/f170/f48）供渲染使用

## 技术约定

- 存储双模式见 `js/storage.js`：GitHub 模式写仓库 `data/*.json`（需令牌），本地模式写 localStorage（key 按文件路径派生，如 `taoguan_records_data_stock_learning_json`）
- 共享工具在 `js/common.js`（toast / 日期 / HTML 转义 / 本地模式提示条），各频道逻辑独立成 `js/<频道>.js`
- CSS 全部在 `css/style.css`；站点设计令牌在 `:root`（--bg / --accent 等）；修改样式优先复用已有类（`.card` `.form-field` `.record-item` …）
- 静态资源引用带 `?v=日期` 缓存清除参数，改动 css/js 后 bump 版本号
- 部署即 push 到 `main`（GitHub Pages 自动发布，全站已启用 HTTPS 强制跳转）
