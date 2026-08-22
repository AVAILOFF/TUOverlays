/* ============================================================================
   TU OVERLAYS — CINEMATIC HERO SCRUBBER
   ----------------------------------------------------------------------------
   Drives the pinned opening on index.html and en/index.html. A port of a
   GSAP + ScrollTrigger component, rewritten without either:

     · ScrollTrigger's pin rewrites layout with a spacer and measures with
       getBoundingClientRect(). html carries zoom:1.5, so those measurements
       come back at 1.5x the numbers the pin math expects and the pin lands in
       the wrong place. position:sticky has no such problem.
     · The site ships no bundler and no runtime dependency. 70KB of animation
       library for one scrubber is not a trade this page should make.

   THE UNIT TRAP, ONCE, SO IT IS NEVER RE-DERIVED
     getBoundingClientRect(), innerHeight, scrollY   →  root px  (zoomed, real)
     offsetHeight, offsetTop, everything in CSS      →  layout px (root / 1.5)
   Progress is computed from rects and innerHeight only, so it never mixes the
   two. --vph is published in layout px because CSS is the only consumer.

   MOTION CONTRACT
   Everything on the scrubber is a pure function of scroll progress, so there is
   no easing over time and nothing can overshoot. Segments ease in space with
   the same two curves the rest of the system eases in time with.
   ========================================================================== */
