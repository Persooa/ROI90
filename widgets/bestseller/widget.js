/* =====================================================================
   widgets/bestseller/widget.js – "Bestsellery" (category tabs)
   Data: window.ROI_PRODUCTS (normalized by build.js – the build entry's `pick`, already in
   bestseller order), window.ROI_CONFIG. Ranking and tabs live here, not in the build:
   - ranking: badge "bestseller" first, then reviewCount desc, then rating desc, then the
     incoming order (stable sort). normalizeProduct() passes only `badges`, so in practice
     it is: bestsellers first, in `pick` order.
   - tabs: "Wszystkie" + texts.tabs [{ key: categoryL1, label, categories: [categoryL2…] }]
     (normalized products carry only `category` = categoryL2), texts.perTab products each.
   Switching a tab renders a fresh panel and a new Carousel, which starts on the first card
   without reporting a carousel event.
   Cards have no basket controls – a click anywhere on the card is a product click.
   Requires core/tracker.js and core/carousel.js – the build inserts them earlier.
   The script sits at the end of <body>, so the DOM is already ready.
   ===================================================================== */
(() => {
  'use strict';

  const { track, tracker, Carousel } = window.ROI;
  const cfg = window.ROI_CONFIG;
  const products = window.ROI_PRODUCTS;
  const texts = cfg.texts;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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

  // Badge key from data ("new", "Bestseller"…) → "bestseller"; text key "badgeBestseller".
  // widget.json has no badgeBestseller text: in a bestseller frame that ribbon says nothing new.
  const badgeKey = (raw) => String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
  const badgeText = (key) => t(`badge${key.charAt(0).toUpperCase()}${key.slice(1)}`);

  // --- Ranking + tabs ---
  const PER_TAB = Math.max(1, Number(texts.perTab) || 8);
  const isBestseller = (p) => (p.badges || []).some((b) => badgeKey(b) === 'bestseller');
  const score = (p, key) => Number(p[key]) || 0; // fields the data may not pass → 0, order kept
  const ranked = [...products].sort((a, b) => isBestseller(b) - isBestseller(a)
    || score(b, 'reviewCount') - score(a, 'reviewCount')
    || score(b, 'rating') - score(a, 'rating'));

  const tabs = [
    { key: 'all', label: t('tabAll'), items: ranked.slice(0, PER_TAB) },
    ...(Array.isArray(texts.tabs) ? texts.tabs : []).map((tab) => {
      const categories = new Set(tab.categories || [tab.key]);
      return {
        key: tab.key, // raw categoryL1 – sent as `tab` in the events
        label: tab.label || tab.key,
        items: ranked.filter((p) => categories.has(p.category)).slice(0, PER_TAB)
      };
    })
  ].filter((tab) => tab.items.length);

  // --- Card render ---
  const template = document.getElementById('w-product-card');

  // index = position in the tab (0-based), total = number of cards in the tab
  const renderCard = (p, index, total) => {
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
    item.setAttribute('aria-label', `${index + 1} / ${total}`);
    item.append(card);
    return item;
  };

  // --- Init ---
  const root = document.querySelector('[data-widget="bestseller"]');

  tracker.setContext({
    vertical: cfg.vertical,
    placement: cfg.placement,
    widget_type: cfg.widgetType
  });
  track('page_open', { page_url: window.location.href.split('#')[0] });

  if (!tabs.length) {
    root.hidden = true; // no data = no frame
    return;
  }

  const tabsEl = root.querySelector('[data-tabs]');
  const panelsEl = root.querySelector('[data-panels]');
  const panelTemplate = root.querySelector('[data-panel-template]');
  const panelId = `${root.id}-panel`;
  const tabId = (i) => `${root.id}-tab-${i}`;
  tabsEl.setAttribute('aria-label', t('tabsLabel'));
  tabsEl.hidden = tabs.length < 2;

  const EVENT_BY_SOURCE = {
    next: 'carousel_next',
    prev: 'carousel_prev',
    swipe: 'carousel_swipe',
    dot: 'carousel_dot',
    autoplay: 'carousel_autoplay'
  };

  const buttons = tabs.map((tab, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'w-tab';
    btn.id = tabId(i);
    btn.textContent = tab.label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', panelId);
    btn.setAttribute('aria-selected', String(i === 0));
    btn.tabIndex = i === 0 ? 0 : -1;
    tabsEl.append(btn);
    return btn;
  });

  /**
   * Panel of tab `i`: a fresh clone of the panel template with its cards and a new Carousel
   * (it starts on the first card and reports nothing). The old panel is removed with its
   * carousel; its callbacks are ignored from then on (`current` check).
   */
  let active = 0;
  let current = null; // { tab, carousel }
  const renderPanel = (i) => {
    const tab = tabs[i];
    const panel = panelTemplate.content.firstElementChild.cloneNode(true);
    panel.id = panelId;
    panel.dataset.tab = tab.key;
    panel.setAttribute('aria-labelledby', tabId(i));
    const viewport = panel.querySelector('[data-carousel-viewport]');
    viewport.setAttribute('aria-label', t('carouselLabel', { tab: tab.label }));
    viewport.append(...tab.items.map((p, index) => renderCard(p, index, tab.items.length)));
    panelsEl.replaceChildren(panel);

    const view = { tab, carousel: null };
    view.carousel = Carousel(panel.querySelector('[data-carousel]'), {
      step: cfg.step,
      autoplay: cfg.autoplay,
      autoplayMs: cfg.autoplayMs,
      labels: { dot: (n, total) => t('dot', { i: n + 1, n: total }) },
      onChange: (index, source) => {
        if (current !== view) return; // a removed panel
        track(EVENT_BY_SOURCE[source], { product_id: tab.items[index].id, position: index + 1, tab: tab.key });
      }
    });
    current = view;
  };

  // --- Tabs ---
  // Keep the active tab visible in the horizontally scrolled list (mobile)
  const revealTab = (btn) => {
    const b = btn.getBoundingClientRect();
    const c = tabsEl.getBoundingClientRect();
    const behavior = reducedMotion.matches ? 'auto' : 'smooth';
    if (b.left < c.left) tabsEl.scrollBy({ left: b.left - c.left - 8, behavior });
    else if (b.right > c.right) tabsEl.scrollBy({ left: b.right - c.right + 8, behavior });
  };

  const selectTab = (i, focus) => {
    if (focus) buttons[i].focus();
    revealTab(buttons[i]);
    if (i === active) return;
    buttons.forEach((btn, j) => {
      btn.setAttribute('aria-selected', String(j === i));
      btn.tabIndex = j === i ? 0 : -1;
    });
    active = i;
    renderPanel(i);
    track('bestseller.tabChange', { tab: tabs[i].key, campaignId: cfg.campaignId });
  };

  tabsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[role="tab"]');
    if (btn) selectTab(buttons.indexOf(btn), false);
  });

  // Keyboard: ←/→ (wrapping), Home/End; automatic activation
  tabsEl.addEventListener('keydown', (e) => {
    const last = buttons.length - 1;
    const target = {
      ArrowRight: active === last ? 0 : active + 1,
      ArrowLeft: active === 0 ? last : active - 1,
      Home: 0,
      End: last
    }[e.key];
    if (target == null) return;
    e.preventDefault();
    selectTab(target, true);
  });

  renderPanel(0);

  // --- Product click ---
  const byId = new Map(products.map((p) => [p.id, p]));

  // Click delegation on the panel container (survives panel swaps); clone clicks are
  // forwarded by carousel.js
  panelsEl.addEventListener('click', (e) => {
    const link = e.target.closest('[data-slot="link"]');
    if (!link) return;
    e.preventDefault(); // demo: no navigation
    const card = link.closest('.w-card');
    const id = card.dataset.productId;
    toast(t('productToast'));
    track('product_click', {
      product_id: id,
      position: Number(card.dataset.position),
      tab: current.tab.key,
      product_url: byId.get(id).url
    });
  });

  // widget_view – once, when at least 50% of the widget is visible
  tracker.observeOnce(root, () => {
    const index = current.carousel.index;
    track('widget_view', {
      product_id: current.tab.items[index].id,
      position: index + 1,
      items: current.tab.items.length,
      tab: current.tab.key
    });
  });
})();
