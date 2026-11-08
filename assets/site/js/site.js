/*
 * site.js - page behaviour for the static copy of home.brandslane.co (no Framer runtime).
 *
 * The markup and CSS are Framer's own server render, so layout is exact by construction. This file adds
 * what Framer's runtime did after hydration, using the same animation library (Motion, window.Motion)
 * and the exact constants read from the live site's components:
 *
 *   1. Query-string carry-over on internal links (Framer's inline script, ported as-is)
 *   2. Shared helpers: CSS value resolution, style transitions, layout (FLIP/projection) transitions
 *   3. Smooth scroll (Lenis 1.0.42, duration 1 - Framer's "Smooth Scroll" component, intensity 10)
 *   4. Header: hide on scroll down / show on scroll up, "Entry" -> "Main" variant past the nav trigger,
 *      phone menu open / close
 *   5. Hover and press states of the button components
 *   6. Shimmer loop on the "Scale My Brand" buttons
 *   7. Ticker (the moving strip of creatives)
 *   8. YouTube embeds (thumbnail -> player on press)
 *
 * Slideshows live in slideshow.js.
 */
(function () {
  'use strict';

  var M = window.Motion;
  var REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ===============================================================================================
  // 1. Query-string carry-over: when the page URL has ?params, internal links keep them
  //    (e.g. UTM tags, Calendly booking details). Same logic as Framer's inline script.
  // ===============================================================================================
  (function preserveQueryParams() {
    var IGNORED = 'framer_variant';
    function merge(search, href) {
      var hashAt = href.indexOf('#');
      var base = hashAt === -1 ? href : href.substring(0, hashAt);
      var hash = hashAt === -1 ? '' : href.substring(hashAt);
      var queryAt = base.indexOf('?');
      var path = queryAt === -1 ? base : base.substring(0, queryAt);
      var own = new URLSearchParams(queryAt === -1 ? '' : base.substring(queryAt));
      new URLSearchParams(search).forEach(function (value, key) {
        if (!own.has(key) && key !== IGNORED) own.append(key, value);
      });
      var query = own.toString();
      return query === '' ? base + hash : path + '?' + query + hash;
    }
    var internal = 'div#main a[href^="#"],div#main a[href^="/"],div#main a[href^="."]';
    var flagged = 'div#main a[data-framer-preserve-params]';
    var isBot = /bot|-google|google-|yandex|ia_archiver|crawl|spider/iu.test(navigator.userAgent);
    if (window.location.search && !navigator.webdriver && !isBot) {
      document.querySelectorAll(internal + ',' + flagged).forEach(function (a) {
        a.setAttribute('href', merge(window.location.search, a.href));
      });
    }
  })();

  // -----------------------------------------------------------------------------------------------
  // 1b. Images: files are the exact bytes Chrome gets from Framer's CDN (mostly AVIF). Browsers without
  //     AVIF support (older iOS) get the WebP/original copies listed in images/fallbacks.json.
  // -----------------------------------------------------------------------------------------------
  (function avifFallback() {
    var probe = new Image();
    probe.onerror = function () {
      fetch('/assets/site/images/fallbacks.json').then(function (r) { return r.json(); }).then(function (map) {
        var swap = function (value) {
          return value.replace(/\/assets\/site\/images\/[^\s,"]+\.avif/g, function (path) { return map[path] || path; });
        };
        document.querySelectorAll('img').forEach(function (img) {
          if (img.srcset && img.srcset.indexOf('.avif') !== -1) img.srcset = swap(img.srcset);
          if (img.getAttribute('src') && img.getAttribute('src').indexOf('.avif') !== -1) img.src = swap(img.getAttribute('src'));
        });
      }).catch(function () {});
    };
    probe.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';
  })();

  if (!M || !M.animate) return;

  // ===============================================================================================
  // 2. Helpers
  // ===============================================================================================

  /** Replace var(--x, fallback) with the computed value of --x on el (or the fallback). */
  function resolveVars(value, el) {
    var guard = 0;
    while (value.indexOf('var(') !== -1 && guard++ < 10) {
      value = value.replace(/var\((--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*(?:\([^()]*\))*[^()]*\))*))?\)/g, function (m, name, fallback) {
        var v = window.getComputedStyle(el).getPropertyValue(name).trim();
        return v || (fallback || '').trim();
      });
    }
    return value;
  }

  function cssName(prop) {
    return prop.indexOf('-') !== -1 ? prop : prop.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
  }

  /**
   * Animate inline style values of el to `to` with a Motion transition. Like Framer Motion, a progress
   * value runs 0 -> 100 on the given spring/tween and each value is mixed from its current value.
   * When done, the declared target strings are written back (so var() references stay as authored).
   */
  var runningStyles = new WeakMap();
  function animateStyles(el, to, transition) {
    var prev = runningStyles.get(el);
    if (prev) prev.stop();
    var props = Object.keys(to);
    var computed = window.getComputedStyle(el);
    var mixers = {};
    var changed = props.filter(function (p) {
      var name = cssName(p);
      var from = (el.style.getPropertyValue(name) || computed.getPropertyValue(name)).trim();
      var a = resolveVars(from, el), b = resolveVars(String(to[p]), el);
      if (a === b && from === String(to[p])) return false;
      try { mixers[p] = M.mix(a, b); } catch (e) { mixers[p] = function (t) { return t < 0.5 ? a : b; }; }
      return true;
    });
    if (!changed.length) return;
    var progress = M.motionValue(0);
    var unsubscribe = progress.on('change', function (v) {
      for (var i = 0; i < changed.length; i++) el.style.setProperty(cssName(changed[i]), mixers[changed[i]](v / 100));
    });
    var animation = M.animate(progress, 100, transition);
    var handle = {
      stop: function () { animation.stop(); unsubscribe(); runningStyles.delete(el); },
    };
    runningStyles.set(el, handle);
    animation.then(function () {
      if (runningStyles.get(el) !== handle) return;
      unsubscribe();
      runningStyles.delete(el);
      for (var i = 0; i < changed.length; i++) el.style.setProperty(cssName(changed[i]), String(to[changed[i]]));
    });
  }

  /**
   * Layout transition (what Framer Motion's layout projection does when a variant changes layout):
   * every element of the component animates from its previous box to its new box, each box expressed
   * relative to its parent's box, so nested elements stay undistorted while their parents move or grow.
   *   root:     component root element
   *   mutate:   function that applies the variant (class swap, DOM changes)
   *   transition: Motion transition
   * Elements excluded from projection keep their own transforms (e.g. the rotating shimmer).
   */
  var runningLayout = new WeakMap();
  function isProjected(el) {
    if (!(el instanceof HTMLElement) && !(el instanceof SVGSVGElement)) return false;
    // never touch transforms that are part of the server markup (e.g. centred play buttons)
    if (el.__blAuthoredTransform === undefined) el.__blAuthoredTransform = el.style.transform || '';
    if (el.__blAuthoredTransform && el.__blAuthoredTransform !== 'none' && !el.hasAttribute('data-bl-template')) return false;
    if (el.closest('[data-framer-component-type="RichTextContainer"] *')) return false;
    if (el.closest('[data-framer-name="Shimmer"]')) return false;
    if (el.tagName === 'P' || el.tagName === 'SPAN' || el.tagName === 'BR' || el.tagName === 'IMG') return false;
    return true;
  }
  function projectedNodes(root) {
    var out = [root];
    root.querySelectorAll('*').forEach(function (el) { if (isProjected(el)) out.push(el); });
    return out;
  }
  function boxOf(el) { var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
  function layoutTransition(root, mutate, transition, template) {
    // template(el) -> transform prefix Framer applies before the projection (its transformTemplate), or ''
    template = template || function () { return ''; };
    var prev = runningLayout.get(root);
    if (prev) prev.stop();
    // 1. current visual boxes (include any in-flight transforms), relative to the parent node
    var before = new Map();
    var nodesBefore = projectedNodes(root);
    nodesBefore.forEach(function (el) {
      if (template(el)) { var keep = el.style.transform; el.style.transform = ''; before.set(el, boxOf(el)); el.style.transform = keep; }
      else before.set(el, boxOf(el));
    });
    // 2. apply the change with transforms cleared and measure the new layout boxes
    nodesBefore.forEach(function (el) { el.style.transform = ''; });
    mutate();
    var nodes = projectedNodes(root);
    nodes.forEach(function (el) { el.style.transform = ''; });
    var after = new Map();
    nodes.forEach(function (el) { after.set(el, boxOf(el)); });
    function parentNode(el) {
      for (var p = el.parentElement; p; p = p.parentElement) { if (after.has(p)) return p; if (p === root) return root; }
      return null;
    }
    function rel(box, parentBox) {
      return parentBox ? { x: box.x - parentBox.x, y: box.y - parentBox.y, w: box.w, h: box.h } : box;
    }
    var plans = nodes.map(function (el) {
      var parent = el === root ? null : parentNode(el);
      var layout = after.get(el);
      var to = rel(layout, parent ? after.get(parent) : null);
      var b0 = before.get(el);
      var from = b0 ? rel(b0, parent ? (before.get(parent) || after.get(parent)) : null) : to;
      return { el: el, parent: parent, layout: layout, from: from, to: to };
    });
    var moving = plans.some(function (p) {
      return Math.abs(p.from.x - p.to.x) > 0.5 || Math.abs(p.from.y - p.to.y) > 0.5 || Math.abs(p.from.w - p.to.w) > 0.5 || Math.abs(p.from.h - p.to.h) > 0.5;
    });
    if (!moving) return;
    var maps = new Map(); // el -> { visual box, affine map page->visual: {ax, bx, ay, by} }
    function render(t) {
      for (var i = 0; i < plans.length; i++) {
        var p = plans[i];
        var parentInfo = p.parent ? maps.get(p.parent) : null;
        var origin = parentInfo ? parentInfo.box : { x: 0, y: 0 };
        var target = {
          x: origin.x + M.mix(p.from.x, p.to.x, t), y: origin.y + M.mix(p.from.y, p.to.y, t),
          w: M.mix(p.from.w, p.to.w, t), h: M.mix(p.from.h, p.to.h, t),
        };
        if (!p.parent) { target.x = M.mix(p.from.x, p.to.x, t); target.y = M.mix(p.from.y, p.to.y, t); }
        var P = parentInfo ? parentInfo.map : { ax: 1, bx: 0, ay: 1, by: 0 };
        // target box in the parent's (untransformed) coordinate space
        var lx = (target.x - P.bx) / P.ax, ly = (target.y - P.by) / P.ay, lw = target.w / P.ax, lh = target.h / P.ay;
        var L = p.layout;
        var sx = L.w ? lw / L.w : 1, sy = L.h ? lh / L.h : 1;
        var cx = L.x + L.w / 2, cy = L.y + L.h / 2;
        var tx = (lx + lw / 2) - cx, ty = (ly + lh / 2) - cy;
        var identity = Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01 && Math.abs(sx - 1) < 0.0001 && Math.abs(sy - 1) < 0.0001;
        p.el.style.transformOrigin = '50% 50% 0px';
        var prefix = template(p.el);
        var own = identity ? '' : 'translateX(' + tx + 'px) translateY(' + ty + 'px) scale(' + sx + ', ' + sy + ')';
        p.el.style.transform = prefix ? (prefix + (own ? ' ' + own : '')) : (own || 'none');
        // this node's full map page -> visual: x -> P(c + t + s(x - c))
        var ax = P.ax * sx, bx = P.ax * (cx + tx - sx * cx) + P.bx;
        var ay = P.ay * sy, by = P.ay * (cy + ty - sy * cy) + P.by;
        maps.set(p.el, { box: target, map: { ax: ax, bx: bx, ay: ay, by: by } });
      }
    }
    var progress = M.motionValue(0);
    var unsubscribe = progress.on('change', function (v) { render(v / 100); });
    render(0);
    var animation = M.animate(progress, 100, transition);
    var handle = { stop: function () { animation.stop(); unsubscribe(); runningLayout.delete(root); } };
    runningLayout.set(root, handle);
    animation.then(function () {
      if (runningLayout.get(root) !== handle) return;
      unsubscribe();
      runningLayout.delete(root);
      plans.forEach(function (p) { p.el.style.transform = template(p.el) || 'none'; p.el.style.transformOrigin = '50% 50% 0px'; });
    });
  }

  /** Swap a variant class in place (keeps class order like Framer's className). */
  function replaceClass(el, from, to) {
    var list = el.getAttribute('class').split(/\s+/);
    var i = list.indexOf(from);
    if (i === -1) { if (to) list.push(to); } else if (to) list[i] = to; else list.splice(i, 1);
    el.setAttribute('class', list.join(' '));
  }
  function insertClassAfter(el, after, cls) {
    var list = el.getAttribute('class').split(/\s+/).filter(function (c) { return c !== cls; });
    var i = list.indexOf(after);
    list.splice(i === -1 ? list.length : i + 1, 0, cls);
    el.setAttribute('class', list.join(' '));
  }
  function removeClass(el, cls) {
    el.setAttribute('class', el.getAttribute('class').split(/\s+/).filter(function (c) { return c !== cls; }).join(' '));
  }
  function isRendered(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }

  // ===============================================================================================
  // 3. Smooth scroll: Framer's "Smooth Scroll" component = Lenis with duration intensity / 10 = 1.
  //    Lenis stops while something is open in #overlay with the page overflow hidden.
  // ===============================================================================================
  var lenis = null;
  if (window.Lenis) {
    lenis = new window.Lenis({ duration: 1 });
    var lenisFrame = function (time) { lenis.raf(time); window.requestAnimationFrame(lenisFrame); };
    window.requestAnimationFrame(lenisFrame);
    var overlay = document.getElementById('overlay');
    if (overlay) {
      new MutationObserver(function () {
        if (overlay.children.length > 0 && window.getComputedStyle(document.documentElement).overflow === 'hidden') lenis.stop();
        else lenis.start();
      }).observe(overlay, { childList: true });
    }
  }

  // ===============================================================================================
  // 4. Header
  //    a) The fixed header container fades out (opacity 0) when scrolling down and back in when
  //       scrolling up: a direction change only sets an anchor; the change applies once the page has
  //       moved 4px from it. Spring: bounce 0.2, duration 0.4. Disabled on the phone layout.
  //    b) The header variant switches from "Entry" to "Main" (white background, bottom border) once
  //       the page has scrolled past the hidden "Nav Trigger" element (its top - 1px).
  //    c) Phone: the menu icon opens a full-height white menu (variant "Mobile Open"); the icon or a
  //       menu link closes it again (variant "Mobile Close").
  // ===============================================================================================
  var HEADER_TRANSITION = { type: 'spring', bounce: 0, duration: 0.4, delay: 0 };
  var HEADER_FADE_TRANSITION = { type: 'spring', bounce: 0.2, duration: 0.4, delay: 0 };
  var HEADER_BASE_STYLE = {
    '--border-bottom-width': '0px', '--border-color': 'rgba(0, 0, 0, 0)', '--border-left-width': '0px',
    '--border-right-width': '0px', '--border-style': 'solid', '--border-top-width': '0px',
    'background-color': 'rgba(255, 255, 255, 0)',
  };
  var HEADER_WITH_BORDER = {
    '--border-bottom-width': '1px', '--border-color': 'var(--token-b59961ac-bb9c-4d3e-873f-758921c03a4b, rgb(230, 230, 230))',
    '--border-left-width': '0px', '--border-right-width': '0px', '--border-style': 'solid', '--border-top-width': '0px',
    'background-color': 'rgb(255, 255, 255)',
  };
  var HEADER_VARIANTS = {
    'Desktop Entry': { cls: 'framer-v-1o82wu8', style: {}, border: false, phone: false },
    'Desktop Main': { cls: 'framer-v-76xs8t', style: HEADER_WITH_BORDER, border: true, phone: false },
    'Mobile Close Entry': { cls: 'framer-v-1vjkvr', style: {}, border: false, phone: true },
    'Mobile Close': { cls: 'framer-v-1ueco5x', style: HEADER_WITH_BORDER, border: true, phone: true },
    'Mobile Open': { cls: 'framer-v-43i80e', style: { 'background-color': 'rgb(255, 255, 255)' }, border: false, phone: true, open: true },
  };
  function headerStyle(name) {
    var out = {}, k;
    for (k in HEADER_BASE_STYLE) out[k] = HEADER_BASE_STYLE[k];
    for (k in HEADER_VARIANTS[name].style) out[k] = HEADER_VARIANTS[name].style[k];
    return out;
  }
  function variantFromClass(el) {
    for (var name in HEADER_VARIANTS) if (el.classList.contains(HEADER_VARIANTS[name].cls)) return name;
    return null;
  }

  var headers = [];
  document.querySelectorAll('.framer-6qags').forEach(function (root) {
    var variant = variantFromClass(root);
    if (!variant) return;
    var container = root.closest('[class$="-container"]');
    // The phone copy of the header sits in a breakpoint wrapper hidden at the three larger breakpoints.
    // On every page the phone breakpoint switches the hide-on-scroll effect off.
    var wrapper = root.closest('.ssr-variant');
    var phoneCopy = HEADER_VARIANTS[variant].phone ||
      (!!wrapper && wrapper.getAttribute('class').split(/\s+/).filter(function (c) { return c.indexOf('hidden-') === 0; }).length >= 3);
    headers.push({
      root: root,
      container: container,
      phone: phoneCopy,
      base: variant,            // variant when above the nav trigger
      // past the nav trigger: Mobile Close on phone, Desktop Main otherwise. The /v2 phone header targets
      // a variant that no longer exists in the component, which changes nothing visible: it stays as is.
      scrolled: HEADER_VARIANTS[variant].phone ? 'Mobile Close' : (phoneCopy ? null : 'Desktop Main'),
      variant: variant,         // variant shown now
      target: undefined,        // variant set by the scroll effect (undefined = base)
    });
  });

  function setHeaderVariant(h, name) {
    if (h.variant === name) return;
    var from = h.variant;
    var fromDef = HEADER_VARIANTS[from], toDef = HEADER_VARIANTS[name];
    var apply = function () {
      replaceClass(h.root, fromDef.cls, toDef.cls);
      h.root.setAttribute('data-framer-name', name);
      if (toDef.border) h.root.setAttribute('data-border', 'true'); else h.root.removeAttribute('data-border');
      if (!!fromDef.open !== !!toDef.open) setPhoneMenu(h, !!toDef.open);
    };
    h.variant = name;
    if (!!fromDef.open !== !!toDef.open) layoutTransition(h.root, apply, HEADER_TRANSITION);
    else apply();
    animateStyles(h.root, headerStyle(name), HEADER_TRANSITION);
  }

  // Phone menu: Menu <-> Close icon, and the menu links (the desktop header's "Menus" block, with the
  // phone sizes of the Scale My Brand button: padding 10px 20px, font size 15).
  function setPhoneMenu(h, open) {
    var icon = h.root.querySelector('.framer-unobwt svg');
    if (icon) {
      replaceClass(icon, open ? 'framer-OmG2n' : 'framer-KpKpK', open ? 'framer-KpKpK' : 'framer-OmG2n');
      var use = icon.querySelector('use');
      if (use) use.setAttribute('href', open ? '#3527454627' : '#1171430842');
    }
    var main = h.root.querySelector('.framer-13b4pzg');
    var existing = main && main.querySelector(':scope > .framer-13erldb');
    if (open && main && !existing) {
      var source = document.querySelector('.framer-6qags:not([class*="framer-v-1vjkvr"]):not([class*="framer-v-1ueco5x"]):not([class*="framer-v-43i80e"]) .framer-13erldb');
      if (!source) return;
      var menus = source.cloneNode(true);
      menus.querySelectorAll('.framer-hnnhqc').forEach(function (b) { b.style.setProperty('--mzlucl', '10px 20px 10px 20px'); });
      menus.querySelectorAll('.framer-k19wr0').forEach(function (t) { t.style.setProperty('--variable-reference-JsGnlYypg-CHHG0cKGt', '15'); });
      menus.querySelectorAll('[style]').forEach(function (el) { if (!el.closest('[data-framer-name="Shimmer"]')) { el.style.transform = ''; el.style.transformOrigin = ''; } });
      main.appendChild(menus);
      // tapping a menu link closes the menu (the link itself still navigates)
      menus.querySelectorAll('a.framer-ZfJVp').forEach(function (a) {
        a.addEventListener('click', function () { setHeaderVariant(h, 'Mobile Close'); });
      });
      initGestures(menus);
      initShimmers(menus);
    } else if (!open && existing) {
      existing.remove();
    }
  }

  // The header logo links to #hero with smooth scrolling (the only link with Framer's smoothScroll on);
  // every other in-page link jumps instantly, which is the browser's own behaviour for hash links.
  document.querySelectorAll('.framer-6qags a.framer-n202p0[href*="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      var url = new URL(a.href, window.location.href);
      if (url.pathname !== window.location.pathname) return;
      var target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (!target) return;
      e.preventDefault();
      if (window.location.hash !== url.hash) window.history.pushState(null, '', url.hash);
      target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    });
  });

  headers.forEach(function (h) {
    if (!h.phone) return;
    var trigger = h.root.querySelector('.framer-unobwt');
    if (!trigger) return;
    trigger.addEventListener('click', function () {
      setHeaderVariant(h, HEADER_VARIANTS[h.variant].open ? 'Mobile Close' : 'Mobile Open');
    });
  });

  // a) + b): scroll effects, evaluated on every scroll event and once at start
  var navTrigger = document.querySelector('[data-framer-name="Nav Trigger"]');
  function documentOffsetTop(el) { var t = 0; for (var e = el; e; e = e.offsetParent) t += e.offsetTop; return t; }
  var lastY, anchorY = 0, direction, fadeTarget;
  var fadeValues = new Map();
  headers.forEach(function (h) {
    if (h.phone || !h.container) return;
    var v = M.motionValue(1);
    v.on('change', function (o) { h.container.style.opacity = o; });
    fadeValues.set(h, v);
  });
  function onScrollEffects() {
    var y = window.scrollY;
    var maxY = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    // header fade on scroll direction
    if (!(y > maxY || y < 0)) {
      var dir = y < (lastY === undefined ? 0 : lastY) ? 'up' : 'down';
      lastY = y;
      if (dir !== direction) { direction = dir; anchorY = y; }
      else if (Math.abs(y - anchorY) >= 4) {
        var target = dir === 'down' ? 'hidden' : undefined;
        if (target !== fadeTarget) {
          fadeTarget = target;
          fadeValues.forEach(function (v) { M.animate(v, target ? 0 : 1, HEADER_FADE_TRANSITION); });
        }
      }
    }
    // header variant past the nav trigger
    if (navTrigger) {
      var top = documentOffsetTop(navTrigger) - 1, height = navTrigger.clientHeight;
      var start = Math.max(top, 0);
      // inputRange [0, start-1, start, start+height] -> [-1, -1, 0, 0], floored (start <= 1: [start, start+height] -> [0, 0])
      var index = start <= 1 ? 0 : (y <= start - 1 ? -1 : (y >= start ? 0 : -1));
      var reached = index >= 0;
      headers.forEach(function (h) {
        var t = reached && h.scrolled ? h.scrolled : undefined;
        if (t === h.target) return;
        h.target = t;
        setHeaderVariant(h, t || h.base);
      });
    }
  }
  var scrollQueued = false;
  window.addEventListener('scroll', function () {
    if (scrollQueued) return;
    scrollQueued = true;
    M.frame.read(function () { scrollQueued = false; onScrollEffects(); });
  }, { passive: true });
  onScrollEffects();

  // ===============================================================================================
  // 5. Hover and press states (Framer "gesture variants").
  //    The component root gets the class "hover" / "pressed" after its variant class, loses its
  //    data-framer-name, the variant's styles animate with the component's transition, and any layout
  //    change made by the CSS for that state animates as a layout transition.
  // ===============================================================================================
  var GESTURES = [
    { // Shimmer Line Button ("Scale My Brand"): spring bounce 0.4, duration 0.8
      selector: 'a.framer-leFG9', variantClass: 'framer-v-yrfot5', hover: true, pressed: true,
      transition: { type: 'spring', bounce: 0.4, duration: 0.8, delay: 0 },
      styles: {
        hover: { '.framer-hnnhqc': { background: 'linear-gradient(90deg, rgb(7, 87, 224) 0%, rgb(35, 166, 232) 100%)' } },
        pressed: { '.framer-hnnhqc': { 'box-shadow': 'inset 0px 0px 13px 0px rgba(255, 255, 255, 0.42), 5px 0px 6px 0px rgba(0, 94, 252, 0.15), -5px 0px 6px 0px rgba(0, 94, 252, 0.15), 0px 7px 7px 0px rgba(0, 94, 252, 0.2)' } },
      },
      unmountWhenPressed: '.framer-q7c35n', // the "Light Beam" is not rendered while pressed
    },
    { // 3d Book Button (floating "Book a call"): the two stacked labels roll up; spring bounce 0.2, duration 0.4
      selector: 'a.framer-nQxER', variantClass: 'framer-v-18beoer', hover: true, pressed: false,
      transition: { type: 'spring', bounce: 0.2, duration: 0.4, delay: 0 },
    },
    { // Header menu link ("Case Studies", "Services"): fades to 70% on hover
      selector: 'a.framer-ZfJVp', variantClass: 'framer-v-1k87gir', hover: true, pressed: false,
      transition: { type: 'spring', bounce: 0.2, duration: 0.4, delay: 0 },
      styles: { hover: { ':self': { opacity: '0.7' } } },
    },
    { // Footer link (Privacy Policy, Terms & Conditions, Refund Policy, Contact Us): fades to 70% on hover
      selector: 'a.framer-5vnkp.framer-v-ni8r10', variantClass: 'framer-v-ni8r10', hover: true, pressed: false,
      transition: { type: 'spring', bounce: 0.2, duration: 0.4, delay: 0 },
      styles: { hover: { ':self': { opacity: '0.7' } } },
    },
    { // Primary CTA 2 (v2 page): the inner highlight flips from the top edge to the bottom edge
      selector: 'a.framer-kpHlz', variantClass: 'framer-v-15rrl8y', hover: true, pressed: false,
      transition: { type: 'spring', bounce: 0.2, duration: 0.6, delay: 0 },
      styles: { hover: { ':self': { 'box-shadow': '0px 4px 4px 0px rgba(22, 119, 255, 0.15), inset 0px -3px 0px 0px rgba(255, 255, 255, 0.3)' } } },
    },
  ];

  function initGestures(scope) {
    GESTURES.forEach(function (g) {
      scope.querySelectorAll(g.selector).forEach(function (root) {
        if (root.__blGesture) return;
        var variantClass = g.variantClass || (root.getAttribute('class').match(/framer-v-[a-z0-9]+/) || [])[0];
        var name = root.getAttribute('data-framer-name');
        // remember each styled element's resting values
        var targets = {};
        var baseStyles = {};
        ['hover', 'pressed'].forEach(function (state) {
          var map = (g.styles && g.styles[state]) || {};
          Object.keys(map).forEach(function (sel) {
            var el = sel === ':self' ? root : root.querySelector(sel);
            if (!el) return;
            targets[sel] = el;
            baseStyles[sel] = baseStyles[sel] || {};
            Object.keys(map[sel]).forEach(function (prop) {
              if (!(prop in baseStyles[sel])) baseStyles[sel][prop] = el.style.getPropertyValue(cssName(prop));
            });
          });
        });
        var unmount = g.unmountWhenPressed ? root.querySelector(g.unmountWhenPressed) : null;
        var unmountParent = unmount && unmount.parentNode, unmountNext = unmount && unmount.nextSibling;
        var state = 'rest', hovered = false;
        function setState(next) {
          if (next === state) return;
          state = next;
          layoutTransition(root, function () {
            removeClass(root, 'hover'); removeClass(root, 'pressed');
            if (next !== 'rest') insertClassAfter(root, variantClass, next);
            if (next === 'rest') { if (name !== null) root.setAttribute('data-framer-name', name); }
            else root.removeAttribute('data-framer-name');
            if (unmount) {
              if (next === 'pressed' && unmount.parentNode) unmount.remove();
              if (next !== 'pressed' && !unmount.parentNode) unmountParent.insertBefore(unmount, unmountNext);
            }
          }, g.transition);
          Object.keys(targets).forEach(function (sel) {
            var to = {};
            var stateStyles = (g.styles && g.styles[next] && g.styles[next][sel]) || {};
            Object.keys(baseStyles[sel]).forEach(function (prop) {
              to[prop] = prop in stateStyles ? stateStyles[prop] : baseStyles[sel][prop];
            });
            animateStyles(targets[sel], to, g.transition);
          });
        }
        root.addEventListener('pointerenter', function (e) {
          if (e.pointerType === 'touch') return;
          hovered = true;
          if (g.hover && state === 'rest') setState('hover');
        });
        root.addEventListener('pointerleave', function (e) {
          if (e.pointerType === 'touch') return;
          hovered = false;
          if (state === 'hover') setState('rest');
        });
        root.addEventListener('pointerdown', function (e) {
          if (e.button !== 0 || !g.pressed) return;
          setState('pressed');
          var up = function () {
            window.removeEventListener('pointerup', up, true);
            window.removeEventListener('pointercancel', up, true);
            setState(hovered && g.hover ? 'hover' : 'rest');
          };
          window.addEventListener('pointerup', up, true);
          window.addEventListener('pointercancel', up, true);
        });
        root.__blGesture = true;
      });
    });
  }
  initGestures(document);

  // ===============================================================================================
  // 6. Shimmer loop on "Scale My Brand": rotate 0 -> 360deg, 3.5s linear, repeating, never paused.
  // ===============================================================================================
  function initShimmers(scope) {
    scope.querySelectorAll('a.framer-leFG9 [data-framer-name="Shimmer"]').forEach(function (el) {
      if (el.__blShimmer) return;
      el.__blShimmer = true;
      el.style.willChange = 'transform';
      M.animate(el, { rotate: [0, 360] }, { duration: 3.5, ease: [0, 0, 1, 1], repeat: Infinity, repeatType: 'loop', delay: 0 });
    });
  }
  initShimmers(document);

  // ===============================================================================================
  // 6b. Word cycle on /v2 ("Words Bad"): the highlighted word steps through its variants on a timer:
  //     1 -> 2 after 2.5s (spring 200/30), 2 -> 3 after 2.5s (spring), 3 -> 4 after 2.5s (tween 0.4s),
  //     4 -> 1 after 0.5s (instant). Each step fades the words and animates their new positions.
  // ===============================================================================================
  var WORD_TWEEN_EASE = [0.44, 0, 0.56, 1];
  var WORD_STEPS = {
    'framer-v-tr28qb': { name: 'Variant 1', next: 'framer-v-naibv5', wait: 2500, transition: { type: 'tween', duration: 0, ease: WORD_TWEEN_EASE, delay: 0 },
      opacity: [1, 0, 0, 1], template: [false, false, false, true] },
    'framer-v-naibv5': { name: 'Variant 2', next: 'framer-v-qe5zjc', wait: 2500, transition: { type: 'spring', stiffness: 200, damping: 30, mass: 1, delay: 0 },
      opacity: [0, 1, 0, 0], template: [false, false, false, false] },
    'framer-v-qe5zjc': { name: 'Variant 3', next: 'framer-v-e3v59n', wait: 2500, transition: { type: 'spring', stiffness: 200, damping: 30, mass: 1, delay: 0 },
      opacity: [0, 0, 1, 0], template: [false, false, false, false] },
    'framer-v-e3v59n': { name: 'Variant 4', next: 'framer-v-tr28qb', wait: 500, transition: { type: 'tween', duration: 0.4, ease: WORD_TWEEN_EASE, delay: 0 },
      opacity: [1, 0, 0, 1], template: [true, false, false, false] },
  };
  var WORD_LAYERS = ['.framer-1y9638o', '.framer-134kxel', '.framer-12m6yav', '.framer-1aejrjz']; // Text-1, -2, -3, -1.2
  document.querySelectorAll('.framer-VjRxF').forEach(function (root) {
    var layers = WORD_LAYERS.map(function (sel) { return root.querySelector(':scope > ' + sel); });
    if (layers.some(function (l) { return !l; })) return;
    layers.forEach(function (l) { l.setAttribute('data-bl-template', ''); });
    var current = Object.keys(WORD_STEPS).filter(function (c) { return root.classList.contains(c); })[0];
    if (!current) return;
    var templated = function (el) {
      var i = layers.indexOf(el);
      return i !== -1 && WORD_STEPS[current].template[i] ? 'translateX(-50%)' : '';
    };
    function go(next) {
      var step = WORD_STEPS[next];
      var from = current;
      layoutTransition(root, function () {
        replaceClass(root, from, next);
        root.setAttribute('data-framer-name', step.name);
        current = next;
      }, step.transition, templated);
      layers.forEach(function (l, i) { animateStyles(l, { opacity: String(step.opacity[i]) }, step.transition); });
      schedule();
    }
    function schedule() {
      var step = WORD_STEPS[current];
      setTimeout(function () { go(step.next); }, step.wait);
    }
    schedule();
  });

  // ===============================================================================================
  // 7. Ticker: the strip of creatives scrolls left at 60px/s, slows to 15% speed while hovered,
  //    loops seamlessly (items that leave on the left are moved to the end of the list, extra copies
  //    are added when the items do not fill the screen), runs only while within 100px of the
  //    viewport and the tab is visible, and stays still for visitors who prefer reduced motion.
  // ===============================================================================================
  var TICKERS = {
    // Home page, "Creatives" section
    'framer-18o8l5o': { velocity: 60, hoverFactor: 0.15, gap: 20 },
  };

  function initTicker(container, cfg) {
    var list = container.querySelector(':scope > ul');
    if (!list) return;
    var originals = Array.prototype.filter.call(list.children, function (li) { return li.classList.contains('ticker-item'); });
    var clones = [];
    var state = { total: 0, inset: 0, positions: [], visible: 0, groups: 0, listSize: 0 };
    var offset = 0;
    var speed = M.motionValue(1);
    var inView = false;

    function cloneGroups(visible, positions, gap) {
      var total = positions[positions.length - 1].end - positions[0].start;
      var maxItem = Math.max.apply(null, positions.map(function (p) { return p.end - p.start; }));
      var count = 0, covered = 0;
      while (covered < visible) { covered = (total + gap) * (count + 1) - maxItem; count++; }
      return Math.max(count - 1, 0);
    }
    function measure() {
      if (!isRendered(container)) return;
      var positions = originals.map(function (li) { return { start: li.offsetLeft, end: li.offsetLeft + li.offsetWidth }; });
      if (!positions.length) return;
      var visible = window.innerWidth; // overflow visible: the whole viewport width
      var total = positions[positions.length - 1].end - positions[0].start;
      var inset = 0;
      for (var e = originals[0]; e; e = e.offsetParent) inset += e.offsetLeft;
      var groups = total > 0 ? cloneGroups(visible, positions, cfg.gap) : 0;
      state.positions = positions; state.total = total; state.inset = inset; state.visible = visible;
      if (groups !== state.groups || !clones.length && groups) rebuildClones(groups);
      state.groups = groups;
      state.listSize = total === 0 ? 0 : (total + cfg.gap) * (groups + 1);
      list.style.opacity = total > 0 ? '1' : '0';
      render();
    }
    function rebuildClones(groups) {
      clones.forEach(function (c) { c.el.remove(); });
      clones = [];
      for (var g = 0; g < groups; g++) {
        originals.forEach(function (li, i) {
          var c = li.cloneNode(true);
          c.className = 'clone-item';
          c.setAttribute('aria-hidden', 'true');
          c.removeAttribute('aria-posinset'); c.removeAttribute('aria-setsize');
          list.appendChild(c);
          clones.push({ el: c, index: i, group: g });
        });
      }
    }
    function render() {
      if (!state.total) return;
      var min = -state.total - cfg.gap - state.inset, max = -state.inset;
      var shown = M.wrap(min, max, offset);
      list.style.transform = 'translateX(' + shown + 'px)';
      var place = function (el, end) {
        var shift = shown + end <= -state.inset ? state.listSize : 0;
        el.style.transform = shift ? 'translateX(' + shift + 'px)' : 'none';
      };
      originals.forEach(function (li, i) { place(li, state.positions[i].end); });
      clones.forEach(function (c) { place(c.el, state.positions[c.index].end + (state.total + cfg.gap) * (c.group + 1)); });
    }
    function step(data) {
      if (!state.total || !inView || document.visibilityState !== 'visible' || REDUCED_MOTION) return;
      offset -= (data.delta / 1000) * (cfg.velocity * speed.get());
      render();
    }

    new IntersectionObserver(function (entries) {
      inView = entries[entries.length - 1].isIntersecting;
      list.style.willChange = inView && state.total ? 'transform' : '';
      if (inView) measure();
    }, { rootMargin: '100px' }).observe(container);
    new ResizeObserver(function () { measure(); }).observe(container);
    window.addEventListener('resize', measure);
    container.addEventListener('pointerenter', function () { M.animate(speed, cfg.hoverFactor); });
    container.addEventListener('pointerleave', function () { M.animate(speed, 1); });
    // keyboard/pointer scrolling inside the strip is reset, as on the original
    container.addEventListener('scroll', function () { container.scrollLeft = 0; container.scrollTop = 0; });
    list.addEventListener('pointerdown', function (e) {
      var hidden = e.target.closest('[aria-hidden="true"]');
      if (hidden) hidden.removeAttribute('aria-hidden');
    });
    M.frame.update(step, true);
    measure();
  }
  Object.keys(TICKERS).forEach(function (cls) {
    document.querySelectorAll('.' + cls).forEach(function (el) { initTicker(el, TICKERS[cls]); });
  });

  // ===============================================================================================
  // 8. YouTube: the server markup shows the thumbnail and a play button; the player iframe keeps its
  //    URL in data-src so nothing loads until the visitor presses play (also keeps the hidden copies
  //    for other screen sizes from loading). Hovering colours the play button red.
  // ===============================================================================================
  function youtubeArticle(target) {
    var a = target && target.closest && target.closest('article[role="presentation"]');
    return a && a.querySelector('iframe[data-src*="youtube.com/embed/"]') ? a : null;
  }
  function setPlayHover(article, on) {
    var path = article.querySelector('button[aria-label="Play"] svg path');
    if (!path) return;
    var red = article.getAttribute('data-yt-color') !== 'white';
    path.setAttribute('fill', on ? (red ? '#f00' : '#000') : '#212121');
    path.setAttribute('fill-opacity', on && red ? '1' : '0.8');
  }
  function playYoutube(article) {
    var iframe = article.querySelector('iframe[data-src]');
    if (!iframe) return;
    iframe.src = iframe.getAttribute('data-src').replace('autoplay=0', 'autoplay=1');
    iframe.removeAttribute('data-src');
    iframe.removeAttribute('loading');
    iframe.style.display = '';
    var button = article.querySelector('button[aria-label="Play"]');
    if (button) button.remove();
    var radius = article.style.borderRadius;
    if (radius && radius !== '0px 0px 0px 0px' && radius !== '0px') article.style.transform = 'translateZ(0.000001px)';
  }
  document.addEventListener('pointerover', function (e) {
    var article = youtubeArticle(e.target);
    if (!article || article.__blPrefetched) return;
    article.__blPrefetched = true;
    [['dns-prefetch', 'https://i.ytimg.com'], ['preconnect', 'https://www.youtube.com'], ['dns-prefetch', 'https://www.google.com']].forEach(function (l) {
      var link = document.createElement('link'); link.rel = l[0]; link.href = l[1]; article.appendChild(link);
    });
  });
  document.addEventListener('pointerenter', function (e) {
    var article = e.target.nodeType === 1 && e.target.matches('article[role="presentation"]') ? youtubeArticle(e.target) : null;
    if (article) setPlayHover(article, true);
  }, true);
  document.addEventListener('pointerleave', function (e) {
    var article = e.target.nodeType === 1 && e.target.matches('article[role="presentation"]') ? youtubeArticle(e.target) : null;
    if (article) setPlayHover(article, false);
  }, true);
  // Autoplay embeds (no thumbnail / play button, e.g. the thank-you video) load at once, but only the
  // copy for the current screen size; the copy for another breakpoint loads if the window is resized into it.
  function loadAutoplayEmbeds() {
    document.querySelectorAll('article[role="presentation"] iframe[data-src*="autoplay=1"]').forEach(function (iframe) {
      var article = iframe.closest('article');
      if (article.querySelector('button[aria-label="Play"]') || !isRendered(article)) return;
      iframe.src = iframe.getAttribute('data-src');
      iframe.removeAttribute('data-src');
    });
  }
  loadAutoplayEmbeds();
  window.addEventListener('resize', loadAutoplayEmbeds);
  document.addEventListener('click', function (e) {
    var article = youtubeArticle(e.target);
    if (article && article.querySelector('button[aria-label="Play"]')) playYoutube(article);
  });
  document.addEventListener('keydown', function (e) {
    var article = youtubeArticle(e.target);
    if (article && article.querySelector('button[aria-label="Play"]')) playYoutube(article);
  });
})();
