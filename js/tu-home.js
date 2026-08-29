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
   They hold off until the opening is behind you. On the home pages that is the
   whole pinned cinematic track, not a screen height: a pill floating over a
   full-bleed plate mid-transition reads as a bug, not as chrome. */
(() => {
  const fabs = ['#supportFab', '#discordFab'].map(s => $(s)).filter(Boolean);
  if (!fabs.length) return;
  const opening = $('.cine') || $('.hero');
  if (!opening) { fabs.forEach(f => f.classList.add('show')); return; }
  const update = () => {
    const past = opening.classList.contains('cine')
      ? opening.getBoundingClientRect().bottom <= innerHeight * 0.6
      : scrollY > innerHeight * 0.62;
    fabs.forEach((f, i) => {
      if (past === f.classList.contains('show')) return;
      setTimeout(() => f.classList.toggle('show', past), reduced ? 0 : i * 90);
    });
  };
  addEventListener('scroll', update, { passive: true });
  update();
})();

/* ---------- the rotating word ------------------------------------------------
   It lives on the info page inside the cinematic plate now, not on the hero H1.
   Driven by index rather than by state, and re-queried every step, so if a
   locale or a future surface ever mounts a second .cyc the two say the same
   word at the same moment instead of drifting apart. */
(() => {
  if (!$('.cyc') || reduced) return;
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

/* ---------- top bar (ribbon + header): stays hidden over the hero,
   fades in once block 01 (#features) starts entering the viewport ---------- */
(() => {
  const bar = $('#topBar');
  const feat = $('#features');
  const heroLang = $('#heroLang');
  const heroNav = $('#heroQuicknav');
  if (!bar || !feat) return;
  const onScroll = () => {
    const show = feat.getBoundingClientRect().top <= innerHeight * 0.85;
    bar.classList.toggle('show', show);
    if (heroLang) heroLang.classList.toggle('is-hidden', show);
    if (heroNav) heroNav.classList.toggle('is-hidden', show);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // .rc-rail (Race Control's sticky log) clears the bar's real height via
  // --topbar-h — the ribbon inside it is dismissable, so that height isn't
  // constant and has to be tracked, not hard-coded.
  const setH = () => document.documentElement.style.setProperty('--topbar-h', bar.offsetHeight + 'px');
  setH();
  if (window.ResizeObserver) new ResizeObserver(setH).observe(bar);
  else addEventListener('resize', setH, { passive: true });
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
  const targetStr = cdPanel && cdPanel.dataset.target;
  const TARGET = targetStr ? new Date(targetStr).getTime() : Infinity;

  const gated = $$('a.btn[href="download.html"]');
  const ribbon = $('#relRibbon'), cdSr = $('#cdSr');

  /* ---- live countdown clock (fills the .cddown-grid until release) ---- */
  const cdGrid = cdPanel && $('.cddown-grid', cdPanel);
  const CD = L.cd || { d: 'дн', h: 'ч', m: 'мин', s: 'сек' };
  let cdCells = null;
  function buildGrid() {
    if (!cdGrid || cdCells) return;
    cdGrid.textContent = '';
    cdCells = {};
    [['d', CD.d], ['h', CD.h], ['m', CD.m], ['s', CD.s]].forEach(([key, lbl], i) => {
      if (i) {
        const sep = document.createElement('span');
        sep.className = 'cddown-sep';
        sep.textContent = ':';
        cdGrid.appendChild(sep);
      }
      const cell = document.createElement('div');
      cell.className = 'cddown-cell';
      const num = document.createElement('span');
      num.className = 'cddown-num';
      num.textContent = '00';
      const l = document.createElement('span');
      l.className = 'cddown-lbl';
      l.textContent = lbl;
      cell.append(num, l);
      cdGrid.appendChild(cell);
      cdCells[key] = num;
    });
  }
  function renderCountdown(ms) {
    buildGrid();
    if (!cdCells) return;
    const total = Math.max(0, Math.floor(ms / 1000));
    const pad = n => String(n).padStart(2, '0');
    cdCells.d.textContent = String(Math.floor(total / 86400));
    cdCells.h.textContent = pad(Math.floor(total % 86400 / 3600));
    cdCells.m.textContent = pad(Math.floor(total % 3600 / 60));
    cdCells.s.textContent = pad(total % 60);
  }

  // remember each button's own label so unlocking restores the exact wording
  gated.forEach(btn => {
    const label = $('.btn-label', btn);
    if (label && !btn.dataset.origLabel) btn.dataset.origLabel = label.textContent;
  });

  function lockBtn(btn) {
    btn.classList.add('is-locked');
    btn.setAttribute('aria-disabled', 'true');
    const label = $('.btn-label', btn);
    if (label) label.textContent = L.lockSoon || 'Скоро';
    btn.setAttribute('aria-label', L.lockAriaSoon || 'Скачивание скоро откроется.');
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
  }

  gated.forEach(btn => btn.addEventListener('click', e => {
    if (btn.classList.contains('is-locked')) e.preventDefault();
  }));

  let locked = false;
  function lockAll() {
    if (locked) return;
    locked = true;
    gated.forEach(btn => lockBtn(btn));
  }

  function tick() {
    if (!Number.isFinite(TARGET)) { lockAll(); return; }
    const ms = TARGET - Date.now();
    if (ms <= 0) { unlock(); return; }
    renderCountdown(ms);
    lockAll();
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
