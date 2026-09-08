// 全站共用工具：toast、日期工具、导航、本地模式提示条等
(function () {
  "use strict";

  const Common = {
    WEEKDAYS: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],

    // 本地时区 YYYY-MM-DD
    todayStr() {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    },

    weekdayOf(dateStr) {
      const d = new Date(dateStr + "T00:00:00");
      if (isNaN(d.getTime())) return "";
      return Common.WEEKDAYS[d.getDay()];
    },

    // HTML 转义，防注入
    escapeHtml(str) {
      if (str == null) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },

    toast(message, type) {
      let container = document.querySelector(".toast-container");
      if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
      }
      const el = document.createElement("div");
      el.className = "toast" + (type === "error" ? " toast-error" : "");
      el.textContent = message;
      container.appendChild(el);
      setTimeout(() => {
        el.remove();
      }, 2600);
    },

    // 移动端导航折叠
    initNav() {
      const toggle = document.querySelector(".nav-toggle");
      const links = document.querySelector(".nav-links");
      if (!toggle || !links) return;
      toggle.addEventListener("click", () => {
        const open = links.classList.toggle("open");
        toggle.setAttribute("aria-expanded", String(open));
      });
    },

    // 判断当前是否有 token（SITE_CONFIG 或 localStorage）
    getToken() {
      const cfg = window.SITE_CONFIG || {};
      if (cfg.token) return cfg.token;
      try {
        return localStorage.getItem("taoguan_github_token") || "";
      } catch (e) {
        return "";
      }
    },

    // 本地模式黄色提示条（含令牌设置入口，已有 token 时不显示）
    initLocalModeBanner() {
      if (Common.getToken()) return;
      const banner = document.createElement("div");
      banner.className = "local-banner";
      banner.setAttribute("role", "status");

      const main = document.createElement("div");
      main.className = "local-banner-main";

      const text = document.createElement("span");
      text.className = "local-banner-text";
      text.textContent = "当前为本地模式，数据只保存在此浏览器。粘贴 GitHub 令牌即可同步到仓库（每台设备只需一次）：";

      const form = document.createElement("form");
      form.className = "token-form";
      const input = document.createElement("input");
      input.type = "password";
      input.placeholder = "粘贴 GitHub 令牌";
      input.setAttribute("aria-label", "GitHub 令牌");
      input.autocomplete = "off";
      const saveBtn = document.createElement("button");
      saveBtn.type = "submit";
      saveBtn.className = "btn btn-small token-save-btn";
      saveBtn.textContent = "保存";
      form.appendChild(input);
      form.appendChild(saveBtn);

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const token = input.value.trim();
        if (!token) {
          Common.toast("请先粘贴令牌", "error");
          return;
        }
        try {
          localStorage.setItem("taoguan_github_token", token);
        } catch (err) {
          Common.toast("保存令牌失败", "error");
          return;
        }
        location.reload();
      });

      main.appendChild(text);
      main.appendChild(form);

      const help = document.createElement("details");
      help.className = "token-help";
      const summary = document.createElement("summary");
      summary.textContent = "如何获取令牌？";
      const helpBody = document.createElement("div");
      helpBody.innerHTML =
        "<ol>" +
        "<li>打开 GitHub：<code>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</code></li>" +
        "<li>Repository access 只勾选 <code>TaoGuan-Daily-log</code> 一个仓库</li>" +
        "<li>Permissions → Repository permissions → <code>Contents</code> 选 <code>Read and write</code></li>" +
        "<li>生成后复制以 <code>github_pat_</code> 开头的令牌，粘贴到上面输入框保存</li>" +
        "</ol>";
      help.appendChild(summary);
      help.appendChild(helpBody);

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "local-banner-close";
      closeBtn.setAttribute("aria-label", "关闭提示");
      closeBtn.textContent = "✕";
      closeBtn.addEventListener("click", () => banner.remove());

      banner.appendChild(main);
      banner.appendChild(help);
      banner.appendChild(closeBtn);
      document.body.insertBefore(banner, document.body.firstChild);
    },

    // 已有 token 时：页脚提供「清除令牌」小入口
    initTokenClear() {
      if (!Common.getToken()) return;
      const footer = document.querySelector(".site-footer p");
      if (!footer) return;
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "token-clear-link";
      clear.textContent = "清除令牌";
      clear.title = "清除后回到本地模式";
      clear.addEventListener("click", () => {
        try {
          localStorage.removeItem("taoguan_github_token");
        } catch (e) {
          /* 忽略 */
        }
        location.reload();
      });
      footer.appendChild(document.createTextNode(" · "));
      footer.appendChild(clear);
    },

    init() {
      Common.initNav();
      Common.initLocalModeBanner();
      Common.initTokenClear();
      document.querySelectorAll(".current-year").forEach((el) => {
        el.textContent = String(new Date().getFullYear());
      });
    },
  };

  window.Common = Common;
  document.addEventListener("DOMContentLoaded", Common.init);
})();
