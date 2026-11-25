(() => {
  'use strict';

  /*
    preview.html: opens index.html first, then follows the links inside the frame.
    - back / forward buttons with their own history stack (enabled / disabled state)
    - shows which file is open
    - theme dropdown = the same page in another vertical (home / fashion / ...)
    - device: desktop / tablet / mobile; floating events window with a show / hide toggle
    State (page, device, events) lives in the URL hash: preview.html#page=home/x.html&device=mobile&events=0
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

  // --- State (from the URL hash) ---
  const state = { page: HOME, device: 'desktop', events: '1' };
  new URLSearchParams(location.hash.slice(1)).forEach((v, k) => { if (k in state) state[k] = v; });
  // The hash is user input: accept only a relative .html path inside dist
  if (!/^[\w\-./]+\.html$/.test(state.page) || state.page.includes('..') || state.page.startsWith('/')) state.page = HOME;
  if (!DEVICES.includes(state.device)) state.device = 'desktop';
  if (state.events !== '0') state.events = '1';

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
    writeHash();
  }

  document.querySelectorAll('.group[data-group="device"] button').forEach((b) => {
    b.addEventListener('click', () => { state.device = b.getAttribute('data-v'); render(); }); // only resizes the frame
  });
  logBtn.addEventListener('click', () => { state.events = state.events === '1' ? '0' : '1'; render(); });

  // Reset: forget the session state of the demos (closed bar, timer start, ...) and reload the page
  $('reset').addEventListener('click', () => {
    try { sessionStorage.clear(); } catch { /* storage unavailable */ }
    try { frame.contentWindow.location.reload(); } catch { frame.src = frame.src; }
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
