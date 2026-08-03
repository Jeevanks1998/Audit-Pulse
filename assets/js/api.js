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

  return { auth: auth, audits: audits, settings: settings };
})();
