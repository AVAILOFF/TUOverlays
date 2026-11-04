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

/* ---------- top bar (the header): hidden over the title card, in from act 2
   ----------------------------------------------------------------------------
   js/tu-cine.js publishes the act on .cine[data-act]. The header arrives once
   the plate is open (act 2) and stays transparent over it — it frosts only
   when 01 (#features) comes up. Without a live scrubber (reduced motion, no
   pin) the old rule holds: everything keys off #features. */
(() => {
  const bar = $('#topBar');
  const hdr = $('#hdr');
  const feat = $('#features');
  const cine = $('.cine');
  const heroLang = $('#heroLang');
  const heroNav = $('#heroQuicknav');
  if (!bar || !feat) return;
  const sync = () => {
    const near = feat.getBoundingClientRect().top <= innerHeight * 0.85;
    const live = cine && cine.classList.contains('is-live');
    const show = near || (live && Number(cine.dataset.act) >= 2);
    bar.classList.toggle('show', show);
    if (hdr) hdr.classList.toggle('stuck', live ? near : scrollY > 14);
    if (heroLang) heroLang.classList.toggle('is-hidden', show);
    if (heroNav) heroNav.classList.toggle('is-hidden', show);
  };
  addEventListener('scroll', sync, { passive: true });
  if (cine) cine.addEventListener('cine:act', sync);
  sync();

  // .rc-rail (Race Control's sticky log) clears the bar's real height via
  // --topbar-h — the header frosts and so changes height, so it is tracked,
  // not hard-coded.
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

/* ---------- widget gallery (01): a tile puts its widget on the stage -------
   Each tile carries its own copy in data-*, so this stays locale-free. */
(() => {
  const root = $('#wg');
  if (!root) return;
  const tiles = $$('.wg-tile[data-i]', root);
  const shot = $('#wgShot'), img = $('#wgImg'), bg = $('#wgBg');
  if (!tiles.length || !shot || !img) return;
  let cur = 0, timer = 0;

  /* warm the cache so a swap never flashes an empty stage */
  tiles.forEach(t => { const i = new Image(); i.src = $('img', t).src; });

  const show = i => {
    if (i === cur) return;
    cur = i;
    const t = tiles[i], th = $('img', t), d = t.dataset;
    tiles.forEach((x, k) => {
      x.classList.toggle('is-on', k === i);
      x.setAttribute('aria-pressed', String(k === i));
    });
    $('#wg').style.setProperty('--k', 'var(--k-' + d.fam + ')');
    $('#wgHead').textContent = d.head;
    $('#wgDesc').textContent = d.desc;
    const swap = () => {
      img.src = th.getAttribute('src');
      /* the attributes, not .width — that is the thumbnail's rendered size */
      img.setAttribute('width', th.getAttribute('width'));
      img.setAttribute('height', th.getAttribute('height'));
      img.alt = d.alt;
      if (bg) bg.style.backgroundImage = 'url(' + d.bg + ')';
      shot.classList.remove('is-swap');
    };
    if (reduced) { swap(); return; }
    clearTimeout(timer);
    shot.classList.add('is-swap');
    timer = setTimeout(swap, 160);
  };

  tiles.forEach(t => t.addEventListener('click', () => show(Number(t.dataset.i))));
  root.addEventListener('keydown', e => {
    if (!e.target.closest('.wg-tile[data-i]')) return;
    const k = e.key;
    const d = k === 'ArrowRight' || k === 'ArrowDown' ? 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (cur + d + tiles.length) % tiles.length;
    show(n);
    tiles[n].focus();
  });
  /* «+16» opens the catalog it points at */
  const more = $('.wg-more', root), cat = $('#wgCatalog');
  if (more && cat) more.addEventListener('click', () => { cat.open = true; });
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

/* ---------- race control: live demo ------------------------------------------
   Race footage beside the app's popped-out Race Control window, behaving as
   the app does: newest line first, filter chips, flags, prev/next, 5s/10s/15s replay
   lead-ins, viewed lines dimmed, the player's own lines edged in amber. One
   departure: a single click on a line replays it (the app wants a double
   click, so a broadcast is never cut by accident — a visitor has no broadcast).

   Two videos stand in for the sim. .rcd-live is the race as it happens
   (loops; its first frame is session time `base`); .rcd-rep plays one
   incident file at a time. event.clip = [file number in clips/, length,
   second in the file where the incident happens], so a lead-in of s seconds
   starts at max(0, that - s). One file per incident rather than one long
   cut to seek inside: a seek far into a file needs HTTP Range, and a server
   without it silently starts every replay at 0. Lines later than `base` land
   in the log when the live footage reaches them; the rest are the race so far. While a replay runs, live is paused
   and its time kept on the wall clock — a hidden muted video may be throttled
   by the browser, so it cannot be trusted to keep counting. All copy comes
   from TU_L.rcd and #rcdData, so the locales cannot drift. */
(() => {
  const root = $('#rcd'), data = $('#rcdData');
  if (!root || !data) return;
  const D = JSON.parse(data.textContent);
  const T = L.rcd || {};
  const live = $('.rcd-live', root), rep = $('.rcd-rep', root);
  const list = $('#rcdList');
  const nNew = $('#rcdNew'), nCount = $('#rcdCount'), nPos = $('#rcdPos');
  const flagBtn = $('#rcdFlagged'), flagTxt = $('#rcdFlaggedTxt');
  const STAR = $('svg', flagBtn).outerHTML;
  const PRESETS = [5, 10, 15];

  const plural = new Intl.PluralRules(document.documentElement.lang || 'en');
  const count = (forms, n) => fmt((forms || {})[plural.select(n)] || (forms || {}).other || '{n}', { n });
  const clk = s => { s = Math.max(0, Math.floor(s)); return (s / 3600 | 0) + ':' + pad2((s % 3600) / 60 | 0) + ':' + pad2(s % 60); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const type = e => (T.types || {})[e.kind] || e.kind;
  // lost-control and crash share the "Crashes" chip, as in the app's categoryOf()
  const cat = e => e.kind === 'off-track' || e.kind === 'contact' ? e.kind : 'crash';
  const mine = e => e.cars.some(c => c[0] === D.me);
  const play = v => { const p = v.play(); if (p) p.catch(() => {}); };

  const evs = D.events.map((e, i) => Object.assign({ id: i, live: e.t > D.base ? e.t - D.base : null }, e));
  const past = () => new Set(evs.filter(e => e.live == null || reduced).map(e => e.id));
  let shown = past(), seen = new Set(), flagged = new Set(), fresh = new Set();
  const cats = { crash: true, 'off-track': true, contact: true };
  let flaggedOnly = false, sel = null, cur = null, lastT = 0, inView = false;
  let held = 0, heldAt = 0;   // live position + wall time when a replay began

  const liveT = () => cur ? held + (performance.now() - heldAt) / 1000 : live.currentTime;
  // newest first, the way the app sorts its log
  const visible = () => evs.filter(e => shown.has(e.id) && cats[cat(e)] && (!flaggedOnly || flagged.has(e.id))).reverse();

  const line = e => {
    const cls = 'rcd-ln' + (mine(e) ? ' is-me' : '') + (sel === e.id ? ' is-sel' : '') +
      (seen.has(e.id) ? ' is-seen' : '') + (fresh.has(e.id) && !reduced ? ' is-new' : '');
    const on = flagged.has(e.id);
    return '<div class="' + cls + '" data-id="' + e.id + '">' +
      '<button type="button" class="rcd-go" data-s="5">' +
        '<span class="c">' + clk(e.t) + '</span><span class="l">L' + e.lap + '</span>' +
        '<span class="k k-' + e.kind + '">' + esc(type(e)) + '</span></button>' +
      '<span class="rcd-cars">' + e.cars.map(c =>
        '<span class="rcd-car' + (c[0] === D.me ? ' is-me' : '') + '">#' + c[0] + ' <span>' + esc(c[1]) + '</span></span>').join('') +
        (e.cars.length > 1 ? '<span class="rcd-n">' + esc(count(T.carsCount, e.cars.length)) + '</span>' : '') + '</span>' +
      (e.pts ? '<span class="rcd-pts">' + e.pts + 'x</span>' : '') +
      '<button type="button" class="rcd-star' + (on ? ' is-on' : '') + '" data-flag aria-pressed="' + on + '" title="' +
        esc(on ? T.unflag : T.flag) + '" aria-label="' + esc(on ? T.unflag : T.flag) + '">' + STAR + '</button>' +
      '<span class="rcd-pre">' + PRESETS.map(s =>
        '<button type="button" data-s="' + s + '" title="' + esc(fmt(T.replayFrom, { n: s })) + '">' + s + 's</button>').join('') + '</span>' +
    '</div>';
  };

  const render = () => {
    const f = document.activeElement;
    const keep = f && list.contains(f) ? [f.closest('.rcd-ln').dataset.id, f.dataset.s, f.hasAttribute('data-flag')] : null;
    const rows = visible();
    list.innerHTML = rows.length ? rows.map(line).join('') : '<div class="rcd-empty">' + esc(T.emptyFiltered) + '</div>';
    fresh.clear();

    const total = evs.filter(e => shown.has(e.id)).length;
    const unseen = evs.filter(e => shown.has(e.id) && !seen.has(e.id)).length;
    nNew.textContent = unseen ? count(T.newCount, unseen) : '';
    nCount.textContent = rows.length === total ? total : rows.length + ' / ' + total;
    const i = rows.findIndex(e => e.id === sel);
    nPos.textContent = i >= 0 ? (rows.length - i) + ' / ' + rows.length : '';
    flagTxt.textContent = flagged.size ? flagged.size : T.flagged;

    if (keep) {
      const ln = $('.rcd-ln[data-id="' + keep[0] + '"]', list);
      const b = ln && (keep[2] ? $('[data-flag]', ln) : $('[data-s="' + (keep[1] || 5) + '"]', ln));
      if (b) b.focus({ preventScroll: true });
    }
  };

  // land every live event the footage has reached by second t
  const reach = t => {
    let added = false;
    evs.forEach(e => {
      if (e.live != null && !shown.has(e.id) && t >= e.live) { shown.add(e.id); fresh.add(e.id); added = true; }
    });
    if (added) { render(); if (!cur) list.scrollTop = 0; }
  };

  const reset = () => { shown = past(); seen.clear(); flagged.clear(); sel = null; render(); list.scrollTop = 0; };

  // Clip files are fetched once into memory while the demo is on screen. On a
  // slow or throttled route a clip requested only on click took seconds to
  // arrive, and the visitor read the wait as a dead button.
  const clipUrl = n => rep.dataset.base + pad2(n) + '.mp4';
  const blobs = {};
  let warming = false;
  const warm = async () => {
    if (warming || !window.fetch || !window.URL) return;
    warming = true;
    // newest incidents first: they sit at the top of the log
    const nums = [...new Set(evs.slice().reverse().map(e => e.clip[0]))];
    for (const n of nums) {
      try {
        const r = await fetch(clipUrl(n));
        if (r.ok) blobs[n] = URL.createObjectURL(await r.blob());
      } catch (_) { /* the click path still loads it over the network */ }
    }
  };

  const replay = (e, lead) => {
    if (!cur) { held = live.currentTime; heldAt = performance.now(); live.pause(); }
    cur = e;
    sel = e.id;
    seen.add(e.id);   // looking at an incident is what "viewed" means, as in the app
    const from = Math.max(0, e.clip[2] - lead);
    const src = blobs[e.clip[0]] || clipUrl(e.clip[0]);
    if (rep.getAttribute('src') !== src) rep.src = src;
    // before metadata a seek is dropped by the load, so it waits for it
    if (rep.readyState >= 1) rep.currentTime = from;
    else rep.addEventListener('loadedmetadata', () => { if (cur === e) rep.currentTime = from; }, { once: true });
    // the frozen live frame stays up until the replay actually moves —
    // a black stage while the clip loads looks like nothing happened
    rep.hidden = false;
    if (!live.hidden && (rep.readyState < 3 || rep.seeking)) root.classList.add('is-wait');
    play(rep);
    render();
  };
  rep.addEventListener('playing', () => {
    if (!cur) return;
    root.classList.remove('is-wait');
    live.hidden = true;
  });

  const backToLive = () => {
    if (!cur) return;
    let t = liveT();
    const dur = live.duration || 0;
    cur = null;
    root.classList.remove('is-wait');
    if (dur && t >= dur) { t %= dur; reset(); }
    rep.pause();
    rep.hidden = true;
    live.hidden = false;
    lastT = t;
    if (!reduced) { live.currentTime = t; if (inView) play(live); }
    render();
    reach(t);
  };

  live.addEventListener('timeupdate', () => {
    if (cur) return;
    const t = live.currentTime;
    if (t + 1 < lastT) reset();   // the loop wrapped: the race starts over
    lastT = t;
    reach(t);
  });
  rep.addEventListener('timeupdate', () => {
    // a seek to another clip is still landing: the old position means nothing
    if (!cur || rep.seeking) return;
    reach(liveT());
    if (rep.currentTime >= cur.clip[1] - .15) backToLive();
  });
  rep.addEventListener('ended', backToLive);

  list.addEventListener('click', ev => {
    const ln = ev.target.closest('.rcd-ln');
    if (!ln) return;
    const e = evs[Number(ln.dataset.id)];
    if (ev.target.closest('[data-flag]')) {
      flagged.has(e.id) ? flagged.delete(e.id) : flagged.add(e.id);
      render();
      return;
    }
    const b = ev.target.closest('[data-s]');
    if (b) replay(e, Number(b.dataset.s));
  });

  // "next" is newer, which is *up* a newest-first log — same walk as the app
  const step = dir => {
    const rows = visible();
    if (!rows.length) return;
    const i = rows.findIndex(e => e.id === sel);
    const j = i < 0 ? (dir === 'next' ? rows.length - 1 : 0)
                    : Math.max(0, Math.min(rows.length - 1, dir === 'next' ? i - 1 : i + 1));
    replay(rows[j], 5);
    const ln = $('.rcd-ln[data-id="' + rows[j].id + '"]', list);
    if (ln) ln.scrollIntoView({ block: 'nearest' });
  };
  $('#rcdPrev').addEventListener('click', () => step('prev'));
  $('#rcdNext').addEventListener('click', () => step('next'));

  $$('.rcd-fchip[data-cat]', root).forEach(b => b.addEventListener('click', () => {
    cats[b.dataset.cat] = !cats[b.dataset.cat];
    b.setAttribute('aria-pressed', String(cats[b.dataset.cat]));
    render();
  }));
  flagBtn.addEventListener('click', () => {
    flaggedOnly = !flaggedOnly;
    flagBtn.setAttribute('aria-pressed', String(flaggedOnly));
    render();
  });
  $('#rcdLive').addEventListener('click', backToLive);
  $('#rcdMyCar').addEventListener('click', backToLive);

  // footage only runs while the demo is on screen; reduced motion never
  // starts the live feed — a replay is still one click away
  new IntersectionObserver(([en]) => {
    inView = en.isIntersecting;
    if (!inView) { live.pause(); rep.pause(); return; }
    warm();
    if (cur) play(rep);
    else if (!reduced) play(live);
  }, { threshold: .35 }).observe(root);

  render();
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

/* ---------- gallery video: plays only while on screen -----------------------
   Muted footage in place of a still. Reduced motion never starts it on its
   own; the visitor gets the controls and decides. */
(() => {
  const vids = $$('.g-video');
  if (!vids.length) return;
  if (reduced) { vids.forEach(v => { v.controls = true; }); return; }
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { const p = e.target.play(); if (p) p.catch(() => {}); }
    else e.target.pause();
  }), { threshold: .35 });
  vids.forEach(v => io.observe(v));
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
  const cdSr = $('#cdSr');

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
    const colors = ['#ff5f96', '#6cd7e3', '#f2b95a', '#63d99b', '#ffffff'];
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

    const u = L.unlock || {};
    const heading = $('#dlHeading'), lead = $('#dlLead');
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

})();

})();
