/* =====================================================================
   core/cart.js – demo basket state, one source of truth for the page
   - ordered list { productId, qty } + registry of normalized products
   - initial state: window.ROI_CART (build entry `cartItems`); nothing is saved,
     a refresh restores the initial state
   - every change: subscribers + document CustomEvent 'roi:cart-change'
     detail: { items, change: { type: 'add'|'qty'|'remove', productId, qtyBefore,
     qtyAfter, source } }
   - tracking (Synerise names) lives here, so the mock and widgets never double it:
     quantity up → product.addToCart ($quantity = the increase), down to 0 →
     product.removeFromCart, after every change → cart.status (full snapshot)
   ===================================================================== */
(() => {
  'use strict';

  const ROI = (window.ROI ??= {});
  const data = window.ROI_CART || {};
  const max = Math.max(1, Number(data.maxQty) || 10);
  const settings = {
    shippingCost: Number(data.shippingCost) || 0,
    freeShippingThreshold: data.freeShippingThreshold ?? null,
    currency: data.currency || 'PLN'
  };

  const products = new Map(); // productId -> normalized product
  let items = [];             // [{ productId, qty }] in display order
  const listeners = new Set();

  for (const raw of data.items || []) {
    const { qty, ...product } = raw;
    const id = String(product.id);
    products.set(id, product);
    const found = items.find((x) => x.productId === id);
    if (found) found.qty = Math.min(max, found.qty + (qty || 1));
    else items.push({ productId: id, qty: Math.min(max, Math.max(1, qty || 1)) });
  }

  const snapshot = () => items.map((x) => ({ ...x }));
  const qtyOf = (id) => items.find((x) => x.productId === String(id))?.qty ?? 0;
  const round2 = (n) => Math.round(n * 100) / 100;

  const totals = () => items.reduce((t, x) => {
    t.count += x.qty;
    t.subtotal = round2(t.subtotal + (products.get(x.productId)?.price || 0) * x.qty);
    return t;
  }, { count: 0, subtotal: 0 });

  // --- Tracking (context – vertical, placement, widget_type, lead – added by ROI.track) ---
  const productParams = (p, quantity) => ({
    product_id: p.id,
    $sku: p.id,
    $quantity: quantity,
    $finalUnitPrice: p.price,
    $regularUnitPrice: p.oldPrice ?? p.price,
    $currency: p.currency || settings.currency,
    $title: p.name,
    $categories: p.category ? [p.category] : [],
    $url: p.url
  });

  const trackChange = (p, before, after, extra) => {
    const track = ROI.track || (() => {});
    if (after > before) track('product.addToCart', { ...productParams(p, after - before), ...extra });
    else if (after === 0) track('product.removeFromCart', productParams(p, before));
    const t = totals();
    track('cart.status', {
      products: items.map((x) => ({
        sku: x.productId,
        quantity: x.qty,
        category: products.get(x.productId)?.category ?? null
      })),
      totalAmount: t.subtotal,
      totalQuantity: t.count,
      itemIds: items.map((x) => x.productId)
    });
  };

  /**
   * Sets the quantity of a product (clamped to 0…max; 0 removes it).
   * meta: { source: 'recommendation' | 'cart', track: {…} – extra product.addToCart fields }
   */
  const setQty = (productId, qty, meta = {}) => {
    const id = String(productId);
    const product = products.get(id);
    if (!product) return false;
    const before = qtyOf(id);
    const after = Math.max(0, Math.min(max, Math.round(Number(qty) || 0)));
    if (after === before) return false;

    if (before === 0) items.push({ productId: id, qty: after }); // new product goes last
    else if (after === 0) items = items.filter((x) => x.productId !== id);
    else items.find((x) => x.productId === id).qty = after;

    trackChange(product, before, after, meta.track);

    const change = {
      type: before === 0 ? 'add' : after === 0 ? 'remove' : 'qty',
      productId: id,
      qtyBefore: before,
      qtyAfter: after,
      source: meta.source || null
    };
    const detail = { items: snapshot(), change };
    listeners.forEach((fn) => fn(detail));
    document.dispatchEvent(new CustomEvent('roi:cart-change', { detail }));
    return true;
  };

  ROI.cart = {
    max,
    settings,
    items: snapshot,
    qty: qtyOf,
    totals,
    product: (id) => products.get(String(id)) || null,
    // +1 of a product; registers it, so products from widgets can be added
    add: (product, meta) => {
      const id = String(product.id);
      if (!products.has(id)) products.set(id, product);
      return setQty(id, qtyOf(id) + 1, meta);
    },
    setQty,
    remove: (productId, meta) => setQty(productId, 0, meta),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
})();
