/* ==========================================================================
   auth.js — login.html page logic
   ========================================================================== */

(function () {
  var U = window.Utils;
  var V = window.Validation;

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('loginForm');
    if (!form) return; // not on login.html

    var emailInput = document.getElementById('email');
    var passwordInput = document.getElementById('password');
    var emailError = document.getElementById('emailError');
    var passwordError = document.getElementById('passwordError');
    var toggleBtn = document.getElementById('togglePasswordBtn');
    var submitBtn = document.getElementById('loginSubmitBtn');
    var googleBtn = document.getElementById('googleLoginBtn');

    // If already "logged in", skip straight to the dashboard
    if (window.Api && window.Api.auth.getSession()) {
      // Only auto-redirect if the user didn't land here deliberately via a link with ?stay
      if (location.search.indexOf('stay') === -1) {
        // no-op: keep on login page unless they submit — avoids surprising back-button loops
      }
    }

    U.on(emailInput, 'blur', function () { V.validateEmailField(emailInput, emailError); });
    U.on(passwordInput, 'blur', function () { V.validatePasswordField(passwordInput, passwordError); });
    U.on(emailInput, 'input', function () { V.clearFieldState(emailInput, emailError); });
    U.on(passwordInput, 'input', function () { V.clearFieldState(passwordInput, passwordError); });

    U.on(toggleBtn, 'click', function () {
      var showing = passwordInput.type === 'text';
      passwordInput.type = showing ? 'password' : 'text';
      toggleBtn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });

    U.on(googleBtn, 'click', function () {
      window.Notifications.info('Not available in demo', 'Google sign-in isn\'t wired up in this front-end-only build.');
    });

    U.on(form, 'submit', function (e) {
      e.preventDefault();

      var emailOk = V.validateEmailField(emailInput, emailError);
      var passwordOk = V.validatePasswordField(passwordInput, passwordError);
      if (!emailOk || !passwordOk) return;

      window.Loader.setButtonLoading(submitBtn, true, 'Signing in…');

      window.Api.auth.login(emailInput.value.trim(), passwordInput.value)
        .then(function () {
          window.Notifications.success('Welcome back', 'Redirecting to your dashboard…');
          setTimeout(function () { window.location.href = 'dashboard.html'; }, 600);
        })
        .catch(function (err) {
          window.Loader.setButtonLoading(submitBtn, false);
          window.Notifications.error('Sign in failed', err.message || 'Please check your credentials and try again.');
        });
    });
  });
})();
