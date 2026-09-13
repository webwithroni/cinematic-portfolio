// Boot, orchestration, the frame loop.
//
// Order of operations matters here: the page must sit on TRUE black until the
// fonts, textures and the hero clip are all decodable, otherwise the sequence
// starts and the figure pops in three frames later. Nothing is revealed until
// everything needed for the first eight seconds is in hand.

import { Stage } from './gl/stage.js';
import { Clip } from './lib/clip.js';
import { computeLayout } from './scene/layout.js';
import { buildWord, fontsReady } from './scene/type.js';
import { Furniture } from './scene/furniture.js';
import { sample, letterOrder, CUES, T } from './scene/timeline.js';
import { damp, clamp } from './lib/ease.js';
// Later scenes are loaded on demand as they approach the viewport.

// a cinematic page manages its own positions; the browser restoring an old
// scroll offset mid-boot yanks the visitor (and any scripted anchor) around
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

const MEDIA = 'media/';
const MIN_BLACK = 620;          // the darkness must be felt, even on a fast line

const root = document.documentElement;
const boot = document.getElementById('boot');
const bootFill = document.getElementById('bootFill');
const bootEnter = document.getElementById('bootEnter');

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const app = {
  stage: null,
  furniture: null,
  clips: {},
  layout: null,
  word: null,
  order: [],
  t0: 0,
  fired: new Set(),
  pointer: { x: 0, y: 0, tx: 0, ty: 0 },
  running: false,
};

// --------------------------------------------------------------------------

async function main() {
  const canvas = document.getElementById('stage');
  app.stage = new Stage(canvas);
  app.furniture = new Furniture(document);

  if (!app.stage.ok) return degrade('WebGL unavailable');

  let manifest;
  try {
    manifest = await fetch(`${MEDIA}manifest.json`).then((r) => r.json());
  } catch {
    return degrade('media manifest missing');
  }

  const steps = 4;
  let done = 0;
  const tick = () => { bootFill.style.width = `${(++done / steps) * 100}%`; };

  const startedAt = performance.now();

  await Promise.all([
    fontsReady().then(tick),
    app.stage.loadTextures({
      grunge: 'tex/grunge.png',
      grain: 'tex/grain.png',
    }).then(tick),
  ]);

  const mk = (name, loopFade) => {
    const c = manifest.clips[name];
    return new Clip({
      src: [
        { url: MEDIA + c.webm, type: 'video/webm' },
        { url: MEDIA + c.mp4, type: 'video/mp4' },
      ],
      poster: MEDIA + c.poster,
      w: c.w, h: c.h, track: c.track, loopFade,
    });
  };
  app.clips.hero = mk('hero', 0.7);

  layout();
  window.addEventListener('resize', debounce(layout, 140));
  window.addEventListener('orientationchange', () => setTimeout(layout, 220));

  await app.clips.hero.whenReady();
  tick();

  const held = performance.now() - startedAt;
  if (held < MIN_BLACK) await wait(MIN_BLACK - held);

  const playing = await app.clips.hero.play();

  // Later scenes are imported only as they approach the viewport.
  // Their own boot modules still manage visibility and render lifecycles.
  lazyScene('#universe', () =>
    import('./scene2/boot2.js').then((m) => m.initUniverse())
  ).then((u) => { app.universe = u; });

  lazyScene('#chrono', () =>
    import('./scene3/boot3.js').then((m) => m.initChrono())
  ).then((c) => { app.chrono = c; });

  lazyScene('#gallery', () =>
    import('./scene4/boot4.js').then((m) => m.initGallery())
  ).then((g) => { app.gallery = g; });

  lazyScene('#fin', () =>
    import('./scene6/boot6.js').then((m) => m.initFinale())
  ).then((f) => { app.finale = f; });

  if (!playing) return awaitGesture();
  begin();
}


function lazyScene(selector, loader) {
  const section = document.querySelector(selector);

  // This promise resolves only when the scene is actually started.
  // Calling .then() must NOT itself trigger the import.
  let resolveStart;
  let rejectStart;

  const ready = new Promise((resolve, reject) => {
    resolveStart = resolve;
    rejectStart = reject;
  });

  let started = false;

  const start = () => {
    if (started) return;
    started = true;

    Promise.resolve()
      .then(loader)
      .then(resolveStart)
      .catch((e) => {
        console.warn(`[roni] ${selector} unavailable:`, e.message);
        rejectStart(e);
      });
  };

  if (!section || !('IntersectionObserver' in window)) {
    // Graceful fallback for browsers without IntersectionObserver.
    start();
    return ready;
  }

  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      io.disconnect();
      start();
    },
    {
      // Begin loading before the visitor reaches the section.
      rootMargin: '120% 0px',
      threshold: 0,
    }
  );

  io.observe(section);

  return ready;
}

