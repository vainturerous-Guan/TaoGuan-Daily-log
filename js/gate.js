// 频道页访问口令门禁：未验证时先展示空白口令页；验证通过后本浏览器 7 天内免验证
(function () {
  "use strict";

  var PASSWORD = "Zxs0806s";
  var STORAGE_KEY = "stayreal_gate_until";
  var REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;

  function storedUntil() {
    try {
      return Number(localStorage.getItem(STORAGE_KEY)) || 0;
    } catch (e) {
      return 0;
    }
  }

  if (storedUntil() > Date.now()) return; // 本浏览器仍在免验证期内

  // 同步注入样式并隐藏正文，避免内容闪现
  var style = document.createElement("style");
  style.id = "gate-style";
  style.textContent =
    "html.gate-locked body { visibility: hidden; overflow: hidden; }" +
    ".gate-overlay { visibility: visible; position: fixed; inset: 0; z-index: 2147483647;" +
    "  display: flex; align-items: center; justify-content: center; padding: 1rem; background: #faf6ef;" +
    "  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; }" +
    ".gate-card { background: #fffdf8; border: 1px solid #ece4d8; border-radius: 14px;" +
    "  box-shadow: 0 2px 10px rgba(96,74,54,.08); padding: 2rem 1.6rem 1.6rem; width: 100%; max-width: 340px; text-align: center; }" +
    ".gate-icon { font-size: 1.7rem; }" +
    ".gate-title { margin: .5rem 0 0; font-size: 1.05rem; font-weight: 600; color: #3c3730; }" +
    ".gate-input { width: 100%; margin: 1rem 0 .7rem; padding: .6rem .7rem; border: 1px solid #ece4d8;" +
    "  border-radius: 10px; background: #fff; color: #3c3730; font-size: 1rem; font-family: inherit; box-sizing: border-box; }" +
    ".gate-input:focus { outline: 2px solid #c96f4a; outline-offset: 1px; border-color: #c96f4a; }" +
    ".gate-btn { width: 100%; border: none; border-radius: 10px; padding: .6rem; background: #c96f4a;" +
    "  color: #fff; font-size: 1rem; font-weight: 600; font-family: inherit; cursor: pointer; }" +
    ".gate-btn:hover { background: #a95636; }" +
    ".gate-error { margin: .6rem 0 0; min-height: 1.2em; font-size: .88rem; font-weight: 600; color: #b23a2a; }" +
    ".gate-hint { margin: .9rem 0 0; font-size: .8rem; color: #7a7268; }" +
    ".gate-card.gate-shake { animation: gate-shake .3s ease; }" +
    "@keyframes gate-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }";
  document.documentElement.classList.add("gate-locked");
  document.head.appendChild(style);

  function unlock() {
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now() + REMEMBER_MS));
    } catch (e) {
      /* 无痕模式等场景下写不进去则本次会话有效 */
    }
    var overlay = document.querySelector(".gate-overlay");
    if (overlay) overlay.remove();
    document.documentElement.classList.remove("gate-locked");
    style.remove();
    // stocks.html 内嵌的监控 iframe 可能已先一步显示门禁，解锁后重载它
    document.querySelectorAll("iframe").forEach(function (frame) {
      try {
        frame.contentWindow.location.reload();
      } catch (e) {
        /* 跨域等情况忽略 */
      }
    });
  }

  function showGate() {
    if (storedUntil() > Date.now()) {
      unlock();
      return;
    }
    var overlay = document.createElement("div");
    overlay.className = "gate-overlay";

    var form = document.createElement("form");
    form.className = "gate-card";
    form.noValidate = true;

    var icon = document.createElement("div");
    icon.className = "gate-icon";
    icon.textContent = "🔒";

    var title = document.createElement("p");
    title.className = "gate-title";
    title.textContent = "此频道需要访问口令";

    var input = document.createElement("input");
    input.className = "gate-input";
    input.type = "password";
    input.placeholder = "请输入访问口令";
    input.setAttribute("aria-label", "访问口令");
    input.autocomplete = "off";

    var btn = document.createElement("button");
    btn.className = "gate-btn";
    btn.type = "submit";
    btn.textContent = "进入";

    var error = document.createElement("p");
    error.className = "gate-error";
    error.setAttribute("role", "alert");

    var hint = document.createElement("p");
    hint.className = "gate-hint";
    hint.textContent = "验证通过后，本浏览器 7 天内进入各频道免验证";

    form.appendChild(icon);
    form.appendChild(title);
    form.appendChild(input);
    form.appendChild(btn);
    form.appendChild(error);
    form.appendChild(hint);
    overlay.appendChild(form);
    document.body.appendChild(overlay);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (input.value === PASSWORD) {
        unlock();
      } else {
        error.textContent = "口令不正确，请重试";
        form.classList.remove("gate-shake");
        void form.offsetWidth;
        form.classList.add("gate-shake");
        input.select();
        input.focus();
      }
    });

    input.focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showGate);
  } else {
    showGate();
  }
})();
