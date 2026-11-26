(() => {
  'use strict';

  /*
    preview.html: opens index.html first, then follows the links inside the frame.
    - back / forward buttons with their own history stack (enabled / disabled state)
    - shows which file is open
    - theme dropdown = the same page in another vertical (home / fashion / ...)
    - device: desktop / tablet / mobile; floating events window with a show / hide toggle
    State (page, device, events) lives in the URL hash: preview.html#page=home/x.html&device=mobile&events=1
    Reading the frame needs the same origin (a server or GitHub Pages; file:// is blocked by the browser).
  */

  const HOME = 'index.html';
  const LABELS = { home: 'Home', fashion: 'Fashion', electronics: 'Elektronika', beauty: 'Beauty' };
  const DEVICES = ['desktop', 'tablet', 'mobile'];

  // --- Page list injected by build.js ---
  let pages = [];
  try { pages = JSON.parse(document.getElementById('pages-data').textContent) || []; } catch { /* no list: theme switcher stays off */ }
  const byFile = Object.fromEntries(pages.map((pg) => [pg.file, pg]));
  const verticals = [...new Set(pages.map((pg) => pg.vertical))];

  const $ = (id) => document.getElementById(id);
  const frame = $('frame');
  const view = $('view');
  const log = $('log');
  const backBtn = $('back');
  const fwdBtn = $('forward');
  const fileEl = $('file');
  const titleEl = $('title');
  const themeSel = $('theme');
  const logBtn = $('toggleLog');
  const optsBox = $('opts');
  const optsBody = $('optsBody');
  const optsBtn = $('toggleOpts');
  const optsTotal = $('optsTotal');
  const optsTotalValue = $('optsTotalValue');

  // --- State (from the URL hash) ---
  const state = { page: HOME, device: 'desktop', events: '0', opts: '1' };   // events are hidden by default
  new URLSearchParams(location.hash.slice(1)).forEach((v, k) => { if (k in state) state[k] = v; });
  // The hash is user input: accept only a relative .html path inside dist
  if (!/^[\w\-./]+\.html$/.test(state.page) || state.page.includes('..') || state.page.startsWith('/')) state.page = HOME;
  if (!DEVICES.includes(state.device)) state.device = 'desktop';
  if (state.events !== '1') state.events = '0';
  if (state.opts !== '0') state.opts = '1';

  const writeHash = () => history.replaceState(null, '', '#' + new URLSearchParams(state).toString());

  // --- Frame location ---
  const baseDir = () => location.pathname.replace(/[^/]*$/, '');

  // Path of the page open in the frame, relative to preview.html; null when the frame is unreadable (file://)
  function framePath() {
    try {
      const loc = frame.contentWindow.location;
      if (loc.href === 'about:blank') return null;
      let rel = decodeURIComponent(loc.pathname);
      const base = baseDir();
      rel = rel.startsWith(base) ? rel.slice(base.length) : rel.replace(/^\//, '');
      return rel === '' || rel.endsWith('/') ? rel + HOME : rel;
    } catch { return null; }
  }

  // Own history stack, so the buttons know whether there is anything to go back / forward to
  let stack = [];
  let idx = -1;
  let pending = null; // 'back' | 'forward' while a button-driven navigation is loading

  function go(path) {
    try { frame.contentWindow.location.assign(baseDir() + path); } catch { frame.src = path; }
  }

  backBtn.addEventListener('click', () => {
    if (idx <= 0) return;
    pending = 'back';
    try { frame.contentWindow.history.back(); } catch { pending = null; }
  });
  fwdBtn.addEventListener('click', () => {
    if (idx >= stack.length - 1) return;
    pending = 'forward';
    try { frame.contentWindow.history.forward(); } catch { pending = null; }
  });

  // --- Theme dropdown: the same page in another vertical ---
  const noneOpt = new Option('–', '');
  themeSel.append(noneOpt, ...verticals.map((v) => new Option(LABELS[v] || v, v)));

  function refreshTheme(path) {
    const entry = byFile[path];
    const rest = entry ? path.slice(entry.vertical.length + 1) : '';
    themeSel.value = entry ? entry.vertical : '';
    themeSel.disabled = !entry; // index.html and unknown files have no theme
    // A vertical is available only if the same file was built for it
    for (const opt of themeSel.options) opt.disabled = !!opt.value && !byFile[`${opt.value}/${rest}`];
  }
  themeSel.addEventListener('change', () => {
    const entry = byFile[stack[idx]];
    if (entry && themeSel.value) go(`${themeSel.value}/${stack[idx].slice(entry.vertical.length + 1)}`);
  });

  // --- The frame loaded a page ---
  function onLoad() {
    clearOptions();   // the new page registers its own options (it answers the "hello" below)
    try { frame.contentWindow.postMessage({ rkOptions: 'hello' }, '*'); } catch { /* frame unreachable */ }
    const path = framePath();
    if (path === null) {
      // unreadable frame (file://): show the address we set, no history tracking
      fileEl.textContent = frame.getAttribute('src') || '';
      titleEl.textContent = 'otwórz przez serwer (http) – file:// blokuje odczyt ramki';
      return;
    }

    if (pending === 'back') idx = Math.max(0, idx - 1);
    else if (pending === 'forward') idx = Math.min(stack.length - 1, idx + 1);
    else if (stack[idx] !== path) { // a link was clicked or the theme changed; a reload keeps the same entry
      stack = stack.slice(0, idx + 1);
      stack.push(path);
      idx = stack.length - 1;
    }
    stack[idx] = path;
    pending = null;

    backBtn.disabled = idx <= 0;
    fwdBtn.disabled = idx >= stack.length - 1;
    fileEl.textContent = path;
    titleEl.textContent = byFile[path] ? byFile[path].title : (path === HOME ? 'Lista demo' : '');
    document.title = `Preview – ${path}`;
    refreshTheme(path);
    state.page = path;
    writeHash();
  }
  frame.addEventListener('load', onLoad);

  // --- Device, events window ---
  function render() {
    document.querySelectorAll('.group[data-group="device"] button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === state.device));
    });
    view.className = `view ${state.device}`;
    log.hidden = state.events !== '1';
    logBtn.setAttribute('aria-pressed', String(state.events === '1'));
    optsBox.hidden = state.opts !== '1' || !optsBody.children.length;
    optsBtn.disabled = !optsBody.children.length;   // always visible; active only when the page in the frame has options
    optsBtn.title = optsBtn.disabled ? 'Ta strona nie ma opcji' : 'Pokaż / ukryj opcje';
    optsBtn.setAttribute('aria-pressed', String(state.opts === '1'));
    writeHash();
  }

  document.querySelectorAll('.group[data-group="device"] button').forEach((b) => {
    b.addEventListener('click', () => { state.device = b.getAttribute('data-v'); render(); }); // only resizes the frame
  });
  logBtn.addEventListener('click', () => { state.events = state.events === '1' ? '0' : '1'; render(); });
  optsBtn.addEventListener('click', () => { state.opts = state.opts === '1' ? '0' : '1'; render(); });

  // Reset: forget the session state of the demos (closed bar, timer start, ...) and reload the page
  $('reset').addEventListener('click', () => {
    try { sessionStorage.clear(); } catch { /* storage unavailable */ }
    try { frame.contentWindow.location.reload(); } catch { frame.src = frame.src; }
  });

  // --- Options window: sections described by core/options.js inside the frame (any widget, any field set) ---
  const sectionEls = new Map(); // id -> { el, inputs: { key: input } }

  const fmt = (n) => String(+Number(n).toFixed(2));

  // Always-on first row ("Standard 8 RBH"): a switch that is on and locked
  function buildBase(base) {
    const wrap = document.createElement('label');
    wrap.className = 'opt opt--switch opt--locked';
    const text = document.createElement('span');
    text.textContent = base.label || 'Standard';
    const cost = Number.isFinite(Number(base.rbh)) ? `${fmt(base.rbh)} RBH` : '';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.className = 'sw'; input.checked = true; input.disabled = true;
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', `${text.textContent} (zawsze włączone)`);
    wrap.title = 'Zawsze włączone';
    wrap.append(text);
    if (cost) { const s = document.createElement('small'); s.textContent = cost; wrap.append(s); }
    wrap.append(input);
    return wrap;
  }

  // Sum of RBH: the base of every section + the switched-on options that have a cost
  function updateTotal() {
    let total = 0, any = false;
    sectionEls.forEach((sec) => {
      if (sec.base) { total += sec.base; any = true; }
      Object.entries(sec.costs).forEach(([k, cost]) => { any = true; if (sec.inputs[k] && sec.inputs[k].checked) total += cost; });
    });
    optsTotal.hidden = !any;
    optsTotalValue.textContent = `${fmt(total)} RBH`;
  }

  function clearOptions() {
    optsBody.textContent = '';
    sectionEls.clear();
    updateTotal();
    render();
  }

  const sendSet = (id, key, value) => {
    try { frame.contentWindow.postMessage({ rkOptions: 'set', id, key, value }, '*'); } catch { /* frame unreachable */ }
  };

  function buildField(id, f, inputs) {
    const wrap = document.createElement('label');
    wrap.className = f.type === 'switch' ? 'opt opt--switch' : 'opt opt--field';
    const cost = f.rbh != null ? `+${fmt(f.rbh)} RBH` : (f.hint || '');
    if (cost) wrap.title = cost;
    const text = document.createElement('span');
    text.textContent = f.label || f.key;
    let input;
    if (f.type === 'select') {
      input = document.createElement('select');
      (f.options || []).forEach((o) => input.append(new Option(o.label ?? o.value, o.value)));
    } else {
      input = document.createElement('input');
      input.type = f.type === 'switch' ? 'checkbox' : f.type === 'number' ? 'number' : 'text';
      if (f.type === 'switch') { input.className = 'sw'; input.setAttribute('role', 'switch'); }
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.maxlength) input.maxLength = f.maxlength;
      if (f.min != null) input.min = f.min;
      if (f.max != null) input.max = f.max;
    }
    input.setAttribute('aria-label', f.label || f.key);
    inputs[f.key] = input;
    setInputValue(input, f.type, f.value);
    input.addEventListener(f.type === 'text' || f.type === 'number' ? 'input' : 'change', () => {
      sendSet(id, f.key, f.type === 'switch' ? input.checked : input.value);
      updateTotal();
    });
    // switch: label, cost, [toggle on the right]; others: label [input]
    if (f.type === 'switch') {
      wrap.append(text);
      if (cost) { const s = document.createElement('small'); s.textContent = cost; wrap.append(s); }
      wrap.append(input);
    } else wrap.append(text, input);
    return wrap;
  }

  function setInputValue(input, type, value) {
    if (type === 'switch') input.checked = !!value;
    else if (document.activeElement !== input) input.value = value ?? '';
  }

  function showSchema(msg) {
    if (!msg.id || !Array.isArray(msg.fields)) return;
    sectionEls.get(msg.id)?.el.remove();
    const el = document.createElement('section');
    const h = document.createElement('h4');
    h.textContent = msg.title || msg.id;
    el.append(h);
    const inputs = {};
    if (msg.base && typeof msg.base === 'object') el.append(buildBase(msg.base));
    msg.fields.forEach((f) => { if (f && f.key) el.append(buildField(msg.id, f, inputs)); });
    optsBody.append(el);
    sectionEls.set(msg.id, {
      el, inputs,
      types: Object.fromEntries(msg.fields.map((f) => [f.key, f.type])),
      base: msg.base && Number.isFinite(Number(msg.base.rbh)) ? Number(msg.base.rbh) : 0,
      costs: Object.fromEntries(msg.fields.filter((f) => f.type === 'switch' && Number.isFinite(Number(f.rbh))).map((f) => [f.key, Number(f.rbh)]))
    });
    updateTotal();
    render();
  }

  function showValues(msg) {
    const sec = sectionEls.get(msg.id);
    if (!sec) return;
    Object.entries(msg.values || {}).forEach(([k, v]) => { if (sec.inputs[k]) setInputValue(sec.inputs[k], sec.types[k], v); });
    updateTotal();
  }

  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || !e.data || !e.data.rkOptions) return;
    if (e.data.rkOptions === 'schema') showSchema(e.data);
    else if (e.data.rkOptions === 'values') showValues(e.data);
  });

  // Events posted by core/tracker.js inside the frame
  const HIDDEN_KEYS = new Set(['event', 'timestamp']);
  window.addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow || !e.data || !e.data.rkEvent) return;
    const payload = e.data.data || {};
    // Compact view: skip empty values and the fields shown elsewhere; the full payload is in the tooltip
    const short = Object.fromEntries(Object.entries(payload).filter(([k, v]) => v !== null && v !== '' && !HIDDEN_KEYS.has(k)));
    const row = document.createElement('div');
    row.innerHTML = '<i></i> <b></b> <i></i>';
    row.children[0].textContent = new Date(e.data.ts).toLocaleTimeString('pl-PL');
    row.children[1].textContent = e.data.rkEvent;
    row.children[2].textContent = JSON.stringify(short);
    row.title = JSON.stringify(payload, null, 2);
    log.insertBefore(row, log.children[1]);
    while (log.children.length > 201) log.lastElementChild.remove(); // keep the window light
  });

  render();
  frame.src = state.page;
})();
