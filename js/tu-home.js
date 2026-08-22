/* ============================================================================
   TU OVERLAYS — home page behaviour
   ----------------------------------------------------------------------------
   Shared by index.html and en/index.html so the two locales cannot drift.
   All user-facing strings come from window.TU_L, declared inline per page.

   MOTION CONTRACT (mirrors css/tu-core.css):
     · one reveal:  opacity + 14px translateY, 420ms, cubic-bezier(.2,.6,.25,1)
     · one stagger: 60ms, capped at 4 steps (240ms) — never longer
     · no parallax, no scroll-jacking, no scroll-linked transforms
   ========================================================================== */
(() => {
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const L  = window.TU_L || {};
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (tpl, v) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => v[k]);
const pad2 = n => String(n).padStart(2, '0');

/* ---------- floating buttons -------------------------------------------------
   They hold off until the hero is behind you: the hero is a two-column split and
   a bottom-left pill would sit straight on top of the lead paragraph. */
(() => {
  const fabs = ['#supportFab', '#discordFab'].map(s => $(s)).filter(Boolean);
  if (!fabs.length) return;
  if (!document.querySelector('.hero')) { fabs.forEach(f => f.classList.add('show')); return; }
  const update = () => {
    const past = scrollY > innerHeight * 0.62;
    fabs.forEach((f, i) => {
      if (past === f.classList.contains('show')) return;
      setTimeout(() => f.classList.toggle('show', past), reduced ? 0 : i * 90);
    });
  };
  addEventListener('scroll', update, { passive: true });
  update();
})();

/* ---------- hero H1: rotating word -------------------------------------------
   Driven by index, not by state, and re-queried every step: the hero copy the
   scroll transition mounts on the rig's monitor is a clone of this one, and the
   two headlines have to say the same word at the same moment. */
(() => {
  if (!$('.hero h1 .cyc') || reduced) return;
  let i = 0;
  setInterval(() => {
    i++;
    $$('.cyc').forEach(cyc => {
      const words = $$('.cyc-w', cyc);
      if (words.length < 2) return;
      const cur = words[(i - 1) % words.length], next = words[i % words.length];
      words.forEach(w => { if (w !== cur && w !== next) w.classList.remove('is-on', 'is-out'); });
      cur.classList.remove('is-on');
      cur.classList.add('is-out');
      next.classList.remove('is-out');
      next.classList.add('is-on');
      setTimeout(() => cur.classList.remove('is-out'), 440);
    });
  }, 2400);
})();

/* ---------- BETA sticker: random pick every load ---------- */
(() => {
  const variants = [
    { cls: 'v1', html: '<span class="q">“</span>BETA<span class="q">”</span>' },
    { cls: 'v2', html: 'BETA<span class="qm">?</span>' },
    { cls: 'v3 stack', html: 'BETA<span class="sub">' + (L.betaSub1 || '') + '</span>' },
    { cls: 'v4', html: '<span class="inner">BETA</span>' },
    { cls: 'v5', html: '<span class="q">“</span>BETA<span class="q">”</span>' },
    { cls: 'v6 stack', html: 'BETA<span class="sub">' + (L.betaSub2 || '') + '</span>' },
  ];
  const pick = variants[Math.floor(Math.random() * variants.length)];
  $$('.logo').forEach(logo => {
    const b = document.createElement('span');
    b.className = 'beta ' + pick.cls;
    b.innerHTML = pick.html;
    b.setAttribute('aria-hidden', 'true');
    logo.appendChild(b);
  });
})();

/* ---------- sticky header: transparent over the hero, frosted after ---------- */
(() => {
  const hdr = $('#hdr');
  if (!hdr) return;
  const onScroll = () => hdr.classList.toggle('stuck', scrollY > 14);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ---------- mobile nav ---------- */
(() => {
  const burger = $('#burger'), mnav = $('#mnav');
  if (!burger || !mnav) return;
  burger.addEventListener('click', () => {
    const open = burger.getAttribute('aria-expanded') === 'true';
    burger.setAttribute('aria-expanded', String(!open));
    mnav.classList.toggle('open', !open);
  });
  $$('a', mnav).forEach(a => a.addEventListener('click', () => {
    burger.setAttribute('aria-expanded', 'false');
    mnav.classList.remove('open');
  }));
})();

/* ---------- scroll reveal: one motion, 60ms stagger, capped at 4 steps ------- */
(() => {
  // containers marked data-reveal-group hand their revealing children the delay
  $$('[data-reveal-group]').forEach(group => {
    $$('[data-reveal]', group).forEach((el, i) => {
      el.style.setProperty('--d', Math.min(i, 4) * 60 + 'ms');
    });
  });

  const all = $$('[data-reveal]');
  if (reduced) { all.forEach(el => el.classList.add('in')); return; }
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: .06 });
  // js/hero-transition.js takes the feature grid off this observer while the
  // hero->features move owns it, and hands it back if that move is not running
  window.TU_REVEAL_IO = io;
  all.forEach(el => io.observe(el));
})();

/* ---------- FAQ accordion ---------- */
$$('#faqList .qa').forEach(qa => {
  const btn = $('.qa-q', qa);
  if (!btn) return;
  btn.addEventListener('click', () => {
    const open = qa.classList.contains('on');
    $$('#faqList .qa').forEach(o => {
      o.classList.remove('on');
      const b = $('.qa-q', o);
      if (b) b.setAttribute('aria-expanded', 'false');
    });
    if (!open) { qa.classList.add('on'); btn.setAttribute('aria-expanded', 'true'); }
  });
});

/* ---------- race control: sticky rail counter -------------------------------
   The rail stays put while the log scrolls past it and reports which entry is
   in the reading band. No transform is driven by scroll — only a class swap. */
(() => {
  const rows = $$('.rc-row');
  const now = $('#rcNow'), total = $('#rcTotal');
  if (!rows.length) return;
  if (total) total.textContent = pad2(rows.length);

  let ticking = false;
  const update = () => {
    ticking = false;
    const band = innerHeight * 0.42;
    let idx = -1;
    rows.forEach((r, i) => { if (r.getBoundingClientRect().top <= band) idx = i; });
    rows.forEach((r, i) => r.classList.toggle('is-now', i === idx));
    if (now && idx >= 0) now.textContent = pad2(idx + 1);
  };
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
  update();
})();

/* ---------- composed-screenshot lightbox (kept for [data-shot] scenes) ------- */
(() => {
  const lb = $('#lb'), lbFrame = $('#lbFrame');
  if (!lb || !lbFrame) return;
  const cards = $$('[data-shot]');
  const lbTitle = $('#lbTitle'), lbSub = $('#lbSub');
  const SHOT_W = 960, SHOT_H = 540;
  let idx = 0, last = null;

  // scale the fixed-size scenes into whatever frame holds them
  const fit = frame => {
    const shot = $('.shot', frame);
    if (shot) shot.style.transform = 'scale(' + (frame.clientWidth / SHOT_W) + ')';
  };
  const ro = new ResizeObserver(es => es.forEach(e => fit(e.target)));
  $$('.frame').forEach(f => { fit(f); ro.observe(f); });

  const fitLb = () => {
    const shot = $('.shot', lbFrame);
    if (!shot) return;
    const k = innerWidth >= 820
      ? lbFrame.clientWidth / SHOT_W
      : Math.max(lbFrame.clientHeight / SHOT_H, (lbFrame.clientWidth / SHOT_W) * 2.2);
    shot.style.transform = 'scale(' + k + ')';
    const canvas = shot.parentElement;
    canvas.style.width = (SHOT_W * k) + 'px';
    canvas.style.height = (SHOT_H * k) + 'px';
  };
  new ResizeObserver(fitLb).observe(lbFrame);

  const open = i => {
    idx = (i + cards.length) % cards.length;
    const card = cards[idx];
    const canvas = document.createElement('div');
    canvas.className = 'lb-canvas';
    canvas.appendChild($('.shot', card).cloneNode(true));
    lbFrame.replaceChildren(canvas);
    if (lbTitle) lbTitle.textContent = card.dataset.title || '';
    if (lbSub) lbSub.textContent = card.dataset.sub || '';
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      fitLb();
      lbFrame.scrollLeft = (lbFrame.scrollWidth - lbFrame.clientWidth) / 2;
    });
    $('#lbClose').focus();
  };
  const close = () => {
    lb.hidden = true;
    document.body.style.overflow = '';
    if (last) last.focus();
  };

  cards.forEach((c, i) => c.addEventListener('click', () => { last = c; open(i); }));
  $('#lbClose').addEventListener('click', close);
  $('#lbPrev').addEventListener('click', () => open(idx - 1));
  $('#lbNext').addEventListener('click', () => open(idx + 1));
  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  addEventListener('keydown', e => {
    if (lb.hidden) return;
    if (e.key === 'Escape') close();
    if (!cards.length) return;
    if (e.key === 'ArrowLeft') open(idx - 1);
    if (e.key === 'ArrowRight') open(idx + 1);
  });
})();