(() => {
'use strict';

/* the track is the tall scroll driver; .cine-stage is the sticky frame
   inside it, and nothing here ever needs to touch that one directly */
const track = document.querySelector('.cine');
if (!track) return;

const $  = (s, r = track) => r.querySelector(s);
const $$ = (s, r = track) => [...r.querySelectorAll(s)];
const root = document.documentElement;

/* ---------- reduced motion: never take the pin ------------------------------
   The stylesheet's default IS the two-block static layout; .is-live is what
   switches the pin on. Leaving the class off is therefore the whole fallback,
   and it is the same one a visitor with JavaScript disabled already gets. */
const mq = matchMedia('(prefers-reduced-motion: reduce)');
if (mq.matches) return;
track.classList.add('is-live');

const slogan = $('.cine-slogan');
const plate  = $('.cine-plate');
const page   = $('.cine-plate-in');
const bg     = $('.cine-bg');
const screen = $('.cine-screen');
const copy   = $('.cine-copy');
const metrics= $$('.cine-mi');
const counters = $$('[data-count]');

/* ---------- viewport bookkeeping -------------------------------------------
   --vph is one true viewport expressed in the layout px CSS works in. Under
   html{zoom:1.5} that is innerHeight / 1.5; the stylesheet's calc() fallback
   says the same thing, this just keeps it honest when a mobile URL bar moves. */
let vh = 0;                       /* one viewport, root px  */
let zoom = 1;

const main = track.parentElement;

const measure = () => {
  zoom = parseFloat(getComputedStyle(root).zoom) || 1;
  vh = window.innerHeight;
  root.style.setProperty('--vph', (vh / zoom).toFixed(2) + 'px');
  /* everything in flow above <main> — the release ribbon and the header — is
     what the track has to be pulled back up under. offsetTop is already in the
     layout px the margin is written in, and <main> is a flow root, so this
     number does not move when the margin is applied to its child. */
  track.style.setProperty('--cine-top', (main ? main.offsetTop : 0) + 'px');
  /* and the header alone is what the full-bleed page has to clear at the top */
  const hdr = document.querySelector('.hdr');
  track.style.setProperty('--cine-hdr', (hdr ? hdr.offsetHeight : 0) + 'px');
};

/* ---------- easing + segment helpers ---------------------------------------
   seg() maps absolute progress onto one act and eases it. Outside the act it
   clamps, so every property is defined for every p and the timeline can be
   scrubbed backwards as cheaply as forwards. */
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const inOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const out   = t => 1 - Math.pow(1 - t, 3);
const seg   = (p, a, b, ease = out) => ease(clamp((p - a) / (b - a)));
const mix   = (a, b, t) => a + (b - a) * t;

/* Entry and exit are two separate quantities, never one number run backwards:
   act 2 arrives from below and leaves upward, so a single 0..1 that undoes
   itself would slide everything back down through the frame it came from.
   Each element owns its arrival; the act's own container owns the departure
   and the structural parts nobody staggers — the section label, the hairline
   the metric rail hangs from. Fading the page as one layer is also what keeps
   those from sitting on the slogan before the plate has even arrived. */
let drift = 0;

const layer = (el, a) => {
  el.style.opacity = a.toFixed(3);
  /* opacity alone still leaves a layer focusable and hit-testable */
  const on = a > .01;
  if (el.dataset.on !== String(on)) {
    el.dataset.on = String(on);
    el.style.visibility = on ? '' : 'hidden';
  }
};

const enter = (el, t, dx, dy, scale) => {
  if (!el) return;
  el.style.opacity = t.toFixed(3);
  el.style.transform =
    'translate3d(' + mix(dx, 0, t).toFixed(2) + 'px,' +
                    (mix(dy, 0, t) + drift).toFixed(2) + 'px,0)' +
    (scale ? ' scale(' + mix(scale, 1, t).toFixed(4) + ')' : '');
};

/* ---------- the timeline ----------------------------------------------------
   One table, in scroll order, so the choreography can be read without reading
   the code under it. Values are fractions of the pinned track.

   There is no act 3: the info page (act 2) holds full-bleed, then contentOut
   fades it and plateExit slides the plate away in the same breath, releasing
   the pin straight into 01 / Features underneath — nothing is ever parked
   behind the plate for it to reveal. */
const T = {
  sloganOut : [0.00, 0.16],
  plateRise : [0.03, 0.26],
  plateFull : [0.24, 0.38],
  pageIn    : [0.32, 0.42],   /* the container, so no hairline leaks in early */
  screenIn  : [0.36, 0.54],
  copyIn    : [0.40, 0.58],
  railIn    : [0.48, 0.66],   /* + 0.02 stagger per tile */
  count     : [0.48, 0.68],
  contentOut: [0.84, 0.94],
  plateExit : [0.88, 1.00],
};

/* the inset plate size, kept here rather than in CSS because the scrubber has
   to interpolate between it and full-bleed */
const INSET = { w: 88, h: 78, r: 18 };   /* % of stage, % of stage, px */

let counted = -1;

const render = p => {
  /* --- act 0: the slogan clears the frame ------------------------------- */
  const so = seg(p, T.sloganOut[0], T.sloganOut[1], inOut);
  slogan.style.transform = 'translate3d(0,' + (-46 * so).toFixed(1) + 'px,0) scale(' +
    (1 + .07 * so).toFixed(4) + ')';
  layer(slogan, 1 - so);
  if (bg) bg.style.opacity = (1 - .74 * so).toFixed(3);

  /* --- act 1: the plate rises, holds full-bleed, then leaves -------------
     There is no pullback to an inset size any more — nothing is parked behind
     the plate for a mid-size frame to reveal, so `open` only ever climbs. */
  const rise = seg(p, T.plateRise[0], T.plateRise[1], inOut);
  const open = seg(p, T.plateFull[0], T.plateFull[1], inOut);
  const exit = seg(p, T.plateExit[0], T.plateExit[1], t => t * t * t);

  /* full-bleed at 1, inset at 0. Both axes are percentages of the stage,
     which is exactly one viewport, so the zoom factor never enters this. */
  plate.style.setProperty('--pw', mix(INSET.w, 100, open).toFixed(2) + '%');
  plate.style.setProperty('--ph', mix(INSET.h, 100, open).toFixed(2) + '%');
  plate.style.setProperty('--pr', mix(INSET.r, 0, open).toFixed(1) + 'px');
  plate.style.setProperty('--pshadow', (1 - open).toFixed(3));
  /* rise is a share of the plate's own height, exit is a share of the viewport;
     calc() is what lets one transform carry both without a unit conversion */
  plate.style.transform = 'translate3d(0,calc(' +
    mix(126, 0, rise).toFixed(2) + '% - ' +
    ((vh / zoom + 160) * exit).toFixed(1) + 'px),0)';

  /* --- act 2: what the app is, then it leaves with the plate -------------- */
  const out = seg(p, T.contentOut[0], T.contentOut[1], inOut);
  drift = -30 * out;
  layer(page, seg(p, T.pageIn[0], T.pageIn[1]) * (1 - out));

  enter(screen, seg(p, T.screenIn[0], T.screenIn[1]), -34, 56, .94);
  enter(copy,   seg(p, T.copyIn[0],   T.copyIn[1]),    38,  0, 0);
  metrics.forEach((el, i) => {
    const d = i * 0.02;
    enter(el, seg(p, T.railIn[0] + d, T.railIn[1] + d), 0, 22, 0);
  });

  /* counters: snapped, so a slow scrub reads as a count-up and a fast one
     lands on the final figure without ever showing a fractional widget */
  const c = seg(p, T.count[0], T.count[1]);
  const step = Math.round(c * 100);
  if (step !== counted) {
    counted = step;
    counters.forEach(el => {
      const to = parseFloat(el.dataset.count);
      const dec = (el.dataset.count.split('.')[1] || '').length;
      el.textContent = (to * c).toFixed(dec);
    });
  }
};

/* ---------- the scrubber ----------------------------------------------------
   Progress comes from the track's own rect: r.height is the whole track and
   innerHeight is exactly the pinned stage, both in root px, so the ratio is
   immune to the zoom factor entirely. */
let ticking = false;
const update = () => {
  ticking = false;
  const r = track.getBoundingClientRect();
  const travel = r.height - vh;
  if (travel <= 0) return;
  render(clamp(-r.top / travel));
};
const request = () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(update);
};

measure();
update();

addEventListener('scroll', request, { passive: true });
addEventListener('resize', () => { measure(); request(); }, { passive: true });

/* the ribbon is dismissable, and the header changes height when it frosts —
   either one moves the top of the track, so remeasure rather than cache once */
if (window.ResizeObserver) {
  const ro = new ResizeObserver(() => { measure(); request(); });
  ['.relribbon', '.hdr'].forEach(sel => {
    const el = document.querySelector(sel);
    if (el) ro.observe(el);
  });
}

/* a switch to reduced motion mid-session has to give the inline styles back,
   or the static layout inherits a half-scrubbed frame */
mq.addEventListener('change', e => {
  if (!e.matches) return;
  track.classList.remove('is-live');
  [slogan, plate, page, bg, screen, copy, ...metrics].forEach(el => {
    if (el) el.removeAttribute('style');
  });
  counters.forEach(el => { el.textContent = el.dataset.count; });
  removeEventListener('scroll', request);
});
})();
