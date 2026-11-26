#!/usr/bin/env node
/* =====================================================================
   build.js – builds standalone HTML files into dist/
   No dependencies. Node >= 18.

   Loop: placements/*\/config.json → builds[] → dist/{vertical}/{placement}__{widget}.html
   (each build entry = one output file)

   Usage:
     node build.js                 – build
     node build.js --serve         – build + local server on port 5173
     node build.js --serve --watch – + rebuild on file change
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const args = process.argv.slice(2);
const PORT = Number((args.find((a) => a.startsWith('--port=')) || '').split('=')[1]) || 5173;

// --- Helpers ----------------------------------------------------------
const p = (...parts) => path.join(ROOT, ...parts);
const read = (file) => fs.readFileSync(file, 'utf8');
const readOptional = (file) => (fs.existsSync(file) ? read(file) : '');
const isAbsoluteUrl = (s) => /^(https?:)?\/\//i.test(s);

function readJson(file) {
  const txt = readOptional(file).trim();
  if (!txt) return null; // empty file = no config
  return JSON.parse(txt);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// JSON safe to embed inside <script>
function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Single-pass {{key}} replacement – inserted content is not re-scanned.
 */
function fill(template, vars, where, opts = {}) {
  // A placeholder inside an HTML comment would break the page
  for (const c of template.match(/<!--[\s\S]*?-->/g) || []) {
    if (/\{\{\w+\}\}/.test(c)) throw new Error(`placeholder {{…}} w komentarzu HTML w ${where} (placeholder inside HTML comment)`);
  }
  const used = new Set();
  const result = template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    used.add(key);
    if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key];
    console.warn(`  ! brak wartości dla {{${key}}} w ${where} (missing value)`);
    return '';
  });
  // A value with no placeholder usually means the template was broken (e.g. by a formatter)
  for (const key of Object.keys(vars)) {
    if (!used.has(key) && !opts.ignoreUnused) console.warn(`  ! brak placeholdera {{${key}}} w ${where} – wartość nie została wstawiona (placeholder missing)`);
  }
  return result;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // skip dotfiles such as .gitkeep
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) count += copyDir(from, to);
    else { fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(from, to); count++; }
  }
  return count;
}

// --- Index + preview pages ----------------------------------------------
// Files from core/ copied next to dist/index.html (preview) and dist/list.html (styles, logo, preview script)
const SITE_ASSETS = ['index.css', 'logo.svg', 'preview.css', 'preview.js'];

// Readable vertical names for the index page; unknown verticals fall back to their slug
const VERTICAL_LABELS = { home: 'Home', fashion: 'Fashion', beauty: 'Beauty', electronics: 'Elektronika' };

// "Home · Karta produktu": vertical name + placement label (config.json "label", else its slug)
function describeBuild(r) {
  return `${VERTICAL_LABELS[r.vertical] || r.vertical} · ${r.placementLabel || r.placement}`;
}

