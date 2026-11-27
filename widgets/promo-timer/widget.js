/*
  Promo box: countdown + discount code to copy.

  Configuration: data attributes on [data-rk-promo] (see widget.html)
    data-timer="on" | "off"         the countdown
    data-code="on" | "off"          the code line with the copy button
    data-end="2026-12-31T23:59"     end of the promotion (local time, YYYY-MM-DDTHH:mm). Empty = 34 days 9 hours from the page load
                                    (demo: when the countdown reaches 0 it starts over with the same length)
    data-text, data-code-value      texts
    data-demo="on" | "off"          off = the countdown stops at 0 instead of starting over
  Options are registered in ROI.options and shown in preview.html ("Opcje"); they are also read from the URL.
  Events (ROI.track): promo.view (once, when half of the box is visible), code.copy
*/
(function () {
  var root = document.querySelector('[data-rk-promo]');
  if (!root) return;

  var WIDGET = 'promo-timer';
  var $ = function (sel) {
    return root.querySelector(sel);
  };
  var timerEl = $('[data-pt-timer]'), codeBox = $('[data-pt-code]'), copyBtn = $('[data-pt-copy]');
  var labelEl = $('[data-pt-copy-label]'), valueEl = $('[data-pt-code-value]'),
    tailEl = $('[data-pt-code-tail]');
  var textEl = $('[data-pt-text]'), statusEl = $('[data-pt-status]');
  var segs = {
    d: $('[data-seg="d"]'),
    h: $('[data-seg="h"]'),
    m: $('[data-seg="m"]'),
    s: $('[data-seg="s"]')
  };
  var demo = root.getAttribute('data-demo') === 'on';
  var end = 0, span = 0, tick = null, copiedTimer = null;

  function track(name, data) {
    data = Object.assign({widget: WIDGET}, data || {});
    if (window.ROI && typeof window.ROI.track === 'function') window.ROI.track(name, data);
    else if (typeof window.track === 'function') window.track(name, data);
    else console.log('[rk-promo]', name, data);
  }

  function on(name) {
    return root.getAttribute('data-' + name) === 'on';
  }

  // "YYYY-MM-DDTHH:mm" in local time (the format of <input type="datetime-local">)
  function toLocalInput(ms) {
    var d = new Date(ms), p = function (n) {
      return String(n).padStart(2, '0');
    };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // --- Countdown (numbers without leading zeros, as in the design) ---
  function startCountdown() {
    var parsed = Date.parse(root.getAttribute('data-end') || '');   // no time zone in the string = local time
    end = isNaN(parsed) ? 0 : parsed;
    span = Math.max(0, end - Date.now());
    render();
  }

  function render() {
    var left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    if (left === 0 && demo && span > 0) {
      end = Date.now() + span;
      left = Math.ceil(span / 1000);
    }   // demo: start over with the same length
    segs.d.textContent = Math.floor(left / 86400);
    segs.h.textContent = Math.floor(left % 86400 / 3600);
    segs.m.textContent = Math.floor(left % 3600 / 60);
    segs.s.textContent = left % 60;
  }

  function armTimer() {
    clearInterval(tick);
    timerEl.hidden = !on('timer');
    if (on('timer')) {
      render();
      tick = setInterval(render, 1000);
    }
  }

  // --- Copy ---
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-100px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
      } catch (e) {
        reject(e);
      }
      document.body.removeChild(ta);
    });
  }

  function setCopied(copied) {
    root.classList.toggle('is-copied', copied);
    labelEl.textContent = copied ? 'Skopiowano kod' : 'Skopiuj kod';
    valueEl.hidden = copied;                                   // the code is hidden once it is copied
    tailEl.textContent = copied ? 'Ciesz się zniżką' : 'i ciesz się zniżką';
    statusEl.textContent = copied ? 'Kod skopiowany do schowka' : '';
  }

  copyBtn.addEventListener('click', function () {
    var code = root.getAttribute('data-code-value') || '';
    copyText(code).catch(function () { /* clipboard blocked (e.g. file:// or an iframe): the state still changes for the demo */
    }).then(function () {
      setCopied(true);
      track('code.copy', {code: code});
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(function () {
        setCopied(false);
      }, 3500);
    });
  });

  // --- Live changes ---
  root.rkPromo = {
    update: function (p) {
      p = p || {};
      if ('timer' in p) root.setAttribute('data-timer', p.timer ? 'on' : 'off');
      if ('code' in p) {
        root.setAttribute('data-code', p.code ? 'on' : 'off');
        codeBox.hidden = !p.code;
      }
      if ('text' in p) {
        root.setAttribute('data-text', p.text);
        textEl.textContent = p.text;
      }
      if ('codeValue' in p) {
        root.setAttribute('data-code-value', p.codeValue);
        valueEl.textContent = p.codeValue;
      }
      if ('end' in p) {
        root.setAttribute('data-end', p.end);
        startCountdown();
      }
      if ('timer' in p || 'end' in p) armTimer();
    }
  };

  // --- Demo options: described here, shown by preview.html (nothing is shown on a standalone page) ---
  function registerOptions() {
    if (!window.ROI || !ROI.options) {
      console.warn('[rk-promo] ROI.options is missing: the "Opcje" window needs core/preview-bridge.js in the build');
      return;
    }
    ROI.options.register({
      id: WIDGET,
      title: 'Promocja z timerem',
      base: {label: 'Standard', rbh: 0},
      fields: [
        {key: 'timer', type: 'switch', label: 'Timer', rbh: 0, value: on('timer')},
        {key: 'code', type: 'switch', label: 'Kod', rbh: 0, value: on('code')},
        {
          key: 'end',
          type: 'datetime',
          label: 'Koniec promocji',
          value: root.getAttribute('data-end')
        },
        {key: 'text', type: 'text', label: 'Tekst', value: root.getAttribute('data-text') || ''},
        {
          key: 'codeValue',
          type: 'text',
          label: 'Kod rabatowy',
          maxlength: 24,
          value: root.getAttribute('data-code-value') || ''
        }
      ],
      onChange: function (key, value) {
        var patch = {};
        patch[key] = key === 'codeValue' ? String(value).trim() : value;
        root.rkPromo.update(patch);
      }
    });
  }

  // initial state: without data-end the promotion ends in 34 days and 9 hours (a fixed date would expire sooner or later)
  if (!root.getAttribute('data-end')) root.setAttribute('data-end', toLocalInput(Date.now() + 34 * 86400000 + 9 * 3600000));
  root.rkPromo.update({
    code: on('code'),
    text: root.getAttribute('data-text') || '',
    codeValue: root.getAttribute('data-code-value') || ''
  });
  startCountdown();
  armTimer();
  registerOptions();

  // view event: once, when half of the box is visible
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) {
        return e.isIntersecting;
      })) {
        io.disconnect();
        track('promo.view', {timer: on('timer'), code: on('code')});
      }
    }, {threshold: 0.5});
    io.observe(root);
  } else track('promo.view', {timer: on('timer'), code: on('code')});
})();
