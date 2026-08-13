/*
  Рендерит список поддержавших на странице поддержки.
  Сами данные лежат в scripts/supporters.json — самый новый вход должен
  быть первым элементом массива.

  Добавлять людей проще всего через панель /admin.html (см. инструкцию
  на этой странице). Вручную редактировать supporters.json тоже можно —
  это обычный JSON-массив объектов { "name": "...", "tier": "...", "link": "..." },
  поля tier и link необязательные.
*/
(function () {
  "use strict";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.renderSupporters = function (containerSelector, opts) {
    opts = opts || {};
    var root = document.querySelector(containerSelector);
    if (!root) return;

    fetch(opts.dataUrl || "scripts/supporters.json", { cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : []; })
      .catch(function () { return []; })
      .then(function (data) {
        var list = (Array.isArray(data) ? data : [])
          .map(function (e) { return typeof e === "string" ? { name: e } : e; })
          .filter(function (e) { return e && e.name; });

        if (!list.length) {
          root.innerHTML = '<p class="sup-empty">' + escapeHtml(opts.emptyText || "") + "</p>";
          return;
        }

        root.innerHTML = list
          .map(function (e) {
            var inner = escapeHtml(e.name) +
              (e.tier ? '<span class="sup-tag">' + escapeHtml(e.tier) + "</span>" : "");
            if (e.link) {
              return '<a class="sup-chip" href="' + escapeHtml(e.link) +
                '" target="_blank" rel="noopener">' + inner + "</a>";
            }
            return '<span class="sup-chip">' + inner + "</span>";
          })
          .join("");
      });
  };
})();
