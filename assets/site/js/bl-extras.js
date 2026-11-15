/* Brandslane additions on top of the Framer rebuild (16 Nov 2026): Portfolio dropdown + drifting dots. */
(function () {
  'use strict';

  /* ---------- Portfolio dropdown ----------
     Event delegation, because site.js clones the desktop menu into the phone header
     (cloneNode drops listeners). Hover opens it on desktop (CSS); click toggles; a click that
     closes it also hides the hover preview until the pointer leaves. */
  function setDd(dd, open) {
    dd.classList.toggle('open', open);
    var b = dd.querySelector('.bl-dd-btn'); if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function closeAll(except) {
    document.querySelectorAll('.bl-dd.open').forEach(function (d) { if (d !== except) setDd(d, false); });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.bl-dd-btn');
    if (btn) {
      var dd = btn.closest('.bl-dd');
      e.preventDefault();
      if (dd.classList.contains('open')) { setDd(dd, false); dd.classList.add('suppress'); }
      else { closeAll(dd); dd.classList.remove('suppress'); setDd(dd, true); }
      return;
    }
    if (!(e.target.closest && e.target.closest('.bl-dd'))) closeAll();
  });
  document.addEventListener('mouseleave', function (e) {
    if (e.target.classList && e.target.classList.contains('bl-dd')) e.target.classList.remove('suppress');
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelector('.bl-dd.open');
    if (open) { setDd(open, false); open.classList.add('suppress'); var b = open.querySelector('.bl-dd-btn'); if (b) b.focus(); }
  });

  /* ---------- Drifting dots behind the hero + the creatives strip ----------
     Same particles as the SOP page (ai-advertising-system.html): 280 dots over its 1440x1188 hero,
     so the count follows the area. The canvas sits in the page root (z-index 0) under the two sections
     (z-index 1), sized from the hero's top to the strip's bottom. Pauses off-screen / in background tabs. */
  var canvas = document.querySelector('.bl-dots');
  var hero = document.getElementById('hero');
  var strip = document.querySelector('.framer-wfuvfg');
  if (!canvas || !hero || !strip || !canvas.getContext) return;
  var root = canvas.parentElement;
  var ctx = canvas.getContext('2d'), W = 0, H = 0, ps = [], raf = 0, visible = true;
  var DENSITY = 280 / (1440 * 1188);

  function make() {
    return { x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
             r: Math.random() * 1.4 + 0.4, alpha: Math.random() * 0.3 + 0.08 };
  }
  function place() {
    var rr = root.getBoundingClientRect(), hr = hero.getBoundingClientRect(), sr = strip.getBoundingClientRect();
    var top = hr.top - rr.top, h = Math.max(0, sr.bottom - hr.top), w = rr.width;
    canvas.style.top = top + 'px'; canvas.style.height = h + 'px';
    if (!w || !h) return;
    if (W && H) ps.forEach(function (p) { p.x *= w / W; p.y *= h / H; });
    W = canvas.width = Math.round(w); H = canvas.height = Math.round(h);
    var n = Math.round(W * H * DENSITY);
    while (ps.length < n) ps.push(make());
    if (ps.length > n) ps.length = n;
  }
  function tick() {
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,20,20,' + p.alpha + ')'; ctx.fill();
    }
    raf = requestAnimationFrame(tick);
  }
  function run() { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(tick); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  place();
  if (window.ResizeObserver) { var ro = new ResizeObserver(place); ro.observe(hero); ro.observe(strip); ro.observe(root); }
  else window.addEventListener('resize', place);
  if (window.IntersectionObserver) new IntersectionObserver(function (e) { visible = e.some(function (x) { return x.isIntersecting; }); visible ? run() : stop(); }).observe(canvas);
  document.addEventListener('visibilitychange', function () { document.hidden ? stop() : run(); });
  run();
})();
