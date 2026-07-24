(function () {
  "use strict";

  if (window.KagenChat && window.KagenChat.__initialized) return;

  var script = document.currentScript;
  if (!script) {
    var scripts = document.querySelectorAll(
      'script[src*="kagen-chat-widget.js"]',
    );
    script = scripts[scripts.length - 1];
  }
  if (!script) return;

  var scriptUrl;
  try {
    scriptUrl = new URL(script.src, document.baseURI);
  } catch {
    return;
  }
  var widgetOrigin = scriptUrl.origin;
  var data = script.dataset || {};
  var clamp = function (value, fallback, min, max) {
    var parsed = Number.parseInt(value || "", 10);
    return Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, parsed))
      : fallback;
  };
  var safeText = function (value, fallback, max) {
    var text = typeof value === "string" ? value.trim() : "";
    return text ? text.slice(0, max) : fallback;
  };
  var isHex = function (value) {
    return /^#[0-9a-f]{6}$/i.test(value || "");
  };
  var safeUrl = function (value, fallback) {
    if (!value) return fallback;
    try {
      var url = new URL(value, widgetOrigin);
      if (
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
      )
        return url.href;
    } catch {}
    return fallback;
  };
  var bool = function (value, fallback) {
    if (value == null) return fallback;
    return String(value).toLowerCase() === "true";
  };
  var foreground = function (hex) {
    var r = Number.parseInt(hex.slice(1, 3), 16);
    var g = Number.parseInt(hex.slice(3, 5), 16);
    var b = Number.parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62
      ? "#111827"
      : "#ffffff";
  };
  var allowedDomain = safeText(data.allowedDomain, "", 253).toLowerCase();
  if (
    allowedDomain &&
    location.hostname.toLowerCase() !== allowedDomain &&
    !location.hostname.toLowerCase().endsWith("." + allowedDomain)
  ) {
    window.dispatchEvent(
      new CustomEvent("kagen-chat:error", {
        detail: { code: "DOMAIN_NOT_ALLOWED" },
      }),
    );
    return;
  }

  var config = {
    apiUrl: safeUrl(data.apiUrl, widgetOrigin + "/api/chat"),
    title: safeText(data.title, "Ask Kagen AI", 60),
    welcomeMessage: safeText(
      data.welcomeMessage,
      "Hi! How can I help you explore Kagen?",
      300,
    ),
    primaryColor: isHex(data.primaryColor) ? data.primaryColor : "#0063ce",
    position: data.position === "bottom-left" ? "bottom-left" : "bottom-right",
    buttonLabel: safeText(data.buttonLabel, "Chat with Kagen", 40),
    logoUrl: safeUrl(data.logoUrl, ""),
    openByDefault: bool(data.openByDefault, false),
    zIndex: clamp(data.zIndex, 2147483000, 1000, 2147483646),
    width: clamp(data.width, 400, 320, 520),
    height: clamp(data.height, 650, 450, 850),
    mobileFullscreen: bool(data.mobileFullscreen, true),
  };

  var root, launcher, panel, frame, closeHitArea, unread, style;
  var open = false;
  var ready = false;
  var previousOverflow = "";
  var mobileQuery = window.matchMedia("(max-width: 640px)");
  var iconChat =
    '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>';
  var iconClose =
    '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var dispatch = function (name, detail) {
    window.dispatchEvent(
      new CustomEvent("kagen-chat:" + name, { detail: detail || {} }),
    );
  };
  var setPageLock = function (locked) {
    if (!(config.mobileFullscreen && mobileQuery.matches)) return;
    if (locked) {
      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = previousOverflow;
    }
  };
  var buildFrame = function () {
    if (frame) return;
    frame = document.createElement("iframe");
    frame.className = "kagen-chat-frame";
    frame.title = config.title;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups",
    );
    var params = new URLSearchParams({
      title: config.title,
      welcomeMessage: config.welcomeMessage,
      primaryColor: config.primaryColor,
      position: config.position,
      buttonLabel: config.buttonLabel,
      apiUrl: config.apiUrl,
      parentOrigin: window.location.origin,
    });
    if (config.logoUrl) params.set("logoUrl", config.logoUrl);
    frame.src = widgetOrigin + "/embed?" + params.toString();
    panel.appendChild(frame);
  };
  var renderState = function () {
    if (!launcher || !panel) return;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute(
      "aria-label",
      open ? "Close " + config.title : config.buttonLabel,
    );
    launcher.innerHTML =
      (open ? iconClose : iconChat) +
      (open ? "" : '<span class="kagen-chat-label"></span>');
    var label = launcher.querySelector(".kagen-chat-label");
    if (label) label.textContent = config.buttonLabel;
    panel.hidden = !open;
    root.classList.toggle("kagen-chat-open", open);
  };
  var openWidget = function () {
    if (open) return;
    buildFrame();
    open = true;
    unread.textContent = "";
    unread.hidden = true;
    renderState();
    setPageLock(true);
    dispatch("open");
    if (ready && frame.contentWindow)
      frame.contentWindow.postMessage(
        { namespace: "kagen-chat", type: "KAGEN_CHAT_OPEN" },
        widgetOrigin,
      );
  };
  var closeWidget = function () {
    if (!open) return;
    open = false;
    renderState();
    setPageLock(false);
    dispatch("close");
    if (ready && frame && frame.contentWindow)
      frame.contentWindow.postMessage(
        { namespace: "kagen-chat", type: "KAGEN_CHAT_CLOSE" },
        widgetOrigin,
      );
  };
  var toggleWidget = function () {
    if (open) closeWidget();
    else openWidget();
  };
  var onMessage = function (event) {
    if (
      !frame ||
      event.origin !== widgetOrigin ||
      event.source !== frame.contentWindow
    )
      return;
    var message = event.data;
    if (
      !message ||
      message.namespace !== "kagen-chat" ||
      typeof message.type !== "string"
    )
      return;
    if (
      [
        "KAGEN_CHAT_READY",
        "KAGEN_CHAT_CLOSE",
        "KAGEN_CHAT_RESIZE",
        "KAGEN_CHAT_UNREAD",
        "KAGEN_CHAT_ERROR",
      ].indexOf(message.type) < 0
    )
      return;
    if (message.type === "KAGEN_CHAT_READY") {
      ready = true;
      dispatch("ready");
    } else if (message.type === "KAGEN_CHAT_CLOSE") {
      closeWidget();
    } else if (
      message.type === "KAGEN_CHAT_RESIZE" &&
      message.payload &&
      Number.isInteger(message.payload.height) &&
      message.payload.height >= 450 &&
      message.payload.height <= 850
    ) {
      panel.style.height = message.payload.height + "px";
    } else if (
      message.type === "KAGEN_CHAT_UNREAD" &&
      message.payload &&
      Number.isInteger(message.payload.count) &&
      message.payload.count >= 0 &&
      message.payload.count <= 99
    ) {
      unread.textContent = String(message.payload.count);
      unread.hidden = open || message.payload.count === 0;
    } else if (message.type === "KAGEN_CHAT_ERROR") {
      dispatch("error", { code: "IFRAME_ERROR" });
    }
  };
  var destroy = function () {
    setPageLock(false);
    window.removeEventListener("message", onMessage);
    if (root) root.remove();
    if (style) style.remove();
    delete window.KagenChat;
  };
  var init = function () {
    if (document.getElementById("kagen-chat-widget-root")) return;
    style = document.createElement("style");
    style.id = "kagen-chat-widget-styles";
    style.textContent =
      "#kagen-chat-widget-root{--kc-primary:" +
      config.primaryColor +
      ";position:fixed;bottom:max(20px,env(safe-area-inset-bottom));" +
      (config.position === "bottom-left" ? "left:20px" : "right:20px") +
      ";z-index:" +
      config.zIndex +
      ';font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
      "#kagen-chat-widget-root *{box-sizing:border-box}.kagen-chat-launcher{margin-left:auto;display:flex;align-items:center;gap:9px;min-width:56px;height:56px;padding:0 18px;border:0;border-radius:999px;background:var(--kc-primary);color:#fff;box-shadow:0 12px 34px rgba(15,23,42,.28);font:700 14px inherit;cursor:pointer;transition:transform .18s,box-shadow .18s}.kagen-chat-launcher:hover{transform:translateY(-2px);box-shadow:0 16px 40px rgba(15,23,42,.35)}.kagen-chat-launcher:focus-visible{outline:3px solid #a5b4fc;outline-offset:3px}.kagen-chat-launcher svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.kagen-chat-panel{position:absolute;bottom:70px;" +
      (config.position === "bottom-left" ? "left:0" : "right:0") +
      ";width:" +
      config.width +
      "px;height:" +
      config.height +
      "px;max-width:calc(100vw - 24px);max-height:calc(100vh - 104px);overflow:hidden;border-radius:18px;background:#fff;box-shadow:0 24px 80px rgba(2,6,23,.3);transform-origin:bottom " +
      (config.position === "bottom-left" ? "left" : "right") +
      ";animation:kagen-chat-in .2s ease-out}.kagen-chat-panel[hidden]{display:none}.kagen-chat-frame{display:block;width:100%;height:100%;border:0}.kagen-chat-close-hit-area{position:absolute;z-index:2;top:0;right:0;width:52px;height:58px;padding:0;border:0;background:transparent;cursor:pointer}.kagen-chat-close-hit-area:focus-visible{outline:3px solid #fff;outline-offset:-6px;border-radius:10px}.kagen-chat-unread{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 5px;border:2px solid #fff;border-radius:999px;background:#ef4444;color:#fff;font:700 11px/16px sans-serif;text-align:center}.kagen-chat-unread[hidden]{display:none}@keyframes kagen-chat-in{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}" +
      "@media(max-width:640px){.kagen-chat-label{display:none}.kagen-chat-launcher{width:56px;padding:0;justify-content:center}" +
      (config.mobileFullscreen
        ? ".kagen-chat-panel{position:fixed;inset:0;width:100vw;height:100dvh;max-width:none;max-height:none;border-radius:0}"
        : "") +
      "}@media(prefers-reduced-motion:reduce){.kagen-chat-panel,.kagen-chat-launcher{animation:none;transition:none}}";
    document.head.appendChild(style);
    root = document.createElement("div");
    root.id = "kagen-chat-widget-root";
    panel = document.createElement("div");
    panel.className = "kagen-chat-panel";
    panel.hidden = true;
    closeHitArea = document.createElement("button");
    closeHitArea.type = "button";
    closeHitArea.className = "kagen-chat-close-hit-area";
    closeHitArea.setAttribute("aria-label", "Close chat");
    closeHitArea.title = "Close chat";
    closeHitArea.addEventListener("click", closeWidget);
    panel.appendChild(closeHitArea);
    launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "kagen-chat-launcher";
    launcher.style.color = foreground(config.primaryColor);
    unread = document.createElement("span");
    unread.className = "kagen-chat-unread";
    unread.hidden = true;
    launcher.addEventListener("click", toggleWidget);
    root.appendChild(panel);
    root.appendChild(launcher);
    root.appendChild(unread);
    document.body.appendChild(root);
    window.addEventListener("message", onMessage);
    renderState();
    if (config.openByDefault) openWidget();
  };

  window.KagenChat = {
    __initialized: true,
    open: openWidget,
    close: closeWidget,
    toggle: toggleWidget,
    destroy: destroy,
    isOpen: function () {
      return open;
    },
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
