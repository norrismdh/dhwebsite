// Digital Hive — Cookie Consent Manager
// Handles: banner, preference modal, UTM attribution, footer link injection.
(function () {
  'use strict';

  var CONSENT_COOKIE = 'dh_consent';
  var UTM_COOKIE     = 'dh_utm';
  var COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds
  var UTM_KEYS       = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  // ── Pending UTM params captured from current URL ─────────────────
  var pendingUtm = (function () {
    var out = {};
    try {
      var p = new URLSearchParams(window.location.search);
      UTM_KEYS.forEach(function (k) { if (p.has(k)) out[k] = p.get(k); });
    } catch (e) {}
    return out;
  }());

  // ── Cookie helpers ───────────────────────────────────────────────
  function getCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function setCookie(name, value, maxAge) {
    document.cookie = name + '=' + encodeURIComponent(value) +
      '; max-age=' + maxAge + '; path=/; SameSite=Lax';
  }

  // ── Consent state ────────────────────────────────────────────────
  var DEFAULTS = { v: 1, necessary: true, functional: true, performance: false, marketing: false };

  function loadConsent() {
    var raw = getCookie(CONSENT_COOKIE);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function saveConsent(prefs) {
    setCookie(CONSENT_COOKIE, JSON.stringify(prefs), COOKIE_MAX_AGE);
    window.DH_CONSENT = prefs;
    applyConsent(prefs);
    try {
      document.dispatchEvent(new CustomEvent('dh:consent', { detail: prefs }));
    } catch (e) {}
  }

  function applyConsent(prefs) {
    if (prefs.performance) {
      if (typeof window._dhInitAnalytics === 'function') window._dhInitAnalytics();
      loadGoogleAnalytics();
    }
    if (prefs.marketing) {
      storeUtm();
      loadLinkedInInsight();
    }
    fillUtmFields();
  }

  // ── Google Analytics 4 (performance) ─────────────────────────────
  // Sitewide gtag.js. Loaded only once performance consent is granted
  // (initial load if already stored, or the moment the banner/modal
  // accepts it). Idempotent.
  var GA_MEASUREMENT_ID = 'G-GVSXN997VH';
  var gaLoaded = false;

  function loadGoogleAnalytics() {
    if (gaLoaded) return;
    gaLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID);
  }

  // ── LinkedIn Insight Tag (marketing) ─────────────────────────────
  // Sitewide retargeting + conversion tracking. Loaded only once
  // marketing consent is granted (initial load if already stored,
  // or the moment the banner/modal accepts it). Idempotent.
  var LINKEDIN_PARTNER_ID = '7057956';
  var liLoaded = false;

  function loadLinkedInInsight() {
    if (liLoaded) return;
    liLoaded = true;
    window._linkedin_partner_id = LINKEDIN_PARTNER_ID;
    window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
    window._linkedin_data_partner_ids.push(LINKEDIN_PARTNER_ID);
    if (!window.lintrk) {
      window.lintrk = function (a, b) { window.lintrk.q.push([a, b]); };
      window.lintrk.q = [];
    }
    var s = document.getElementsByTagName('script')[0];
    var b = document.createElement('script');
    b.type = 'text/javascript';
    b.async = true;
    b.src = 'https://snap.licdn.com/li.lms-analytics/insight.min.js';
    s.parentNode.insertBefore(b, s);
  }

  // ── UTM storage ──────────────────────────────────────────────────
  function storeUtm() {
    var existing = {};
    var raw = getCookie(UTM_COOKIE);
    if (raw) { try { existing = JSON.parse(raw); } catch (e) {} }
    // Incoming URL params override stored ones for the same key
    var merged = Object.assign({}, existing, pendingUtm);
    if (Object.keys(merged).length) {
      setCookie(UTM_COOKIE, JSON.stringify(merged), COOKIE_MAX_AGE);
    }
  }

  function getUtm() {
    var raw = getCookie(UTM_COOKIE);
    var stored = {};
    if (raw) { try { stored = JSON.parse(raw); } catch (e) {} }
    // Also expose any in-memory pending params even before cookie write
    return Object.assign({}, stored, pendingUtm);
  }

  function fillUtmFields() {
    var utm = getUtm();
    document.querySelectorAll('[data-utm-field]').forEach(function (el) {
      var key = el.getAttribute('data-utm-field');
      if (utm[key]) el.value = utm[key];
    });
  }

  // Exposed for form scripts to read
  window.DH_getUtm = getUtm;

  // ── Banner ───────────────────────────────────────────────────────
  var banner = null;

  function showBanner() {
    if (banner || document.querySelector('.dh-consent-banner')) return;
    banner = document.createElement('div');
    banner.className = 'dh-consent-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie preferences');
    banner.innerHTML =
      '<div class="dh-consent-banner__inner">' +
        '<div class="dh-consent-banner__text">' +
          '<strong>Cookie preferences</strong>' +
          '<p>We use cookies to keep the site running. With your consent we also track performance analytics and campaign attribution. <a href="/Privacy.html#cookies" aria-label="Learn more about our cookie policy">Learn more</a>.</p>' +
        '</div>' +
        '<div class="dh-consent-banner__actions">' +
          '<button class="dh-cb dh-cb--ghost" data-consent="manage">Manage</button>' +
          '<button class="dh-cb dh-cb--outline" data-consent="reject">Reject optional</button>' +
          '<button class="dh-cb dh-cb--primary" data-consent="accept">Accept all</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { banner.classList.add('is-visible'); });
    });

    banner.querySelector('[data-consent="accept"]').addEventListener('click', function () {
      saveConsent({ v: 1, necessary: true, functional: true, performance: true, marketing: true });
      hideBanner();
    });
    banner.querySelector('[data-consent="reject"]').addEventListener('click', function () {
      saveConsent({ v: 1, necessary: true, functional: true, performance: false, marketing: false });
      hideBanner();
    });
    banner.querySelector('[data-consent="manage"]').addEventListener('click', function () {
      hideBanner(true);
      openModal();
    });
  }

  function hideBanner(instant) {
    if (!banner) return;
    var b = banner;
    banner = null;
    if (instant) {
      b.parentNode && b.parentNode.removeChild(b);
      return;
    }
    b.classList.remove('is-visible');
    b.addEventListener('transitionend', function () {
      b.parentNode && b.parentNode.removeChild(b);
    }, { once: true });
  }

  // ── Preference modal ─────────────────────────────────────────────
  var modal = null;

  function openModal() {
    if (modal) return;
    var prefs = loadConsent() || Object.assign({}, DEFAULTS);

    function toggle(id, label, desc, checked, disabled) {
      return '<div class="dh-cm__row">' +
        '<div class="dh-cm__row-text"><strong>' + label + '</strong><p>' + desc + '</p></div>' +
        '<label class="dh-toggle">' +
          '<input type="checkbox" name="' + id + '"' +
            (checked  ? ' checked'  : '') +
            (disabled ? ' disabled' : '') + ' />' +
          '<span class="dh-toggle__track"></span>' +
        '</label>' +
      '</div>';
    }

    modal = document.createElement('div');
    modal.className = 'dh-cm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Cookie preferences');
    modal.innerHTML =
      '<div class="dh-cm__overlay" data-cm-close></div>' +
      '<div class="dh-cm__box">' +
        '<div class="dh-cm__head">' +
          '<h2 class="dh-cm__title">Cookie preferences</h2>' +
          '<button class="dh-cm__close" data-cm-close aria-label="Close">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
              '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
            '</svg>' +
          '</button>' +
        '</div>' +
        '<div class="dh-cm__body">' +
          '<p class="dh-cm__intro">Choose which cookies Digital Hive may use. Strictly necessary cookies keep the site working and cannot be disabled.</p>' +
          toggle('necessary',   'Strictly necessary',        'Required for navigation, form submission, and security. Always active.',                                        true,              true)  +
          toggle('functional',  'Functional',                'Remembers your cookie choice so we don\'t ask again for 12 months.',                                           prefs.functional,  false) +
          toggle('performance', 'Performance & analytics',   'Helps us understand how visitors use the site (e.g. Google Analytics). No personal data sold or shared.',      prefs.performance, false) +
          toggle('marketing',   'Marketing & attribution',   'Stores campaign parameters (UTM tags) so we can measure which channels brought you here. No ad retargeting.',  prefs.marketing,   false) +
        '</div>' +
        '<div class="dh-cm__foot">' +
          '<a href="/Privacy.html#cookies" class="dh-cm__policy-link">Privacy Policy</a>' +
          '<div class="dh-cm__foot-actions">' +
            '<button class="dh-cb dh-cb--outline" data-cm-reject>Reject optional</button>' +
            '<button class="dh-cb dh-cb--primary" data-cm-save>Save preferences</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { modal.classList.add('is-visible'); });
    });

    var firstBtn = modal.querySelector('button:not([disabled])');
    if (firstBtn) firstBtn.focus();

    function closeModal() {
      if (!modal) return;
      var m = modal;
      modal = null;
      m.classList.remove('is-visible');
      m.addEventListener('transitionend', function () {
        m.parentNode && m.parentNode.removeChild(m);
      }, { once: true });
    }

    modal.querySelectorAll('[data-cm-close]').forEach(function (el) {
      el.addEventListener('click', closeModal);
    });
    modal.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });
    modal.querySelector('[data-cm-reject]').addEventListener('click', function () {
      saveConsent({ v: 1, necessary: true, functional: true, performance: false, marketing: false });
      closeModal();
    });
    modal.querySelector('[data-cm-save]').addEventListener('click', function () {
      var updated = { v: 1, necessary: true, functional: true, performance: false, marketing: false };
      modal.querySelectorAll('input[type="checkbox"]:not([disabled])').forEach(function (cb) {
        updated[cb.name] = cb.checked;
      });
      saveConsent(updated);
      closeModal();
    });
  }

  // ── Footer "Cookie settings" link ────────────────────────────────
  function injectFooterLink() {
    var ul = document.querySelector('.footer__bottom ul');
    if (!ul || ul.querySelector('[data-consent-footer]')) return;
    var li  = document.createElement('li');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'footer__cookie-btn';
    btn.setAttribute('data-consent-footer', '');
    btn.textContent = 'Cookie settings';
    btn.addEventListener('click', openModal);
    li.appendChild(btn);
    // Insert before the last item (Trust center)
    var last = ul.lastElementChild;
    ul.insertBefore(li, last);
  }

  // ── Init ─────────────────────────────────────────────────────────
  function init() {
    var stored = loadConsent();
    window.DH_CONSENT = stored || Object.assign({}, DEFAULTS);
    window.DH_openConsentModal = openModal;

    if (stored) {
      applyConsent(stored);
    } else {
      showBanner();
    }

    injectFooterLink();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