function begin() {
  boot.classList.add('is-done');
  root.classList.remove('is-booting');
  app.t0 = performance.now();
  app.running = true;
  bindPointer();

  // ?t=4.2 starts the sequence part-way through, and ?t=end lands on the
  // settled composition. Purely a review aid for tuning a single beat without
  // sitting through the whole opening each time.
  const q = new URLSearchParams(location.search).get('t');
  if (q !== null) {
    const at = q === 'end' ? T.settled : parseFloat(q);
    if (Number.isFinite(at)) {
      app.t0 = performance.now() - at * 1000;
      for (const [when, name] of CUES) {
        if (at >= when) { app.fired.add(name); root.classList.add(`is-${name}`); }
      }
    }
  }
  if (reduced) {
    // honour the preference fully: land on the finished composition and hold it
    // still - no build-up, no looping walk, no drifting grain
    app.t0 = performance.now() - T.settled * 1000;
    for (const [, name] of CUES) root.classList.add(`is-${name}`);
    const c = app.clips.hero;
    const still = () => {
      c.pause();
      renderStill();
      window.addEventListener('resize', debounce(renderStill, 160));
    };
    c.el.addEventListener('seeked', still, { once: true });
    c.el.currentTime = Math.min(6, (c.duration || 8) * 0.6);
    return;
  }
  requestAnimationFrame(frame);
}

/** Autoplay was refused — offer a single deliberate entry point. */
function awaitGesture() {
  bootEnter.hidden = false;
  bootEnter.addEventListener('click', async () => {
    await app.clips.hero.play();
    begin();
  }, { once: true });
}

// --------------------------------------------------------------------------

function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const L = computeLayout(w, h);
  app.layout = L;
  app.stage.resize(L);

  const capPx = Math.round(L.word.capH * L.dpr);
  if (!app.word || Math.abs(app.word.capPx - capPx) > 2) {
    const word = buildWord(capPx, app.stage.maxTexture);
    word.capPx = capPx;
    app.word = word;
    app.stage.setWord(word);
    app.order = letterOrder(word.letters);
  }
  app.furniture.apply(L);
}

function bindPointer() {
  if (reduced || matchMedia('(pointer: coarse)').matches) return;
  window.addEventListener('pointermove', (e) => {
    // normalised to -1..1, then damped in the frame loop; the response is
    // deliberately small — depth, not a toy
    app.pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    app.pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });
  window.addEventListener('pointerleave', () => {
    app.pointer.tx = 0;
    app.pointer.ty = 0;
  });
}

let last = 0;
function frame(now) {
  if (!app.running) return;
  const t = (now - app.t0) / 1000;
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;

  for (const [at, name] of CUES) {
    if (t >= at && !app.fired.has(name)) {
      app.fired.add(name);
      root.classList.add(`is-${name}`);
    }
  }

  const p = app.pointer;
  p.x = damp(p.x, p.tx, 3.1, dt);
  p.y = damp(p.y, p.ty, 3.1, dt);
  // parallax only comes alive once the composition has settled
  const gate = clamp((t - T.settled + 0.9) / 1.2);
  app.stage.parallax.x = p.x * gate;
  app.stage.parallax.y = p.y * gate;

  const state = sample(t, app.word.letters.length, app.order);

  // after the intro the wordmark breathes very slightly, so the frame never
  // becomes a static image
  if (state.settled) {
    const b = Math.sin(t * 0.42) * 0.5 + Math.sin(t * 0.27 + 1.3) * 0.5;
    for (const l of state.letters) l.dy = b * 0.0035;
  }

  app.stage.render(state, t, app.clips);
  requestAnimationFrame(frame);
}

// --------------------------------------------------------------------------

function degrade(reason) {
  console.warn('[roni] falling back:', reason);
  root.classList.remove('is-booting');
  root.classList.add('is-fallback');
  boot.classList.add('is-done');
  for (const [, name] of CUES) root.classList.add(`is-${name}`);
  document.querySelector('.stage-wrap').insertAdjacentHTML('afterbegin',
    '<div class="fallback"><p>RONI HALDER</p>'
    + '<small>Welcome to my world</small></div>');
}

function renderStill() {
  layout();
  const state = sample(T.settled + 1, app.word.letters.length, app.order);
  app.stage.render(state, T.settled + 1, app.clips);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function debounce(fn, ms) {
  let id;
  return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); };
}

// mobile menu
const burger = document.getElementById('burger');
const menu = document.getElementById('menu');
const menuLinks = menu?.querySelectorAll('a') ?? [];
let menuReturnFocus = null;

