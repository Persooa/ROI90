/*
  Bar in a blue frame: timer, discount code, newsletter (+ popup). Needs core/popup.js (ROI.Popup) loaded before it.

  Configuration: data attributes on [data-rk-bar="combo"] (see widget.html)
    data-timer / data-code / data-newsletter = "on" | "off"
    data-text, data-code-value, data-newsletter-code
    data-end="2026-11-30T23:59:59"  fixed timer end (local time)
    data-duration="7200"            or seconds from the first visit in this session (neither: until midnight)
    data-demo="on" | "off"          the "Demo" options strip under the bar. Set "off" for the production version.
  Demo mode also reads / writes URL params: ?timer=0&code=1&newsletter=1&text=...&codeValue=...
  Live changes from code: element.rkBar.update({ timer: true, text: '...' })
  Events (window.track if present, otherwise console.log):
    bar.view, bar.click, bar.close, code.copy, timer.expired, popup.view, popup.close, newsletter.subscribe
*/
(function () {
  var root = document.querySelector('[data-rk-bar="combo"]');
  var popEl = document.querySelector('[data-rk-popup="combo"]');
  if (!root || !popEl) return;

  // Move the popup to <body>: an ancestor with transform / filter / overflow (e.g. a demo frame)
  // would otherwise trap position:fixed inside itself instead of covering the whole viewport
  document.body.appendChild(popEl);

  var KEY_CLOSED = 'rk_cb_closed', KEY_START = 'rk_cb_start', KEY_SUB = 'rk_cb_subscribed';
  var $ = function (sel, ctx) { return (ctx || root).querySelector(sel); };
  var frameEl = $('.rk-cb__frame');
  var textEl = $('[data-rk-text]'), timerWrap = $('[data-rk-timer]'), codeWrap = $('[data-rk-code]');
  var codeVal = $('[data-rk-code-value]'), copyBtn = $('[data-rk-copy]'), openBtn = $('[data-rk-open]');
  var status = $('.rk-cb__status');
  var copyLabel = copyBtn.textContent;
  var segs = {};
  ['d', 'h', 'm', 's'].forEach(function (k) { segs[k] = $('[data-seg="' + k + '"] b'); });
  var dayEls = [$('[data-seg="d"]'), $('[data-sep="d"]')];

  var form = $('form', popEl), email = $('input[type="email"]', popEl), consent = $('input[type="checkbox"]', popEl);
  var error = $('.rk-modal__error', popEl), viewForm = $('[data-view="form"]', popEl), viewDone = $('[data-view="done"]', popEl);
  var sentTo = $('[data-sent-to]', popEl), newsCode = $('[data-rk-newsletter-code]', popEl);

  var interval = null, end = 0, expired = false, copyTimer = null, popup = null;
  var demo = root.getAttribute('data-demo') === 'on';
  var demoUi = null;
  var subscribed = !demo && read(KEY_SUB) === '1';   // demo: the sign-up button always stays available

  function track(name, data) {
    data = data || {};
    // core/tracker.js exposes ROI.track; window.track is kept as a fallback
    if (window.ROI && typeof window.ROI.track === 'function') window.ROI.track(name, data);
    else if (typeof window.track === 'function') window.track(name, data);
    else console.log('[rk-bar]', name, data);
  }
  function read(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function on(name) { return root.getAttribute('data-' + name) === 'on'; }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  // --- Timer ---
  function endTime() {
    var fixed = root.getAttribute('data-end');
    if (fixed) { var t = new Date(fixed).getTime(); if (!isNaN(t)) return t; }
    var dur = parseInt(root.getAttribute('data-duration'), 10);
    if (dur > 0) {
      var start = parseInt(read(KEY_START), 10);
      // Demo: a countdown that already ran out (tab left open, Timer re-enabled) starts over
      if (demo && start && start + dur * 1000 <= Date.now()) start = 0;
      if (!start) { start = Date.now(); write(KEY_START, String(start)); }
      return start + dur * 1000;
    }
    var eod = new Date(); eod.setHours(23, 59, 59, 999);
    return eod.getTime();
  }
  function tick() {
    var left = Math.max(0, Math.floor((end - Date.now()) / 1000));
    var d = Math.floor(left / 86400);
    segs.d.textContent = pad(d);
    segs.h.textContent = pad(Math.floor((left % 86400) / 3600));
    segs.m.textContent = pad(Math.floor((left % 3600) / 60));
    segs.s.textContent = pad(left % 60);
    dayEls.forEach(function (el) { el.hidden = d === 0; });   // days only when there are any
    if (left === 0 && demo && parseInt(root.getAttribute('data-duration'), 10) > 0 && !root.getAttribute('data-end')) {
      write(KEY_START, '');   // demo: loop the countdown instead of hiding it
      armTimer();
      return;
    }
    if (left === 0) {
      clearInterval(interval);
      expired = true;
      timerWrap.hidden = true;
      track('timer.expired', { bar: 'combo' });
    }
  }
  function armTimer() {
    clearInterval(interval);
    expired = false;
    end = endTime();
    timerWrap.hidden = !on('timer');
    if (!on('timer')) return;
    tick();
    if (!expired) interval = setInterval(tick, 1000);
  }

  // --- Render from attributes ---
  function apply() {
    textEl.textContent = root.getAttribute('data-text') || '';
    textEl.hidden = !textEl.textContent;
    codeVal.textContent = root.getAttribute('data-code-value') || '';
    newsCode.textContent = root.getAttribute('data-newsletter-code') || '';
    codeWrap.hidden = !on('code');
    openBtn.hidden = !on('newsletter') || (subscribed && !demo);
    armTimer();
  }

  // --- Clipboard: Clipboard API needs a secure context; fall back to execCommand otherwise ---
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }
  copyBtn.addEventListener('click', function () {
    var code = codeVal.textContent.trim();
    copy(code).then(function () {
      copyBtn.textContent = 'Skopiowano ✓';
      status.textContent = 'Kod ' + code + ' skopiowany do schowka';
      track('code.copy', { code: code });
      clearTimeout(copyTimer);
      copyTimer = setTimeout(function () { copyBtn.textContent = copyLabel; status.textContent = ''; }, 2000);
    }).catch(function () { copyBtn.textContent = 'Zaznacz i skopiuj'; });
  });

  // --- Newsletter popup (ROI.Popup from core/popup.js) ---
  if (window.ROI && ROI.Popup) {
    popup = ROI.Popup(popEl, {
      initialFocus: 'input[type="email"]',
      onOpen: function () {
        if (demo) { viewForm.hidden = false; viewDone.hidden = true; }   // demo: always start from the form
        track('popup.view', { popup: 'newsletter' });
      },
      onClose: function (source) { track('popup.close', { popup: 'newsletter', subscribed: subscribed, source: source }); }
    });
  } else {
    console.error('[rk-bar] ROI.Popup not found – load core/popup.js before the bar. Newsletter is disabled.');
    openBtn.disabled = true;
  }
  openBtn.addEventListener('click', function () {
    track('bar.click', { bar: 'combo', action: 'newsletter' });
    if (popup) popup.open();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var value = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      error.textContent = 'Podaj poprawny adres e-mail.';
      email.focus();
      return;
    }
    if (!consent.checked) { error.textContent = 'Zaznacz zgodę, aby zapisać się do newslettera.'; return; }
    error.textContent = '';
    subscribed = true;
    if (!demo) write(KEY_SUB, '1');
    sentTo.textContent = value;
    viewForm.hidden = true;
    viewDone.hidden = false;
    openBtn.hidden = !demo;   // demo: keep the button so the flow can be shown again
    track('newsletter.subscribe', { email: value, source: 'bar+popup' });
  });

  // --- Close (in demo mode only the frame is hidden, so the options strip can bring it back) ---
  function setBarHidden(hidden) {
    (demo ? frameEl : root).hidden = hidden;
    if (demoUi) demoUi.restore.hidden = !hidden;
  }
  $('[data-rk-close]').addEventListener('click', function () {
    track('bar.close', { bar: 'combo' });
    clearInterval(interval);
    setBarHidden(true);
    write(KEY_CLOSED, '1');
  });

  // --- Public API for live changes ---
  root.rkBar = {
    update: function (p) {
      p = p || {};
      ['timer', 'code', 'newsletter'].forEach(function (k) {
        if (k in p) root.setAttribute('data-' + k, p[k] ? 'on' : 'off');
      });
      if ('text' in p) root.setAttribute('data-text', p.text);
      if ('codeValue' in p) root.setAttribute('data-code-value', p.codeValue);
      if ('newsletterCode' in p) root.setAttribute('data-newsletter-code', p.newsletterCode);
      if ('end' in p) root.setAttribute('data-end', p.end || '');
      if ('duration' in p) { write(KEY_START, ''); root.setAttribute('data-duration', String(p.duration || '')); }
      apply();
    }
  };

  // --- "Demo" options strip ---
  function mountDemo() {
    var FEATURES = [['timer', 'Timer', '+2 RBH'], ['code', 'Kod', '+2 RBH'], ['newsletter', 'Newsletter', '+8 RBH']];
    var box = document.createElement('div');
    box.className = 'rk-cb__demo';
    box.innerHTML = '<span class="rk-cb__demo-tag">Demo</span>' + FEATURES.map(function (f) {
      return '<label data-tip="' + f[2] + '"><input type="checkbox" data-demo-switch="' + f[0] + '"> ' + f[1] + '</label>';
    }).join('')
      + '<input type="text" data-demo-text aria-label="Tekst belki" placeholder="Tekst belki">'
      + '<input type="text" data-demo-code aria-label="Kod rabatowy" placeholder="Kod" maxlength="24">'
      + '<button type="button" data-demo-restore hidden>Pokaż belkę</button>';
    // Hang it on the bottom edge of the visible frame: the demo frame (.roi-frame) if there is one, otherwise the bar itself
    var host = root.closest('.roi-frame') || root;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(box);
    // Same colour as the frame label, so the tab looks like a part of the frame
    var label = host.querySelector('.roi-frame__label');
    if (label) {
      var bg = getComputedStyle(label).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') box.style.setProperty('--demo-bg', bg);
    }

    var textIn = $('[data-demo-text]', box), codeIn = $('[data-demo-code]', box);
    demoUi = { restore: $('[data-demo-restore]', box) };

    function syncFromAttrs() {
      FEATURES.forEach(function (f) { $('[data-demo-switch="' + f[0] + '"]', box).checked = on(f[0]); });
      if (document.activeElement !== textIn) textIn.value = root.getAttribute('data-text') || '';
      if (document.activeElement !== codeIn) codeIn.value = root.getAttribute('data-code-value') || '';
    }
    // Keep the current setup in the URL, so a link shows the same configuration
    function syncUrl() {
      try {
        var u = new URL(location.href);
        FEATURES.forEach(function (f) { u.searchParams.set(f[0], on(f[0]) ? '1' : '0'); });
        u.searchParams.set('text', root.getAttribute('data-text') || '');
        u.searchParams.set('codeValue', root.getAttribute('data-code-value') || '');
        history.replaceState(null, '', u.toString());
      } catch (e) { /* e.g. file:// restrictions */ }
    }

    // Initial state from the URL
    var q = new URLSearchParams(location.search), patch = {};
    FEATURES.forEach(function (f) { if (q.has(f[0])) patch[f[0]] = q.get(f[0]) === '1'; });
    if (q.has('text')) patch.text = q.get('text');
    if (q.has('codeValue')) patch.codeValue = q.get('codeValue');
    if (Object.keys(patch).length) root.rkBar.update(patch);
    syncFromAttrs();

    box.addEventListener('change', function (e) {
      var key = e.target.getAttribute('data-demo-switch');
      if (!key) return;
      var p = {}; p[key] = e.target.checked;
      root.rkBar.update(p);
      syncUrl();
    });
    textIn.addEventListener('input', function () { root.rkBar.update({ text: textIn.value }); syncUrl(); });
    codeIn.addEventListener('input', function () { root.rkBar.update({ codeValue: codeIn.value.trim() }); syncUrl(); });
    demoUi.restore.addEventListener('click', function () {
      write(KEY_CLOSED, '');
      setBarHidden(false);
      armTimer();
    });
  }

  apply();
  if (demo) mountDemo();
  if (read(KEY_CLOSED) === '1') setBarHidden(true);
  else track('bar.view', { bar: 'combo', timer: on('timer'), code: on('code'), newsletter: on('newsletter') });
})();
