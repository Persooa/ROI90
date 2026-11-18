(() => {
  'use strict';

  const ROI = (window.ROI ??= {});
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), '
    + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const instances = new WeakMap(); // element -> Popup (one instance per element)
  const stack = [];                // open popups, topmost last (only the topmost reacts to Esc / Tab)

  // --- Scroll lock (shared counter, so nested popups don't unlock each other) ---
  let locks = 0;
  let prevOverflow = '';
  const lockScroll = () => {
    if (locks++ === 0) {
      prevOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
    }
  };
  const unlockScroll = () => {
    if (locks > 0 && --locks === 0) document.documentElement.style.overflow = prevOverflow;
  };

  // --- "Show once" storage (every access can throw: private mode, blocked cookies) ---
  const getStore = (kind) => {
    try {
      return kind === 'local' ? window.localStorage : window.sessionStorage;
    } catch {
      return null;
    }
  };
  const wasSeen = ({key, storage = 'session', ttlMs = 0}) => {
    try {
      const raw = getStore(storage)?.getItem(key);
      if (!raw) return false;
      return ttlMs > 0 ? Date.now() - Number(raw) < ttlMs : true;
    } catch {
      return false;
    }
  };
  const markSeen = ({key, storage = 'session'}) => {
    try {
      getStore(storage)?.setItem(key, String(Date.now()));
    } catch { /* storage unavailable */
    }
  };

  /**
   * Accessible modal popup. Markup contract:
   *   <div class="w-popup" hidden>                     <- root: overlay
   *     <div data-popup-dialog>…</div>                 <- dialog (optional; falls back to root)
   *       <button data-popup-close>×</button>          <- any element with data-popup-close closes it
   *   </div>
   * The popup only toggles `hidden` and the `is-open` class; all visuals live in CSS.
   * A CSS transition on the root (opacity etc.) is honoured when closing.
   *
   * @param {HTMLElement|string} root – the overlay element or a selector
   * @param {object} opts
   *   openers: string | Element | Element[]   – elements that open the popup on click
   *   closeOnOverlay: boolean (default true)  – click on the backdrop closes
   *   closeOnEsc: boolean (default true)
   *   lockScroll: boolean (default true)
   *   initialFocus: string                    – selector inside the dialog (default: first focusable)
   *   trigger: { type: 'delay', ms }
   *          | { type: 'scroll', percent }
   *          | { type: 'exit' }               – exit intent, desktop only (mouse leaves through the top)
   *   once: { key, storage: 'session'|'local', ttlMs }
   *                                           – automatic triggers skip a popup already opened within ttlMs
   *   onOpen(source)                          – source: 'api' | 'opener' | 'delay' | 'scroll' | 'exit'
   *   onClose(source)                         – source: 'api' | 'button' | 'overlay' | 'esc'
   */
  function Popup(root, opts = {}) {
    const el = typeof root === 'string' ? document.querySelector(root) : root;
    if (!el) return null;
    if (instances.has(el)) return instances.get(el);

    const dialog = el.querySelector('[data-popup-dialog]') || el;
    if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
    if (!dialog.hasAttribute('aria-modal')) dialog.setAttribute('aria-modal', 'true');
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');

    const cfg = {closeOnOverlay: true, closeOnEsc: true, lockScroll: true, ...opts};
    let isOpen = false;
    let locked = false;        // this popup holds a scroll lock
    let lastFocus = null;
    let closeToken = 0;        // invalidates a pending close animation when reopened
    let armed = false;         // automatic trigger still waiting
    const cleanups = [];       // listeners to remove in destroy()

    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    };

    const focusables = () => [...dialog.querySelectorAll(FOCUSABLE)]
      .filter((node) => !node.closest('[hidden]') && node.getClientRects().length > 0);

    // --- Open / close ---
    const open = (source = 'api') => {
      if (isOpen) return;
      isOpen = true;
      closeToken++;
      lastFocus = document.activeElement;
      el.hidden = false;
      // next frame, so a CSS transition runs from the hidden state
      requestAnimationFrame(() => {
        if (isOpen) el.classList.add('is-open');
      });
      if (cfg.lockScroll) {
        lockScroll();
        locked = true;
      }
      stack.push(api);
      if (cfg.once) markSeen(cfg.once);

      const target = (cfg.initialFocus && dialog.querySelector(cfg.initialFocus)) || focusables()[0] || dialog;
      target.focus({preventScroll: true});
      cfg.onOpen?.(source);
    };

    const close = (source = 'api') => {
      if (!isOpen) return;
      isOpen = false;
      const token = ++closeToken;
      stack.splice(stack.indexOf(api), 1);
      if (locked) {
        unlockScroll();
        locked = false;
      }
      el.classList.remove('is-open');

      if (lastFocus && document.contains(lastFocus)) lastFocus.focus({preventScroll: true});
      lastFocus = null;

      const finish = () => {
        if (token === closeToken) el.hidden = true;
      };
      const ms = parseFloat(getComputedStyle(el).transitionDuration) * 1000 || 0;
      if (ms > 0 && !reducedMotion.matches) {
        el.addEventListener('transitionend', function done(e) {
          if (e.target !== el) return;
          el.removeEventListener('transitionend', done);
          finish();
        });
        setTimeout(finish, ms + 100); // fallback if transitionend never fires
      } else {
        finish();
      }
      cfg.onClose?.(source);
    };

    // --- Closing: button, backdrop, Esc ---
    listen(el, 'click', (e) => {
      if (e.target.closest('[data-popup-close]')) close('button');
    });

    // The press must also start on the backdrop, so selecting text and releasing outside doesn't close
    let pressedOnBackdrop = false;
    listen(el, 'pointerdown', (e) => {
      pressedOnBackdrop = e.target === el;
    });
    listen(el, 'click', (e) => {
      if (cfg.closeOnOverlay && e.target === el && pressedOnBackdrop) close('overlay');
      pressedOnBackdrop = false;
    });

    listen(document, 'keydown', (e) => {
      if (!isOpen || stack[stack.length - 1] !== api) return;
      if (e.key === 'Escape' && cfg.closeOnEsc) {
        e.preventDefault();
        close('esc');
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus trap
      const items = focusables();
      if (!items.length) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // --- Openers ---
    const openers = typeof cfg.openers === 'string'
      ? [...document.querySelectorAll(cfg.openers)]
      : [].concat(cfg.openers ?? []);
    openers.forEach((btn) => listen(btn, 'click', (e) => {
      if (btn.tagName === 'A') e.preventDefault();
      open('opener');
    }));

    // --- Automatic triggers ---
    const fire = (source) => {
      if (!armed || stack.length) return; // never stack an automatic popup over another
      armed = false;
      disarm();
      open(source);
    };

    let disarm = () => {
    };
    if (cfg.trigger && !(cfg.once && wasSeen(cfg.once))) {
      armed = true;
      const {type} = cfg.trigger;
      if (type === 'delay') {
        const timer = setTimeout(() => fire('delay'), cfg.trigger.ms ?? 5000);
        disarm = () => clearTimeout(timer);
      } else if (type === 'scroll') {
        const percent = cfg.trigger.percent ?? 50;
        const onScroll = () => {
          const room = document.documentElement.scrollHeight - window.innerHeight;
          const done = room <= 0 || (window.scrollY / room) * 100 >= percent;
          if (done) fire('scroll');
        };
        listen(window, 'scroll', onScroll, {passive: true});
        disarm = () => window.removeEventListener('scroll', onScroll);
      } else if (type === 'exit') {
        const onOut = (e) => {
          if (!e.relatedTarget && e.clientY <= 0) fire('exit');
        };
        listen(document, 'mouseout', onOut);
        disarm = () => document.removeEventListener('mouseout', onOut);
      }
    }

    const destroy = () => {
      armed = false;
      disarm();
      if (isOpen) close('api');
      cleanups.forEach((fn) => fn());
      cleanups.length = 0;
      instances.delete(el);
    };

    // Start closed
    el.hidden = true;
    el.classList.remove('is-open');

    const api = {
      open: () => open('api'),
      close: () => close('api'),
      toggle: () => (isOpen ? close('api') : open('api')),
      destroy,
      get isOpen() {
        return isOpen;
      },
      element: el
    };
    instances.set(el, api);
    return api;
  }

  ROI.Popup = Popup;
})();
