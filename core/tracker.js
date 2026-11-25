/* =====================================================================
   core/tracker.js – single track(event, data) function
   - logs to console
   - pushes to window.dataLayer when it exists
   - mirrors the event to the "Events" window of preview.html (when the page
     is shown inside its frame; on a standalone page this does nothing)
   - adds context: vertical, placement, widget_type + ?lead= from URL
   ===================================================================== */
(() => {
  'use strict';

  const ROI = (window.ROI ??= {});

  // ?lead= parameter from URL
  const lead = new URLSearchParams(window.location.search).get('lead');

  // Shared event context
  let context = { vertical: null, placement: null, widget_type: null };

  const setContext = (ctx) => { context = { ...context, ...ctx }; };

  /**
   * Sends the payload to the parent window (preview.html -> "Events").
   * Never throws: no parent, a cross-origin parent or a non-cloneable value is simply ignored.
   */
  const mirrorToPreview = (payload) => {
    try {
      if (window.parent === window) return; // page opened on its own, no frame around it
      // JSON round trip keeps only plain data (postMessage throws on functions / DOM nodes)
      window.parent.postMessage({ rkEvent: payload.event, data: JSON.parse(JSON.stringify(payload)), ts: Date.now() }, '*');
    } catch (err) { /* the preview is optional */ }
  };

  /**
   * Sends an event.
   * @param {string} event – event name
   * @param {object} [data] – e.g. product_id, position
   */
  const track = (event, data = {}) => {
    const payload = {
      event,
      ...context,
      product_id: null,
      position: null,
      ...data,
      ...(lead && { lead }),
      timestamp: new Date().toISOString()
    };
    console.log(`[ROI track] ${event}`, payload);
    window.dataLayer?.push(payload);
    mirrorToPreview(payload);
    return payload;
  };

  /**
   * Fires the callback once, when the element is at least `threshold` visible.
   */
  const observeOnce = (el, callback, threshold = 0.5) => {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        io.disconnect();
        callback();
      }
    }, { threshold });
    io.observe(el);
  };

  track.mirrors = true; // tells core/preview-bridge.js that it does not have to wrap track() again
  ROI.tracker = { track, setContext, observeOnce, lead };
  ROI.track = track;
})();
