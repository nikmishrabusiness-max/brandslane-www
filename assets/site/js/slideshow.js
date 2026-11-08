/*
 * slideshow.js - Slideshow behaviour for the static copy of home.brandslane.co
 *
 * Re-implements, in plain JS on top of Motion (window.Motion, the same animation library Framer runs on),
 * the behaviour of Framer's "Slideshow" component as it runs on the live homepage. The markup is Framer's
 * own server render (every breakpoint variant is present, hidden by .hidden-xxxx media classes); this file
 * only adds what the live React component does after hydration:
 *
 *   - measures the first set of slides and translates the list so the 2nd of 4 copies is showing,
 *     reveals the section (opacity 0.001 -> 1), keeps slide visibility / transform-origin / aria-hidden
 *     in step with the position, exactly as the original's motion values do;
 *   - autoplay every `interval` seconds while the section is in the viewport and the tab is visible,
 *     restarting the countdown on every re-render the original would do (hover in/out, mouse down/up,
 *     arrow/dot clicks, resizes);
 *   - arrows (spring transition, press scale 0.9), dots (opacity tween), infinite wrap-around;
 *   - horizontal drag with Framer Motion's pan rules (3 px start distance, 10 px direction lock,
 *     velocity over the last 100 ms, +/-200 px/s flick, half-slide threshold, no momentum);
 *   - resize handling (jump while resizing inside one breakpoint, spring when a breakpoint changes,
 *     autoplay paused for 500 ms) and lazy start of the variants that are display:none at load.
 *
 * Constants and rules were read from Framer's Slideshow source and from Framer Motion's drag code and
 * checked frame by frame against the live site. Nothing here is Framer code.
 */