/* ---------- photo lightbox: hero deck, feature cards, gallery ---------- */
(() => {
  const plb = $('#plb'), plbImg = $('#plbImg'), plbTitle = $('#plbTitle');
  if (!plb || !plbImg) return;
  const shots = $$('.w-shot, .fcard .mv img, .g-photo');
  if (!shots.length) return;
  let idx = 0, last = null;

  const open = i => {
    idx = (i + shots.length) % shots.length;
    const img = shots[idx];
    plbImg.src = img.currentSrc || img.src;
    plbImg.alt = img.alt;
    if (plbTitle) plbTitle.textContent = img.alt;
    plb.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#plbClose').focus();
  };
  const close = () => {
    plb.hidden = true;
    document.body.style.overflow = '';
    if (last) last.focus();
  };

  shots.forEach((s, i) => {
    s.setAttribute('role', 'button');
    s.setAttribute('tabindex', '0');
    s.addEventListener('click', () => { last = s; open(i); });
    s.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); last = s; open(i); }
    });
  });
  $('#plbClose').addEventListener('click', close);
  $('#plbPrev').addEventListener('click', () => open(idx - 1));
  $('#plbNext').addEventListener('click', () => open(idx + 1));
  plb.addEventListener('click', e => { if (e.target === plb) close(); });
  addEventListener('keydown', e => {
    if (plb.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') open(idx - 1);
    if (e.key === 'ArrowRight') open(idx + 1);
  });
})();

