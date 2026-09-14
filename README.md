# 陶关每日记录

纯静态个人记录网站（HTML + CSS + 原生 JavaScript，无框架、无构建工具、无外部 CDN 依赖），部署到 GitHub Pages（仓库 `vainturerous-Guan/TaoGuan-Daily-log`，分支 `main`）。

## 频道

| 页面 | 说明 |
| --- | --- |
| `index.html` | 首页，五个频道入口 |
| `daily.html` | 生活日常记录（已完整实现） |
| `parenting.html` / `knowledge.html` / `reading.html` / `stocks.html` | 占位页，内容建设中 |

## 数据存储（双模式）

**令牌不写死在代码里**（避免泄漏进仓库、触发 GitHub Push Protection）。token 改为在网页顶部提示条中输入一次，保存在浏览器 `localStorage`（key：`taoguan_github_token`），每台设备只需输入一次。

### GitHub 模式（有令牌时）

数据存为仓库根下 `data/daily-records.json`（JSON 数组）。读取用 `GET .../contents/data/daily-records.json`（`Accept: application/vnd.github.raw+json`，404 视为空数组）；写入先 GET 拿 `sha` 再 PUT（base64，message 为「更新每日记录」），409 冲突自动重试一次。

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
  "journal": [ { "id": "...", "createdAt": 1726200000000, "text": "整理后的流水账文本" } ],
  "work": "个人工作完成情况",
  "parenting": { "life": "生活&育儿完成情况", "mindful": "育儿正念", "reflection": "育儿反思及提升点" },
  "createdAt": "...", "updatedAt": "..."
}
```

- `journal` 为当日流水账条目数组，按录入顺序排列（流水账 1、2、3…）。
- 体重一律以公斤（kg）存储；页面上可在「斤 / 公斤」间切换显示（默认斤），单位选择持久化在 `localStorage`（key：`taoguan_weight_unit`），切换时表单已填数字自动换算（斤 ÷ 2 = kg）。
- 历史记录以表格展示（日期/睡眠/体重/饮食/今日记录/工作/生活和育儿/操作），点「编辑」在模态框中修改。
- 旧结构记录（`todayRecord`/`dailyLog`/`reflections` 字符串、`sleep` 字符串、`weight` 数字等）读取时自动一次性归一化为新结构（文本合并入 `journal` 单元素数组），编辑保存后落盘为新格式。

### 语音转文字 + 智能整理（零 token）

在「当日流水账」分区粘贴 iPhone/Mac 系统听写出的口语文字，点【智能整理】（`js/smart.js`，**纯前端规则，不调任何 AI API、内容不出本机**）：

1. **清洗**：删除典型口水词（嗯/呃/然后呢/就是就是/对对对/你知道吧/对吧/可以说等，同时充当断句点）、合并重复标点、去多余空格。
2. **分段**：按句读断句（每句句号收尾），在 上午/中午/下午/晚上/深夜/凌晨/早上/今早/昨晚 等时间词前另起一段。
3. **存条目**：结果追加为「流水账 N」条目（可再编辑、可删除），清空粘贴框。
4. **填充栏目**：对当天全部流水账合并文本做规则提取——睡眠（昨晚 X 睡/今早 X 起，时间归一化为 HH:MM）、体重（数字+斤/公斤，自动换算 kg，睡前→night、早起/空腹→morning）、饮食/工作/育儿（按关键词整句追加、自动去重）。

提取只改表单状态，检查无误后点「保存记录」才落盘。已知局限：规则匹配靠关键词，口语隐喻、同音误字、上下文缺失（如"轻了2斤"）可能提取不准，整理后请人工检查。

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
index.html  daily.html  parenting.html  knowledge.html  reading.html  stocks.html
css/style.css
js/config.js  js/storage.js  js/common.js  js/smart.js  js/daily.js
```