(function () {
  'use strict';

  var M = window.Motion;
  if (!M || !M.animate || !M.motionValue || !M.frame) return;

  // ---------------------------------------------------------------------------------------------
  // 1. Props per instance, keyed by the container class that wraps the slideshow <section>.
  //    Visual props (slide widths, gap, arrow/dot position and look) are already in the markup;
  //    they are listed for reference. Every instance: direction left, startFrom 0, no slide effects
  //    (opacity 1, scale 1, rotate 0, perspective 1200), overflow visible, arrows grouped bottom-middle.
  // ---------------------------------------------------------------------------------------------
  var SPRING = { type: 'spring', stiffness: 200, damping: 40, mass: 1, delay: 0 };

  var SLIDESHOWS = {
    // Case Studies, "World Class Brands Rely On Us"
    'framer-14y1lm9-container': {
      autoPlay: true, interval: 2, playOffscreen: false, effectsHover: true, drag: true,
      startFrom: 0, gap: 24, transition: SPRING, dots: null,
      itemAmount: { desktop: 2.8, tablet: 2, phone: 1 }, arrowBottom: { desktop: -70, tablet: -70, phone: -60 },
    },
    // CMO section, "Paid Ads Scaling"
    'framer-1qcpkqo-container': {
      autoPlay: true, interval: 2, playOffscreen: false, effectsHover: true, drag: true,
      startFrom: 0, gap: 24, transition: SPRING, dots: null,
      itemAmount: { desktop: 2.8, tablet: 2, phone: 1 }, arrowBottom: -70,
    },
    // CMO section, "Performance Creatives" (YouTube cards)
    'framer-186z093-container': {
      autoPlay: true, interval: 2, playOffscreen: false, effectsHover: true, drag: true,
      startFrom: 0, gap: 24, transition: SPRING, dots: null,
      itemAmount: { desktop: 2.8, tablet: 2, phone: 1 }, arrowBottom: -70,
    },
    // Testimonials, phone only (below 810 px). Live mounts it only on the phone layout, so it starts
    // over every time the phone layout comes back (phoneOnly: state is not kept across breakpoints).
    'framer-5ycs4c-container': {
      autoPlay: false, interval: 1.5, playOffscreen: false, effectsHover: true, drag: true,
      startFrom: 0, gap: 3, transition: SPRING, dots: { opacity: 0.2, activeOpacity: 1 },
      itemAmount: 1, arrowBottom: -100, phoneOnly: true,
    },
  };

  var COPIES = 4; // the original renders the slide set 4 times
  var BREAKPOINTS = [
    '(min-width: 1440px)',
    '(min-width: 1200px) and (max-width: 1439.98px)',
    '(min-width: 810px) and (max-width: 1199.98px)',
    '(max-width: 809.98px)',
  ];
  var TEXT_INPUTS = { INPUT: 1, SELECT: 1, TEXTAREA: 1 }; // drag does not start on these
  var sizeCounter = 0; // every measurement is a new value (re-runs the resize jump effect)

  // ---------------------------------------------------------------------------------------------
  // 2. Render scheduling. The original is a React component: state changes re-render it in a later
  //    task, and every re-render re-runs its autoplay effect (clears the countdown, calls play()).
  //    commit() below is that re-render; set()/shift() queue it the way React batches updates.
  // ---------------------------------------------------------------------------------------------
  var pending = [];
  var channel = new MessageChannel();
  channel.port1.onmessage = function () {
    var list = pending;
    pending = [];
    for (var i = 0; i < list.length; i++) { list[i].queued = false; list[i].commit(); }
  };
  function queueRender(ctrl) {
    if (ctrl.queued) return;
    ctrl.queued = true;
    if (!pending.length) channel.port2.postMessage(0);
    pending.push(ctrl);
  }

  // ---------------------------------------------------------------------------------------------
  // 3. Snapshot / restore of the server markup (used when a phone-only instance unmounts).
  // ---------------------------------------------------------------------------------------------
  function snapshotAttrs(els, names) {
    return els.map(function (el) {
      var s = {};
      names.forEach(function (n) { s[n] = el.getAttribute(n); });
      return { el: el, s: s };
    });
  }
  function restoreAttrs(list) {
    list.forEach(function (it) {
      Object.keys(it.s).forEach(function (n) {
        if (it.s[n] === null) it.el.removeAttribute(n); else it.el.setAttribute(n, it.s[n]);
      });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // 4. View: one rendered copy of a slideshow (one breakpoint variant's <section>).
  // ---------------------------------------------------------------------------------------------
  function View(section, key) {
    this.section = section;
    this.key = key;
    this.ul = section.querySelector('ul');
    this.slides = Array.prototype.map.call(this.ul.children, function (li) { return li.firstElementChild; });
    this.count = this.slides.length / COPIES;
    var controls = section.querySelector('fieldset.framer--slideshow-controls');
    this.prev = controls.querySelector('button[aria-label="Previous"]');
    this.next = controls.querySelector('button[aria-label="Next"]');
    var dotBox = controls.children[1];
    this.dotButtons = dotBox ? Array.prototype.slice.call(dotBox.querySelectorAll('button')) : [];
    this.dots = this.dotButtons.map(function (b) { return b.firstElementChild; });
    this.focusables = this.slides.map(function (s) { return Array.prototype.slice.call(s.querySelectorAll('button,a')); });
    this.saved = [].concat(
      snapshotAttrs([section, this.ul].concat(this.dots, [this.prev, this.next]), ['style']),
      snapshotAttrs(this.slides, ['style', 'aria-hidden']),
      snapshotAttrs([].concat.apply([], this.focusables), ['tabindex', 'data-orig-tab-index'])
    );
    this.size = null;        // measurement (Framer's size state)
    this.sizeVersion = 0;
    this.fns = null;         // per-slide interpolators built from the measurement
    this.inRange = null;     // per-slide "fully in view" flags driving aria-hidden
    this.lastTx = null;
    this.dotTargets = null;
    this.dotAnims = [];
    this.listPrimed = false; // the first ResizeObserver callback after observe() is not a resize
    this.bound = false;
  }

  // Framer's measure(): first and last slide of the first copy, list width, viewport width.
  View.prototype.measure = function (gap) {
    var first = this.slides[0], last = this.slides[this.count - 1], ul = this.ul;
    var rtl = first && last && last.offsetLeft < first.offsetLeft;
    var a = rtl ? last : first, b = rtl ? first : last;
    var start = a ? a.offsetLeft : 0;
    this.setSize({
      parent: ul.offsetWidth,
      children: (b ? b.offsetLeft + b.offsetWidth : 0) - start + gap,
      item: a ? a.offsetWidth : 0,
      itemWidth: a ? a.offsetWidth : 0,
      itemHeight: a ? a.offsetHeight : 0,
      viewportLength: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0, ul.offsetWidth),
    }, gap);
  };

  View.prototype.setSize = function (size, gap) {
    this.size = size;
    this.sizeVersion = ++sizeCounter;
    // Per slide p: the position range in which it is fully inside the list, and the derived
    // visibility (hidden more than one viewport away) and transform-origin (100% -> 0% across the list).
    var fns = [];
    for (var p = 0; p < this.slides.length; p++) {
      var off = (size.item + gap) * p;
      var C = [-size.item - off, -off, size.parent - size.item + gap - off, size.parent - off];
      fns.push({
        lo: C[1], hi: C[2],
        vis: M.interpolate([C[0] - size.viewportLength, M.mix(C[1], C[2], 0.5), C[3] + size.viewportLength], ['hidden', 'visible', 'hidden']),
        origin: M.interpolate(C, [1, 1, 0, 0]),
      });
    }
    this.fns = fns;
  };

  // What the original's motion values render for the current position: list transform, slide
  // visibility / transform-origin, and aria-hidden + tabindex when a slide enters or leaves the list.
  View.prototype.paint = function (ctrl) {
    var size = this.size;
    if (!size) return;
    var ot = size.children;
    var raw = ctrl.x.get();
    var tx = M.wrap(-ot, -ot * 2, raw * 1);
    if (isNaN(tx)) tx = 0;
    if (tx !== this.lastTx) {
      this.lastTx = tx;
      this.ul.style.transform = tx === 0 ? 'none' : 'translateX(' + tx + 'px)';
    }
    for (var p = 0; p < this.slides.length; p++) {
      var f = this.fns[p], el = this.slides[p];
      var vis = f.vis(tx);
      if (el.style.visibility !== vis) el.style.visibility = vis;
      var origin = f.origin(tx) * 100 + '% 50% 0';
      if (el.__origin !== origin) { el.__origin = origin; el.style.transformOrigin = origin; }
      var inside = tx >= f.lo && tx <= f.hi;
      if (inside !== this.inRange[p]) { this.inRange[p] = inside; this.setHidden(p, !inside); }
    }
  };

  // The original's aria handler: hidden slides get aria-hidden="true" and their buttons/links tabindex -1
  // (an existing tabindex is kept in data-orig-tab-index and restored when the slide comes back).
  View.prototype.setHidden = function (p, hidden) {
    var el = this.slides[p];
    this.focusables[p].forEach(function (f) {
      if (!hidden) {
        var orig = f.dataset.origTabIndex;
        if (orig) f.tabIndex = orig; else f.removeAttribute('tabIndex');
      } else {
        var t = f.getAttribute('tabIndex');
        if (t) f.dataset.origTabIndex = t;
        f.tabIndex = -1;
      }
    });
    el.setAttribute('aria-hidden', hidden);
  };

  // Dots: current one at activeOpacity, others at opacity, 0.3 s tween on change (no animation at mount).
  View.prototype.paintDots = function (index, dotsProps) {
    if (!this.dots.length || !dotsProps) return;
    var current = M.wrap(0, this.count, index);
    for (var i = 0; i < this.dots.length; i++) {
      var target = current === i ? dotsProps.activeOpacity : dotsProps.opacity;
      if (this.dotTargets[i] !== target) {
        this.dotTargets[i] = target;
        this.dotAnims[i] = M.animate(this.dots[i], { opacity: target }, { duration: 0.3 });
      }
    }
  };

  // ---------------------------------------------------------------------------------------------
  // 5. Controller: the component state of one slideshow instance. Shared by its breakpoint variants,
  //    because live keeps one component across breakpoints (index and position carry over).
  // ---------------------------------------------------------------------------------------------
  function Controller(key, props) {
    var self = this;
    this.key = key;
    this.p = props;
    this.view = null;
    this.x = M.motionValue(null); // raw position; starts null like the original (velocity never tracked)
    this.index = null;            // slide counter, starts at startFrom + slide count (2nd copy)
    this.autoPlayOn = props.autoPlay;
    this.hovering = false;        // only re-renders here (the original fades arrows in with it; off on this site)
    this.mouseDown = false;
    this.dragging = false;
    this.resizing = false;
    this.inView = false;
    this.pageVisible = !document.hidden;
    this.sawFirstResize = false;  // the original ignores its first ResizeObserver callback
    this.timer = null;            // autoplay countdown
    this.autoplayCleanup = false;
    this.resizeEndTimer = null;
    this.lastResizing = false;
    this.lastDeps = null;
    this.renderedIndex = null;
    this.queued = false;
    // Like a motion component, DOM output is written in the frame loop's render step, so a value that is
    // set and then overridden by a running animation within the same frame is never painted.
    this.paintQueued = false;
    this.paintTask = function () { self.paintQueued = false; if (self.view) self.view.paint(self); };
    this.x.on('change', function () { self.schedulePaint(); });
  }

  Controller.prototype.schedulePaint = function () {
    if (this.paintQueued) return;
    this.paintQueued = true;
    M.frame.render(this.paintTask, false, true);
  };

  Controller.prototype.target = function (index, size) {
    return -index * (size.item + this.p.gap);
  };

  // State setters. Like useState, setting an unchanged value does not re-render.
  Controller.prototype.set = function (name, value) {
    if (this[name] === value) return;
    this[name] = value;
    queueRender(this);
  };
  Controller.prototype.shift = function (n) {
    this.index += n;
    queueRender(this);
  };

  // One re-render: render-phase values, then the layout effect, then the autoplay effect.
  Controller.prototype.commit = function () {
    var v = this.view;
    if (!v) return;
    var p = this.p;
    if (v.size) v.section.style.opacity = '1';
    v.ul.style.cursor = p.drag ? (this.mouseDown ? 'grabbing' : 'grab') : 'auto';
    this.schedulePaint();
    v.paintDots(this.index, p.dots);
    this.renderedIndex = this.index;

    // While resizing, the position jumps straight to the current slide (no transition).
    var deps = v.sizeVersion + '|' + this.index + '|' + this.resizing;
    if (deps !== this.lastDeps) {
      this.lastDeps = deps;
      if (v.size && this.sawFirstResize && this.resizing) this.x.set(this.target(this.index, v.size));
    }

    // "Resizing" clears itself 500 ms after it was set.
    if (this.resizing !== this.lastResizing) {
      this.lastResizing = this.resizing;
      clearTimeout(this.resizeEndTimer);
      if (this.resizing) {
        var self = this;
        this.resizeEndTimer = setTimeout(function () { self.set('resizing', false); }, 500);
      }
    }

    // Autoplay effect: runs on every re-render.
    if (this.autoplayCleanup) { this.autoplayCleanup = false; if (this.timer) clearTimeout(this.timer); }
    if (this.inView && this.pageVisible && !this.resizing && v.count > 1) {
      this.autoplayCleanup = true;
      this.play(this.snapshot());
    }
  };

  // The values one render's play() closes over (the countdown calls the play() of the render that set it).
  Controller.prototype.snapshot = function () {
    var v = this.view;
    return {
      size: v && v.size, index: this.index, dragging: this.dragging, autoPlayOn: this.autoPlayOn,
      visible: this.inView && this.pageVisible,
    };
  };

  // Spring to the current slide if not there, then (autoplay) count down to the next one.
  Controller.prototype.play = function (s) {
    var p = this.p, self = this;
    if (!s.size || !s.size.parent || s.dragging) return;
    var target = this.target(s.index, s.size);
    if (this.x.get() !== target) M.animate(this.x, target, p.transition);
    if (p.autoPlay && s.autoPlayOn && (p.playOffscreen || s.visible)) {
      this.timer = setTimeout(function () {
        self.shift(1);
        self.play(s);
      }, p.interval * 1000);
    }
  };

  // Framer's re-measure: next animation frame (read phase), then a re-render.
  Controller.prototype.remeasure = function (then) {
    var self = this, v = this.view;
    queueMicrotask(function () {
      M.frame.read(function () {
        if (self.view !== v) return;
        v.measure(self.p.gap);
        queueRender(self);
        if (then) then();
      }, false, true);
    });
  };

  // Called by the list's ResizeObserver. Inside one breakpoint the "resizing" render comes first (so the
  // new measurement jumps); when a breakpoint changes, live re-renders the whole page and the new
  // measurement lands first, so the slideshow springs to the new position and then pauses for 500 ms.
  Controller.prototype.onListResize = function (width, height) {
    if (!(width || height)) return;
    var self = this;
    if (breakpointChanging) {
      this.remeasure(function () { queueTask(function () { self.set('resizing', true); }); });
    } else {
      this.remeasure();
      this.set('resizing', true);
    }
  };

  // Section hover / press, as the original's mouse handlers.
  Controller.prototype.bindInput = function (v, signal) {
    var self = this, p = this.p, opts = { signal: signal };
    v.section.addEventListener('mouseenter', function () {
      self.set('hovering', true);
      if (!p.effectsHover) self.set('autoPlayOn', false);
    }, opts);
    v.section.addEventListener('mouseleave', function () {
      self.set('hovering', false);
      if (!p.effectsHover) self.set('autoPlayOn', true);
    }, opts);
    v.section.addEventListener('mousedown', function (e) {
      e.preventDefault();
      self.set('mouseDown', true);
    }, opts);
    v.section.addEventListener('mouseup', function () { self.set('mouseDown', false); }, opts);

    // Arrows: one slide back / forward. Pressed arrows scale to 0.9 over 0.15 s.
    v.prev.addEventListener('click', function () { self.shift(-1); }, opts);
    v.next.addEventListener('click', function () { self.shift(1); }, opts);
    // (A motion value rather than animate(element): like the original, this ignores prefers-reduced-motion.)
    var pressScale = function (el) {
      if (!el.__ssScale) {
        el.__ssScale = M.motionValue(1);
        el.__ssScale.on('change', function (s) { el.style.transform = s === 1 ? 'none' : 'scale(' + s + ')'; });
      }
      M.animate(el.__ssScale, 0.9, { duration: 0.15 });
      return function () { M.animate(el.__ssScale, 1, { duration: 0.15 }); };
    };
    var cancelPrev = M.press(v.prev, pressScale), cancelNext = M.press(v.next, pressScale);
    signal.addEventListener('abort', function () { cancelPrev(); cancelNext(); });

    // Dots: jump to page i of the set currently showing.
    v.dotButtons.forEach(function (b, i) {
      b.addEventListener('click', function () {
        self.shift(i - M.wrap(0, v.count, self.renderedIndex));
      }, opts);
    });

    // Drag.
    if (p.drag) {
      v.ul.addEventListener('pointerdown', function (e) {
        var t = e.target;
        if (t !== v.ul && (TEXT_INPUTS[t.tagName] || t.isContentEditable === true)) return;
        if (!M.isPrimaryPointer(e)) return;
        startDrag(self, v, e);
      }, { passive: true, signal: signal });
    }
  };

  // ---------------------------------------------------------------------------------------------
  // 6. Drag: Framer Motion's pan session + drag controls (drag="x", direction lock, no momentum),
  //    then the original's onDragEnd rules.
  // ---------------------------------------------------------------------------------------------
  function panInfo(point, history) {
    return { point: point, offset: { x: point.x - history[0].x, y: point.y - history[0].y }, velocity: velocity(history, 0.1) };
  }

  function velocity(history, timeDelta) {
    if (history.length < 2) return { x: 0, y: 0 };
    var i = history.length - 1, from = null, last = history[history.length - 1];
    while (i >= 0) {
      from = history[i];
      if (last.timestamp - from.timestamp > timeDelta * 1000) break;
      i--;
    }
    if (!from) return { x: 0, y: 0 };
    if (from === history[0] && history.length > 2 && last.timestamp - from.timestamp > timeDelta * 1000 * 2) from = history[1];
    var time = (last.timestamp - from.timestamp) / 1000;
    if (time === 0) return { x: 0, y: 0 };
    var v = { x: (last.x - from.x) / time, y: (last.y - from.y) / time };
    if (v.x === Infinity) v.x = 0;
    if (v.y === Infinity) v.y = 0;
    return v;
  }

  function startDrag(ctrl, view, event) {
    var s = { startEvent: null, lastMove: null, lastPoint: null, dragging: false, direction: null, origin: 0, unlock: null };

    // Session start: stop the running slide animation.
    ctrl.x.stop();
    s.history = [{ x: event.pageX, y: event.pageY, timestamp: M.frameData.timestamp }];

    function updatePoint() {
      if (!s.lastMove || !s.lastPoint) return;
      var info = panInfo(s.lastPoint, s.history);
      var started = s.startEvent !== null;
      var past = Math.sqrt(info.offset.x * info.offset.x + info.offset.y * info.offset.y) >= 3;
      if (!started && !past) return;
      s.history.push({ x: info.point.x, y: info.point.y, timestamp: M.frameData.timestamp });
      if (!started) { onStart(); s.startEvent = s.lastMove; }
      onMove(info);
    }

    function onStart() {
      var unlock = M.setDragLock('x');
      if (!unlock) return;
      s.unlock = unlock;
      s.dragging = true;
      s.direction = null;
      s.origin = ctrl.x.get() || 0;
      M.frame.update(function () { ctrl.set('dragging', true); }, false, true);
    }

    function onMove(info) {
      if (!s.unlock) return;
      if (s.direction === null) {
        var o = info.offset;
        s.direction = Math.abs(o.y) > 10 ? 'y' : Math.abs(o.x) > 10 ? 'x' : null;
        return;
      }
      if (s.direction === 'x') ctrl.x.set(s.origin + info.offset.x);
    }

    function onPointerMove(e) {
      if (!M.isPrimaryPointer(e)) return;
      s.lastMove = e;
      s.lastPoint = { x: e.pageX, y: e.pageY };
      M.frame.update(updatePoint, true);
    }

    function onPointerUp(e) {
      if (!M.isPrimaryPointer(e)) return;
      end();
      if (!s.lastMove || !s.lastPoint) return;
      var info = panInfo(e.type === 'pointercancel' ? s.lastPoint : { x: e.pageX, y: e.pageY }, s.history);
      var wasDragging = s.dragging;
      s.dragging = false;
      if (s.unlock) { s.unlock(); s.unlock = null; }
      if (!wasDragging) return;
      // (Framer Motion starts a zero-velocity inertia animation here; it does not move anything.)
      M.frame.postRender(function () { onDragEnd(info); });
    }

    function onDragEnd(info) {
      ctrl.set('dragging', false);
      var v = ctrl.view;
      if (!v || !v.size) return;
      var item = v.size.item;
      var dx = info.offset.x, vx = info.velocity.x;
      var back = dx < -item / 2, fwd = dx > item / 2;
      var c = Math.round(Math.abs(dx) / item), l = c === 0 ? 1 : c;
      if (vx > 200) ctrl.shift(-l);
      else if (vx < -200) ctrl.shift(l);
      else { if (back) ctrl.shift(c); if (fwd) ctrl.shift(-c); }
    }

    // Scrolling during a drag: window scroll moves the pointer point, element scroll the start point.
    var scrolls = new Map();
    for (var el = view.ul.parentElement; el; el = el.parentElement) {
      var cs = getComputedStyle(el);
      if (/auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY)) scrolls.set(el, { x: el.scrollLeft, y: el.scrollTop });
    }
    scrolls.set(window, { x: window.scrollX, y: window.scrollY });
    function handleScroll(target) {
      var prev = scrolls.get(target);
      if (!prev) return;
      var isWin = target === window;
      var now = isWin ? { x: window.scrollX, y: window.scrollY } : { x: target.scrollLeft, y: target.scrollTop };
      var d = { x: now.x - prev.x, y: now.y - prev.y };
      if (d.x === 0 && d.y === 0) return;
      if (isWin) { if (s.lastPoint) { s.lastPoint.x += d.x; s.lastPoint.y += d.y; } }
      else if (s.history.length > 0) { s.history[0].x -= d.x; s.history[0].y -= d.y; }
      scrolls.set(target, now);
      M.frame.update(updatePoint, true);
    }
    function onElementScroll(e) { handleScroll(e.target); }
    function onWindowScroll() { handleScroll(window); }

    function end() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('scroll', onElementScroll, { capture: true });
      window.removeEventListener('scroll', onWindowScroll);
      scrolls.clear();
      M.cancelFrame(updatePoint);
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    window.addEventListener('scroll', onElementScroll, { capture: true });
    window.addEventListener('scroll', onWindowScroll);
  }

  // ---------------------------------------------------------------------------------------------
  // 7. Binding views to controllers: start a variant when it is rendered, hand state over to the
  //    variant of the next breakpoint, and reset a phone-only instance when it disappears.
  // ---------------------------------------------------------------------------------------------
  var controllers = {};
  var views = [];

  function queueTask(fn) {
    var ch = new MessageChannel();
    ch.port1.onmessage = function () { fn(); };
    ch.port2.postMessage(0);
  }

  var listObserver = new ResizeObserver(function (entries) {
    entries.forEach(function (e) {
      var v = e.target.__ssView;
      if (!v || !v.bound) return;
      var ctrl = controllers[v.key];
      if (!ctrl || ctrl.view !== v) return;
      if (!v.listPrimed) { v.listPrimed = true; ctrl.sawFirstResize = true; return; }
      ctrl.onListResize(e.contentRect.width, e.contentRect.height);
    });
  });

  var viewObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var v = e.target.__ssView;
      var ctrl = v && controllers[v.key];
      if (ctrl && ctrl.view === v) ctrl.set('inView', e.isIntersecting);
    });
  }, { threshold: 0 });

  function bind(v) {
    var p = SLIDESHOWS[v.key];
    var ctrl = controllers[v.key];
    var prev = ctrl && ctrl.lastView;
    v.bound = true;
    v.abort = new AbortController();
    v.listPrimed = false;

    if (!ctrl) {
      // Fresh mount.
      ctrl = controllers[v.key] = new Controller(v.key, p);
      ctrl.index = p.startFrom + v.count;
      v.inRange = v.slides.map(function (_, i) { return i <= 1; }); // first render: size unknown, position 0
      v.slides.forEach(function (_, i) { v.setHidden(i, false); }); // mount: every slide aria-hidden="false"
      v.dotTargets = p.dots ? v.dots.map(function (_, i) { return M.wrap(0, v.count, ctrl.index) === i ? p.dots.activeOpacity : p.dots.opacity; }) : [];
      ctrl.view = v;
      ctrl.lastView = v;
      ctrl.bindInput(v, v.abort.signal);
      viewObserver.observe(v.section);
      listObserver.observe(v.ul);
      ctrl.remeasure();
      return;
    }

    // Same instance, next breakpoint: carry the slides' state over, keep the old measurement until the
    // new one lands (so the first frame shows what live shows), then spring to the new position.
    v.inRange = prev.inRange.slice();
    v.slides.forEach(function (el, i) {
      var old = prev.slides[i];
      el.setAttribute('aria-hidden', old.getAttribute('aria-hidden'));
      el.style.visibility = old.style.visibility;
      el.style.transformOrigin = old.style.transformOrigin;
      el.__origin = old.__origin;
      v.focusables[i].forEach(function (f, j) {
        var o = prev.focusables[i][j];
        if (!o) return;
        ['tabindex', 'data-orig-tab-index'].forEach(function (n) {
          var val = o.getAttribute(n);
          if (val === null) f.removeAttribute(n); else f.setAttribute(n, val);
        });
      });
    });
    v.dotTargets = prev.dotTargets ? prev.dotTargets.slice() : [];
    if (prev.size) {
      v.size = prev.size;
      v.setSize(prev.size, p.gap);
      v.section.style.opacity = '1';
    }
    ctrl.view = v;
    ctrl.lastView = v;
    v.lastTx = null;
    v.paint(ctrl); // same frame as the switch: show the position the previous variant showed
    ctrl.bindInput(v, v.abort.signal);
    viewObserver.observe(v.section);
    listObserver.observe(v.ul);
    ctrl.remeasure(function () { queueTask(function () { ctrl.set('resizing', true); }); });
  }

  function unbind(v) {
    var ctrl = controllers[v.key];
    v.bound = false;
    if (v.abort) v.abort.abort();
    viewObserver.unobserve(v.section);
    listObserver.unobserve(v.ul);
    if (!ctrl || ctrl.view !== v) return;
    ctrl.view = null;
    if (ctrl.p.phoneOnly) {
      // Unmounted on live: stop everything and put the server markup back for the next mount.
      clearTimeout(ctrl.timer);
      clearTimeout(ctrl.resizeEndTimer);
      ctrl.x.stop();
      delete controllers[v.key];
      v.size = null;
      v.fns = null;
      v.lastTx = null;
      v.dotAnims.forEach(function (a) { if (a) a.cancel(); });
      v.dotAnims = [];
      restoreAttrs(v.saved);
      v.slides.forEach(function (el) { el.__origin = undefined; });
    }
  }

  function rendered(section) { return section.getClientRects().length > 0; }

  // Re-check which variants are rendered: hide first (so state can move), then show.
  function sync() {
    views.forEach(function (v) { if (v.bound && !rendered(v.section)) unbind(v); });
    views.forEach(function (v) { if (!v.bound && rendered(v.section)) bind(v); });
  }

  var sectionObserver = new ResizeObserver(sync);

  // A breakpoint change re-renders the whole live page: every slideshow re-renders (its countdown restarts).
  var breakpointChanging = false;
  BREAKPOINTS.forEach(function (q) {
    var mq = window.matchMedia(q);
    var onChange = function () {
      breakpointChanging = true;
      requestAnimationFrame(function () { setTimeout(function () { breakpointChanging = false; }, 0); });
      sync(); // switch variants before this frame's callbacks run
      Object.keys(controllers).forEach(function (k) { queueRender(controllers[k]); });
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else mq.addListener(onChange);
  });

  document.addEventListener('visibilitychange', function () {
    Object.keys(controllers).forEach(function (k) { controllers[k].set('pageVisible', !document.hidden); });
  });

  // ---------------------------------------------------------------------------------------------
  // 8. Start.
  // ---------------------------------------------------------------------------------------------
  function containerKey(section) {
    for (var el = section.parentElement; el; el = el.parentElement) {
      for (var i = 0; i < el.classList.length; i++) {
        var c = el.classList[i];
        if (/^framer-[a-z0-9]+-container$/.test(c)) return c;
      }
    }
    return null;
  }

  function init() {
    var sections = Array.prototype.map.call(document.querySelectorAll('fieldset.framer--slideshow-controls'), function (f) { return f.closest('section'); });
    sections.forEach(function (section) {
      var key = section && containerKey(section);
      if (!key || !SLIDESHOWS[key]) return;
      var v = new View(section, key);
      section.__ssView = v;
      v.ul.__ssView = v;
      views.push(v);
      sectionObserver.observe(section);
    });
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
