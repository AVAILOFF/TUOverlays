/*
  Временный гейт доступа для пре-релизного превью сайта.
  Это НЕ настоящая защита — пароль виден в исходнике этого файла всем,
  кто откроет devtools. Задача — не пускать случайных посетителей
  до релиза, а не защитить от целенаправленного обхода.

  Чтобы сменить пароль — поменяй значение PASSWORD ниже.
  Чтобы снять ограничение перед релизом — удали <script src=".../scripts/site-lock.js">
  из <head> каждой страницы (или удали этот файл).
*/
(function () {
  "use strict";

  var PASSWORD = "TU-Preview-914";
  var STORAGE_KEY = "tuoverlays_unlocked";

  if (sessionStorage.getItem(STORAGE_KEY) === "1") {
    return;
  }

  document.documentElement.style.visibility = "hidden";

  function init() {
    var style = document.createElement("style");
    style.textContent =
      "#site-lock-overlay{visibility:visible;position:fixed;inset:0;z-index:2147483647;" +
      "display:flex;align-items:center;justify-content:center;padding:24px;" +
      "background:#02102c;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}" +
      "#site-lock-overlay .box{width:100%;max-width:340px;padding:32px 28px;border-radius:16px;" +
      "background:rgba(8,30,68,.58);border:1px solid rgba(124,162,224,.24);" +
      "box-shadow:0 20px 60px rgba(0,0,0,.4);text-align:center}" +
      "#site-lock-overlay .title{font-size:20px;font-weight:700;color:#e4ecfb;margin:0 0 4px}" +
      "#site-lock-overlay .sub{font-size:13px;color:#9fb2d4;margin:0 0 20px}" +
      "#site-lock-overlay input{width:100%;box-sizing:border-box;padding:11px 14px;font-size:15px;" +
      "border-radius:10px;border:1px solid rgba(124,162,224,.24);background:#051a3f;color:#e4ecfb;" +
      "outline:none;margin-bottom:12px}" +
      "#site-lock-overlay input:focus{border-color:#ff0066}" +
      "#site-lock-overlay button{width:100%;padding:11px 14px;font-size:15px;font-weight:600;" +
      "border-radius:10px;border:none;background:#ff0066;color:#fff;cursor:pointer}" +
      "#site-lock-overlay button:hover{opacity:.9}" +
      "#site-lock-overlay .err{display:none;color:#ff5577;font-size:13px;margin-top:12px}";
    document.head.appendChild(style);

    var overlay = document.createElement("div");
    overlay.id = "site-lock-overlay";
    overlay.innerHTML =
      '<div class="box">' +
      '<p class="title">TU Overlays</p>' +
      '<p class="sub">Сайт в режиме предпросмотра. Введите пароль.</p>' +
      '<form id="site-lock-form" autocomplete="off">' +
      '<input type="password" id="site-lock-input" placeholder="Пароль" autofocus>' +
      "<button type=\"submit\">Войти</button>" +
      '<p class="err" id="site-lock-err">Неверный пароль</p>' +
      "</form>" +
      "</div>";
    document.body.appendChild(overlay);

    document.getElementById("site-lock-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = document.getElementById("site-lock-input");
      if (input.value === PASSWORD) {
        sessionStorage.setItem(STORAGE_KEY, "1");
        overlay.remove();
        document.documentElement.style.visibility = "";
      } else {
        document.getElementById("site-lock-err").style.display = "block";
        input.value = "";
        input.focus();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
