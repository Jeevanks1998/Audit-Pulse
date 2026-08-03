/* ==========================================================================
   report.js — report.html page logic: renders the radar chart from the
   score grid already in the markup, wires score-cell → section scrolling,
   and the share / print / download report actions.
   ========================================================================== */

(function () {
  var U = window.Utils;

  document.addEventListener('DOMContentLoaded', function () {
    var scoreGrid = document.getElementById('scoreGrid');
    if (!scoreGrid) return; // not on report.html

    var radarCanvas = document.getElementById('radarChart');
    var shareBtn = document.getElementById('shareReportBtn');
    var printBtn = document.getElementById('printReportBtn');
    var downloadBtn = document.getElementById('downloadPdfBtn');

    /* --------------------- build radar chart from DOM --------------------- */

    var cells = U.qsa('.score-cell', scoreGrid);
    var labels = [];
    var values = [];

    cells.forEach(function (cell) {
      var labelEl = cell.querySelector('.score-cell__label');
      var valueEl = cell.querySelector('.vring__label');
      if (!labelEl || !valueEl) return;
      labels.push(labelEl.textContent.trim());
      values.push(parseInt(valueEl.textContent, 10) || 0);
    });

    if (radarCanvas && window.Charts && labels.length) {
      window.Charts.renderRadar('radarChart', labels, values, { datasetLabel: 'Score' });
    }

    /* ------------------- score-cell click → scroll to section ------------------- */

    cells.forEach(function (cell) {
      var target = cell.dataset.target;
      if (!target) return;
      var section = document.getElementById(target);
      if (!section) return;

      function jump() {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }

      U.on(cell, 'click', jump);
      U.on(cell, 'keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          jump();
        }
      });
    });

    /* ------------------------------ banner actions ------------------------------ */

    U.on(shareBtn, 'click', function () {
      U.copyToClipboard(window.location.href).then(function () {
        window.Notifications.success('Link copied', 'Report link copied to your clipboard.');
      }).catch(function () {
        window.Notifications.error('Copy failed', 'Could not copy the link to your clipboard.');
      });
    });

    U.on(printBtn, 'click', function () {
      window.print();
    });

    U.on(downloadBtn, 'click', function () {
      window.Notifications.info('Not available in demo', 'PDF export isn\'t wired up in this front-end-only build.');
    });
  });
})();
