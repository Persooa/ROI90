/* =====================================================================
   core/carousel.js – infinite-loop carousel
   - native scroll + scroll-snap (gives native swipe on mobile)
   - loop: clones of the full list before and after the originals,
     silent jump back to the originals once scrolling settles
   - arrows, dash pagination, optional autoplay
   - no tracking inside – reports changes through callbacks

   Required markup:
     .w-carousel > .w-carousel__viewport > .w-carousel__item*
     [data-carousel-prev] [data-carousel-next] [data-carousel-dots]
   ===================================================================== */
(() => {
  'use strict';

  const ROI = (window.ROI ??= {});
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const FOCUSABLE = 'a[href], button';

  /**
   * @param {HTMLElement} root – the .w-carousel element
   * @param {object} opts
   *   step: 'card' | 'page'     – how far an arrow moves
   *   autoplay: boolean, autoplayMs: number
   *   labels: { dot: fn(i, n) } – aria-labels for the dashes
   *   onChange(index, source)   – source: 'next' | 'prev' | 'swipe' | 'dot' | 'autoplay'
   */
  function Carousel(root, opts = {}) {
    const viewport = root.querySelector('.w-carousel__viewport');
    const prevBtn = root.querySelector('[data-carousel-prev]');
    const nextBtn = root.querySelector('[data-carousel-next]');
    const dotsEl = root.parentNode.querySelector('[data-carousel-dots]');
    const originals = [...viewport.querySelectorAll('.w-carousel__item')];
    const n = originals.length;
    if (!n) return null;

    const loop = n > 1;
    let current = 0;
    let pendingTarget = null;   // target of the scroll in progress
    let programmatic = null;    // source of a code-driven move
    let userScrolling = false;
    let lastSettledIndex = 0;
    let paused = false;

    // --- Loop clones ---
    // inert: clone can't take focus, is skipped by Tab and hidden from screen readers;
    // mouse clicks on clones are forwarded to the originals (see below)
    const makeClone = (el, i) => {
      const clone = el.cloneNode(true);
      clone.inert = true;
      clone.dataset.clone = '';
      clone.dataset.loopIndex = i;
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id')); // no duplicate ids
      return clone;
    };
    originals.forEach((el, i) => { el.dataset.loopIndex = i; });
    if (loop) {
      viewport.prepend(...originals.map(makeClone));
      viewport.append(...originals.map(makeClone));
    }
    const items = [...viewport.querySelectorAll('.w-carousel__item')];
    const offset = loop ? n : 0; // index of the first original

    // --- Geometry ---
    const posOf = (abs) => items[abs].offsetLeft - items[0].offsetLeft;
    const stepPx = () => (items.length > 1 ? posOf(1) : viewport.clientWidth);
    const perView = () => Math.max(1, Math.floor((viewport.clientWidth + 1) / stepPx()));
    const absIndexNow = () => Math.round(viewport.scrollLeft / stepPx());
    const logical = (abs) => (((abs - offset) % n) + n) % n;

    const scrollToAbs = (abs, smooth) => {
      const target = Math.max(0, Math.min(items.length - 1, abs));
      viewport.scrollTo({ left: posOf(target), behavior: smooth && !reducedMotion.matches ? 'smooth' : 'auto' });
      return target;
    };

    // Instant jump with snapping temporarily disabled
    const jumpTo = (abs) => {
      viewport.style.scrollSnapType = 'none';
      viewport.scrollLeft = posOf(abs);
      // restore snapping on the next frame
      requestAnimationFrame(() => { viewport.style.scrollSnapType = ''; });
    };

    // --- Focus ---
    const fullyVisible = (el) => {
      const r = el.getBoundingClientRect();
      const v = viewport.getBoundingClientRect();
      return r.left >= v.left - 1 && r.right <= v.right + 1;
    };

    // Move focus to the same element (link / heart) in real card `idx`
    const focusInCard = (idx, previous) => {
      const item = originals[idx];
      const slot = previous.dataset?.slot;
      const target = (slot && item.querySelector(`[data-slot="${slot}"]`)) || item.querySelector(FOCUSABLE);
      if (target && target !== previous) target.focus({ preventScroll: true });
    };

    // Silent jump from the clones back to the originals
    const normalize = () => {
      if (!loop) return;
      const abs = absIndexNow();
      if (abs >= offset && abs < offset + n) return;
      const idx = logical(abs);
      const active = document.activeElement;
      jumpTo(offset + idx);
      // Focus was inside and its card is now out of view → move it to the real card
      const activeItem = active !== viewport && viewport.contains(active) ? active.closest('.w-carousel__item') : null;
      if (activeItem && !fullyVisible(activeItem)) focusInCard(idx, active);
    };

    // --- Click on a clone → same element in the original ---
    // Clones are inert, so the event targets the viewport; find the clone under the pointer by geometry.
    const containsPoint = (el, x, y) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };

    const originalAtPoint = (x, y) => {
      const clone = [...viewport.querySelectorAll('[data-clone]')].find((c) => containsPoint(c, x, y));
      if (!clone) return null;
      // child-index path to the deepest element under the pointer; a later sibling is on top
      const path = [];
      let node = clone;
      for (;;) {
        const children = [...node.children];
        const i = children.findLastIndex((child) => containsPoint(child, x, y));
        if (i < 0) break;
        path.push(i);
        node = children[i];
      }
      return path.reduce((el, i) => el?.children[i], originals[clone.dataset.loopIndex]) ?? null;
    };

    const interactiveAt = (x, y) => originalAtPoint(x, y)?.closest(FOCUSABLE) ?? null;

    if (loop) {
      viewport.addEventListener('click', (e) => {
        if (e.target !== viewport) return; // click on a real card – handled by the widget
        interactiveAt(e.clientX, e.clientY)?.click(); // same handler as on the original
      });

      // pointer cursor over clickable elements of clones
      let cursorRaf = 0;
      viewport.addEventListener('mousemove', (e) => {
        if (cursorRaf) return;
        const { clientX: x, clientY: y } = e;
        const onViewport = e.target === viewport;
        cursorRaf = requestAnimationFrame(() => {
          cursorRaf = 0;
          viewport.style.cursor = onViewport && interactiveAt(x, y) ? 'pointer' : '';
        });
      });
    }

    // --- Dash pagination ---
    const dots = originals.map((_, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-dots__btn';
      btn.dataset.index = i;
      btn.setAttribute('aria-label', opts.labels?.dot?.(i, n) ?? String(i + 1));
      return btn;
    });
    if (dotsEl) {
      dotsEl.replaceChildren(...dots.map((btn) => {
        const li = document.createElement('li');
        li.append(btn);
        return li;
      }));
      dotsEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.w-dots__btn');
        if (btn) goTo(Number(btn.dataset.index), 'dot');
      });
    }

    const setCurrent = (idx) => {
      current = idx;
      dots.forEach((btn, i) => btn.setAttribute('aria-current', String(i === idx)));
    };

    // --- Navigation ---
    const move = (dir, source) => {
      const step = opts.step === 'page' ? perView() : 1;
      let target = (pendingTarget ?? absIndexNow()) + dir * step;
      if (!loop) target = Math.max(0, Math.min(n - 1, target));
      // stay within the clones on rapid clicks
      if (target < 0 || target > items.length - perView()) return;
      programmatic = source;
      pendingTarget = scrollToAbs(target, true);
      setCurrent(logical(pendingTarget));
      opts.onChange?.(current, source);
    };

    const goTo = (idx, source) => {
      const target = offset + idx;
      // already there – no scrollend would fire
      if (idx === current && Math.abs(posOf(target) - viewport.scrollLeft) < 2) return;
      programmatic = source;
      pendingTarget = scrollToAbs(target, true);
      setCurrent(idx);
      opts.onChange?.(current, source);
    };

    prevBtn?.addEventListener('click', () => move(-1, 'prev'));
    nextBtn?.addEventListener('click', () => move(1, 'next'));

    // Keyboard: ←/→; when a card has focus, focus follows the current card
    viewport.addEventListener('keydown', (e) => {
      const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      move(dir, dir > 0 ? 'next' : 'prev');
      if (e.target !== viewport) focusInCard(current, e.target);
    });

    // --- Swipe detection ---
    const markUser = () => { userScrolling = true; };
    for (const type of ['touchstart', 'pointerdown', 'wheel']) {
      viewport.addEventListener(type, markUser, { passive: true });
    }

    const onSettled = () => {
      normalize();
      const idx = logical(absIndexNow());
      const wasUser = userScrolling && !programmatic;
      pendingTarget = null;
      programmatic = null;
      userScrolling = false;
      if (idx !== current) setCurrent(idx);
      if (wasUser && idx !== lastSettledIndex) opts.onChange?.(idx, 'swipe');
      lastSettledIndex = idx;
    };

    // scrollend; debounce fallback for Safari < 26, which doesn't support it
    const hasScrollEnd = 'onscrollend' in window;
    let settleTimer;
    if (hasScrollEnd) viewport.addEventListener('scrollend', onSettled);
    viewport.addEventListener('scroll', () => {
      if (!programmatic) {
        const idx = logical(absIndexNow());
        if (idx !== current) setCurrent(idx); // dashes follow the finger
      }
      if (!hasScrollEnd) {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(onSettled, 140);
      }
    }, { passive: true });

    // --- Resize: keep position ---
    let lastWidth = 0;
    new ResizeObserver(() => {
      if (viewport.clientWidth === lastWidth) return;
      lastWidth = viewport.clientWidth;
      jumpTo(offset + current);
    }).observe(viewport);

    // --- Autoplay (off by default) ---
    const pause = () => { paused = true; };
    const resume = () => { paused = false; };
    root.addEventListener('mouseenter', pause);
    root.addEventListener('mouseleave', resume);
    root.addEventListener('focusin', pause);
    root.addEventListener('focusout', resume);
    viewport.addEventListener('touchstart', pause, { passive: true });
    viewport.addEventListener('touchend', resume, { passive: true });

    if (opts.autoplay && !reducedMotion.matches) {
      setInterval(() => {
        if (!paused && !document.hidden) move(1, 'autoplay');
      }, Math.max(2000, opts.autoplayMs || 5000));
    }

    // Start at the first original
    jumpTo(offset);
    setCurrent(0);

    return {
      next: () => move(1, 'next'),
      prev: () => move(-1, 'prev'),
      goTo: (i) => goTo(i, 'dot'),
      get index() { return current; },
      perView
    };
  }

  ROI.Carousel = Carousel;
})();
