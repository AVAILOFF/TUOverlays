/*
  Google Analytics 4 — загрузчик, общий для всех страниц сайта.
  ID меняется здесь один раз, а не в <head> каждой страницы.
  Дашборд: https://analytics.google.com (property tuoverlays.xyz)
*/
(function () {
  var MEASUREMENT_ID = 'G-J12FEG5LZ1';

  var tag = document.createElement('script');
  tag.async = true;
  tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(tag);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };

  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID);

  /*
    События по кликам. Слушатель делегированный и висит на документе,
    поэтому разметку кнопок трогать не нужно — новые ссылки на Discord
    и новые кнопки скачивания попадут в статистику автоматически.
  */
  document.addEventListener('click', function (e) {
    var link = e.target && e.target.closest && e.target.closest('a');
    if (!link) return;

    // Кнопки скачивания. Переиспользуем разметку GoatCounter
    // (data-goatcounter-click="download-exe" / "download-zip"),
    // чтобы оба счётчика считали одни и те же клики.
    var gc = link.getAttribute('data-goatcounter-click');
    if (gc) {
      gtag('event', 'download_click', {
        variant: gc.replace(/^download-/, ''),
        link_url: link.href
      });
      return;
    }

    if (link.hostname === 'discord.gg') {
      gtag('event', 'discord_click', {
        location: link.classList.contains('discord-fab') ? 'fab'
          : link.closest('footer, .ftr-links') ? 'footer'
            : 'inline'
      });
    }
  }, true);
})();