menuLinks.forEach((a, i) => a.style.setProperty('--i', i));

function setMenu(open) {
  if (!burger || !menu) return;

  burger.setAttribute('aria-expanded', String(open));
  root.classList.toggle('is-menu', open);

  if (open) {
    menu.hidden = false;
    menuReturnFocus = document.activeElement;

    requestAnimationFrame(() => {
      menu.querySelector('a')?.focus();
    });
    return;
  }

  setTimeout(() => {
    if (!root.classList.contains('is-menu')) menu.hidden = true;
  }, 500);

  requestAnimationFrame(() => {
    const target =
      menuReturnFocus instanceof HTMLElement ? menuReturnFocus : burger;
    target?.focus();
  });
}

burger?.addEventListener('click', () => {
  const open = burger.getAttribute('aria-expanded') !== 'true';
  setMenu(open);
});

menu?.addEventListener('click', (e) => {
  if (e.target.closest('a')) setMenu(false);
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !root.classList.contains('is-menu')) return;

  e.preventDefault();
  setMenu(false);
});

// Keep both desktop and mobile navs synchronized with the section in view.
const navLinks = [...document.querySelectorAll('[data-nav][href^="#"]')];
const navTargets = [
  { id: 'top', ratio: 0 },
  { id: 'universe', ratio: 0 },
  { id: 'chrono', ratio: 0 },
  { id: 'gallery', ratio: 0 },
  { id: 'fin', ratio: 0 },
];

function setActiveNav(id) {
  navLinks.forEach((link) => {
    const active = link.getAttribute('href') === `#${id}`;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function updateActiveNav() {
  let best = navTargets[0];

  for (const target of navTargets) {
    const el = document.getElementById(target.id);
    if (!el) continue;

    const rect = el.getBoundingClientRect();
    const visible = Math.max(
      0,
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
    );

    const ratio = visible / Math.max(1, Math.min(rect.height, window.innerHeight));

    if (ratio > best.ratio) {
      best = { id: target.id, ratio };
    }
  }

  // The hero owns the home state until another real section has meaningful
  // viewport presence.
  if (best.id === 'top' || best.ratio >= 0.18) setActiveNav(best.id);
}

let navTicking = false;
function scheduleActiveNav() {
  if (navTicking) return;
  navTicking = true;

  requestAnimationFrame(() => {
    navTicking = false;
    updateActiveNav();
  });
}

window.addEventListener('scroll', scheduleActiveNav, { passive: true });
window.addEventListener('resize', scheduleActiveNav, { passive: true });
window.addEventListener('load', updateActiveNav);

// The hero is position:fixed behind the flow, so once scene two covers it there
// is nothing to see - stop decoding its video rather than burning battery on
// frames nobody is looking at.
const heroWrap = document.querySelector('.stage-wrap');
if (heroWrap && 'IntersectionObserver' in window) {
  const spacer = document.querySelector('.hero-spacer');
  if (spacer) {
    new IntersectionObserver(([e]) => {
      const c = app.clips.hero;
      if (!c) return;
      app.heroOnScreen = e.isIntersecting;
      if (e.isIntersecting) { c.play(); heroWrap.style.visibility = ''; }
      else { c.pause(); heroWrap.style.visibility = 'hidden'; }
    }, { threshold: 0 }).observe(spacer);
  }
}

// pause the decoder when the tab is hidden rather than burning battery
// decoding frames nobody is looking at
document.addEventListener('visibilitychange', () => {
  const hidden = document.visibilityState === 'hidden';
  for (const c of Object.values(app.clips)) {
    if (!c) continue;
    if (hidden) c.pause();
    else if (app.heroOnScreen !== false) c.play();
  }
});

// Review hook. Draws one frame on demand and reads the framebuffer in the SAME
// task, because the context is created without preserveDrawingBuffer. Rendering
// here rather than piggy-backing on the animation loop means it still works when
// the tab is hidden and rAF is throttled to a stop.
window.__shot = async (name = 'shot', at = null) => {
  if (!app.word) return 'not ready';
  const t = at !== null ? at : (performance.now() - app.t0) / 1000;
  app.stage.render(sample(t, app.word.letters.length, app.order), t, app.clips);
  const url = app.stage.canvas.toDataURL('image/png');
  await fetch(`/__shot?name=${encodeURIComponent(name)}`,
    { method: 'POST', body: url });
  return `${app.stage.canvas.width}x${app.stage.canvas.height} @ t=${t.toFixed(2)}`;
};

// live tuning of the letter surface while matching the reference art
window.__tune = (k, v) => { app.stage[k] = v; return app.stage[k]; };

main().catch((e) => degrade(e.message));