/* ---------- latest release tag ---------- */
(() => {
  const slots = $$('.js-version');
  if (!slots.length) return;
  fetch('https://api.github.com/repos/AVAILOFF/TUOverlays/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
  })
    .then(res => res.ok ? res.json() : Promise.reject(res.status))
    .then(rel => { if (rel.tag_name) slots.forEach(el => { el.textContent = rel.tag_name; }); })
    .catch(() => {});
})();

/* ==========================================================================
   RELEASE GATE — countdown, button lock, ribbon, release-day promo
   ========================================================================== */
(() => {
  const cdPanel = $('#dlCountdown');
  const TARGET = new Date((cdPanel && cdPanel.dataset.target) || '2026-08-23T21:00:00+03:00').getTime();
  const PROMO_END = new Date((cdPanel && cdPanel.dataset.promoEnd) || '2026-08-24T00:00:00+03:00').getTime();

  const gated = $$('a.btn[href="download.html"]');
  const ribbon = $('#relRibbon'), ribbonCd = $('#ribbonCd'), cdSr = $('#cdSr');
  const cdD = $('#cdDays'), cdH = $('#cdHours'), cdM = $('#cdMins'), cdS = $('#cdSecs');

  // remember each button's own label so unlocking restores the exact wording
  gated.forEach(btn => {
    const label = $('.btn-label', btn);
    if (label && !btn.dataset.origLabel) btn.dataset.origLabel = label.textContent;
  });

  const parts = ms => {
    const s = Math.floor(ms / 1000);
    return { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
  };

  function lockBtn(btn, p) {
    btn.classList.add('is-locked');
    btn.setAttribute('aria-disabled', 'true');
    const v = { d: p.d, h: pad2(p.h), m: pad2(p.m), s: pad2(p.s) };
    const label = $('.btn-label', btn);
    if (label) label.textContent = p.d > 0 ? fmt(L.lockD, v) : fmt(L.lockH, v);
    btn.setAttribute('aria-label', p.d > 0 ? fmt(L.lockAriaD, p) : fmt(L.lockAriaH, p));
  }

  function spawnConfetti(container, count) {
    if (reduced || !container) return;
    const colors = ['#ff5f96', '#3fd8e0', '#ffb02e', '#35e08d', '#ffffff'];
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.style.left = (Math.random() * 100).toFixed(1) + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = (1.5 + Math.random() * 1.3).toFixed(2) + 's';
      p.style.animationDelay = (Math.random() * 1).toFixed(2) + 's';
      container.appendChild(p);
    }
  }

  let unlocked = false;
  function unlock() {
    if (unlocked) return;
    unlocked = true;

    gated.forEach(btn => {
      btn.classList.remove('is-locked');
      btn.removeAttribute('aria-disabled');
      btn.removeAttribute('aria-label');
      const label = $('.btn-label', btn);
      if (label && btn.dataset.origLabel) label.textContent = btn.dataset.origLabel;
      if (!reduced) {
        btn.classList.add('just-unlocked');
        setTimeout(() => btn.classList.remove('just-unlocked'), 700);
      }
    });

    if (cdPanel) { cdPanel.classList.add('is-live'); spawnConfetti($('.cddown-confetti', cdPanel), 24); }
    if (ribbon) ribbon.classList.add('is-live');

    const u = L.unlock || {};
    const eyebrow = $('#dlEyebrow'), heading = $('#dlHeading'), lead = $('#dlLead');
    if (eyebrow && u.eyebrow) eyebrow.textContent = u.eyebrow;
    if (heading && u.heading) heading.innerHTML = u.heading;
    if (lead && u.lead) lead.textContent = u.lead;
    if (cdSr && u.sr) cdSr.textContent = u.sr;
    // every copy of it: the scroll transition mounts a clone of the hero on
    // the rig's monitor, and both badges have to say the same thing
    if (u.heroBadge) $$('.hero .rel-badge').forEach(b => { b.innerHTML = u.heroBadge; });
  }

  gated.forEach(btn => btn.addEventListener('click', e => {
    if (btn.classList.contains('is-locked')) e.preventDefault();
  }));

  /* ---- release-day promo (preset giveaway) — unlocks with the buttons ---- */
  const PROMO_PREVIEW = new URLSearchParams(location.search).get('promo') === '1';
  const promoBtn = $('#ribbonPromoBtn'), promo = $('#promo'), promoClose = $('#promoClose');
  let promoLastFocus = null;

  const tickPromoVisibility = () => {
    if (!promoBtn) return;
    const now = Date.now();
    promoBtn.style.display = (PROMO_PREVIEW || (now >= TARGET && now < PROMO_END)) ? 'inline-flex' : 'none';
  };
  const openPromo = () => {
    if (!promo) return;
    promoLastFocus = document.activeElement;
    const confetti = $('.cddown-confetti', promo);
    if (confetti) { confetti.replaceChildren(); spawnConfetti(confetti, 18); }
    promo.hidden = false;
    document.body.style.overflow = 'hidden';
    if (promoClose) promoClose.focus();
  };
  const closePromo = () => {
    if (!promo) return;
    promo.hidden = true;
    document.body.style.overflow = '';
    if (promoLastFocus) promoLastFocus.focus();
  };
  if (promoBtn) promoBtn.addEventListener('click', openPromo);
  if (promoClose) promoClose.addEventListener('click', closePromo);
  if (promo) promo.addEventListener('click', e => { if (e.target === promo) closePromo(); });
  addEventListener('keydown', e => {
    if (promo && !promo.hidden && e.key === 'Escape') closePromo();
  });

  function tick() {
    tickPromoVisibility();
    const ms = TARGET - Date.now();
    if (ms <= 0) { unlock(); return; }
    const p = parts(ms);
    if (cdD) cdD.textContent = pad2(p.d);
    if (cdH) cdH.textContent = pad2(p.h);
    if (cdM) cdM.textContent = pad2(p.m);
    if (cdS) cdS.textContent = pad2(p.s);
    if (ribbonCd) ribbonCd.textContent = (p.d > 0 ? p.d + (L.dayShort || 'd') + ' ' : '') +
      pad2(p.h) + ':' + pad2(p.m) + ':' + pad2(p.s);
    gated.forEach(btn => lockBtn(btn, p));
  }
  tick();
  setInterval(tick, 1000);

  /* ---- ribbon dismiss (persists for this browser session) ---- */
  const ribbonClose = $('#ribbonClose');
  if (ribbon) {
    let dismissed = false;
    try { dismissed = sessionStorage.getItem('tu-ribbon-dismissed') === '1'; } catch (_) {}
    if (dismissed) ribbon.hidden = true;
  }
  if (ribbonClose) ribbonClose.addEventListener('click', () => {
    ribbon.hidden = true;
    try { sessionStorage.setItem('tu-ribbon-dismissed', '1'); } catch (_) {}
  });
})();

})();
