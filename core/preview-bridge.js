/* =====================================================================
   core/preview-bridge.js – everything the page needs to talk to preview.html:
   1) legacy events wrapper (only when tracker.js does not mirror events by itself)
   2) ROI.options (the "Opcje" window) – details below
   ===================================================================== */
// Preview bridge (legacy fallback): core/tracker.js now mirrors events to preview.html by itself.
// This wrapper only matters for a tracker.js without that feature, and never doubles the events.
(function () {
  if (window.parent === window) return;
  if (window.ROI && window.ROI.track && window.ROI.track.mirrors) return;

  function post(event, data) {
    try { window.parent.postMessage({ rkEvent: String(event), data: data || {}, ts: Date.now() }, '*'); } catch (e) { /* ignore */ }
  }
  function wrap(owner) {
    var original = owner && owner.track;
    if (typeof original !== 'function') return;
    owner.track = function (event, data) {
      post(event, data);
      return original.apply(this, arguments);
    };
  }
  wrap(window);
  wrap(window.ROI);
})();

/* =====================================================================
   core/options.js – ROI.options.register({...}): demo options of a widget, shown in the "Opcje" window of preview.html
   - the widget describes its options (switch / text / select / number); this file does not render any UI
   - preview.html draws the window and sends changes back; the widget reacts in onChange
   - standalone page (no preview around it): nothing is shown, the values still come from the URL
   - the current values are kept in the URL (?timer=0&text=...), so a link shows the same configuration

   ROI.options.register({
     id: 'bar-combo',                    // unique per widget on the page
     title: 'Belka',                     // heading of the section in the window
     base: { label: 'Standard', rbh: 8 }, // optional, always on (cannot be switched off); differs per widget
     fields: [
       { key: 'timer', type: 'switch', label: 'Timer', rbh: 2, value: true },   // rbh: cost of the option, summed in the window
       { key: 'text',  type: 'text',   label: 'Tekst belki', placeholder: '…', maxlength: 80, value: 'Hello' },
       { key: 'size',  type: 'select', label: 'Rozmiar', value: 'm', options: [{ value: 's', label: 'S' }, { value: 'm', label: 'M' }] },
       { key: 'count', type: 'number', label: 'Ilość', value: 3, min: 1, max: 9 }
     ],
     onChange(key, value, all) { … }     // called for every change (and once per value taken from the URL)
   });
   ROI.options.set('bar-combo', 'timer', false)   // the widget changes a value itself; the window follows
   ===================================================================== */
(() => {
  'use strict';

  const ROI = (window.ROI ??= {});
  if (ROI.options) return;   // already defined (e.g. a separate core/options.js is also in the build)
  const sections = new Map(); // id -> { def, values }
  const framed = window.parent !== window;

  const post = (msg) => {
    try { if (framed) window.parent.postMessage(msg, '*'); } catch { /* the preview is optional */ }
  };

  // --- Value <-> URL (switch: 1/0, number: number, others: text) ---
  const fromUrl = (field, raw) => {
    if (field.type === 'switch') return raw === '1' || raw === 'true';
    if (field.type === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : field.value; }
    return raw;
  };
  const toUrl = (field, v) => (field.type === 'switch' ? (v ? '1' : '0') : String(v));

  const syncUrl = (sec) => {
    try {
      const u = new URL(location.href);
      sec.def.fields.forEach((f) => u.searchParams.set(f.key, toUrl(f, sec.values[f.key])));
      history.replaceState(null, '', u.toString());
    } catch { /* e.g. file:// */ }
  };

  const schema = (sec) => ({
    rkOptions: 'schema',
    id: sec.def.id,
    title: sec.def.title || sec.def.id,
    base: sec.def.base || null,   // { label: 'Standard', rbh: 8 } – always-on row, cost counted in the total
    fields: sec.def.fields.map((f) => ({ ...f, value: sec.values[f.key] }))
  });

  const apply = (sec, key, value, silent) => {
    const f = sec.def.fields.find((x) => x.key === key);
    if (!f) return;
    if (f.type === 'switch') value = !!value;
    else if (f.type === 'number') value = Number(value);
    else value = String(value ?? '');
    sec.values[key] = value;
    if (!silent) syncUrl(sec);
    try { sec.def.onChange?.(key, value, { ...sec.values }); } catch (err) { console.error('[ROI options]', err); }
  };

  const register = (def) => {
    if (!def || !def.id || !Array.isArray(def.fields)) return;
    const sec = { def, values: Object.fromEntries(def.fields.map((f) => [f.key, f.value])) };
    sections.set(def.id, sec);

    // Values from the URL win over the defaults
    const q = new URLSearchParams(location.search);
    def.fields.forEach((f) => { if (q.has(f.key)) apply(sec, f.key, fromUrl(f, q.get(f.key)), true); });

    post(schema(sec));
  };

  const set = (id, key, value) => {
    const sec = sections.get(id);
    if (!sec) return;
    apply(sec, key, value, false);
    post({ rkOptions: 'values', id, values: { ...sec.values } });
  };

  // Messages from preview.html: "hello" (it asks for the schemas again after every page load) and "set"
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !e.data || !e.data.rkOptions) return;
    const { rkOptions, id, key, value } = e.data;
    if (rkOptions === 'hello') sections.forEach((sec) => post(schema(sec)));
    else if (rkOptions === 'set') { const sec = sections.get(id); if (sec) apply(sec, key, value, false); }
  });

  ROI.options = { register, set };
})();
