/* =====================================================================
   widgets/add-to-cart/widget.js
   The CTA button adds the product of the page to a demo cart and opens a mini cart drawer from the right.
   Product data: elements with data-roi-product="name|price|old-price|discount|image" (a demo product when missing).
   Drawer: ROI.Popup from core/popup.js (focus trap, Esc, overlay click, scroll lock); plain toggle as a fallback.
   Events (ROI.track, optional): add_to_cart, cart.view, cart.qty_change, cart.remove, cart.checkout_click
   ===================================================================== */
(function () {
  'use strict';

  function track(name, data) {
    try {
      if (window.ROI && typeof window.ROI.track === 'function') window.ROI.track(name, data || {});
      else if (typeof window.track === 'function') window.track(name, data || {});
    } catch (e) { /* tracking is optional */ }
  }

  function num(text) {
    var n = parseFloat(String(text || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }
  function money(n) { return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł'; }
  function field(key) { return document.querySelector('[data-roi-product="' + key + '"]'); }

  function readProduct() {
    var nameEl = field('name'), imgEl = field('image');
    var name = nameEl && nameEl.textContent.trim();
    var price = num(field('price') && field('price').textContent);
    var src = imgEl && (imgEl.getAttribute('src') || '');
    return {
      id: name || 'demo-product',
      name: name || 'Produkt demo',
      price: price != null ? price : 199,
      oldPrice: num(field('old-price') && field('old-price').textContent),
      discount: ((field('discount') && field('discount').textContent) || '').trim(),
      image: src || ''
    };
  }

  function init(root) {
    var $ = function (sel, from) { return (from || root).querySelector(sel); };
    var btn = $('[data-rk-atc-btn]'), drawer = $('[data-rk-atc-drawer]');
    if (!btn || !drawer) return;

    // Portal: a fixed drawer must not sit inside a transformed / overflow-hidden ancestor of the mock
    document.body.appendChild(drawer);

    var items = [];   // { product, qty }
    var listEl = $('[data-atc-items]', drawer), emptyEl = $('[data-atc-empty]', drawer), addedEl = $('[data-atc-added]', drawer);
    var countEl = $('[data-atc-count]', drawer), totalEl = $('[data-atc-total]', drawer), goBtn = $('[data-atc-checkout]', drawer);

    function render() {
      listEl.textContent = '';
      items.forEach(function (it, idx) {
        var p = it.product, el = document.createElement('div');
        var hasOld = p.oldPrice && p.oldPrice > p.price;
        el.className = 'rk-atc__item';
        el.innerHTML = '<div class="rk-atc__img" role="img"></div><h3 class="rk-atc__name"></h3>'
          + '<button type="button" class="rk-atc__del" data-del aria-label="Usuń produkt z koszyka">&#128465;</button>'
          + '<div class="rk-atc__sum"><span class="rk-atc__price"></span>'
          + (hasOld ? '<span class="rk-atc__old">Cena sugerowana: <s></s><b></b></span>' : '')
          + '<div class="rk-atc__qty"><button type="button" data-dec aria-label="Zmniejsz ilość">&minus;</button><output></output>'
          + '<button type="button" data-inc aria-label="Zwiększ ilość">+</button></div></div>';
        $('.rk-atc__name', el).textContent = p.name;
        var img = $('.rk-atc__img', el);
        if (p.image) img.style.backgroundImage = 'url("' + p.image.replace(/"/g, '%22') + '")';
        img.setAttribute('aria-label', p.name);
        var priceEl = $('.rk-atc__price', el);
        priceEl.textContent = money(p.price * it.qty);
        if (hasOld) {
          priceEl.classList.add('is-sale');
          $('.rk-atc__old s', el).textContent = money(p.oldPrice * it.qty);
          $('.rk-atc__old b', el).textContent = p.discount;
        }
        $('output', el).textContent = it.qty;
        $('[data-dec]', el).disabled = it.qty <= 1;
        $('[data-dec]', el).onclick = function () { it.qty--; track('cart.qty_change', { product_id: p.id, quantity: it.qty }); render(); };
        $('[data-inc]', el).onclick = function () { it.qty++; track('cart.qty_change', { product_id: p.id, quantity: it.qty }); render(); };
        $('[data-del]', el).onclick = function () { items.splice(idx, 1); track('cart.remove', { product_id: p.id }); render(); };
        listEl.appendChild(el);
      });
      countEl.textContent = items.reduce(function (n, it) { return n + it.qty; }, 0);
      totalEl.textContent = money(items.reduce(function (sum, it) { return sum + it.product.price * it.qty; }, 0));
      emptyEl.hidden = items.length > 0;
      goBtn.disabled = items.length === 0;
    }

    var popup = null;
    function ensurePopup() {
      if (popup) return popup;
      if (window.ROI && window.ROI.Popup) popup = window.ROI.Popup(drawer, { initialFocus: '[data-popup-close]' });
      else {
        drawer.addEventListener('click', function (e) {
          if (e.target === drawer || e.target.closest('[data-popup-close]')) { drawer.classList.remove('is-open'); drawer.hidden = true; }
        });
        popup = { open: function () { drawer.hidden = false; requestAnimationFrame(function () { drawer.classList.add('is-open'); }); } };
      }
      return popup;
    }

    btn.addEventListener('click', function () {
      var p = readProduct();
      var found = items.filter(function (it) { return it.product.id === p.id; })[0];
      if (found) found.qty++; else items.push({ product: p, qty: 1 });
      render();
      addedEl.hidden = false;
      track('add_to_cart', { product_id: p.id, product_name: p.name });
      ensurePopup().open();
      track('cart.view', { items: items.length });
    });
    goBtn.addEventListener('click', function () { track('cart.checkout_click', { items: items.length }); });

    render();
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-rk-atc]'), init);
})();
