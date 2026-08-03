/* ==========================================================================
   dashboard.js — dashboard.html page logic
   ========================================================================== */

(function () {
  var U = window.Utils;

  document.addEventListener('DOMContentLoaded', function () {
    var statTotal = document.getElementById('statTotalAudits');
    if (!statTotal || !window.Api) return; // not on dashboard.html

    var statSeo = document.getElementById('statSeoIssues');
    var statPerf = document.getElementById('statPerformance');
    var statCritical = document.getElementById('statCriticalIssues');

    var greetingEl = document.getElementById('dashboardGreeting');
    if (greetingEl) {
      var hour = new Date().getHours();
      var timeGreeting = hour < 12 ? 'Good morning' : (hour < 18 ? 'Good afternoon' : 'Good evening');
      var user = window.Api ? window.Api.auth.getUser() : null;
      var firstName = user && user.name ? user.name.split(' ')[0] : null;
      greetingEl.textContent = firstName ? (timeGreeting + ', ' + firstName) : timeGreeting;
    }

    var healthRingCircle = document.getElementById('healthRingCircle');
    var healthRing = document.getElementById('healthRing');
    var healthScoreValue = document.getElementById('healthScoreValue');
    var recentList = document.getElementById('recentAuditsList');

    [statTotal, statSeo, statPerf, statCritical].forEach(function (el) { window.Loader.setSkeleton(el, true); });
    window.Loader.setSkeleton(healthScoreValue, true);

    Promise.all([window.Api.audits.getStats(), window.Api.audits.getRecent()])
      .then(function (results) {
        var stats = results[0];
        var recent = results[1];

        window.Loader.setSkeleton(statTotal, false);
        window.Loader.setSkeleton(statSeo, false);
        window.Loader.setSkeleton(statPerf, false);
        window.Loader.setSkeleton(statCritical, false);
        window.Loader.setSkeleton(healthScoreValue, false);

        U.animateCountUp(statTotal, stats.totalAudits, 700);
        U.animateCountUp(statSeo, stats.seoIssues, 700);
        U.animateCountUp(statPerf, stats.performanceScore, 700, '%');
        U.animateCountUp(statCritical, stats.criticalIssues, 700);

        U.animateCountUp(healthScoreValue, stats.overall, 900);
        U.setRingProgress(healthRingCircle, stats.overall);
        U.setRingBand(healthRing, stats.overall);

        setBar('barSeo', 'valSeo', stats.breakdown.seo);
        setBar('barPerformance', 'valPerformance', stats.breakdown.performance);
        setBar('barAccessibility', 'valAccessibility', stats.breakdown.accessibility);
        setBar('barSecurity', 'valSecurity', stats.breakdown.security);

        renderRecentAudits(recent);
      })
      .catch(function () {
        window.Notifications.error('Couldn\'t load dashboard', 'Please refresh the page to try again.');
      });

    function setBar(fillId, valId, value) {
      var fill = document.getElementById(fillId);
      var val = document.getElementById(valId);
      if (fill) fill.style.width = value + '%';
      if (val) U.animateCountUp(val, value, 700);
    }

    function renderRecentAudits(list) {
      if (!recentList || !list || !list.length) return;
      recentList.innerHTML = list.slice(0, 4).map(function (audit) {
        var band = U.scoreBand(audit.score);
        var chipClass = band === 'good' ? 'score-chip--good' : (band === 'mid' ? 'score-chip--mid' : 'score-chip--bad');
        return '' +
          '<a class="row-item" href="report.html?id=' + encodeURIComponent(audit.id) + '" style="text-decoration:none; color:inherit;">' +
            '<div class="row-item__favicon">' + U.escapeHtml(U.faviconLetter(audit.url)) + '</div>' +
            '<div class="row-item__body">' +
              '<div class="row-item__title">' + U.escapeHtml(audit.url) + '</div>' +
              '<div class="row-item__meta">' + U.formatRelativeTime(audit.completedAt) + ' · ' + U.escapeHtml(audit.label) + '</div>' +
            '</div>' +
            '<span class="score-chip ' + chipClass + '">' + audit.score + '</span>' +
          '</a>';
      }).join('');

      // Point the "Download PDF" quick-action card at the most recent
      // audit's report so it's a real link rather than the static
      // report.html placeholder.
      var pdfQuickAction = document.getElementById('downloadPdfQuickAction');
      if (pdfQuickAction && list[0]) {
        pdfQuickAction.href = 'report.html?id=' + encodeURIComponent(list[0].id);
      }
    }
  });
})();