// Injects `value` into the {{ key }} placeholder of core/<name> and writes the result to dist/<outName> (default: the same name).
// Only data is injected; all markup, styling and behaviour live in core/.
function renderTemplate(name, key, value, outName = name) {
  const tplFile = p('core', name);
  if (!fs.existsSync(tplFile)) throw new Error(`brak szablonu core/${name} (template missing)`);
  const tpl = read(tplFile);

  const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`);
  if (!placeholder.test(tpl)) throw new Error(`core/${name} nie zawiera znacznika {{ ${key} }} (placeholder missing)`);

  // Replacer function, so "$" characters in the value are never treated as patterns
  fs.writeFileSync(path.join(DIST, outName), tpl.replace(placeholder, () => value));
}

// dist/list.html: list of links to all built pages (template core/index.html)
function renderIndex(results) {
  const list = results
    .map((r) => `<li><a href="${escapeHtml(r.file)}">${escapeHtml(r.title)}</a> <small>${escapeHtml(describeBuild(r))}</small></li>`)
    .join('\n      ');
  renderTemplate('index.html', 'list', list, 'list.html');
}

// dist/index.html = the preview (template core/preview.html): opens list.html first and follows links from there;
// it gets the page list as JSON (titles, and the theme switcher moves between verticals)
function renderPreview(results) {
  const pages = results.map((r) => ({ file: r.file, title: r.title, vertical: r.vertical, placement: r.placement, widget: r.widget }));
  renderTemplate('preview.html', 'pagesJson', scriptJson(pages), 'index.html');
}

function copySiteAssets() {
  for (const name of SITE_ASSETS) {
    const src = p('core', name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, name));
    else console.warn(`- core/${name}: brak pliku, pomijam (missing, skipped)`);
  }
}

// --- Product data -----------------------------------------------------
const catalogCache = new Map();
function loadCatalog(vertical) {
  if (!catalogCache.has(vertical)) {
    const data = readJson(p('data', vertical, 'products.json'));
    const list = Array.isArray(data) ? data : (data && Array.isArray(data.products) ? data.products : []);
    catalogCache.set(vertical, list);
  }
  return catalogCache.get(vertical);
}

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Normalize to the fields used by widgets.
 * In products.json: price = regular price, salePrice = promo price.
 */
function normalizeProduct(raw) {
  const regular = num(raw.price);
  const sale = num(raw.salePrice);
  const current = sale != null ? sale : regular;
  let old = num(raw.oldPrice);
  if (old == null && sale != null && regular != null) old = regular;
  const hasDiscount = current != null && old != null && old > current;

  let image = raw.image || raw.imageUrl || raw.img || '';
  if (image && !isAbsoluteUrl(image)) image = 'img/' + path.basename(image); // relative path

  // Lowest price from the last 30 days (Omnibus) – only when the data has it, never derived
  const lowest = num(raw.lowestPrice30d ?? raw.lowestPrice);
  const belowLowest = current != null && lowest != null && current < lowest;

  return {
    id: String(raw.id != null ? raw.id : raw.sku || ''),
    name: raw.title || raw.name || '',
    url: raw.url || raw.link || '#',
    image,
    brand: raw.brand || null,
    price: current,
    oldPrice: hasDiscount ? old : null,
    discountPct: hasDiscount ? (num(raw.discountPct) != null ? num(raw.discountPct) : Math.round((1 - current / old) * 100)) : null,
    badge: raw.badge || null,
    badges: [].concat(raw.badges ?? raw.badge ?? []).filter(Boolean).map(String), // string or array
    category: raw.categoryL2 || raw.categoryL1 || null,
    lowestPrice: lowest,
    lowestPct: belowLowest ? Math.round((1 - current / lowest) * 100) : null,
    currency: raw.currency || 'PLN'
  };
}

/**
 * Anchor products of the page (raw catalog items):
 *   `anchor`    – the "current" product (product page)
 *   `cartItems` – products in the basket: "ID" or { id, qty }
 * Both are anchors: never shown in the widget and used for the `related` ordering.
 */
function resolveAnchors(catalog, settings) {
  const find = (id) => catalog.find((x) => String(x.id) === String(id)) || null;

  let anchor = null;
  if (settings.anchor != null) {
    anchor = find(settings.anchor);
    if (!anchor) console.warn(`  ! produkt bazowy ${settings.anchor} nie istnieje (anchor missing)`);
  }

  const cart = [];
  for (const entry of Array.isArray(settings.cartItems) ? settings.cartItems : []) {
    const id = entry && typeof entry === 'object' ? entry.id : entry;
    const item = find(id);
    if (!item) { console.warn(`  ! produkt koszyka ${id} nie istnieje (cart item missing)`); continue; }
    const qty = Math.max(1, Math.floor(num(entry && entry.qty) || 1));
    cart.push({ item, qty });
  }

  return { anchor, cart, anchors: [anchor, ...cart.map((c) => c.item)].filter(Boolean) };
}

const categoryOf = (x) => x.categoryL2 || x.categoryL1;

/**
 * Order: `pick` IDs → related to the anchors → rest of the catalog. Anchors are never included.
 * related: "similar" (default) – same categoryL1 as an anchor;
 *          "complementary"     – a category (categoryL2 || categoryL1) no anchor has,
 *                                taking one product per category in turn.
 */
function pickProducts(catalog, { pick, count, anchors = [], related = 'similar' }) {
  const byId = new Map(catalog.map((x) => [String(x.id), x]));
  const out = [];
  for (const id of Array.isArray(pick) ? pick : []) {
    const found = byId.get(String(id));
    if (found) out.push(found);
    else console.warn(`  ! produkt ${id} nie istnieje w katalogu (product not found)`);
  }

  const isAnchor = (item) => anchors.includes(item);
  const add = (item) => {
    if (out.length < count && !isAnchor(item) && !out.includes(item)) out.push(item);
  };
  if (anchors.length) {
    if (related === 'complementary') {
      // one product per other category in turn (the catalog is sorted by category)
      const taken = new Set(anchors.map(categoryOf));
      const groups = new Map();
      for (const x of catalog) {
        const key = categoryOf(x);
        if (taken.has(key)) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(x);
      }
      const queues = [...groups.values()];
      const longest = Math.max(0, ...queues.map((q) => q.length));
      for (let i = 0; i < longest && out.length < count; i++) {
        queues.forEach((q) => { if (q[i]) add(q[i]); });
      }
    } else {
      const l1 = new Set(anchors.map((a) => a.categoryL1));
      catalog.filter((x) => l1.has(x.categoryL1)).forEach(add);
    }
  }
  catalog.forEach(add); // fill up to `count` with further catalog items
  return out.filter((x) => !isAnchor(x)).slice(0, count);
}

// "1 299,00 zł" – same format as formatPrice() in the widgets (non-breaking spaces)
function formatPrice(value, currency = 'PLN') {
  if (!Number.isFinite(value)) return '';
  const [int, dec] = value.toFixed(2).split('.');
  const amount = `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec}`;
  return `${amount} ${currency === 'PLN' ? 'zł' : currency}`;
}

/**
 * Optional mock placeholders for the anchor product (build entry `anchor`).
 * No anchor → empty values and anchorState "no-anchor" (the mock shows a skeleton).
 */
function anchorVars(a) {
  return {
    anchorState: a ? 'has-anchor' : 'no-anchor',
    anchorName: escapeHtml(a ? a.name : ''),
    anchorCategory: escapeHtml(a ? a.category : ''),
    anchorImage: escapeHtml(a ? a.image : ''),
    anchorPrice: escapeHtml(a ? formatPrice(a.price, a.currency) : ''),
    anchorOldPrice: escapeHtml(a && a.oldPrice != null ? formatPrice(a.oldPrice, a.currency) : ''),
    anchorDiscount: escapeHtml(a && a.discountPct > 0 ? `−${a.discountPct}%` : '')
  };
}

/**
 * Initial demo basket (build entry `cartItems`) → window.ROI_CART, read by core/cart.js.
 * Always embedded; without cartItems the basket is empty.
 */
function cartData(cart, settings) {
  const items = cart.map(({ item, qty }) => ({ ...normalizeProduct(item), qty }));
  const threshold = num(settings.freeShippingThreshold);
  return {
    items,
    maxQty: Math.max(1, Math.floor(num(settings.maxQty) || 10)),
    shippingCost: num(settings.shippingCost) || 0,
    freeShippingThreshold: threshold != null && threshold > 0 ? threshold : null,
    currency: (items[0] && items[0].currency) || 'PLN'
  };
}

// Optional mock placeholders for the basket – initial state, so the page renders without a flash
function cartVars(data) {
  return {
    cartState: data.items.length ? 'has-items' : 'is-empty',
    cartCount: String(data.items.reduce((sum, x) => sum + x.qty, 0))
  };
}

// Optional mock values (anchor*, cart*) – only for placeholders the mock contains
function mockVars(mockTpl, vars) {
  return Object.fromEntries(Object.entries(vars).filter(([key]) => mockTpl.includes(`{{${key}}}`)));
}

// --- Single build -----------------------------------------------------
function buildOne(placementCfg, entry) {
  const placement = placementCfg.placement;
  const { vertical, widget } = entry;
  const widgetDir = p('widgets', widget);
  if (!fs.existsSync(path.join(widgetDir, 'widget.html'))) throw new Error(`brak widgets/${widget}/widget.html`);

  const defaults = readJson(path.join(widgetDir, 'widget.json')) || {};
  const settings = { ...defaults, ...entry, texts: { ...(defaults.texts || {}), ...(entry.texts || {}) } };
  const count = settings.count || 8;

  const catalog = loadCatalog(vertical);
  // raw catalog items: anchor ("current" product of the page) + basket contents
  const { anchor, cart, anchors } = resolveAnchors(catalog, settings);

  const products = pickProducts(catalog, { pick: settings.pick, count, anchors, related: settings.related })
    .map(normalizeProduct);
  if (!products.length) console.warn(`  ! brak produktów dla ${vertical} (no products)`);

  const widgetId = `w-${widget}`;
  const texts = settings.texts;

  // 1) Widget
  const widgetHtml = fill(read(path.join(widgetDir, 'widget.html')), {
    widgetId,
    title: escapeHtml(settings.title),
    subtitleHtml: settings.subtitle ? `<p class="w-subtitle">${escapeHtml(settings.subtitle)}</p>` : '',
    labelPrev: escapeHtml(texts.prev),
    labelNext: escapeHtml(texts.next),
    labelDots: escapeHtml(texts.dots)
  }, `widgets/${widget}/widget.html`, { ignoreUnused: !!settings.ignoreUnusedVars }); // e.g. bars use no carousel labels

  // 2) Placement mock; anchor* / cart* values only for placeholders the mock actually uses
  const mockTpl = read(p('placements', placement, 'mock.html'));
  const cartInit = cartData(cart, settings);
  const mockHtml = fill(mockTpl, {
    frameLabel: escapeHtml(settings.frameLabel || ''),
    widget: widgetHtml,
    ...mockVars(mockTpl, { ...anchorVars(anchor && normalizeProduct(anchor)), ...cartVars(cartInit) })
  }, `placements/${placement}/mock.html`);

  // 3) CSS: theme → core/base → core/presentation → widget
  const css = [
    `/* themes/${vertical}.css */`, read(p('themes', `${vertical}.css`)),
    '/* core/base.css */', read(p('core', 'base.css')),
    '/* core/presentation.css */', read(p('core', 'presentation.css')),
    `/* widgets/${widget}/widget.css */`, readOptional(path.join(widgetDir, 'widget.css'))
  ].join('\n');

  // 4) JS: core (tracker → carousel → popup → cart) → widget
  const js = [
    '/* core/tracker.js */', read(p('core', 'tracker.js')),
    '/* core/preview-bridge.js */', readOptional(p('core', 'preview-bridge.js')), // forwards events to preview.html when framed
    '/* core/carousel.js */', read(p('core', 'carousel.js')),
    '/* core/popup.js */', read(p('core', 'popup.js')),
    '/* core/cart.js */', read(p('core', 'cart.js')),
    `/* widgets/${widget}/widget.js */`, read(path.join(widgetDir, 'widget.js'))
  ].join('\n');

  // 5) OG: first product image
  const first = products[0] || {};
  const baseUrl = (settings.baseUrl || placementCfg.baseUrl || '').replace(/\/$/, '');
  const outName = `${placement}__${widget}.html`;
  let ogImage = first.image || '';
  if (ogImage && !isAbsoluteUrl(ogImage) && baseUrl) ogImage = `${baseUrl}/${vertical}/${ogImage}`;

  const config = {
    vertical,
    placement,
    widget,
    widgetType: settings.type || widget.replace(/-/g, '_'),
    step: settings.step,
    autoplay: !!settings.autoplay,
    autoplayMs: settings.autoplayMs,
    campaignId: settings.campaignId || null,
    texts
  };

  const html = fill(read(p('core', 'page-shell.html')), {
    pageTitle: escapeHtml(settings.pageTitle || settings.title),
    pageDescription: escapeHtml(settings.pageDescription || ''),
    ogImage: escapeHtml(ogImage),
    ogImageAlt: escapeHtml(first.name || ''),
    ogUrlTag: baseUrl ? `<meta property="og:url" content="${escapeHtml(`${baseUrl}/${vertical}/${outName}`)}">` : '',
    css,
    mock: mockHtml,
    templates: readOptional(path.join(widgetDir, 'product-card.html')),
    configJson: scriptJson(config),
    productsJson: scriptJson(products),
    cartJson: scriptJson(cartInit),
    js
  }, 'core/page-shell.html');

  const outDir = path.join(DIST, vertical);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, outName), html);

  return { vertical, placement, placementLabel: placementCfg.label, widget, file: `${vertical}/${outName}`, title: settings.pageTitle || settings.title, products: products.length, kb: Math.round(Buffer.byteLength(html) / 1024) };
}

// --- Full build -------------------------------------------------------
function build() {
  const t0 = Date.now();
  catalogCache.clear();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const results = [];
  const verticals = new Set();

  for (const dir of fs.readdirSync(p('placements')).sort()) {
    const cfgFile = p('placements', dir, 'config.json');
    let cfg;
    try { cfg = readJson(cfgFile); } catch (e) {
      console.warn(`- placements/${dir}: niepoprawny JSON, pomijam (invalid JSON, skipped): ${e.message}`);
      continue;
    }
    if (!cfg || !Array.isArray(cfg.builds) || !cfg.builds.length) continue; // empty config = placement not ready yet
    cfg.placement = cfg.placement || dir;

    for (const entry of cfg.builds) {
      try {
        const r = buildOne(cfg, entry);
        results.push(r);
        verticals.add(r.vertical);
        console.log(`✓ ${r.file}  (${r.products} produktów, ${r.kb} KB)`);
      } catch (e) {
        console.error(`✗ ${cfg.placement} / ${entry.widget} / ${entry.vertical}: ${e.message}`);
        process.exitCode = 1;
      }
    }
  }

  // Local images: data/{v}/img → dist/{v}/img
  for (const v of verticals) {
    const n = copyDir(p('data', v, 'img'), path.join(DIST, v, 'img'));
    if (n) console.log(`✓ ${v}/img  (${n} plików)`);
  }

  // List + preview pages + .nojekyll for GitHub Pages
  try {
    renderIndex(results);
  } catch (e) {
    console.error(`✗ list.html: ${e.message}`);
    process.exitCode = 1;
  }
  try {
    renderPreview(results);
  } catch (e) {
    console.error(`✗ index.html (preview): ${e.message}`);
    process.exitCode = 1;
  }
  copySiteAssets();
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

  console.log(`Gotowe w ${Date.now() - t0} ms → dist/ (Done)`);
  return results;
}

// --- Dev server -------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.avif': 'image/avif', '.ico': 'image/x-icon'
};

function serve() {
  http.createServer((req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { urlPath = '/'; }
    let file = path.normalize(path.join(DIST, urlPath));
    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end('403'); } // path traversal guard
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 – nie znaleziono (not found)'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  }).listen(PORT, () => {
    console.log(`\nSerwer (server): http://localhost:${PORT}/`);
    console.log(`Preview: http://localhost:${PORT}/  (list of pages: /list.html)`);
    console.log(`Widget: http://localhost:${PORT}/home/home-page__last-seen.html?lead=test`);
  });
}

function watch() {
  let timer;
  const rebuild = (event, file) => {
    clearTimeout(timer);
    timer = setTimeout(() => { console.log(`\n↻ zmiana (change): ${file || ''}`); try { build(); } catch (e) { console.error(e.message); } }, 150);
  };
  for (const dir of ['core', 'themes', 'widgets', 'placements', 'data']) {
    try { fs.watch(p(dir), { recursive: true }, rebuild); } catch (e) { console.warn(`! watch ${dir}: ${e.message}`); }
  }
  console.log('Obserwuję zmiany (watching)…');
}

build();
if (args.includes('--serve')) serve();
if (args.includes('--watch')) watch();
