/* =====================================================================
   widgets/last-seen/widget.js – "Last seen" widget
   Data: window.ROI_PRODUCTS (normalized by build.js), window.ROI_CONFIG.
   Requires core/tracker.js and core/carousel.js – the build inserts them earlier.
   The script sits at the end of <body>, so the DOM is already ready.
   ===================================================================== */
(() => {
  'use strict';

  const { track, tracker, Carousel } = window.ROI;
  const cfg = window.ROI_CONFIG;
  const products = window.ROI_PRODUCTS;
  const texts = cfg.texts;

  // --- Helpers ---
  // Text from widget.json with {variables} substituted
  const t = (key, vars = {}) => (texts[key] ?? '').replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);

  /**
   * Price format "1 299,00 zł". Intl for pl-PL doesn't group
   * 4-digit numbers, so the number is formatted by hand.
   */
  const formatPrice = (value, currency = 'PLN') => {
    if (!Number.isFinite(value)) return '';
    const [int, dec] = value.toFixed(2).split('.');
    const amount = `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec}`; // non-breaking space
    return `${amount} ${currency === 'PLN' ? 'zł' : currency}`;
  };

  const toastEl = document.getElementById('roi-toast');
  let toastTimer;
  const toast = (message) => {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2600);
  };

  // --- Card render ---
  const template = document.getElementById('w-product-card');

  const renderCard = (p, index) => {
    const card = template.content.firstElementChild.cloneNode(true);
    const slot = (name) => card.querySelector(`[data-slot="${name}"]`);
    const media = slot('media');
    const hasDiscount = p.oldPrice != null; // build sets oldPrice only when there is a discount

    card.dataset.productId = p.id;
    card.dataset.position = index + 1;
    slot('link').href = p.url;

    // Image: missing or failed to load → empty placeholder
    const img = slot('image');
    img.alt = p.name;
    img.addEventListener('error', () => media.classList.add('is-broken'));
    if (p.image) img.src = p.image;
    else media.classList.add('is-broken');

    const name = slot('name');
    name.textContent = p.name;
    name.title = p.name;

    const price = formatPrice(p.price, p.currency);
    slot('price').textContent = price;
    slot('price').setAttribute('aria-label', `${t('pricePrefix')} ${price}`);

    if (hasDiscount) {
      const old = formatPrice(p.oldPrice, p.currency);
      const oldEl = slot('oldPrice');
      oldEl.textContent = old;
      oldEl.setAttribute('aria-label', `${t('oldPricePrefix')} ${old}`);
      oldEl.hidden = false;
    }

    // Badge: discount first, then new / bestseller
    const badge = slot('badge');
    if (hasDiscount && p.discountPct > 0) {
      badge.textContent = `−${p.discountPct}%`;
      badge.classList.add('w-card__badge--sale');
      badge.hidden = false;
    } else if (p.badge === 'new' || p.badge === 'bestseller') {
      badge.textContent = t(p.badge === 'new' ? 'badgeNew' : 'badgeBestseller');
      badge.classList.add(`w-card__badge--${p.badge}`);
      badge.hidden = false;
    }

    slot('wish').setAttribute('aria-label', t('wishAdd', { name: p.name }));

    const item = document.createElement('div');
    item.className = 'w-carousel__item';
    item.setAttribute('role', 'group');
    item.setAttribute('aria-roledescription', 'slajd');
    item.setAttribute('aria-label', `${index + 1} / ${products.length}`);
    item.append(card);
    return item;
  };

  // --- Init ---
  const root = document.querySelector('[data-widget="last-seen"]');

  tracker.setContext({
    vertical: cfg.vertical,
    placement: cfg.placement,
    widget_type: cfg.widgetType
  });
  track('page_open', { page_url: window.location.href.split('#')[0] });

  if (!products.length) {
    root.hidden = true; // no data = no frame
    return;
  }

  const viewport = root.querySelector('[data-carousel-viewport]');
  viewport.append(...products.map(renderCard));

  const EVENT_BY_SOURCE = {
    next: 'carousel_next',
    prev: 'carousel_prev',
    swipe: 'carousel_swipe',
    dot: 'carousel_dot',
    autoplay: 'carousel_autoplay'
  };

  const carousel = Carousel(root.querySelector('[data-carousel]'), {
    step: cfg.step,
    autoplay: cfg.autoplay,
    autoplayMs: cfg.autoplayMs,
    labels: { dot: (i, n) => t('dot', { i: i + 1, n }) },
    onChange: (index, source) => {
      track(EVENT_BY_SOURCE[source], { product_id: products[index].id, position: index + 1 });
    }
  });

  // Click delegation – clicks on clones are forwarded by carousel.js
  const wishlist = new Set();
  viewport.addEventListener('click', (e) => {
    const card = e.target.closest('.w-card');
    if (!card) return;
    const id = card.dataset.productId;
    const position = Number(card.dataset.position);
    const p = products[position - 1];

    if (e.target.closest('[data-slot="wish"]')) {
      e.preventDefault();
      const on = !wishlist.has(id);
      if (on) wishlist.add(id);
      else wishlist.delete(id);
      // sync the original and its clones
      viewport.querySelectorAll(`.w-card[data-product-id="${id}"] [data-slot="wish"]`).forEach((btn) => {
        btn.setAttribute('aria-pressed', String(on));
        btn.setAttribute('aria-label', t(on ? 'wishRemove' : 'wishAdd', { name: p.name }));
      });
      toast(t(on ? 'wishAdded' : 'wishRemoved'));
      track('wishlist_click', { product_id: id, position, state: on ? 'added' : 'removed' });
      return;
    }

    if (e.target.closest('[data-slot="link"]')) {
      e.preventDefault(); // demo: no navigation
      toast(t('productToast'));
      track('product_click', { product_id: id, position, product_url: p.url });
    }
  });

  // widget_view – once, when at least 50% of the widget is visible
  tracker.observeOnce(root, () => {
    const index = carousel.index;
    track('widget_view', { product_id: products[index].id, position: index + 1, items: products.length });
  });
})();
