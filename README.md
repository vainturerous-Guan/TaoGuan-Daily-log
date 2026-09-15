# 陶关每日记录

纯静态个人记录网站（HTML + CSS + 原生 JavaScript，无框架、无构建工具、无外部 CDN 依赖），部署到 GitHub Pages（仓库 `vainturerous-Guan/TaoGuan-Daily-log`，分支 `main`）。

## 频道

| 页面 | 说明 |
| --- | --- |
| `index.html` | 首页，五个频道入口 |
| `daily.html` | 生活日常记录（已完整实现） |
| `knowledge.html` | 知识点积累（已可用） |
| `parenting.html` / `reading.html` | 占位页，内容建设中 |
| `stocks.html` | 股票监控与分析（股票监控 + 交易体系学习） |

## 数据存储（双模式）

**令牌不写死在代码里**（避免泄漏进仓库、触发 GitHub Push Protection）。token 改为在网页顶部提示条中输入一次，保存在浏览器 `localStorage`（key：`taoguan_github_token`），每台设备只需输入一次。

### GitHub 模式（有令牌时）

数据存为仓库根下 `data/daily-records.json`（JSON 数组；知识点积累频道则存 `data/knowledge.json`，两者共用同一套读写逻辑，按文件路径区分）。读取用 `GET .../contents/<文件路径>`（`Accept: application/vnd.github.raw+json`，404 视为空数组）；写入先 GET 拿 `sha` 再 PUT（base64，message 为「更新记录数据」），409 冲突自动重试一次。所有 API 请求带 `cache: "no-store"`，避免浏览器缓存串包导致 sha 丢失。

### 如何填写 / 清除令牌

1. 打开站点任意页面，顶部会出现黄色提示条（本地模式）。
2. 在「粘贴 GitHub 令牌」输入框中粘贴 fine-grained PAT，点「保存」，页面自动刷新进入 GitHub 模式。提示条里的「如何获取令牌？」有详细步骤：
   - `Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token`
   - Repository access 只勾选 `TaoGuan-Daily-log` 一个仓库
   - Permissions → Repository permissions → `Contents` 选 `Read and write`
   - 生成后复制以 `github_pat_` 开头的令牌
3. 清除：已有令牌时提示条不再显示，页脚会出现「清除令牌」链接，点击后回到本地模式并刷新。

### 本地模式（无令牌时）

退化为 `localStorage`（key：`taoguan_daily_records`），页顶部显示黄色提示条「当前为本地模式，数据只保存在此浏览器」。

### 记录数据结构

`data/daily-records.json` / `localStorage` 中为一个 JSON 数组，每条：

```json
{
  "id": "...",
  "date": "YYYY-MM-DD",
  "summary": "今日一句话总结",
  "sleep": { "bedTime": "昨日入睡时间", "wakeTime": "今早起床时间" },
  "weight": { "night": 55.5, "morning": 55.0 },
  "diet": { "snacks": "零食饮料", "meals": "正餐" },
  "todayRecord": "今日记录（流水账/感悟）",
  "work": "个人工作完成情况",
  "parenting": { "life": "生活流水账", "lifeMindful": "生活正念", "mindful": "育儿正念", "reflection": "反思与提升" },
  "createdAt": "...", "updatedAt": "..."
}
```

- 体重一律以公斤（kg）存储；页面上可在「斤 / 公斤」间切换显示（默认斤），单位选择持久化在 `localStorage`（key：`taoguan_weight_unit`），切换时表单已填数字自动换算（斤 ÷ 2 = kg）。
- 历史记录以表格展示（日期/睡眠/体重/饮食/今日记录/工作/生活和育儿/操作），点「编辑」在模态框中修改。
- 旧结构记录（`dailyLog`/`sleep` 字符串、`weight` 数字等）读取时自动一次性归一化为新结构，编辑保存后落盘为新格式。

### 知识点积累（knowledge.html）

数据文件 `data/knowledge.json`（本地模式 key：`taoguan_records_data_knowledge_json`），JSON 数组，每条：

```json
{ "id": "...", "date": "YYYY-MM-DD", "source": "知识来源（可空）", "point": "知识点", "insight": "心得感悟（可空）", "attachments": [{ "name": "原文件名", "type": "MIME", "size": 12345, "path": "data/attachments/<记录id>-<序号>-<文件名>" }], "createdAt": "...", "updatedAt": "..." }
```

同一天允许多条记录，各自独立；列表按日期倒序、同日期按 createdAt 倒序；读取时自动过滤缺 `id` 的坏条目。

**附件**：表单中可点击上传或粘贴图片，一条知识点可挂多个附件。附件优先写入本机项目文件夹（通过 File System Access API 选择一次项目文件夹，句柄存浏览器 IndexedDB，后续自动复用；页面需经本地服务器访问，如 `python3 -m http.server`）。未选择文件夹或不支持该 API 时，附件以 base64 内嵌进记录本身。历史记录中图片可点击放大预览，其他附件可点击下载。注意：附件只保存在本机，不会随 GitHub 模式同步到仓库。

### 股票监控与分析（stocks.html）

页面左侧为抽屉式页签（桌面端常驻侧栏、移动端 ☰ 滑出）：

- **股票监控**：内嵌 `stock-monitor.html`（独立页面，原样引入、未做修改），数据与交互逻辑均在其页面内自给。
- **交易体系学习**：表单含日期（默认当天、显示星期）、名称、知识点；保存后进入历史记录，按日期倒序、同日期按创建时间倒序展示（含 HH:mm）。

数据文件 `data/stock-learning.json`（本地模式 key：`taoguan_records_data_stock_learning_json`），JSON 数组，每条：

```json
{ "id": "...", "date": "YYYY-MM-DD", "name": "名称", "point": "知识点", "createdAt": "...", "updatedAt": "..." }
```

> 安全说明：令牌只存在你自己浏览器的 localStorage 里，不会进入仓库代码。请勿在公共电脑上保存令牌；若怀疑令牌泄漏，立即在 GitHub 上吊销并重新生成。

## 本地预览

```bash
cd ericzzy_com
python3 -m http.server 8000
# 打开 http://localhost:8000
```

用 `daily.html` 即可新增 / 查看 / 编辑记录（本地模式下数据存浏览器）。

## 文件结构

```
index.html  daily.html  parenting.html  knowledge.html  reading.html  stocks.html  stock-monitor.html
css/style.css
js/config.js  js/storage.js  js/common.js  js/daily.js  js/knowledge.js  js/stocks.js
```
