/* =====================================================================
   widgets/similar/widget.js – "Similar products" widget
   Data: window.ROI_PRODUCTS (normalized by build.js; picked by the `anchor`
   product's categoryL1), window.ROI_CONFIG.
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
    const amount = `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec}`; // non-breaking space
    return `${amount} ${currency === 'PLN' ? 'zł' : currency}`;
  };

  // Toast element comes from core/page-shell.html
  const toastEl = document.getElementById('roi-toast');
  let toastTimer;
  const toast = (message) => {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2600);
  };

  // Badge key from data ("new", "Bestseller"…) → "bestseller"; text key "badgeBestseller"
  const badgeKey = (raw) => String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
  const badgeText = (key) => t(`badge${key.charAt(0).toUpperCase()}${key.slice(1)}`);

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

    // Ribbons: one per badge, stacked; badges without a text in widget.json are skipped
    const ribbons = slot('badges');
    for (const key of (p.badges || []).map(badgeKey)) {
      const text = badgeText(key);
      if (!text) continue;
      const ribbon = document.createElement('span');
      ribbon.className = `w-card__ribbon w-card__ribbon--${key}`;
      ribbon.textContent = text;
      ribbons.append(ribbon);
    }
    ribbons.hidden = !ribbons.children.length;

    if (p.category) {
      slot('category').textContent = p.category;
      slot('category').hidden = false;
    }

    const name = slot('name');
    name.textContent = p.name;
    name.title = p.name;

    const price = formatPrice(p.price, p.currency);
    const priceEl = slot('price');
    priceEl.textContent = price;
    priceEl.setAttribute('aria-label', `${t('pricePrefix')} ${price}`);
    priceEl.classList.toggle('is-sale', hasDiscount);

    // "Cena sugerowana": only on promotion – struck regular price + %
    if (hasDiscount) {
      slot('labelSuggested').textContent = t('labelSuggested');
      const s = document.createElement('s');
      s.textContent = formatPrice(p.oldPrice, p.currency);
      slot('suggested').append(s);
      if (p.discountPct > 0) {
        slot('suggestedPct').textContent = `−${p.discountPct}%`;
        slot('suggestedPct').hidden = false;
      }
      slot('rowSuggested').hidden = false;
    }

    // "Najniższa cena" (30 days, Omnibus): only when the data has it
    if (p.lowestPrice != null) {
      slot('labelLowest').textContent = t('labelLowest');
      slot('lowest').textContent = formatPrice(p.lowestPrice, p.currency);
      if (p.lowestPct > 0) {
        slot('lowestPct').textContent = `−${p.lowestPct}%`;
        slot('lowestPct').hidden = false;
      }
      slot('rowLowest').hidden = false;
    }

    const item = document.createElement('div');
    item.className = 'w-carousel__item';
    item.setAttribute('role', 'group');
    item.setAttribute('aria-roledescription', 'slajd');
    item.setAttribute('aria-label', `${index + 1} / ${products.length}`);
    item.append(card);
    return item;
  };

  // --- Init ---
  const root = document.querySelector('[data-widget="similar"]');

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
  viewport.addEventListener('click', (e) => {
    const card = e.target.closest('.w-card');
    if (!card || !e.target.closest('[data-slot="link"]')) return;
    e.preventDefault(); // demo: no navigation
    const position = Number(card.dataset.position);
    const p = products[position - 1];
    toast(t('productToast'));
    track('product_click', { product_id: p.id, position, product_url: p.url });
  });

  // widget_view – once, when at least 50% of the widget is visible
  tracker.observeOnce(root, () => {
    const index = carousel.index;
    track('widget_view', {
      product_id: products[index].id,
      position: index + 1,
      items: products.length
    });
  });
})();
