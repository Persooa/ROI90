/* =====================================================================
   core/tracker.js – single track(event, data) function
   - logs to console
   - pushes to window.dataLayer when it exists
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

  ROI.tracker = { track, setContext, observeOnce, lead };
  ROI.track = track;
})();
