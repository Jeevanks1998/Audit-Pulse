/* ==========================================================================
   app.js — runs on every page. Wires up the shared app-shell chrome
   (sidebar, theme toggle, profile menu, notification bell) plus the
   settings.html page, which has no dedicated script file of its own.
   ========================================================================== */

(function () {
  var U = window.Utils;
  var CFG = window.APP_CONFIG;

  document.addEventListener('DOMContentLoaded', function () {
    applyStoredTheme();
    initSidebar();
    initThemeToggle();
    initProfileMenu();
    initNotificationBell();
    highlightActiveNav();
    initSettingsPage();
  });

  /* ---------------------------------------------------------------- */
  /* Theme                                                              */
  /* ---------------------------------------------------------------- */

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(mode) {
    var resolved = mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
    if (resolved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');

    U.qsa('.theme-toggle button').forEach(function (btn) {
      var isDarkBtn = /dark/i.test(btn.getAttribute('aria-label') || '');
      btn.classList.toggle('is-active', isDarkBtn === (resolved === 'dark'));
    });

    U.qsa('.theme-swatch').forEach(function (swatch) {
      swatch.classList.toggle('is-active', swatch.dataset.themeChoice === mode);
    });
  }

  function applyStoredTheme() {
    var mode = U.storageGet(CFG.STORAGE_KEYS.THEME, 'light');
    applyTheme(mode);
  }

  function initThemeToggle() {
    U.qsa('.theme-toggle button').forEach(function (btn) {
      U.on(btn, 'click', function () {
        var isDark = /dark/i.test(btn.getAttribute('aria-label') || '');
        var mode = isDark ? 'dark' : 'light';
        U.storageSet(CFG.STORAGE_KEYS.THEME, mode);
        applyTheme(mode);
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Sidebar (mobile off-canvas)                                       */
  /* ---------------------------------------------------------------- */

  function initSidebar() {
    var sidebar = document.getElementById('sidebar');
    var backdrop = document.getElementById('sidebarBackdrop');
    var toggle = document.getElementById('menuToggle');
    if (!sidebar || !toggle) return;

    function openSidebar() {
      sidebar.classList.add('is-open');
      if (backdrop) backdrop.classList.add('is-open');
    }
    function closeSidebar() {
      sidebar.classList.remove('is-open');
      if (backdrop) backdrop.classList.remove('is-open');
    }

    U.on(toggle, 'click', function () {
      sidebar.classList.contains('is-open') ? closeSidebar() : openSidebar();
    });
    U.on(backdrop, 'click', closeSidebar);
    U.qsa('.sidebar__link').forEach(function (link) { U.on(link, 'click', closeSidebar); });
  }

  /* ---------------------------------------------------------------- */
  /* Active nav highlighting                                           */
  /* ---------------------------------------------------------------- */

  function highlightActiveNav() {
    var current = (location.pathname.split('/').pop() || 'index.html');
    U.qsa('.sidebar__link').forEach(function (link) {
      var href = (link.getAttribute('href') || '').split('#')[0];
      if (href && href === current) link.classList.add('is-active');
    });
  }

  /* ---------------------------------------------------------------- */
  /* Profile menu                                                       */
  /* ---------------------------------------------------------------- */

  function initProfileMenu() {
    var chip = U.qs('.profile-chip');
    if (!chip) return;

    var user = window.Api ? window.Api.auth.getUser() : { name: 'Jeevan Varma', email: 'jeevan@company.com' };
    var nameEl = chip.querySelector('.profile-chip__name');
    if (nameEl && user && user.name) nameEl.textContent = user.name.split(' ')[0];

    chip.style.cursor = 'pointer';
    chip.style.position = 'relative';

    var menu = null;
    function closeMenu() {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      menu = null;
      document.removeEventListener('click', onDocClick);
    }
    function onDocClick(e) {
      if (!chip.contains(e.target)) closeMenu();
    }
    function openMenu() {
      menu = document.createElement('div');
      menu.style.cssText = 'position:absolute; right:0; top:calc(100% + 8px); background:var(--surface); ' +
        'border:1px solid var(--border); border-radius:var(--radius-md); box-shadow:var(--shadow-lg); ' +
        'min-width:180px; padding:6px; z-index:60; font-size:var(--fs-sm);';
      menu.innerHTML =
        '<div style="padding:8px 10px; color:var(--text-tertiary); font-size:12px;">' + U.escapeHtml((user && user.email) || '') + '</div>' +
        '<a href="settings.html" style="display:block; padding:8px 10px; border-radius:var(--radius-sm); color:var(--text-primary);">Settings</a>' +
        '<a href="#" id="profileMenuLogout" style="display:block; padding:8px 10px; border-radius:var(--radius-sm); color:var(--color-error);">Log out</a>';
      chip.appendChild(menu);
      U.qsa('a', menu).forEach(function (a) {
        U.on(a, 'mouseenter', function () { a.style.background = 'var(--surface-sunken)'; });
        U.on(a, 'mouseleave', function () { a.style.background = ''; });
      });
      U.on(menu.querySelector('#profileMenuLogout'), 'click', function (e) {
        e.preventDefault();
        if (window.Api) window.Api.auth.logout();
        window.location.href = 'login.html';
      });
      setTimeout(function () { document.addEventListener('click', onDocClick); }, 0);
    }

    U.on(chip, 'click', function () {
      menu ? closeMenu() : openMenu();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Notification bell                                                  */
  /* ---------------------------------------------------------------- */

  function initNotificationBell() {
    var bell = U.qs('.topbar__actions .icon-btn[aria-label="Notifications"]');
    if (!bell) return;

    var mockNotifications = [
      { title: 'Audit completed', desc: 'example.com scored 92/100', time: '2 min ago' },
      { title: 'Critical issue found', desc: 'shopcraft.io — 3 broken links', time: '1 hour ago' },
      { title: 'Weekly digest ready', desc: '4 sites summarized', time: 'Yesterday' }
    ];

    bell.style.position = 'relative';
    var panel = null;

    function closePanel() {
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      panel = null;
      document.removeEventListener('click', onDocClick);
    }
    function onDocClick(e) {
      if (!bell.contains(e.target)) closePanel();
    }
    function openPanel() {
      var dot = bell.querySelector('.dot');
      if (dot) dot.style.display = 'none';

      panel = document.createElement('div');
      panel.style.cssText = 'position:absolute; right:0; top:calc(100% + 8px); background:var(--surface); ' +
        'border:1px solid var(--border); border-radius:var(--radius-md); box-shadow:var(--shadow-lg); ' +
        'width:280px; padding:10px; z-index:60;';
      var itemsHtml = mockNotifications.map(function (n) {
        return '<div style="padding:8px 10px; border-radius:var(--radius-sm);">' +
          '<div style="font-weight:600; font-size:var(--fs-sm);">' + U.escapeHtml(n.title) + '</div>' +
          '<div style="font-size:12px; color:var(--text-tertiary); margin-top:2px;">' + U.escapeHtml(n.desc) + ' · ' + n.time + '</div>' +
          '</div>';
      }).join('');
      panel.innerHTML = '<div style="font-weight:700; font-size:var(--fs-sm); padding:6px 10px 10px;">Notifications</div>' + itemsHtml;
      bell.appendChild(panel);
      setTimeout(function () { document.addEventListener('click', onDocClick); }, 0);
    }

    U.on(bell, 'click', function (e) {
      e.stopPropagation();
      panel ? closePanel() : openPanel();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Settings page (no dedicated settings.js — wired here)              */
  /* ---------------------------------------------------------------- */

  function initSettingsPage() {
    var saveBtn = document.getElementById('saveSettingsBtn');
    if (!saveBtn || !window.Api) return; // not on settings.html

    var cancelBtn = document.getElementById('cancelSettingsBtn');
    var copyKeyBtn = document.getElementById('copyApiKeyBtn');
    var revokeKeyBtn = document.getElementById('revokeApiKeyBtn');
    var generateKeyBtn = document.getElementById('generateApiKeyBtn');
    var exportBtn = document.getElementById('exportDataBtn');
    var swatches = U.qsa('.theme-swatch');
    var apiKeyDisplay = document.getElementById('apiKeyDisplay');

    var selectedTheme = U.storageGet(CFG.STORAGE_KEYS.THEME, 'light');

    // Load persisted settings into the form
    window.Api.settings.get().then(function (s) {
      setVal('settingName', s.name);
      setVal('settingEmail', s.email);
      setVal('settingCompany', s.company);
      setVal('settingAiProvider', s.aiProvider);
      setChecked('notifyAuditCompleted', s.notifyAuditCompleted);
      setChecked('notifyCriticalIssue', s.notifyCriticalIssue);
      setChecked('notifyWeeklySummary', s.notifyWeeklySummary);
      setVal('settingLanguage', s.language);
      setVal('scheduleFrequency', s.scheduleFrequency);
      setVal('scheduleTime', s.scheduleTime);
    });

    function setVal(id, value) {
      var el = document.getElementById(id);
      if (el && value != null) el.value = value;
    }
    function setChecked(id, value) {
      var el = document.getElementById(id);
      if (el) el.checked = !!value;
    }
    function getVal(id) {
      var el = document.getElementById(id);
      return el ? el.value : undefined;
    }
    function getChecked(id) {
      var el = document.getElementById(id);
      return el ? el.checked : undefined;
    }

    swatches.forEach(function (swatch) {
      U.on(swatch, 'click', function () {
        selectedTheme = swatch.dataset.themeChoice;
        swatches.forEach(function (s) { s.classList.toggle('is-active', s === swatch); });
        U.storageSet(CFG.STORAGE_KEYS.THEME, selectedTheme);
        applyTheme(selectedTheme);
      });
    });

    U.on(copyKeyBtn, 'click', function () {
      window.Api.settings.get().then(function (s) {
        U.copyToClipboard(s.apiKey).then(function () {
          window.Notifications.success('Copied', 'API key copied to clipboard.');
        });
      });
    });

    U.on(revokeKeyBtn, 'click', function () {
      window.Modal.confirm({
        title: 'Revoke production key?',
        body: 'Any integration using this key will stop working immediately. This can\'t be undone.',
        confirmLabel: 'Revoke key',
        dangerous: true,
        onConfirm: function () {
          window.Api.settings.regenerateApiKey().then(function (key) {
            if (apiKeyDisplay) apiKeyDisplay.textContent = maskKey(key);
            window.Notifications.warning('Key revoked', 'A new production key has been generated.');
          });
        }
      });
    });

    U.on(generateKeyBtn, 'click', function () {
      window.Loader.setButtonLoading(generateKeyBtn, true, 'Generating…');
      window.Api.settings.regenerateApiKey().then(function (key) {
        window.Loader.setButtonLoading(generateKeyBtn, false);
        if (apiKeyDisplay) apiKeyDisplay.textContent = maskKey(key);
        window.Notifications.success('New key generated', 'Copy it now — you won\'t see the full key again.');
      });
    });

    function maskKey(key) {
      return key.slice(0, 8) + '••••••••••••' + key.slice(-4);
    }

    U.on(exportBtn, 'click', function () {
      window.Api.settings.exportJson().then(function (data) {
        U.downloadTextFile('auditpulse-settings.json', JSON.stringify(data, null, 2), 'application/json');
        window.Notifications.info('Exported', 'Your workspace settings were downloaded as JSON.');
      });
    });

    U.on(cancelBtn, 'click', function (e) {
      e.preventDefault();
      window.location.reload();
    });

    U.on(saveBtn, 'click', function () {
      var patch = {
        name: getVal('settingName'),
        email: getVal('settingEmail'),
        company: getVal('settingCompany'),
        aiProvider: getVal('settingAiProvider'),
        notifyAuditCompleted: getChecked('notifyAuditCompleted'),
        notifyCriticalIssue: getChecked('notifyCriticalIssue'),
        notifyWeeklySummary: getChecked('notifyWeeklySummary'),
        theme: selectedTheme,
        language: getVal('settingLanguage'),
        scheduleFrequency: getVal('scheduleFrequency'),
        scheduleTime: getVal('scheduleTime')
      };

      if (patch.email && !window.Validation.isValidEmail(patch.email)) {
        window.Notifications.error('Invalid email', 'Please enter a valid profile email address.');
        return;
      }

      window.Loader.setButtonLoading(saveBtn, true, 'Saving…');
      window.Api.settings.save(patch).then(function () {
        window.Loader.setButtonLoading(saveBtn, false);
        window.Notifications.success('Settings saved', 'Your workspace preferences were updated.');
      });
    });
  }

  // Exposed so settings.js-equivalent code above can call the same theme logic
  window.__applyTheme = applyTheme;
})();
