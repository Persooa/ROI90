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
