/* ==========================================================================
   report.js — report.html page logic. Reads ?id=<auditId> from the URL,
   fetches that audit's real report from the backend (see assets/js/api.js
   Api.reports), and renders the banner, score grid, critical issues, AI
   recommendations, per-module score chips/findings, and the consent-banner
   screenshot from it. Also wires the share / print / download-PDF actions
   to the real backend endpoints.
   ========================================================================== */

(function () {
  var U = window.Utils;

  var PASS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>';
  var FAIL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var WARN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';

  // report.html section ids that findings/score-grid modules can actually
  // map to. Modules the backend computes but this page has no section for
  // (ux, images, links, mobile, forms) still show up in the score grid,
  // they just won't be clickable-to-scroll or get a detail section.
  var MODULE_CHECK_GRID_IDS = {
    seo: 'seoCheckGrid',
    performance: 'performanceCheckGrid',
    accessibility: 'accessibilityCheckGrid',
    security: 'securityCheckGrid'
  };
  var MODULE_SCORE_CHIP_IDS = {
    seo: 'seoScoreChip',
    performance: 'performanceScoreChip',
    accessibility: 'accessibilityScoreChip',
    security: 'securityScoreChip'
  };

  document.addEventListener('DOMContentLoaded', function () {
    var scoreGrid = document.getElementById('scoreGrid');
    if (!scoreGrid) return; // not on report.html

    var auditId = U.getQueryParam('id');
    var shareBtn = document.getElementById('shareReportBtn');
    var printBtn = document.getElementById('printReportBtn');
    var downloadBtn = document.getElementById('downloadPdfBtn');

    if (!auditId) {
      window.Notifications.error('No report selected', 'Open a report from your dashboard or history so we know which audit to show.');
      return;
    }

    var currentReport = null; // populated once the fetch below resolves

    /* ------------------------------ banner actions ------------------------------ */

    U.on(shareBtn, 'click', function () {
      window.Api.reports.share(auditId).then(function (shareUrl) {
        var fullUrl = window.APP_CONFIG.API_ORIGIN + shareUrl;
        return U.copyToClipboard(fullUrl);
      }).then(function () {
        window.Notifications.success('Link copied', 'Report link copied to your clipboard.');
      }).catch(function (err) {
        window.Notifications.error('Couldn\'t create share link', err.message || 'Please try again.');
      });
    });

    U.on(printBtn, 'click', function () {
      window.print();
    });

    U.on(downloadBtn, 'click', function () {
      window.Loader.setButtonLoading(downloadBtn, true, 'Preparing PDF…');
      window.Api.reports.exportPdfBlob(auditId).then(function (blob) {
        var host = currentReport ? U.hostnameOf(currentReport.url) : 'report';
        U.downloadBlob('audit-' + host + '-' + auditId + '.pdf', blob);
      }).catch(function (err) {
        window.Notifications.error('Download failed', err.message || 'Could not generate the PDF export.');
      }).finally(function () {
        window.Loader.setButtonLoading(downloadBtn, false);
      });
    });

    /* --------------------------- fetch + render --------------------------- */

    Promise.all([
      window.Api.reports.getFull(auditId).catch(function () {
        // The AI-enriched export can be slower / can fail if the AI layer
        // errors; fall back to the plain (score grid + findings) report
        // rather than showing nothing.
        return window.Api.reports.get(auditId);
      }),
      window.Api.audits.getConsent(auditId).catch(function () { return null; })
    ]).then(function (results) {
      currentReport = results[0];
      renderBanner(currentReport);
      renderScoreGrid(currentReport);
      renderCriticalIssues(currentReport);
      renderRecommendations(currentReport);
      renderModuleSections(currentReport);
      renderConsent(results[1]);
      document.title = 'Audit Report — ' + U.hostnameOf(currentReport.url) + ' — AuditPulse';
    }).catch(function (err) {
      window.Notifications.error('Couldn\'t load report', err.message || 'This report may not exist or may still be running.');
    });

    /* ------------------------------- renderers ------------------------------- */

    function renderBanner(report) {
      var host = U.hostnameOf(report.url);
      var favicon = document.getElementById('bannerFavicon');
      var urlEl = document.getElementById('bannerUrl');
      var metaEl = document.getElementById('bannerMeta');
      var ring = document.getElementById('bannerScoreRing');
      var circle = document.getElementById('bannerScoreCircle');
      var label = document.getElementById('bannerScoreLabel');

      if (favicon) favicon.textContent = U.faviconLetter(report.url);
      if (urlEl) urlEl.textContent = host;
      if (metaEl) metaEl.textContent = 'Completed ' + U.formatRelativeTime(new Date(report.generatedAt).getTime());
      if (label) label.innerHTML = report.overall + '<small>Score</small>';
      if (ring) U.setRingBand(ring, report.overall);
      if (circle) U.setRingProgress(circle, report.overall);
    }

    function renderScoreGrid(report) {
      if (!scoreGrid || !window.Components) return;
      scoreGrid.innerHTML = report.scoreGrid.map(function (cell) {
        var target = (cell.targetSection || '').replace(/^section-/, '');
        return window.Components.renderScoreCard({ score: cell.score, label: cell.label, target: target });
      }).join('');

      // Re-wire score-cell -> section scroll + radar chart now that the
      // grid has been rebuilt (report.js used to do this once on load
      // against static markup; now it has to happen after each render).
      var cells = U.qsa('.score-cell', scoreGrid);
      var labels = [];
      var values = [];
      cells.forEach(function (cell) {
        var labelEl = cell.querySelector('.score-cell__label');
        var valueEl = cell.querySelector('.vring__label');
        if (labelEl && valueEl) {
          labels.push(labelEl.textContent.trim());
          values.push(parseInt(valueEl.textContent, 10) || 0);
        }
        var target = cell.dataset.target;
        var section = target && document.getElementById(target);
        if (!section) return;
        function jump() { section.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        U.on(cell, 'click', jump);
        U.on(cell, 'keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
        });
      });

      var radarCanvas = document.getElementById('radarChart');
      if (radarCanvas && window.Charts && labels.length) {
        window.Charts.renderRadar('radarChart', labels, values, { datasetLabel: 'Score' });
      }
    }

    function renderCriticalIssues(report) {
      var list = document.getElementById('issueList');
      var badge = document.getElementById('criticalIssuesBadge');
      if (!list) return;

      var issues = report.findings.filter(function (f) {
        return f.severity === 'critical' || f.severity === 'warning';
      });

      if (badge) badge.textContent = issues.length + ' open';

      if (!issues.length) {
        list.innerHTML = '<div class="issue-row"><div class="issue-row__body"><div class="issue-row__title">No open issues</div><div class="issue-row__desc">Nice — nothing critical or warning-level was found.</div></div></div>';
        return;
      }

      list.innerHTML = issues.slice(0, 8).map(function (f) {
        var sevClass = f.severity === 'critical' ? 'badge--error' : 'badge--warning';
        var sevLabel = f.severity === 'critical' ? 'High' : 'Medium';
        return (
          '<div class="issue-row">' +
            '<span class="issue-row__icon">' + FAIL_ICON + '</span>' +
            '<div class="issue-row__body"><div class="issue-row__title">' + U.escapeHtml(f.title) + '</div><div class="issue-row__desc">' + U.escapeHtml(f.description || '') + '</div></div>' +
            '<span class="issue-row__sev badge ' + sevClass + '">' + sevLabel + '</span>' +
          '</div>'
        );
      }).join('');
    }

    function renderRecommendations(report) {
      var card = document.getElementById('aiRecoCard');
      var list = document.getElementById('recoList');
      if (!card || !list) return;
      if (!report.priorities || !report.priorities.length) {
        card.style.display = 'none';
        return;
      }
      card.style.display = '';
      list.innerHTML = report.priorities.slice(0, 6).map(function (p, i) {
        var impactClass = p.severity === 'critical' ? 'badge--success' : 'badge--warning';
        var impactLabel = p.severity === 'critical' ? 'High impact' : 'Medium impact';
        var num = String(i + 1).padStart(2, '0');
        return (
          '<div class="reco-item">' +
            '<span class="reco-item__num">' + num + '</span>' +
            '<div><div class="reco-item__title">' + U.escapeHtml(p.title) + '</div><div class="reco-item__desc">' + U.escapeHtml(p.description || '') + '</div></div>' +
            '<span class="reco-item__impact badge ' + impactClass + '">' + impactLabel + '</span>' +
          '</div>'
        );
      }).join('');
    }

    function renderCheckGrid(containerId, findingsForModule) {
      var el = document.getElementById(containerId);
      if (!el) return;
      if (!findingsForModule.length) {
        el.innerHTML = '<div class="check-item check-item--pass"><span class="check-item__icon">' + PASS_ICON + '</span><span class="check-item__label">No issues found</span></div>';
        return;
      }
      el.innerHTML = findingsForModule.map(function (f) {
        var cls = f.severity === 'critical' ? 'check-item--fail' : 'check-item--warn';
        var icon = f.severity === 'critical' ? FAIL_ICON : WARN_ICON;
        return '<div class="check-item ' + cls + '"><span class="check-item__icon">' + icon + '</span><span class="check-item__label">' + U.escapeHtml(f.title) + '</span></div>';
      }).join('');
    }

    function renderModuleSections(report) {
      var scoreByModule = {};
      report.scoreGrid.forEach(function (c) { scoreByModule[c.module] = c.score; });

      Object.keys(MODULE_SCORE_CHIP_IDS).forEach(function (module) {
        var chip = document.getElementById(MODULE_SCORE_CHIP_IDS[module]);
        if (chip && scoreByModule[module] != null) chip.textContent = scoreByModule[module] + ' / 100';
      });

      Object.keys(MODULE_CHECK_GRID_IDS).forEach(function (module) {
        var findingsForModule = report.findings.filter(function (f) { return f.module === module; });
        renderCheckGrid(MODULE_CHECK_GRID_IDS[module], findingsForModule);
      });
    }

    function renderConsent(consent) {
      var chip = document.getElementById('consentScoreChip');
      var checkGrid = document.getElementById('consentCheckGrid');
      var shotWrap = document.getElementById('consentScreenshotWrap');

      if (!consent) {
        if (chip) chip.textContent = 'Not scanned';
        if (checkGrid) checkGrid.innerHTML = '<p class="text-sm" style="color: var(--text-tertiary);">This audit didn\'t include the consent module.</p>';
        if (shotWrap) shotWrap.innerHTML = '';
        return;
      }

      if (chip) chip.textContent = consent.consentScore + ' / 100';

      if (checkGrid) {
        var items = [
          { label: 'Cookie banner detected', ok: consent.hasCookieBanner },
          { label: 'Blocks trackers before consent', ok: consent.bannerBlocksScriptsPreConsent },
          { label: 'GDPR-compliant', ok: consent.gdprCompliant },
          { label: 'CCPA-compliant', ok: consent.ccpaCompliant }
        ];
        checkGrid.innerHTML = items.map(function (item) {
          return '<div class="check-item ' + (item.ok ? 'check-item--pass' : 'check-item--fail') + '"><span class="check-item__icon">' + (item.ok ? PASS_ICON : FAIL_ICON) + '</span><span class="check-item__label">' + U.escapeHtml(item.label) + '</span></div>';
        }).join('');
      }

      if (shotWrap) {
        if (consent.bannerScreenshotUrl) {
          shotWrap.innerHTML =
            '<div class="screenshot-strip" style="grid-template-columns: 1fr;">' +
              '<div class="screenshot-strip__item" style="background:none; align-items:stretch; padding:0;">' +
                '<img src="' + U.escapeHtml(consent.bannerScreenshotUrl) + '" alt="Consent banner screenshot" style="width:100%; height:100%; object-fit:contain; border-radius: var(--radius-md);">' +
              '</div>' +
            '</div>';
        } else {
          shotWrap.innerHTML =
            '<div class="screenshot-strip" style="grid-template-columns: 1fr;">' +
              '<div class="screenshot-strip__item"><span>No screenshot captured</span></div>' +
            '</div>';
        }
      }
    }
  });
})();
