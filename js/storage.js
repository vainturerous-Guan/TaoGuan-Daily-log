// 双模式存储：GitHub（有 token）/ 本地 localStorage
// 对 daily.js 暴露统一接口：Storage.load() / Storage.save(records)
// token 来源：window.SITE_CONFIG.token 或 localStorage（用户在网页上输入一次，全站生效）
(function () {
  "use strict";

  const LOCAL_KEY = "taoguan_daily_records";
  const TOKEN_KEY = "taoguan_github_token";
  const FILE_PATH = "data/daily-records.json";

  function config() {
    return window.SITE_CONFIG || {};
  }

  function getToken() {
    if (config().token) return config().token;
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function isGitHubMode() {
    return Boolean(getToken());
  }

  function apiUrl(filePath) {
    const { owner, repo } = config();
    return `https://api.github.com/repos/${owner}/${repo}/contents/${filePath || FILE_PATH}`;
  }

  // 本地模式的存储 key：默认日记文件沿用旧 key 兼容已有本地数据，其它文件按路径派生
  function localKey(filePath) {
    if (!filePath || filePath === FILE_PATH) return LOCAL_KEY;
    return "taoguan_records_" + String(filePath).replace(/[^a-zA-Z0-9]+/g, "_");
  }

  function authHeaders(extra) {
    return Object.assign(
      {
        Authorization: `Bearer ${getToken()}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      extra || {}
    );
  }

  // UTF-8 安全的 base64 编码（兼容中文）
  function base64EncodeUtf8(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + CHUNK)
      );
    }
    return btoa(binary);
  }

  function normalizeArray(data) {
    if (Array.isArray(data)) return data;
    if (data == null) return [];
    return [];
  }

  // GitHub：GET（raw）→ JSON 数组；404 视为空数组
  async function githubLoad(filePath) {
    const res = await fetch(apiUrl(filePath), {
      // no-store：避免浏览器缓存把 raw 响应当成 json 元数据（会导致 sha 丢失、写入 422）
      cache: "no-store",
      headers: authHeaders({ Accept: "application/vnd.github.raw+json" }),
    });
    if (res.status === 404) return [];
    if (!res.ok) throw apiError("GitHub 读取失败", res.status, await readErrDetail(res));
    const text = await res.text();
    if (!text.trim()) return [];
    return normalizeArray(JSON.parse(text));
  }

  // 读取 GitHub 错误响应里的 message 字段（排查 401/403 等必备）
  async function readErrDetail(res) {
    try {
      const j = await res.json();
      return (j.message || "").slice(0, 120);
    } catch (e) {
      return "";
    }
  }

  function apiError(prefix, status, detail) {
    const err = new Error(prefix + "：" + status + (detail ? "｜" + detail : ""));
    err.status = status;
    return err;
  }

  // GitHub：先 GET 拿 sha，再 PUT base64 内容；409 冲突时重新 GET 再试一次
  async function githubPut(records, filePath, retried) {
    const getRes = await fetch(apiUrl(filePath), { cache: "no-store", headers: authHeaders() });
    let sha;
    if (getRes.status === 404) {
      sha = undefined; // 文件尚不存在，直接创建
    } else if (getRes.ok) {
      sha = (await getRes.json()).sha;
    } else {
      throw apiError("GitHub 获取文件信息失败", getRes.status, await readErrDetail(getRes));
    }

    const body = {
      message: "更新记录数据",
      content: base64EncodeUtf8(JSON.stringify(records, null, 2)),
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(apiUrl(filePath), {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (putRes.ok) return records;
    if (putRes.status === 409 && !retried) {
      return githubPut(records, filePath, true);
    }
    throw apiError("GitHub 写入失败", putRes.status, await readErrDetail(putRes));
  }

  async function githubSave(records, filePath) {
    return githubPut(records, filePath, false);
  }

  function localLoad(filePath) {
    try {
      const raw = localStorage.getItem(localKey(filePath));
      if (!raw) return [];
      return normalizeArray(JSON.parse(raw));
    } catch (e) {
      console.error("读取本地记录失败", e);
      return [];
    }
  }

  function localSave(records, filePath) {
    localStorage.setItem(localKey(filePath), JSON.stringify(records));
    return records;
  }

  window.Storage = {
    FILE_PATH,
    LOCAL_KEY,
    isGitHubMode,
    load(filePath) {
      return isGitHubMode() ? githubLoad(filePath) : Promise.resolve(localLoad(filePath));
    },
    save(records, filePath) {
      return isGitHubMode()
        ? githubSave(records, filePath)
        : Promise.resolve(localSave(records, filePath));
    },
  };
})();
