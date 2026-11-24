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
// Files from core/ copied next to dist/index.html (styles, logo, preview script)
const SITE_ASSETS = ['index.css', 'logo.svg', 'preview.css', 'preview.js'];

// Injects `value` into the {{ key }} placeholder of core/<name> and writes the result to dist/<name>.
// Only data is injected; all markup, styling and behaviour live in core/.
function renderTemplate(name, key, value) {
  const tplFile = p('core', name);
  if (!fs.existsSync(tplFile)) throw new Error(`brak szablonu core/${name} (template missing)`);
  const tpl = read(tplFile);

  const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`);
  if (!placeholder.test(tpl)) throw new Error(`core/${name} nie zawiera znacznika {{ ${key} }} (placeholder missing)`);

  // Replacer function, so "$" characters in the value are never treated as patterns
  fs.writeFileSync(path.join(DIST, name), tpl.replace(placeholder, () => value));
}

// dist/index.html: list of links to all built pages
function renderIndex(results) {
  const list = results
    .map((r) => `<li><a href="${escapeHtml(r.file)}">${escapeHtml(r.title)}</a> <small>${escapeHtml(r.file)}</small></li>`)
    .join('\n      ');
  renderTemplate('index.html', 'list', list);
}

// dist/preview.html: opens index.html first and follows links from there;
// it gets the page list as JSON (titles, and the theme switcher moves between verticals)
function renderPreview(results) {
  const pages = results.map((r) => ({ file: r.file, title: r.title, vertical: r.vertical, placement: r.placement, widget: r.widget }));
  renderTemplate('preview.html', 'pagesJson', scriptJson(pages));
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
 * Order: `pick` IDs → (with `anchor`, a raw catalog item) same categoryL1 as the anchor
 * → rest of the catalog. The anchor product itself is never included.
 */
function pickProducts(catalog, { pick, count, anchor }) {
  const byId = new Map(catalog.map((x) => [String(x.id), x]));
  const out = [];
  for (const id of Array.isArray(pick) ? pick : []) {
    const found = byId.get(String(id));
    if (found) out.push(found);
    else console.warn(`  ! produkt ${id} nie istnieje w katalogu (product not found)`);
  }

  const add = (item) => {
    if (out.length < count && item !== anchor && !out.includes(item)) out.push(item);
  };
  // similar first
  if (anchor) catalog.filter((x) => x.categoryL1 === anchor.categoryL1).forEach(add);
  catalog.forEach(add); // fill up to `count` with further catalog items
  return out.filter((x) => x !== anchor).slice(0, count);
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
  let anchor = null; // raw catalog item of the anchor product ("current" product of the page)
  if (settings.anchor != null) {
    anchor = catalog.find((x) => String(x.id) === String(settings.anchor)) || null;
    if (!anchor) console.warn(`  ! produkt bazowy ${settings.anchor} nie istnieje (anchor missing)`);
  }

  const products = pickProducts(catalog, { pick: settings.pick, count, anchor })
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

  // 2) Placement mock; anchor* values only for placeholders the mock actually uses
  const mockTpl = read(p('placements', placement, 'mock.html'));
  const mockAnchor = Object.entries(anchorVars(anchor && normalizeProduct(anchor)))
    .filter(([key]) => mockTpl.includes(`{{${key}}}`));
  const mockHtml = fill(mockTpl, {
    frameLabel: escapeHtml(settings.frameLabel || ''),
    widget: widgetHtml,
    ...Object.fromEntries(mockAnchor)
  }, `placements/${placement}/mock.html`);

  // 3) CSS: theme → core/base → core/presentation → widget
  const css = [
    `/* themes/${vertical}.css */`, read(p('themes', `${vertical}.css`)),
    '/* core/base.css */', read(p('core', 'base.css')),
    '/* core/presentation.css */', read(p('core', 'presentation.css')),
    `/* widgets/${widget}/widget.css */`, readOptional(path.join(widgetDir, 'widget.css'))
  ].join('\n');

  // 4) JS: core → widget
  const js = [
    '/* core/tracker.js */', read(p('core', 'tracker.js')),
    '/* core/preview-bridge.js */', readOptional(p('core', 'preview-bridge.js')), // forwards events to preview.html when framed
    '/* core/carousel.js */', read(p('core', 'carousel.js')),
    '/* core/popup.js */', read(p('core', 'popup.js')),
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
    js
  }, 'core/page-shell.html');

  const outDir = path.join(DIST, vertical);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, outName), html);

  return { vertical, placement, widget, file: `${vertical}/${outName}`, title: settings.pageTitle || settings.title, products: products.length, kb: Math.round(Buffer.byteLength(html) / 1024) };
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

  // Link index + .nojekyll for GitHub Pages
  try {
    renderIndex(results);
  } catch (e) {
    console.error(`✗ index.html: ${e.message}`);
    process.exitCode = 1;
  }
  try {
    renderPreview(results);
  } catch (e) {
    console.error(`✗ preview.html: ${e.message}`);
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
    console.log(`Preview: http://localhost:${PORT}/preview.html`);
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
