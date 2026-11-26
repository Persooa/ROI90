/*
  Slide widget: a fixed tab on the screen edge (vertically centred), collapsed by default; it opens a newsletter panel.

  Configuration: data attributes on [data-rk-slide] (see widget.html)
    data-side="right" | "left"      screen edge
    data-name="on" | "off"          the "Imię" field
    data-auto-open="on" | "off"     open by itself after data-delay seconds (once)
    data-delay="5"                  seconds for the auto-open
    data-exit-intent="on" | "off"   open when the mouse leaves through the top of the window (once, desktop)
    data-title, data-tab-text, data-code   texts (title of the panel, vertical label, discount code shown after signing up)
    data-demo="on" | "off"          demo behaviour: dismissing is not remembered (the preview "Resetuj" brings the widget back)
  Options are registered in ROI.options and shown in preview.html ("Opcje"); they are also read from the URL.
  Events (ROI.track): show {trigger}, close {action: collapse | dismiss, source}, newsletter.subscribe
*/
(function () {
  var root = document.querySelector('[data-rk-slide]');
  if (!root) return;

  var KEY_DISMISSED = 'rk_sl_dismissed';
  var WIDGET = 'slide-newsletter';
  var $ = function (sel) {
    return root.querySelector(sel);
  };
  var toggle = $('[data-sl-toggle]'), closeBtn = $('[data-sl-close]'),
    dismissBtn = $('[data-sl-dismiss]'), panel = $('.rk-sl__panel');
  var tabText = $('[data-sl-tab-text]'), titleEl = $('[data-sl-title]'),
    nameInput = $('[data-sl-name]');
  var form = $('form'), email = $('input[type="email"]'), consent = $('input[type="checkbox"]'),
    error = $('.rk-sl__error');
  var viewForm = $('[data-sl-view="form"]'), viewDone = $('[data-sl-view="done"]');
  var codeEl = $('[data-sl-code]'), sentTo = $('[data-sl-sent-to]');
  var demo = root.getAttribute('data-demo') === 'on';
  var autoTimer = null, exitBound = false, autoDone = false, exitDone = false;

  function track(name, data) {
    data = Object.assign({widget: WIDGET}, data || {});
    if (window.ROI && typeof window.ROI.track === 'function') window.ROI.track(name, data);
    else if (typeof window.track === 'function') window.track(name, data);
    else console.log('[rk-slide]', name, data);
  }

  function read(k) {
    try {
      return sessionStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }

  function write(k, v) {
    try {
      sessionStorage.setItem(k, v);
    } catch (e) {
    }
  }

  function on(name) {
    return root.getAttribute('data-' + name) === 'on';
  }

  function isOpen() {
    return root.getAttribute('data-open') === 'on';
  }

  // --- Open / close ---
  function setOpen(open, meta) {
    if (open === isOpen()) return;
    root.setAttribute('data-open', open ? 'on' : 'off');
    toggle.setAttribute('aria-expanded', String(open));
    if (open) panel.removeAttribute('inert'); else panel.setAttribute('inert', '');
    meta = meta || {};
    if (open) {
      track('show', {trigger: meta.trigger || 'click'});
      // focus after the slide-in started (the panel was not focusable before)
      setTimeout(function () {
        var first = (!nameInput.hidden && nameInput) || email;
        if (first && isOpen() && !viewForm.hidden) first.focus();
      }, 320);
    } else {
      track('close', {action: 'collapse', source: meta.source || 'button'});
      if (meta.refocus) toggle.focus();
    }
  }

  toggle.addEventListener('click', function () {
    setOpen(!isOpen(), {trigger: 'click', source: 'tab', refocus: false});
  });
  closeBtn.addEventListener('click', function () {
    setOpen(false, {source: 'x', refocus: true});
  });
  root.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) setOpen(false, {source: 'esc', refocus: true});
  });

  // Dismiss the whole widget (only from the collapsed tab)
  dismissBtn.addEventListener('click', function () {
    root.hidden = true;
    if (!demo) write(KEY_DISMISSED, '1');
    track('close', {action: 'dismiss', source: 'x'});
  });
  if (!demo && read(KEY_DISMISSED) === '1') root.hidden = true;

  // --- Sign-up form ---
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var value = email.value.trim(), name = nameInput.value.trim();
    if (on('name') && !name) {
      error.textContent = 'Podaj imię.';
      nameInput.focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      error.textContent = 'Podaj poprawny adres e-mail.';
      email.focus();
      return;
    }
    if (!consent.checked) {
      error.textContent = 'Zaznacz zgodę, aby odebrać rabat.';
      return;
    }
    error.textContent = '';
    sentTo.textContent = value;
    viewForm.hidden = true;
    viewDone.hidden = false;
    track('newsletter.subscribe', {email: value, name: on('name') ? name : null, source: 'slide'});
  });
  // The privacy link is a demo link: it must not scroll the page to the top
  var privacy = $('[data-sl-privacy]');
  if (privacy) privacy.addEventListener('click', function (e) {
    e.preventDefault();
  });

  // --- Auto-open and exit intent (each fires once, only while the panel is closed) ---
  function armAuto() {
    clearTimeout(autoTimer);
    if (!on('auto-open') || autoDone) return;
    var sec = Math.max(0, parseFloat(root.getAttribute('data-delay')) || 0);
    autoTimer = setTimeout(function () {
      autoDone = true;
      if (!isOpen() && !root.hidden) setOpen(true, {trigger: 'auto'});
    }, sec * 1000);
  }

  function onMouseOut(e) {
    if (!on('exit-intent') || exitDone || e.relatedTarget || e.clientY > 0) return;
    exitDone = true;
    if (!isOpen() && !root.hidden) setOpen(true, {trigger: 'exit_intent'});
  }

  function armExit() {
    if (on('exit-intent') && !exitBound) {
      document.addEventListener('mouseout', onMouseOut);
      exitBound = true;
    }
    if (!on('exit-intent') && exitBound) {
      document.removeEventListener('mouseout', onMouseOut);
      exitBound = false;
    }
  }

  // --- Live changes ---
  root.rkSlide = {
    update: function (p) {
      p = p || {};
      if ('name' in p) {
        root.setAttribute('data-name', p.name ? 'on' : 'off');
        nameInput.hidden = !p.name;
      }
      if ('left' in p) root.setAttribute('data-side', p.left ? 'left' : 'right');
      if ('tabText' in p) {
        root.setAttribute('data-tab-text', p.tabText);
        tabText.textContent = p.tabText;
      }
      if ('title' in p) {
        root.setAttribute('data-title', p.title);
        titleEl.textContent = p.title;
      }
      if ('code' in p) {
        root.setAttribute('data-code', p.code);
        codeEl.textContent = p.code;
      }
      if ('delay' in p) root.setAttribute('data-delay', String(p.delay));
      if ('autoOpen' in p) {
        root.setAttribute('data-auto-open', p.autoOpen ? 'on' : 'off');
        autoDone = false;
      }
      if ('exitIntent' in p) {
        root.setAttribute('data-exit-intent', p.exitIntent ? 'on' : 'off');
        exitDone = false;
      }
      if ('autoOpen' in p || 'delay' in p) armAuto();
      if ('exitIntent' in p) armExit();
    }
  };

  // --- Demo options: described here, shown by preview.html (nothing is shown on a standalone page) ---
  function registerOptions() {
    if (!window.ROI || !ROI.options) {
      console.warn('[rk-slide] ROI.options is missing: the "Opcje" window needs core/preview-bridge.js in the build');
      return;
    }
    var keyMap = {autoOpen: 'autoOpen', exitIntent: 'exitIntent'};
    ROI.options.register({
      id: WIDGET,
      title: 'Slide widget',
      base: {label: 'Standard', rbh: 0},   // placeholder values: set the real RBH per option
      fields: [
        {key: 'name', type: 'switch', label: 'Pole „Imię”', rbh: 0, value: on('name')},
        {key: 'autoOpen', type: 'switch', label: 'Auto-otwarcie', rbh: 0, value: on('auto-open')},
        {
          key: 'delay',
          type: 'number',
          label: 'Opóźnienie (s)',
          min: 0,
          max: 120,
          value: parseFloat(root.getAttribute('data-delay')) || 0
        },
        {key: 'exitIntent', type: 'switch', label: 'Exit intent', rbh: 0, value: on('exit-intent')},
        {
          key: 'left',
          type: 'switch',
          label: 'Po lewej stronie',
          rbh: 0,
          value: root.getAttribute('data-side') === 'left'
        },
        {
          key: 'tabText',
          type: 'text',
          label: 'Tekst zakładki',
          value: root.getAttribute('data-tab-text') || ''
        },
        {
          key: 'title',
          type: 'text',
          label: 'Tytuł panelu',
          value: root.getAttribute('data-title') || ''
        },
        {
          key: 'code',
          type: 'text',
          label: 'Kod rabatowy',
          maxlength: 24,
          value: root.getAttribute('data-code') || ''
        }
      ],
      onChange: function (key, value) {
        var patch = {};
        patch[keyMap[key] || key] = key === 'code' ? String(value).trim() : value;
        root.rkSlide.update(patch);
      }
    });
  }

  // initial state from the attributes
  root.rkSlide.update({
    name: on('name'),
    tabText: root.getAttribute('data-tab-text'),
    title: root.getAttribute('data-title'),
    code: root.getAttribute('data-code')
  });
  registerOptions();
  armAuto();
  armExit();
})();
