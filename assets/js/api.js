/* ==========================================================================
   api.js — talks to the real AuditPulse FastAPI backend (see /backend).
   Same public shape as the old mock ({ auth, audits, settings }) so every
   page (auth.js, audit.js, dashboard.js, history.js, app.js) works
   unmodified — only the implementation underneath changed.
   Exposed as window.Api.
   ========================================================================== */

window.Api = (function () {
  var U = window.Utils;
  var CFG = window.APP_CONFIG;
  var BASE = CFG.API_BASE_URL;

  /* ------------------------------ session ------------------------------ */
  // Kept in localStorage (not just memory) so getSession()/getUser() can
  // stay synchronous, matching how auth.js/app.js already call them.

  function getSession() {
    return U.storageGetJSON(CFG.STORAGE_KEYS.SESSION, null);
  }

  function saveSession(session) {
    U.storageSetJSON(CFG.STORAGE_KEYS.SESSION, session);
  }

  function clearSession() {
    U.storageRemove(CFG.STORAGE_KEYS.SESSION);
  }

  /* -------------------------------- fetch -------------------------------- */

  function request(path, options) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var session = getSession();
    if (session && session.token) {
      headers['Authorization'] = 'Bearer ' + session.token;
    }

    return fetch(BASE + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) {
          if (res.status === 401) {
            clearSession();
            if (!/login\.html$/.test(window.location.pathname)) {
              window.location.href = 'login.html';
            }
          }
          var message = (data && (data.error || data.detail)) || ('Request failed (' + res.status + ')');
          throw new Error(typeof message === 'string' ? message : 'Request failed.');
        }
        return data;
      });
    });
  }

  // Same auth header as request(), but for endpoints that return a binary
  // body (the PDF export) instead of JSON — request() always calls
  // res.json() on the response, which would choke on PDF bytes.
  function requestBlob(path) {
    var headers = {};
    var session = getSession();
    if (session && session.token) {
      headers['Authorization'] = 'Bearer ' + session.token;
    }
    return fetch(BASE + path, { headers: headers }).then(function (res) {
      if (!res.ok) {
        if (res.status === 401) {
          clearSession();
          if (!/login\.html$/.test(window.location.pathname)) {
            window.location.href = 'login.html';
          }
        }
        throw new Error('Request failed (' + res.status + ')');
      }
      return res.blob();
    });
  }

  /* -------------------------------- auth -------------------------------- */

  var auth = {
    getSession: getSession,

    getUser: function () {
      var session = getSession();
      return session && session.user ? session.user : null;
    },

    // The UI only has a login form (no separate sign-up page), so we try
    // to log in first and transparently register on a first-time email —
    // mirrors the old mock's "any email/password works" demo behavior,
    // but against the real backend/database this time.
    login: function (email, password) {
      if (!email || !password) {
        return Promise.reject(new Error('Please enter your email and password.'));
      }

      function doLogin() {
        return request('/auth/login', { method: 'POST', body: { email: email, password: password } });
      }

      return doLogin()
        .catch(function (err) {
          var looksLikeNoAccount = /incorrect email or password/i.test(err.message || '');
          if (!looksLikeNoAccount) throw err;
          var name = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
          return request('/auth/register', {
            method: 'POST',
            body: { name: name || 'New User', email: email, password: password }
          }).then(doLogin);
        })
        .then(function (data) {
          var session = { token: data.token, user: data.user };
          saveSession(session);
          return session;
        });
    },

    logout: function () {
      request('/auth/logout', { method: 'POST' }).catch(function () {});
      clearSession();
    }
  };

  /* ------------------------------- audits ------------------------------- */

  function mapAuditToRecent(a) {
    return {
      id: a.id,
      url: U.hostnameOf(a.url),
      score: a.overall_score != null ? a.overall_score : 0,
      completedAt: new Date(a.completed_at || a.created_at).getTime(),
      label: a.label,
      status: a.status
    };
  }

  var audits = {
    // Starts a real audit on the backend, then polls /audits/{id}/progress
    // until it finishes, calling onProgress(progress) on each step change —
    // same { stepId, status, percent, elapsedLabel } shape audit.js expects.
    run: function (config, onProgress) {
      if (!config || !config.url || !window.Validation.isValidUrl(config.url)) {
        return Promise.reject(new Error('Please provide a valid website URL.'));
      }

      return request('/audits/', {
        method: 'POST',
        body: {
          url: config.url,
          depth: config.depth === 'full' ? 'full' : 'homepage',
          max_pages: config.maxPages || 1,
          modules: config.modules && config.modules.length ? config.modules : CFG.MODULES
        }
      }).then(function (created) {
        return pollProgress(created.id, onProgress);
      });
    },

    getStats: function () {
      return request('/dashboard/').then(function (d) {
        var s = d.stats;
        return {
          totalAudits: s.total_audits,
          seoIssues: s.seo_issues,
          performanceScore: s.performance_score,
          criticalIssues: s.critical_issues,
          overall: s.overall,
          breakdown: {
            seo: s.breakdown.seo,
            performance: s.breakdown.performance,
            accessibility: s.breakdown.accessibility,
            security: s.breakdown.security
          }
        };
      });
    },

    getRecent: function () {
      return request('/audits/recent').then(function (list) {
        return (list || []).map(mapAuditToRecent);
      });
    },

    // Consent-module detail for one audit (banner presence, cookie/tracker
    // findings, and the banner screenshot) — 404s if the audit didn't run
    // with the "consent" module enabled.
    getConsent: function (auditId) {
      return request('/audits/' + auditId + '/consent').then(function (c) {
        return {
          hasCookieBanner: c.has_cookie_banner,
          bannerBlocksScriptsPreConsent: c.banner_blocks_scripts_pre_consent,
          gdprCompliant: c.gdpr_compliant,
          ccpaCompliant: c.ccpa_compliant,
          consentScore: c.consent_score,
          bannerScreenshotUrl: c.banner_screenshot_url ? (CFG.API_ORIGIN + c.banner_screenshot_url) : null
        };
      });
    },

    // Analytics/tag-detection detail for one audit (GA4/GTM/Meta Pixel/etc.
    // detected, dataLayer presence, event counts) — 404s if the audit
    // didn't run with the "analytics" module enabled.
    getAnalytics: function (auditId) {
      return request('/audits/' + auditId + '/analytics').then(function (a) {
        return {
          trackersDetected: a.trackers_detected || [],
          tagManagerDetected: a.tag_manager_detected,
          gtmContainerId: a.gtm_container_id,
          gaMeasurementId: a.ga_measurement_id,
          dataLayerPresent: a.data_layer_present,
          pageviewEventsFound: a.pageview_events_found,
          customEventsFound: a.custom_events_found,
          analyticsScore: a.analytics_score
        };
      });
    }
  };

  function pollProgress(auditId, onProgress) {
    return new Promise(function (resolve, reject) {
      var lastStep = null;
      var lastPercent = 0;

      function tick() {
        request('/audits/' + auditId + '/progress')
          .then(function (p) {
            if (p.current_step && p.current_step !== lastStep) {
              if (lastStep && onProgress) {
                onProgress({ stepId: lastStep, status: 'pass', percent: lastPercent, elapsedLabel: 'done' });
              }
              lastStep = p.current_step;
              if (onProgress) onProgress({ stepId: lastStep, status: 'running', percent: p.percent });
            }
            lastPercent = p.percent;

            if (p.status === 'completed') {
              if (lastStep && onProgress) {
                onProgress({ stepId: lastStep, status: 'pass', percent: 100, elapsedLabel: 'done' });
              }
              U.storageSetJSON('auditpulse:lastAuditId', auditId);
              resolve({ overall: p.overall_score, id: auditId });
              return;
            }
            if (p.status === 'failed') {
              reject(new Error('Something went wrong while auditing this site.'));
              return;
            }
            setTimeout(tick, 700);
          })
          .catch(reject);
      }

      tick();
    });
  }

  /* ------------------------------- reports ------------------------------- */
  // Backs report.html: the real score grid / findings / AI recommendations
  // for one completed audit, plus the share and PDF-download actions.

  function mapReport(d) {
    return {
      auditId: d.audit_id,
      url: d.url,
      overall: d.overall,
      generatedAt: d.generated_at,
      shareUrl: d.share_url,
      scoreGrid: (d.score_grid || []).map(function (c) {
        return { module: c.module, label: c.label, score: c.score, targetSection: c.target_section };
      }),
      findings: (d.findings || []).map(function (f) {
        return { module: f.module, severity: f.severity, title: f.title, description: f.description };
      }),
      // Only present via reports.getFull() (GET /reports/{id}/export.json) —
      // undefined when the plain reports.get() call was used instead.
      priorities: d.priorities ? d.priorities.map(function (p) {
        return { rank: p.rank, module: p.module, severity: p.severity, title: p.title, description: p.description, effort: p.effort };
      }) : undefined
    };
  }

  var reports = {
    // Lightweight report view (score grid + findings) for report.html's
    // main render.
    get: function (auditId) {
      return request('/reports/' + auditId).then(mapReport);
    },

    // Full, AI-enriched export (adds prioritized recommendations) — same
    // data report.html's "AI Recommendations" card needs, at the cost of
    // a slower first call (cached server-side after that).
    getFull: function (auditId) {
      return request('/reports/' + auditId + '/export.json').then(mapReport);
    },

    share: function (auditId) {
      return request('/reports/' + auditId + '/share', { method: 'POST' }).then(function (d) {
        return d.share_url;
      });
    },

    // Fetches the real PDF export and returns it as a Blob for
    // Utils.downloadBlob() to save — see downloadPdfBtn in report.js.
    exportPdfBlob: function (auditId) {
      return requestBlob('/reports/' + auditId + '/export');
    }
  };

  /* --------------------------------- ai ---------------------------------- */
  // The AI-assistant chat panel on report.html — POST /ai/{id}/chat, with
  // the running Q&A history sent back each turn so follow-up questions
  // stay in context (the backend is stateless between requests).

  var ai = {
    chat: function (auditId, question, history) {
      return request('/ai/' + auditId + '/chat', {
        method: 'POST',
        body: { question: question, history: history || [] }
      }).then(function (d) {
        return d.answer;
      });
    }
  };

  /* ------------------------------- history -------------------------------- */
  // Real account-activity feed (audits started/completed, settings changes,
  // logins, scheduled runs, ...) — GET /history/activity. Backs the
  // notification bell in app.js; replaces the old hardcoded mock list.

  var history = {
    getActivity: function (pageSize) {
      return request('/history/activity?page_size=' + (pageSize || 10)).then(function (d) {
        return (d.items || []).map(function (item) {
          return {
            id: item.id,
            eventType: item.event_type,
            description: item.description,
            auditId: item.audit_id,
            createdAt: item.created_at
          };
        });
      });
    }
  };

  /* ------------------------------ settings ------------------------------ */

  function mapSettingsOut(s) {
    return {
      name: s.name,
      email: s.email,
      company: s.company,
      aiProvider: s.ai_provider,
      notifyAuditCompleted: s.notify_audit_completed,
      notifyCriticalIssue: s.notify_critical_issue,
      notifyWeeklySummary: s.notify_weekly_summary,
      theme: s.theme,
      language: s.language,
      scheduleFrequency: s.schedule_frequency,
      scheduleTime: s.schedule_time,
      apiKey: s.api_key
    };
  }

  var settings = {
    get: function () {
      return request('/settings/').then(mapSettingsOut);
    },

    save: function (patch) {
      patch = patch || {};
      var body = {
        name: patch.name,
        email: patch.email,
        company: patch.company,
        ai_provider: patch.aiProvider,
        notify_audit_completed: patch.notifyAuditCompleted,
        notify_critical_issue: patch.notifyCriticalIssue,
        notify_weekly_summary: patch.notifyWeeklySummary,
        theme: patch.theme,
        language: patch.language,
        schedule_frequency: patch.scheduleFrequency,
        schedule_time: patch.scheduleTime
      };
      Object.keys(body).forEach(function (k) { if (body[k] === undefined) delete body[k]; });
      return request('/settings/', { method: 'PATCH', body: body }).then(mapSettingsOut);
    },

    regenerateApiKey: function () {
      return request('/settings/api-key/regenerate', { method: 'POST' }).then(function (d) { return d.api_key; });
    },

    exportJson: function () {
      return request('/settings/export').then(function (d) {
        return {
          exportedAt: d.exported_at,
          settings: mapSettingsOut(d.settings),
          audits: (d.audits || []).map(mapAuditToRecent)
        };
      });
    }
  };

  return { auth: auth, audits: audits, settings: settings, reports: reports, ai: ai, history: history };
})();
