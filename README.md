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
js/config.js  js/storage.js  js/common.js  js/daily.js
```
