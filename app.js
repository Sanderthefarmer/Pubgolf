/* Pubgolf — scorekaart-app voor een kroegentocht.
 * Eén statische pagina. Live synchronisatie loopt via de REST-API van een
 * Firebase Realtime Database (geen SDK nodig); zonder database werkt de app
 * lokaal op één toestel. */
'use strict';
(function () {
  // ------------------------------------------------------------ helpers
  const $ = (sel, root) => (root || document).querySelector(sel);
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const now = () => Date.now();
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  function uid(n) {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    const buf = new Uint8Array(n || 8);
    crypto.getRandomValues(buf);
    let s = '';
    buf.forEach((b) => { s += abc[b % abc.length]; });
    return s;
  }
  function randInt(n) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % n;
  }
  function hashStr(s) {
    let h = 5381;
    for (const ch of String(s)) h = ((h << 5) + h + ch.codePointAt(0)) >>> 0;
    return h.toString(36);
  }
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* vol of geblokkeerd */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* negeren */ } }
  };
  function restart() {
    const u = location.origin + location.pathname;
    if (location.href === u) location.reload(); else location.href = u;
  }
  const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* negeren */ } };

  // ------------------------------------------------------------ config
  const CFG = window.PUBGOLF_CONFIG || {};
  const qs = new URLSearchParams(location.search);
  const hs = new URLSearchParams(location.hash.replace(/^#/, ''));
  const param = (k) => hs.get(k) || qs.get(k) || '';

  function normalizeDb(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (u.toLowerCase() === 'local') return 'local';
    u = u.replace(/\/?\.json.*$/, '').replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }
  const cleanGame = (g) => String(g || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);

  const CFG_DB = normalizeDb(CFG.db);
  const CFG_GAME = cleanGame(CFG.game) || 'pubgolf';
  const DB = normalizeDb(param('db')) || CFG_DB || normalizeDb(LS.get('pg.db', ''));
  const GAME = cleanGame(param('g')) || CFG_GAME;
  if (param('db') && DB) LS.set('pg.db', DB);
  const LOCAL = DB === 'local';
  const NS = 'pg.' + hashStr(DB + '|' + GAME) + '.';

  // ------------------------------------------------------------ defaults
  const DEFAULT_WHEEL = [
    { label: 'Bier', par: 2 }, { label: 'Wijn', par: 3 }, { label: 'Shotje', par: 1 },
    { label: 'Mixdrankje', par: 3 }, { label: 'Speciaalbier', par: 4 }, { label: 'Fris / 0.0', par: 2 }
  ];
  const DEFAULT_HOLES = [
    { name: 'Kroeg 1', type: 'fixed', drink: 'Biertje', par: 2 },
    { name: 'Kroeg 2', type: 'fixed', drink: 'Wijntje', par: 3 },
    { name: 'Kroeg 3', type: 'wheel', wheelMode: 'player', options: DEFAULT_WHEEL },
    { name: 'Kroeg 4', type: 'fixed', drink: 'Speciaalbier', par: 4 },
    { name: 'Kroeg 5', type: 'fixed', drink: 'Shotje', par: 1 },
    { name: 'Kroeg 6', type: 'wheel', wheelMode: 'player', options: DEFAULT_WHEEL },
    { name: 'Kroeg 7', type: 'fixed', drink: 'Mixdrankje', par: 3 },
    { name: 'Kroeg 8', type: 'fixed', drink: 'Cider', par: 3 },
    { name: 'Kroeg 9', type: 'fixed', drink: 'Halve liter bier', par: 4 }
  ];
  const DEFAULT_PENS = [
    { l: 'Gemorst', n: 1 }, { l: 'Te laat bij de hole', n: 1 }, { l: 'Glas omgegooid', n: 2 }
  ];
  const EMOJIS = ['🍺', '🍻', '🍷', '🥃', '🍸', '🍹', '⛳', '🏌️', '🦄', '🦊', '🐻', '🐸', '🐧', '🦁', '🐯', '🐵',
    '🐷', '🐮', '🦆', '🦈', '🐙', '🚀', '🔥', '⚡', '👑', '🎩', '🤠', '😎', '🤡', '👻', '🍕', '🌮'];

  // ------------------------------------------------------------ store
  function norm(d) {
    d = d && typeof d === 'object' ? d : {};
    return { meta: d.meta || null, holes: d.holes || {}, players: d.players || {}, scores: d.scores || {}, spins: d.spins || {} };
  }
  const S = {
    data: norm(LS.get(NS + 'data', null)),
    outbox: LS.get(NS + 'outbox', []) || [],
    loaded: LOCAL,          // eerste succesvolle lezing van de server gedaan
    online: false,
    err: '',
    me: LS.get(NS + 'me', null),
    org: !!LS.get(NS + 'org', false),
    spectator: !!LS.get(NS + 'spec', false)
  };
  const ui = {
    tab: 'holes', hole: (history.state && history.state.hole) || null, pid: null, editing: false,
    editHoles: false, spinning: false, joinEmoji: EMOJIS[randInt(EMOJIS.length)], wheelRot: {}, scroll: {}
  };

  function setAt(root, path, value) {
    const keys = String(path || '').split('/').filter(Boolean);
    if (!keys.length) return value;
    if (!root || typeof root !== 'object') root = {};
    let o = root;
    const trail = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (o[k] == null || typeof o[k] !== 'object') {
        if (value == null) return root;
        o[k] = {};
      }
      trail.push([o, k]);
      o = o[k];
    }
    const last = keys[keys.length - 1];
    if (value == null) {
      if (Array.isArray(o)) o[last] = null; else delete o[last];
      for (let i = trail.length - 1; i >= 0; i--) {
        const [p, k] = trail[i];
        if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k]) && !Object.keys(p[k]).length) delete p[k]; else break;
      }
    } else {
      o[last] = value;
    }
    return root;
  }
  const persist = () => LS.set(NS + 'data', S.data);
  const saveOutbox = () => LS.set(NS + 'outbox', S.outbox);

  /** Schrijf lokaal (direct zichtbaar) en zet de wijziging in de wachtrij voor de server. */
  function write(path, value) {
    if (value === undefined) value = null;
    S.data = norm(setAt(S.data, path, clone(value)));
    if (!LOCAL) {
      S.outbox = path === '' ? [] : S.outbox.filter((op) => !(op.p === path || op.p.startsWith(path + '/')));
      S.outbox.push({ p: path, v: value });
      saveOutbox();
      setTimeout(flush, 0);
    }
    snap = snapshot();
    persist();
    render();
  }

  // ------------------------------------------------------------ sync (Firebase REST)
  const url = (path) => DB + '/games/' + GAME + (path ? '/' + path : '') + '.json';

  async function http(method, path, body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const opt = { method, signal: ctl.signal, cache: 'no-store' };
      if (body !== undefined) opt.body = JSON.stringify(body);
      return await fetch(url(path), opt);
    } finally {
      clearTimeout(timer);
    }
  }
  function httpError(status) {
    if (status === 401 || status === 403) return 'De database weigert toegang. Zet de regels op "test mode" (lezen en schrijven toegestaan).';
    if (status === 404) return 'Database niet gevonden. Klopt de URL?';
    return 'Serverfout (' + status + ').';
  }

  let flushing = false, backoff = 1500, flushTimer = null;
  async function flush() {
    if (flushing || LOCAL || !DB || !S.outbox.length) return;
    flushing = true;
    clearTimeout(flushTimer);
    try {
      while (S.outbox.length) {
        const op = S.outbox[0];
        const res = op.v == null ? await http('DELETE', op.p) : await http('PUT', op.p, op.v);
        if (!res.ok) throw new Error(httpError(res.status));
        const i = S.outbox.indexOf(op);
        if (i >= 0) S.outbox.splice(i, 1);
        saveOutbox();
        backoff = 1500;
        S.err = '';
        S.online = true;
      }
    } catch (e) {
      S.online = false;
      if (e && e.message && !/abort|fetch|network|load failed/i.test(e.message)) S.err = e.message;
      flushTimer = setTimeout(flush, backoff);
      backoff = Math.min(backoff * 2, 15000);
    } finally {
      flushing = false;
      paintStatus();
    }
  }

  let lastRemoteAt = 0, lastPullAt = 0, pulling = false;
  function applyRemote(path, data, isPatch) {
    let root = S.data;
    const base = String(path || '').replace(/^\/+|\/+$/g, '');
    if (isPatch && data && typeof data === 'object') {
      for (const k in data) root = setAt(root, (base ? base + '/' : '') + k, data[k]);
    } else {
      root = setAt(root, base, data);
    }
    S.data = norm(root);
    for (const op of S.outbox) S.data = norm(setAt(S.data, op.p, clone(op.v)));
    S.loaded = true;
    S.online = true;
    S.err = '';
    afterRemote();
  }
  async function pull() {
    if (LOCAL || !DB || pulling) return;
    pulling = true;
    const started = now();
    lastPullAt = started;
    try {
      const res = await http('GET', '');
      if (!res.ok) throw new Error(httpError(res.status));
      const data = await res.json();
      if (lastRemoteAt <= started) applyRemote('', data, false);
    } catch (e) {
      S.online = false;
      if (e && e.message && !/abort|fetch|network|load failed/i.test(e.message)) S.err = e.message;
      else if (!S.loaded) S.err = 'Geen verbinding met de database.';
      paintStatus();
      if (!S.loaded) render();
    } finally {
      pulling = false;
    }
  }

  let es = null, lastEventAt = 0;
  function connect() {
    if (LOCAL || !DB || typeof EventSource === 'undefined') return;
    if (es) { try { es.close(); } catch (e) { /* negeren */ } es = null; }
    let src;
    try { src = new EventSource(url('')); } catch (e) { return; }
    es = src;
    lastEventAt = now();
    const onData = (isPatch) => (ev) => {
      if (src !== es) return;
      lastEventAt = lastRemoteAt = now();
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m) return;
      applyRemote(m.path, m.data, isPatch);
    };
    src.addEventListener('put', onData(false));
    src.addEventListener('patch', onData(true));
    src.addEventListener('keep-alive', () => { if (src === es) lastEventAt = now(); });
    src.addEventListener('cancel', () => { if (src === es) { S.err = httpError(401); S.online = false; paintStatus(); } });
    src.onerror = () => {
      if (src !== es) return;
      if (src.readyState === 2) es = null;
      paintStatus();
    };
  }
  function tick() {
    if (LOCAL || !DB) return;
    const streamOk = es && es.readyState === 1 && now() - lastEventAt < 75000;
    if (!streamOk && (!es || es.readyState === 2 || now() - lastEventAt > 75000)) connect();
    if (!streamOk || now() - lastPullAt > 30000) pull();
    if (S.outbox.length) flush();
  }
  function resync() {
    if (LOCAL || !DB) return;
    connect();
    pull();
    flush();
  }

  // Meldingen over scores van anderen en binnenkomende rad-uitslagen
  function snapshot() {
    const m = { sc: {}, sp: {} };
    for (const pid in S.data.scores) {
      const row = S.data.scores[pid] || {};
      for (const hid in row) m.sc[pid + '/' + hid] = row[hid] && row[hid].done ? 1 : 0;
    }
    for (const hid in S.data.spins) {
      const row = S.data.spins[hid] || {};
      for (const key in row) m.sp[hid + '/' + key] = (row[key] && row[key].t) || 1;
    }
    return m;
  }
  let snap = snapshot(), announce = false;
  function afterRemote() {
    const next = snapshot();
    if (announce) {
      const fresh = [];
      for (const k in next.sc) if (next.sc[k] && !snap.sc[k]) fresh.push(k);
      if (fresh.length <= 3) fresh.forEach(announceScore);
      for (const k in next.sp) {
        if (next.sp[k] !== snap.sp[k] && !ui.spinning && ui.hole) {
          const [hid, key] = k.split('/');
          const hole = S.data.holes[hid];
          if (hid === ui.hole && hole && key === spinKey(hole, targetPid())) {
            const sp = S.data.spins[hid][key];
            const n = (hole.options || []).length;
            if (sp && n && $('.wheel')) { snap = next; persist(); playSpin(sp.i, n, k); return; }
          }
        }
      }
    }
    announce = true;
    snap = next;
    persist();
    render();
    paintStatus();
  }
  function announceScore(k) {
    const [pid, hid] = k.split('/');
    if (pid === S.me) return;
    const p = S.data.players[pid];
    const hole = holeById(hid);
    if (!p || !hole) return;
    const sc = scoreOf(pid, hid);
    const info = holeInfo(hole, pid);
    const st = strokesOf(sc, info.par);
    if (st == null) return;
    const term = termFor(sc, st, info.par);
    toast(`${p.emoji || '🍺'} ${p.name}: ${term.t} op hole ${holeNo(hid)}`, term.cls === 'hio' ? 'gold' : '');
  }

  // ------------------------------------------------------------ domein
  const title = () => (S.data.meta && S.data.meta.title) || 'Pubgolf';
  const dnfExtra = () => { const n = S.data.meta ? +S.data.meta.dnf : NaN; return Number.isFinite(n) ? n : 3; };
  const penList = () => (S.data.meta && Array.isArray(S.data.meta.pens) ? S.data.meta.pens.filter(Boolean) : []);
  const isOrg = () => LOCAL || S.org;
  const holesList = () => Object.keys(S.data.holes).map((id) => Object.assign({ id }, S.data.holes[id]))
    .filter((h) => h && typeof h === 'object')
    .sort((a, b) => (+a.order || 0) - (+b.order || 0) || (a.id < b.id ? -1 : 1));
  const holeById = (id) => (S.data.holes[id] ? Object.assign({ id }, S.data.holes[id]) : null);
  const holeNo = (id) => holesList().findIndex((h) => h.id === id) + 1;
  const playersList = () => Object.keys(S.data.players).map((id) => Object.assign({ id }, S.data.players[id]))
    .filter((p) => p && p.name)
    .sort((a, b) => (+a.t || 0) - (+b.t || 0) || (a.id < b.id ? -1 : 1));
  const meP = () => (S.me && S.data.players[S.me] ? S.me : null);
  const targetPid = () => (isOrg() && ui.pid && S.data.players[ui.pid] ? ui.pid : meP());
  const scoreOf = (pid, hid) => (pid && S.data.scores[pid] && S.data.scores[pid][hid]) || null;
  const wheelOpts = (hole) => (Array.isArray(hole.options) ? hole.options.filter((o) => o && o.label) : []);
  const spinKey = (hole, pid) => (hole.wheelMode === 'group' ? '_group' : pid);
  function spinOf(hole, pid) {
    const row = S.data.spins[hole.id] || {};
    const key = spinKey(hole, pid);
    return (key && row[key]) || null;
  }
  /** Drankje en par van een hole voor een speler (bij een rad hangt dat van de draai af). */
  function holeInfo(hole, pid) {
    if (hole.type !== 'wheel') return { drink: hole.drink || 'Drankje', par: Math.max(1, +hole.par || 1) };
    const sp = spinOf(hole, pid);
    if (sp && sp.label) return { drink: sp.label, par: Math.max(1, +sp.par || 1), spin: sp };
    const sc = scoreOf(pid, hole.id);
    if (sc && sc.done && sc.par) return { drink: sc.drink || 'Rad', par: +sc.par };
    return { drink: null, par: null, needSpin: true };
  }
  const penTotal = (sc) => (sc && Array.isArray(sc.pens) ? sc.pens.reduce((a, p) => a + (p ? +p.n || 0 : 0), 0) : 0);
  function strokesOf(sc, par) {
    if (!sc || !sc.done || par == null) return null;
    return (sc.dnf ? par + dnfExtra() : Math.max(1, +sc.sips || 1)) + penTotal(sc);
  }
  function termFor(sc, strokes, par) {
    const d = strokes - par;
    if (sc.dnf) return { t: 'Niet opgedronken', cls: 'bad' };
    if (+sc.sips === 1 && par >= 2 && !penTotal(sc)) return { t: 'Hole-in-one! 🎯', cls: 'hio' };
    if (d <= -3) return { t: 'Albatros', cls: 'good' };
    if (d === -2) return { t: 'Eagle', cls: 'good' };
    if (d === -1) return { t: 'Birdie', cls: 'good' };
    if (d === 0) return { t: 'Par', cls: 'par' };
    if (d === 1) return { t: 'Bogey', cls: 'bad' };
    if (d === 2) return { t: 'Dubbel bogey', cls: 'bad' };
    if (d === 3) return { t: 'Triple bogey', cls: 'bad' };
    return { t: '+' + d, cls: 'bad' };
  }
  const fmtRel = (d) => (d === 0 ? 'Par' : d > 0 ? '+' + d : '−' + Math.abs(d));
  const relCls = (d) => (d < 0 ? 'good' : d > 0 ? 'bad' : 'par');
  function totals(pid) {
    const t = { str: 0, par: 0, n: 0, hio: 0 };
    for (const h of holesList()) {
      const sc = scoreOf(pid, h.id);
      const info = holeInfo(h, pid);
      const st = strokesOf(sc, info.par);
      if (st == null) continue;
      t.str += st; t.par += info.par; t.n++;
      if (!sc.dnf && +sc.sips === 1 && info.par >= 2) t.hio++;
    }
    t.rel = t.str - t.par;
    return t;
  }
  function ranking() {
    const rows = playersList().map((p) => Object.assign({ p }, totals(p.id)));
    rows.sort((a, b) => (b.n > 0) - (a.n > 0) || a.rel - b.rel || b.n - a.n || a.str - b.str || (a.p.name < b.p.name ? -1 : 1));
    let rank = 0;
    rows.forEach((r, i) => {
      if (i === 0 || r.n === 0 || rows[i - 1].rel !== r.rel || rows[i - 1].n === 0) rank = i + 1;
      r.rank = r.n ? rank : null;
    });
    return rows;
  }
  function currentHoleId() {
    const cur = S.data.meta && S.data.meta.current;
    if (cur && S.data.holes[cur]) return cur;
    const pid = meP();
    if (!pid) return null;
    const next = holesList().find((h) => { const sc = scoreOf(pid, h.id); return !(sc && sc.done); });
    return next ? next.id : null;
  }
  function drinkIcon(name) {
    const s = String(name || '').toLowerCase();
    if (/water|fris|0[.,]0|alcoholvrij|cola$|ranja/.test(s)) return '🥤';
    if (/bier|pils|ipa|fluitje|vaasje|pul|tripel|weizen|radler|liter/.test(s)) return '🍺';
    if (/wijn|ros[eé]|prosecco|cava|bubbel|champ/.test(s)) return '🍷';
    if (/shot|j[aä]ger|tequila|sambuca|likeur|lik[oö]r|salmari|dropshot/.test(s)) return '🥃';
    if (/cocktail|mojito|spritz|sex on|pornstar/.test(s)) return '🍹';
    if (/mix|gin|rum|wodka|vodka|baco|whisk/.test(s)) return '🍸';
    if (/cider/.test(s)) return '🍏';
    return '🍻';
  }

  // ------------------------------------------------------------ toasts en confetti
  function toast(msg, cls) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (cls || '');
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3600);
  }
  function confetti(emojis) {
    const set = emojis || ['🎉', '⛳', '🍺', '✨', '🎯'];
    const layer = document.createElement('div');
    layer.className = 'confetti';
    for (let i = 0; i < 26; i++) {
      const s = document.createElement('span');
      s.textContent = set[i % set.length];
      s.style.left = Math.random() * 100 + '%';
      s.style.animationDelay = Math.random() * 0.35 + 's';
      s.style.fontSize = 18 + Math.random() * 20 + 'px';
      layer.appendChild(s);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 2400);
  }

  // ------------------------------------------------------------ rad
  const WCOL = ['#f4d35e', '#5bd68a', '#6bb8ff', '#ff8a70', '#c69cff', '#ffb347', '#59d4d0', '#ff7eb6'];
  function wheelSvg(opts, rot) {
    const n = opts.length;
    const step = 360 / n;
    const R = 96;
    const pt = (deg) => { const a = (deg * Math.PI) / 180; return (100 + R * Math.sin(a)).toFixed(2) + ' ' + (100 - R * Math.cos(a)).toFixed(2); };
    let g = '';
    opts.forEach((o, i) => {
      let col = WCOL[i % WCOL.length];
      if (i === n - 1 && n > 1 && col === WCOL[0]) col = WCOL[3];
      const mid = i * step + step / 2;
      g += n === 1
        ? `<circle cx="100" cy="100" r="${R}" fill="${col}"/>`
        : `<path d="M100 100 L${pt(i * step)} A${R} ${R} 0 ${step > 180 ? 1 : 0} 1 ${pt((i + 1) * step)} Z" fill="${col}" stroke="#0a1a13" stroke-width="1.5"/>`;
      const label = o.label.length > 14 ? o.label.slice(0, 13) + '…' : o.label;
      const base = n <= 4 ? 13 : n <= 6 ? 12 : n <= 8 ? 10.5 : n <= 12 ? 8.5 : 7;
      const fs = Math.min(base, 66 / (Math.max(3, label.length) * 0.6)).toFixed(1);
      // Labels lopen van de rand naar het midden; op de linkerhelft omgedraaid zodat ze leesbaar blijven.
      const left = mid > 180;
      g += `<text x="${left ? 13 : 187}" y="100" transform="rotate(${(left ? mid + 90 : mid - 90).toFixed(2)} 100 100)" text-anchor="${left ? 'start' : 'end'}" dominant-baseline="central" font-size="${fs}" font-weight="800" fill="#10220f">${esc(label)}</text>`;
    });
    return `<svg class="wheel" viewBox="0 0 200 200" style="transform:rotate(${rot}deg)" aria-hidden="true">${g}<circle cx="100" cy="100" r="14" fill="#0a1a13" stroke="#f3f7f2" stroke-width="3"/></svg>`;
  }
  function playSpin(i, n, key) {
    const el = $('.wheel');
    const done = () => {
      if (!ui.spinning) return;
      ui.spinning = false;
      buzz([40, 60, 120]);
      confetti(['🎡', '🍺', '🍷', '🥃', '✨']);
      render(true);
    };
    if (!el) { render(true); return; }
    ui.spinning = true;
    const wrap = $('.wheel-box');
    if (wrap) wrap.classList.add('is-spinning');
    const step = 360 / n;
    const jitter = (Math.random() - 0.5) * step * 0.7;
    const final = 360 * 6 - (i + 0.5) * step + jitter;
    ui.wheelRot[key] = final % 360;
    el.style.transition = 'none';
    el.style.transform = 'rotate(0deg)';
    void el.getBoundingClientRect();
    el.style.transition = 'transform 4.6s cubic-bezier(.13,.62,.08,1)';
    el.style.transform = 'rotate(' + final.toFixed(2) + 'deg)';
    setTimeout(done, 4850);
  }
  async function doSpin(hole) {
    if (ui.spinning) return;
    const pid = targetPid();
    const key = spinKey(hole, pid);
    const opts = wheelOpts(hole);
    if (!key || !opts.length) return;
    if (spinOf(hole, pid)) { render(true); return; }
    if (hole.wheelMode === 'group' && !LOCAL) {
      // Iemand anders kan net gedraaid hebben: eerst de server vragen.
      ui.spinning = true;
      const box = $('.wheel-box');
      if (box) box.classList.add('is-spinning');
      try {
        const res = await http('GET', 'spins/' + hole.id + '/_group');
        const cur = res.ok ? await res.json() : null;
        if (cur && cur.label) {
          ui.spinning = false;
          snap.sp[hole.id + '/_group'] = cur.t || 1;
          S.data = norm(setAt(S.data, 'spins/' + hole.id + '/_group', cur));
          persist();
          playSpin(+cur.i || 0, opts.length, hole.id + '/_group');
          return;
        }
      } catch (e) { /* offline: gewoon draaien */ }
      ui.spinning = false;
    }
    const i = randInt(opts.length);
    const spin = { i, label: opts[i].label, par: Math.max(1, +opts[i].par || 1), t: now(), by: S.me || '' };
    ui.spinning = true;
    write('spins/' + hole.id + '/' + key, spin);
    ui.spinning = false;
    playSpin(i, opts.length, hole.id + '/' + key);
  }

  // ------------------------------------------------------------ views
  function statusInfo() {
    if (LOCAL) return { cls: 'local', txt: 'Lokaal' };
    if (S.outbox.length) return { cls: 'wait', txt: S.outbox.length + ' wacht' + (S.outbox.length === 1 ? '' : 'en') };
    if (S.online) return { cls: 'live', txt: 'Live' };
    return { cls: 'off', txt: 'Offline' };
  }
  function paintStatus() {
    const el = $('.status');
    if (!el) return;
    const st = statusInfo();
    el.className = 'status ' + st.cls;
    el.innerHTML = '<i></i>' + st.txt;
  }

  function viewSetup() {
    return `<div class="center-screen">
      <div class="logo">⛳</div>
      <h1>Pubgolf</h1>
      <p class="mut">Koppel een database zodat iedereen op z'n eigen telefoon live mee kan doen.</p>
      <label class="field"><span>Firebase Realtime Database-URL</span>
        <input id="in-db" type="url" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://…-default-rtdb.europe-west1.firebasedatabase.app"></label>
      <button class="btn big" data-act="save-db">Koppelen</button>
      <p id="setup-msg" class="msg"></p>
      <button class="btn ghost" data-act="use-local">Alleen op dit toestel spelen</button>
      <details class="help"><summary>Hoe kom ik aan zo'n URL?</summary>
        <ol>
          <li>Ga naar <b>console.firebase.google.com</b> en maak een project aan (Analytics mag uit).</li>
          <li>Kies links <b>Build → Realtime Database → Create Database</b>, locatie België, <b>test mode</b>.</li>
          <li>Kopieer de URL die bovenaan staat en plak hem hier.</li>
        </ol>
      </details>
    </div>`;
  }
  function viewLoading() {
    const err = S.err;
    return `<div class="center-screen">
      <div class="logo ${err ? '' : 'pulse'}">⛳</div>
      <h1>Pubgolf</h1>
      <p class="mut">${err ? esc(err) : 'Verbinden met de baan…'}</p>
      ${err ? `<button class="btn" data-act="retry">Opnieuw proberen</button>
      <button class="btn ghost" data-act="change-db">Andere database kiezen</button>` : ''}
    </div>`;
  }
  const localCopy = () => {
    if (LOCAL) return null;
    const d = LS.get('pg.' + hashStr('local|' + GAME) + '.data', null);
    return d && d.meta && d.holes ? d : null;
  };
  function viewCreate() {
    const lc = localCopy();
    return `<div class="center-screen">
      <div class="logo">⛳</div>
      <h1>Nieuw spel</h1>
      <p class="mut">Er is nog geen spel. Maak het aan, daarna kan iedereen meedoen via de link.</p>
      <label class="field"><span>Naam van het spel</span>
        <input id="in-title" type="text" maxlength="40" value="Pubgolf Zwolle"></label>
      ${LOCAL ? '' : `<label class="field"><span>Organisator-pincode (voor holes aanpassen)</span>
        <input id="in-pin" type="text" inputmode="numeric" maxlength="8" placeholder="bijv. 1234" autocomplete="off"></label>`}
      <button class="btn big" data-act="create-game">Spel aanmaken</button>
      ${lc ? `<button class="btn ghost" data-act="create-from-local">Neem het lokale spel van dit toestel over (${Object.keys(lc.holes).length} holes)</button>` : ''}
      <p id="create-msg" class="msg"></p>
      ${LOCAL ? '<button class="btn ghost" data-act="change-db">Toch een database koppelen</button>' : ''}
    </div>`;
  }
  function viewJoin() {
    const players = playersList();
    return `<div class="center-screen join">
      <div class="logo">⛳</div>
      <h1>${esc(title())}</h1>
      <p class="mut">Vul je naam in en kies een poppetje.</p>
      <label class="field"><span>Je naam</span>
        <input id="in-name" type="text" maxlength="20" autocomplete="given-name" autocapitalize="words" placeholder="Naam"></label>
      <div class="emoji-grid">${EMOJIS.map((e) => `<button class="emoji ${e === ui.joinEmoji ? 'on' : ''}" data-act="pick-emoji" data-e="${e}">${e}</button>`).join('')}</div>
      <button class="btn big" data-act="join">Meedoen</button>
      <p id="join-msg" class="msg"></p>
      ${players.length ? `<div class="rejoin"><p class="mut">Deed je al mee? Tik op je naam:</p>
        <div class="chips">${players.map((p) => `<button class="chip" data-act="claim" data-id="${p.id}">${esc(p.emoji || '🍺')} ${esc(p.name)}</button>`).join('')}</div></div>` : ''}
      <button class="btn ghost" data-act="spectate">Alleen meekijken</button>
    </div>`;
  }

  function holeLine(h, pid) {
    if (h.type === 'wheel') {
      const info = holeInfo(h, pid);
      if (info.drink && !info.needSpin) return `🎡 ${esc(info.drink)} · par ${info.par}`;
      return '🎡 Rad bepaalt je drankje';
    }
    return `${drinkIcon(h.drink)} ${esc(h.drink || 'Drankje')} · par ${Math.max(1, +h.par || 1)}`;
  }
  function viewHoles() {
    const list = holesList();
    const pid = meP();
    const cur = currentHoleId();
    const nPlayers = playersList().length;
    let html = '';
    if (cur) {
      const h = holeById(cur);
      const pinned = S.data.meta && S.data.meta.current === cur;
      html += `<button class="now" data-act="open-hole" data-id="${cur}">
        <span class="now-l">${pinned ? '📍 We zijn nu bij' : '👉 Jouw volgende hole'}</span>
        <span class="now-t">Hole ${holeNo(cur)} · ${esc(h.name || '')}</span><span class="now-go">›</span></button>`;
    }
    if (isOrg()) {
      html += `<div class="rowbar"><button class="chip ${ui.editHoles ? 'on' : ''}" data-act="toggle-edit-holes">✏️ ${ui.editHoles ? 'Klaar met bewerken' : 'Holes bewerken'}</button></div>`;
    }
    if (!list.length) html += '<div class="empty">Nog geen holes. De organisator kan ze toevoegen.</div>';
    list.forEach((h, i) => {
      const info = holeInfo(h, pid);
      const sc = scoreOf(pid, h.id);
      const st = strokesOf(sc, info.par);
      const doneN = playersList().filter((p) => { const s = scoreOf(p.id, h.id); return s && s.done; }).length;
      html += `<div class="hole ${h.id === cur ? 'cur' : ''} ${st != null ? 'done' : ''}" data-act="open-hole" data-id="${h.id}" role="button" tabindex="0">
        <div class="hole-no">${i + 1}</div>
        <div class="hole-main"><div class="hole-name">${esc(h.name || 'Hole ' + (i + 1))}</div>
          <div class="hole-sub">${holeLine(h, pid)}</div>
          <div class="hole-meta">${doneN}/${nPlayers} klaar</div></div>
        ${ui.editHoles && isOrg()
          ? `<div class="hole-tools"><button class="mini" data-act="hole-move" data-id="${h.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Omhoog">▲</button>
             <button class="mini" data-act="hole-move" data-id="${h.id}" data-d="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Omlaag">▼</button>
             <button class="mini" data-act="hole-edit" data-id="${h.id}" aria-label="Bewerken">✏️</button></div>`
          : st != null
            ? `<div class="hole-score"><b>${st}</b><span class="rel ${relCls(st - info.par)}">${fmtRel(st - info.par)}</span></div>`
            : '<div class="hole-go">›</div>'}
      </div>`;
    });
    if (isOrg()) html += '<button class="btn ghost wide" data-act="hole-add">+ Hole toevoegen</button>';
    return html;
  }

  function scoreEditor(h, pid, info, sc) {
    const p = S.data.players[pid];
    const sips = clamp(+sc.sips || 0, 0, 99);
    const pens = Array.isArray(sc.pens) ? sc.pens.filter(Boolean) : [];
    const mine = pid === S.me;
    const preview = sc.dnf || sips > 0 ? strokesOf(Object.assign({}, sc, { done: true }), info.par) : null;
    const term = preview != null ? termFor(sc, preview, info.par) : null;
    return `<section class="card score">
      <h3>${mine ? 'Jouw score' : 'Score van ' + esc(p.name)}</h3>
      <p class="mut small">Tel je teugen. In één keer leeg is een hole-in-one.</p>
      <div class="counter ${sc.dnf ? 'dim' : ''}">
        <button class="cbtn" data-act="sip" data-d="-1" aria-label="Eén teug minder">−</button>
        <div class="cnum"><b>${sips}</b><span>${sips === 1 ? 'teug' : 'teugen'}</span></div>
        <button class="cbtn plus" data-act="sip" data-d="1" aria-label="Eén teug erbij">+1</button>
      </div>
      <div class="quick">${[1, 2, 3, 4, 5, 6].map((n) => `<button class="chip ${!sc.dnf && sips === n ? 'on' : ''}" data-act="sip-set" data-n="${n}">${n === 1 ? '1× 🎯' : n}</button>`).join('')}</div>
      <button class="chip wide ${sc.dnf ? 'on bad' : ''}" data-act="dnf">🚫 Niet opgedronken (par + ${dnfExtra()})</button>
      <h4>Strafslagen</h4>
      <div class="chips">${penList().map((pn, i) => `<button class="chip" data-act="pen-add" data-i="${i}">+${+pn.n || 1} ${esc(pn.l)}</button>`).join('')}
        <button class="chip" data-act="pen-add" data-i="-1">+1 Anders</button></div>
      ${pens.length ? `<div class="pens">${pens.map((pn, i) => `<span class="pen">+${+pn.n || 0} ${esc(pn.l)} <button data-act="pen-del" data-i="${i}" aria-label="Verwijder">✕</button></span>`).join('')}</div>` : ''}
      <div class="result ${term ? term.cls : ''}">${term ? `<b>${esc(term.t)}</b><span>${preview} ${preview === 1 ? 'slag' : 'slagen'} op par ${info.par} · ${fmtRel(preview - info.par)}</span>` : '<span>Nog geen teugen geteld</span>'}</div>
      <button class="btn big" data-act="score-done" ${preview == null ? 'disabled' : ''}>${sc.done ? 'Klaar ✓' : 'Glas leeg — score opslaan ✓'}</button>
    </section>`;
  }
  function scoreSummary(h, pid, info, sc) {
    const p = S.data.players[pid];
    const st = strokesOf(sc, info.par);
    const term = termFor(sc, st, info.par);
    const pen = penTotal(sc);
    return `<section class="card score saved ${term.cls}">
      <h3>${pid === S.me ? 'Jouw score' : 'Score van ' + esc(p.name)}</h3>
      <div class="saved-row"><div class="saved-n">${st}</div>
        <div class="saved-t"><b>${esc(term.t)}</b>
          <span>${sc.dnf ? 'niet opgedronken' : (+sc.sips === 1 ? 'in 1 teug' : 'in ' + (+sc.sips || 1) + ' teugen')}${pen ? ' + ' + pen + ' straf' : ''} · par ${info.par}</span></div>
        <div class="rel big ${relCls(st - info.par)}">${fmtRel(st - info.par)}</div></div>
      <button class="btn ghost" data-act="score-edit">Aanpassen</button>
    </section>`;
  }
  function viewHole(h) {
    const list = holesList();
    const idx = list.findIndex((x) => x.id === h.id);
    const pid = targetPid();
    const info = holeInfo(h, pid);
    const sc = scoreOf(pid, h.id) || {};
    const players = playersList();
    const pinned = S.data.meta && S.data.meta.current === h.id;
    let html = `<div class="subbar">
      <button class="icon" data-act="back" aria-label="Terug">‹ Holes</button>
      <span>Hole ${idx + 1} van ${list.length}</span>
      <span class="nav"><button class="icon" data-act="hole-nav" data-d="-1" ${idx <= 0 ? 'disabled' : ''} aria-label="Vorige">‹</button>
      <button class="icon" data-act="hole-nav" data-d="1" ${idx >= list.length - 1 ? 'disabled' : ''} aria-label="Volgende">›</button></span></div>`;

    html += `<section class="hero">
      <div class="hero-no">${idx + 1}</div>
      <h2>${esc(h.name || 'Hole ' + (idx + 1))}</h2>
      <div class="hero-drink">${holeLine(h, pid)}</div>
      ${h.note ? `<p class="hero-note">${esc(h.note)}</p>` : ''}
      ${pinned ? '<span class="badge">📍 Hier zijn we nu</span>' : ''}
      ${isOrg() ? `<div class="chips center">${pinned ? '' : '<button class="chip" data-act="hole-pin">📍 Maak dit de actieve hole</button>'}
        <button class="chip" data-act="hole-edit" data-id="${h.id}">✏️ Bewerken</button></div>` : ''}
    </section>`;

    if (isOrg() && players.length > 1) {
      html += `<div class="who"><span class="mut small">Score invullen voor</span><div class="chips scroll">
        ${players.map((p) => `<button class="chip ${p.id === pid ? 'on' : ''}" data-act="pick-player" data-id="${p.id}">${esc(p.emoji || '🍺')} ${esc(p.name)}</button>`).join('')}</div></div>`;
    }

    if (h.type === 'wheel') {
      const opts = wheelOpts(h);
      const sp = spinOf(h, pid);
      const key = h.id + '/' + spinKey(h, pid);
      const step = opts.length ? 360 / opts.length : 360;
      const rot = sp && opts.length ? (ui.wheelRot[key] != null ? ui.wheelRot[key] : -((+sp.i || 0) + 0.5) * step) : 0;
      const group = h.wheelMode === 'group';
      html += `<section class="card wheel-card">
        <h3>🎡 Het rad</h3>
        <p class="mut small">${group ? 'Eén draai geldt voor de hele groep.' : 'Iedereen draait zelf voor z\'n eigen drankje.'}</p>
        ${opts.length ? `<div class="wheel-box"><div class="pointer"></div>${wheelSvg(opts, rot)}</div>` : '<div class="empty">Dit rad heeft nog geen drankjes.</div>'}
        ${sp
          ? `<div class="spin-result"><span>${group ? 'Het drankje is' : (pid === S.me ? 'Jouw drankje' : 'Drankje van ' + esc((S.data.players[pid] || {}).name))}</span>
              <b>${drinkIcon(sp.label)} ${esc(sp.label)}</b><span>par ${+sp.par || 1}</span></div>
              ${isOrg() ? '<button class="btn ghost" data-act="spin-reset">Opnieuw laten draaien</button>' : ''}`
          : (group ? (pid || isOrg()) : pid) && opts.length
            ? '<button class="btn big spin-btn" data-act="spin">Draai aan het rad!</button>'
            : ''}
        ${!sp && opts.length ? `<p class="wheel-legend">${opts.map((o) => esc(o.label) + ' <b>par ' + (+o.par || 1) + '</b>').join(' · ')}</p>` : ''}
      </section>`;
    }

    if (pid && info.par != null) {
      html += sc.done && !ui.editing ? scoreSummary(h, pid, info, sc) : scoreEditor(h, pid, info, sc);
    } else if (pid && h.type === 'wheel') {
      html += '<section class="card"><p class="mut">Draai eerst aan het rad, daarna kun je je teugen tellen.</p></section>';
    } else if (!pid) {
      html += '<section class="card"><p class="mut">Je kijkt alleen mee. Doe mee via <b>Meer → Meedoen</b> om scores in te vullen.</p></section>';
    }

    html += `<section class="card"><h3>Iedereen op deze hole</h3><div class="plist">`;
    if (!players.length) html += '<p class="mut">Nog geen spelers.</p>';
    players.forEach((p) => {
      const pi = holeInfo(h, p.id);
      const ps = scoreOf(p.id, h.id);
      const st = strokesOf(ps, pi.par);
      let right = '<span class="mut">—</span>', sub = '';
      if (st != null) {
        const term = termFor(ps, st, pi.par);
        right = `<b>${st}</b><span class="rel ${relCls(st - pi.par)}">${fmtRel(st - pi.par)}</span>`;
        sub = term.t + (h.type === 'wheel' ? ' · ' + pi.drink : '');
      } else if (ps && (+ps.sips > 0 || ps.dnf)) {
        sub = 'bezig… ' + (+ps.sips || 0) + (+ps.sips === 1 ? ' teug' : ' teugen');
        right = '<span class="busy">🍺</span>';
      } else if (h.type === 'wheel' && pi.drink) {
        sub = pi.drink + ' · par ' + pi.par;
      }
      html += `<div class="prow ${p.id === S.me ? 'me' : ''}" ${isOrg() ? `data-act="pick-player" data-id="${p.id}" role="button"` : ''}>
        <span class="av">${esc(p.emoji || '🍺')}</span>
        <span class="pn"><b>${esc(p.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
        <span class="pr">${right}</span></div>`;
    });
    html += '</div></section>';
    return html;
  }

  function viewBoard() {
    const rows = ranking();
    if (!rows.length) return '<div class="empty">Nog geen spelers.</div>';
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const nHoles = holesList().length;
    let html = '<div class="board">';
    rows.forEach((r) => {
      html += `<div class="brow ${r.p.id === S.me ? 'me' : ''} ${r.rank === 1 ? 'lead' : ''}">
        <div class="rank">${r.rank ? (medals[r.rank] || r.rank) : '–'}</div>
        <div class="av big">${esc(r.p.emoji || '🍺')}</div>
        <div class="bmain"><b>${esc(r.p.name)}</b>
          <small>${r.n ? `${r.str} ${r.str === 1 ? 'slag' : 'slagen'} · ${r.n}/${nHoles} holes${r.hio ? ' · ' + '🎯'.repeat(Math.min(r.hio, 5)) : ''}` : 'nog niet gestart'}</small></div>
        <div class="rel huge ${r.n ? relCls(r.rel) : 'par'}">${r.n ? fmtRel(r.rel) : '–'}</div>
      </div>`;
    });
    html += '</div><p class="mut small center">Laagste score wint. De stand is ten opzichte van par over de holes die je gespeeld hebt.</p>';
    return html;
  }

  function viewCard() {
    const holes = holesList();
    const rows = ranking();
    if (!holes.length || !rows.length) return '<div class="empty">Nog niets om te tonen.</div>';
    let html = '<div class="card-scroll"><table class="sc"><thead><tr><th class="sticky">Hole</th>';
    holes.forEach((h, i) => { html += `<th>${i + 1}</th>`; });
    html += '<th>Tot</th><th>±</th></tr><tr class="parrow"><th class="sticky">Par</th>';
    holes.forEach((h) => { html += `<td>${h.type === 'wheel' ? '🎡' : Math.max(1, +h.par || 1)}</td>`; });
    html += '<td></td><td></td></tr></thead><tbody>';
    rows.forEach((r) => {
      html += `<tr class="${r.p.id === S.me ? 'me' : ''}"><th class="sticky">${esc(r.p.emoji || '🍺')} ${esc(r.p.name)}</th>`;
      holes.forEach((h) => {
        const info = holeInfo(h, r.p.id);
        const sc = scoreOf(r.p.id, h.id);
        const st = strokesOf(sc, info.par);
        if (st == null) { html += '<td class="nil">·</td>'; return; }
        const d = st - info.par;
        const cls = sc.dnf ? 'dnf' : (+sc.sips === 1 && info.par >= 2 && !penTotal(sc)) ? 'hio' : d < 0 ? 'under' : d > 0 ? 'over' : 'even';
        html += `<td><span class="cell ${cls}">${st}</span></td>`;
      });
      html += `<td class="tot">${r.n ? r.str : '·'}</td><td class="tot rel ${r.n ? relCls(r.rel) : ''}">${r.n ? fmtRel(r.rel) : '·'}</td></tr>`;
    });
    html += `</tbody></table></div>
      <div class="legend"><span><i class="cell hio">1</i> hole-in-one</span><span><i class="cell under">2</i> onder par</span>
      <span><i class="cell even">3</i> par</span><span><i class="cell over">4</i> boven par</span><span><i class="cell dnf">7</i> niet leeg</span></div>`;
    return html;
  }

  function shareUrl() {
    const p = [];
    if (!LOCAL && DB && DB !== CFG_DB) p.push('db=' + encodeURIComponent(DB));
    if (GAME !== CFG_GAME) p.push('g=' + GAME);
    return location.origin + location.pathname + (p.length ? '#' + p.join('&') : '');
  }
  function qrSvg(text) {
    try {
      const qr = window.qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
    } catch (e) { return ''; }
  }
  function viewMore() {
    const pid = meP();
    const me = pid ? S.data.players[pid] : null;
    const link = shareUrl();
    let html = '';
    if (LOCAL) {
      html += `<section class="card"><h3>📱 Lokaal spel</h3>
        <p class="mut">Dit spel staat alleen op dit toestel. Voeg hieronder spelers toe en vul alle scores hier in, of koppel een database zodat iedereen op z'n eigen telefoon meedoet.</p>
        <button class="btn ghost" data-act="change-db">Database koppelen</button></section>`;
    } else {
      html += `<section class="card invite"><h3>📲 Nodig iedereen uit</h3>
        <p class="mut small">Laat de QR-code scannen of deel de link in de groepsapp.</p>
        <div class="qr">${qrSvg(link)}</div>
        <div class="link">${esc(link)}</div>
        <div class="btnrow"><button class="btn" data-act="share">Deel link</button><button class="btn ghost" data-act="copy">Kopieer</button></div></section>`;
    }
    html += `<section class="card"><h3>📜 Spelregels</h3>
      <ul class="rules">
        <li>Elke kroeg is een hole met een drankje en een <b>par</b>: het aantal teugen waarin je het glas leeg hoort te hebben.</li>
        <li>Tel je <b>teugen</b>. In één keer achterover is een <b>hole-in-one</b>.</li>
        <li>Staat er een <b>rad</b> bij de hole, dan bepaalt het rad je drankje en je par.</li>
        <li>Glas niet leeg? Dan krijg je par + ${dnfExtra()}.</li>
        ${penList().length ? `<li>Strafslagen: ${penList().map((p) => esc(p.l) + ' +' + (+p.n || 1)).join(', ')}.</li>` : ''}
        <li>Laagste totaalscore wint. Fris of 0.0 telt net zo goed.</li>
      </ul></section>`;
    html += `<section class="card"><h3>🙋 Jij</h3>`;
    if (me) {
      html += `<div class="prow"><span class="av big">${esc(me.emoji || '🍺')}</span><span class="pn"><b>${esc(me.name)}</b><small>speler</small></span></div>
        <div class="btnrow"><button class="btn ghost" data-act="profile">Profiel wijzigen</button><button class="btn ghost" data-act="logout">Wissel speler</button></div>`;
    } else {
      html += '<p class="mut">Je kijkt alleen mee.</p><button class="btn" data-act="logout">Meedoen</button>';
    }
    html += '</section>';
    html += '<section class="card"><h3>🛠️ Organisator</h3>';
    if (isOrg()) {
      html += `<p class="mut small">Je kunt holes aanpassen (tabblad Holes), scores van iedereen invullen en de actieve hole kiezen.</p>
        <div class="stack">
          <button class="btn ghost" data-act="settings">Spelinstellingen en strafslagen</button>
          <button class="btn ghost" data-act="player-add">Speler toevoegen (zonder telefoon)</button>
          <button class="btn ghost" data-act="players">Spelers beheren</button>
          <button class="btn ghost" data-act="unpin">Actieve hole loslaten</button>
          <button class="btn ghost danger" data-act="reset-scores">Alle scores wissen</button>
          ${LOCAL ? '' : '<button class="btn ghost" data-act="org-off">Organisator-modus uit</button>'}
        </div>`;
    } else {
      html += '<p class="mut small">Met de pincode kun je holes aanpassen en scores van anderen invullen.</p><button class="btn ghost" data-act="org-on">Ontgrendel met pincode</button>';
    }
    html += '</section>';
    const st = statusInfo();
    html += `<section class="card"><h3>📡 Verbinding</h3>
      <p class="mut small">${LOCAL ? 'Lokaal spel, alles blijft op dit toestel.' : `Status: <b>${st.txt}</b>${S.err ? ' · ' + esc(S.err) : ''}. Scores die je zonder bereik invult worden bewaard en verstuurd zodra er weer verbinding is.`}</p>
      <div class="btnrow"><button class="btn ghost" data-act="reload">Ververs</button>${LOCAL || CFG_DB ? '' : '<button class="btn ghost" data-act="change-db">Andere database</button>'}</div>
      <p class="mut tiny">Spel: ${esc(GAME)}</p></section>`;
    return html;
  }

  function viewMain() {
    const hole = ui.hole ? holeById(ui.hole) : null;
    if (ui.hole && !hole) ui.hole = null;
    const st = statusInfo();
    const tabs = [['holes', '⛳', 'Holes'], ['board', '🏆', 'Stand'], ['card', '📋', 'Kaart'], ['more', '☰', 'Meer']];
    let body;
    if (hole) body = viewHole(hole);
    else if (ui.tab === 'board') body = viewBoard();
    else if (ui.tab === 'card') body = viewCard();
    else if (ui.tab === 'more') body = viewMore();
    else body = viewHoles();
    return `<header class="top"><div class="brand"><span>⛳</span><b>${esc(title())}</b></div>
        <button class="status ${st.cls}" data-act="status"><i></i>${st.txt}</button></header>
      <main class="view ${hole ? 'v-hole' : 'v-' + ui.tab}">${body}</main>
      <nav class="tabs">${tabs.map((t) => `<button class="${!hole && ui.tab === t[0] ? 'on' : ''}" data-act="tab" data-tab="${t[0]}"><span>${t[1]}</span>${t[2]}</button>`).join('')}</nav>`;
  }

  // ------------------------------------------------------------ render
  let queued = false, forceNext = false, dirty = false, lastKey = '';
  function render(force) {
    if (force) forceNext = true;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; const f = forceNext; forceNext = false; doRender(f); });
  }
  function doRender(force) {
    if (ui.spinning) { dirty = true; return; }
    const app = $('#app');
    const ae = document.activeElement;
    const typing = ae && app.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
    if (typing && !force) { dirty = true; return; }
    dirty = false;

    let html, key;
    if (!DB) { html = viewSetup(); key = 'setup'; }
    else if (!S.loaded && !S.data.meta) { html = viewLoading(); key = 'loading'; }
    else if (!S.data.meta) { html = viewCreate(); key = 'create'; }
    else if (!meP() && !S.spectator) { html = viewJoin(); key = 'join'; }
    else { html = viewMain(); key = ui.hole ? 'hole:' + ui.hole : 'tab:' + ui.tab; }

    const keep = {};
    app.querySelectorAll('input[id],textarea[id]').forEach((el) => { keep[el.id] = el.value; });
    const focusId = typing && ae.id ? ae.id : null;
    if (key !== lastKey) ui.scroll[lastKey] = window.scrollY;
    app.innerHTML = html;
    for (const id in keep) { const el = document.getElementById(id); if (el) el.value = keep[id]; }
    if (focusId) { const el = document.getElementById(focusId); if (el) el.focus({ preventScroll: true }); }
    if (key !== lastKey) {
      window.scrollTo(0, key.startsWith('tab:') ? ui.scroll[key] || 0 : 0);
      lastKey = key;
    }
    document.title = title();
  }
  document.addEventListener('focusout', () => { if (dirty) setTimeout(render, 80); });

  // ------------------------------------------------------------ sheets
  function openSheet(html) {
    $('#sheet-root').innerHTML = `<div class="backdrop" data-act="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.classList.add('sheet-open');
    history.pushState({ hole: ui.hole, sheet: 1 }, '');
  }
  function removeSheet() {
    $('#sheet-root').innerHTML = '';
    document.body.classList.remove('sheet-open');
  }
  function closeSheet() {
    if (history.state && history.state.sheet) history.back(); else removeSheet();
  }
  const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const msg = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  function parseOptions(text) {
    return String(text || '').split('\n').map((line) => {
      line = line.trim();
      if (!line) return null;
      const m = line.match(/^(.*?)[\s]*[,|;:][\s]*(\d{1,2})\s*$/);
      if (m && m[1].trim()) return { label: m[1].trim().slice(0, 30), par: clamp(+m[2] || 1, 1, 20) };
      return { label: line.slice(0, 30), par: 3 };
    }).filter(Boolean).slice(0, 16);
  }
  function parsePens(text) {
    return String(text || '').split('\n').map((line) => {
      line = line.trim();
      if (!line) return null;
      const m = line.match(/^(.*?)[\s]*[,|;:][\s]*\+?(\d{1,2})\s*$/);
      if (m && m[1].trim()) return { l: m[1].trim().slice(0, 30), n: clamp(+m[2] || 1, 1, 20) };
      return { l: line.slice(0, 30), n: 1 };
    }).filter(Boolean).slice(0, 12);
  }

  function sheetHole(id) {
    const h = id ? holeById(id) : null;
    const d = h || { name: '', type: 'fixed', drink: '', par: 3, wheelMode: 'player', options: DEFAULT_WHEEL, note: '' };
    const opts = (Array.isArray(d.options) && d.options.length ? d.options : DEFAULT_WHEEL).filter(Boolean);
    openSheet(`<h2>${h ? 'Hole bewerken' : 'Nieuwe hole'}</h2>
      <label class="field"><span>Kroeg</span><input id="h-name" type="text" maxlength="40" value="${esc(d.name)}" placeholder="Naam van de kroeg"></label>
      <div class="seg" id="h-type" data-v="${d.type === 'wheel' ? 'wheel' : 'fixed'}">
        <button data-act="seg" data-v="fixed" class="${d.type === 'wheel' ? '' : 'on'}">🍺 Vast drankje</button>
        <button data-act="seg" data-v="wheel" class="${d.type === 'wheel' ? 'on' : ''}">🎡 Rad</button></div>
      <div class="when when-fixed">
        <label class="field"><span>Drankje</span><input id="h-drink" type="text" maxlength="30" value="${esc(d.drink || '')}" placeholder="bijv. Biertje"></label>
        <label class="field"><span>Par (aantal teugen)</span><input id="h-par" type="number" inputmode="numeric" min="1" max="20" value="${Math.max(1, +d.par || 3)}"></label>
      </div>
      <div class="when when-wheel">
        <div class="seg" id="h-mode" data-v="${d.wheelMode === 'group' ? 'group' : 'player'}">
          <button data-act="seg" data-v="player" class="${d.wheelMode === 'group' ? '' : 'on'}">Ieder draait zelf</button>
          <button data-act="seg" data-v="group" class="${d.wheelMode === 'group' ? 'on' : ''}">Eén draai voor de groep</button></div>
        <label class="field"><span>Drankjes op het rad — één per regel, met de par achter een komma</span>
          <textarea id="h-opts" rows="6" spellcheck="false">${esc(opts.map((o) => o.label + ', ' + (+o.par || 1)).join('\n'))}</textarea></label>
      </div>
      <label class="field"><span>Opmerking of extra regel (optioneel)</span><input id="h-note" type="text" maxlength="120" value="${esc(d.note || '')}" placeholder="bijv. Waterhazard: niet naar de wc"></label>
      <p id="h-msg" class="msg"></p>
      <button class="btn big" data-act="hole-save" data-id="${h ? h.id : ''}">Opslaan</button>
      ${h ? `<button class="btn ghost danger" data-act="hole-del" data-id="${h.id}">Hole verwijderen</button>` : ''}
      <button class="btn ghost" data-act="sheet-close">Annuleren</button>`);
    syncSeg();
  }
  function syncSeg() {
    const t = $('#h-type');
    const sheet = $('.sheet');
    if (t && sheet) sheet.dataset.type = t.dataset.v;
  }
  function sheetSettings() {
    const m = S.data.meta || {};
    openSheet(`<h2>Spelinstellingen</h2>
      <label class="field"><span>Naam van het spel</span><input id="s-title" type="text" maxlength="40" value="${esc(m.title || '')}"></label>
      <label class="field"><span>Extra slagen bij "niet opgedronken" (bovenop par)</span><input id="s-dnf" type="number" inputmode="numeric" min="0" max="20" value="${dnfExtra()}"></label>
      <label class="field"><span>Strafslagen — één per regel, met het aantal achter een komma</span>
        <textarea id="s-pens" rows="5" spellcheck="false">${esc(penList().map((p) => p.l + ', ' + (+p.n || 1)).join('\n'))}</textarea></label>
      ${LOCAL ? '' : '<label class="field"><span>Nieuwe organisator-pincode (leeg laten = niet wijzigen)</span><input id="s-pin" type="text" inputmode="numeric" maxlength="8" autocomplete="off"></label>'}
      <button class="btn big" data-act="settings-save">Opslaan</button>
      <button class="btn ghost" data-act="sheet-close">Annuleren</button>`);
  }
  function sheetProfile() {
    const me = S.data.players[meP()];
    if (!me) return;
    ui.joinEmoji = me.emoji || ui.joinEmoji;
    openSheet(`<h2>Jouw profiel</h2>
      <label class="field"><span>Naam</span><input id="p-name" type="text" maxlength="20" value="${esc(me.name)}"></label>
      <div class="emoji-grid" id="p-emoji">${EMOJIS.map((e) => `<button class="emoji ${e === ui.joinEmoji ? 'on' : ''}" data-act="pick-emoji" data-e="${e}">${e}</button>`).join('')}</div>
      <button class="btn big" data-act="profile-save">Opslaan</button>
      <button class="btn ghost" data-act="sheet-close">Annuleren</button>`);
  }
  function sheetAddPlayer() {
    openSheet(`<h2>Speler toevoegen</h2>
      <p class="mut small">Voor iemand zonder telefoon. Jij vult de scores in via "Score invullen voor" bij een hole.</p>
      <label class="field"><span>Naam</span><input id="a-name" type="text" maxlength="20" autocapitalize="words"></label>
      <p id="a-msg" class="msg"></p>
      <button class="btn big" data-act="player-add-save">Toevoegen</button>
      <button class="btn ghost" data-act="sheet-close">Klaar</button>`);
    setTimeout(() => { const el = $('#a-name'); if (el) el.focus(); }, 50);
  }
  function sheetPlayers() {
    const rows = playersList().map((p) => `<div class="prow"><span class="av">${esc(p.emoji || '🍺')}</span>
      <span class="pn"><b>${esc(p.name)}</b>${p.id === S.me ? '<small>dat ben jij</small>' : ''}</span>
      <button class="mini danger" data-act="player-del" data-id="${p.id}" aria-label="Verwijder ${esc(p.name)}">🗑️</button></div>`).join('');
    openSheet(`<h2>Spelers</h2><div class="plist">${rows || '<p class="mut">Nog geen spelers.</p>'}</div>
      <button class="btn ghost" data-act="sheet-close">Sluiten</button>`);
  }
  function sheetPin() {
    openSheet(`<h2>Organisator</h2>
      <label class="field"><span>Pincode</span><input id="o-pin" type="text" inputmode="numeric" maxlength="8" autocomplete="off"></label>
      <p id="o-msg" class="msg"></p>
      <button class="btn big" data-act="org-check">Ontgrendel</button>
      <button class="btn ghost" data-act="sheet-close">Annuleren</button>`);
    setTimeout(() => { const el = $('#o-pin'); if (el) el.focus(); }, 50);
  }
  function sheetPen() {
    openSheet(`<h2>Strafslag</h2>
      <label class="field"><span>Waarvoor?</span><input id="x-l" type="text" maxlength="30" placeholder="bijv. Te hard gelachen"></label>
      <label class="field"><span>Aantal slagen</span><input id="x-n" type="number" inputmode="numeric" min="1" max="20" value="1"></label>
      <button class="btn big" data-act="pen-custom-save">Toevoegen</button>
      <button class="btn ghost" data-act="sheet-close">Annuleren</button>`);
  }

  // ------------------------------------------------------------ acties
  function setMe(pid) {
    S.me = pid; S.spectator = false;
    if (pid) LS.set(NS + 'me', pid); else LS.del(NS + 'me');
    LS.del(NS + 'spec');
  }
  function setOrg(on) {
    S.org = !!on;
    if (on) LS.set(NS + 'org', true); else LS.del(NS + 'org');
    if (!on) { ui.pid = null; ui.editHoles = false; }
  }
  function addPlayer(name, emoji, guest) {
    const pid = 'p' + uid(7);
    const p = { name: name.slice(0, 20), emoji: emoji || '🍺', t: now() };
    if (guest) p.guest = true;
    write('players/' + pid, p);
    return pid;
  }
  function putScore(patch) {
    const h = ui.hole ? holeById(ui.hole) : null;
    const pid = targetPid();
    if (!h || !pid) return;
    const info = holeInfo(h, pid);
    if (info.par == null) return;
    const next = Object.assign({ sips: 0, done: false }, scoreOf(pid, h.id) || {}, patch, { t: now(), par: info.par, drink: info.drink || '' });
    if (!next.pens || !next.pens.length) delete next.pens;
    if (!next.dnf) delete next.dnf;
    write('scores/' + pid + '/' + h.id, next);
  }
  function openHole(id) {
    if (!S.data.holes[id]) return;
    ui.hole = id; ui.editing = false;
    history.pushState({ hole: id }, '');
    render(true);
  }

  const A = {
    'tab'(el) {
      const go = () => { ui.tab = el.dataset.tab; ui.editing = false; render(true); };
      if (ui.hole) { ui.hole = null; history.replaceState({ hole: null }, ''); }
      go();
    },
    'status'() {
      const st = statusInfo();
      toast(LOCAL ? 'Lokaal spel: alles staat op dit toestel.' : S.err ? S.err : st.cls === 'live' ? 'Verbonden. Scores komen live binnen.' : st.cls === 'wait' ? 'Wijzigingen wachten op verbinding…' : 'Geen verbinding. Ik probeer het opnieuw…');
      resync();
    },
    'retry'() { S.err = ''; render(true); resync(); },
    'reload'() { location.reload(); },
    'change-db'() {
      if (!confirm('Database-koppeling op dit toestel wijzigen?')) return;
      LS.del('pg.db');
      restart();
    },
    async 'save-db'(el) {
      const db = normalizeDb(val('in-db'));
      if (!db || db === 'local' || !/^https?:\/\/[^/]+\.[^/]+|^http:\/\/localhost/.test(db)) { msg('setup-msg', 'Plak de volledige URL van je database.'); return; }
      el.disabled = true; msg('setup-msg', 'Controleren…');
      try {
        const res = await fetch(db + '/games/' + GAME + '/meta.json', { cache: 'no-store' });
        if (!res.ok) { msg('setup-msg', httpError(res.status)); el.disabled = false; return; }
      } catch (e) { msg('setup-msg', 'Kan de database niet bereiken. Klopt de URL en heb je internet?'); el.disabled = false; return; }
      LS.set('pg.db', db);
      restart();
    },
    'use-local'() { LS.set('pg.db', 'local'); restart(); },
    'create-game'() {
      const t = val('in-title') || 'Pubgolf';
      const pin = val('in-pin');
      if (!LOCAL && pin.length < 3) { msg('create-msg', 'Kies een pincode van minstens 3 tekens.'); return; }
      const holes = {};
      DEFAULT_HOLES.forEach((h, i) => { holes['h' + uid(6)] = Object.assign({ order: i + 1 }, clone(h)); });
      write('meta', { title: t.slice(0, 40), pin: pin ? hashStr('pg:' + pin) : '', dnf: 3, pens: DEFAULT_PENS, created: now() });
      write('holes', holes);
      setOrg(true);
      render(true);
    },
    'create-from-local'() {
      const lc = localCopy();
      const pin = val('in-pin');
      if (!lc) return;
      if (pin.length < 3) { msg('create-msg', 'Kies eerst een pincode van minstens 3 tekens.'); return; }
      const d = norm(clone(lc));
      d.meta.pin = hashStr('pg:' + pin);
      write('meta', d.meta);
      write('holes', d.holes);
      if (Object.keys(d.players).length) write('players', d.players);
      if (Object.keys(d.scores).length) write('scores', d.scores);
      if (Object.keys(d.spins).length) write('spins', d.spins);
      const me = LS.get('pg.' + hashStr('local|' + GAME) + '.me', null);
      if (me && d.players[me]) setMe(me);
      setOrg(true);
      render(true);
    },
    'pick-emoji'(el) {
      ui.joinEmoji = el.dataset.e;
      el.parentNode.querySelectorAll('.emoji').forEach((b) => b.classList.toggle('on', b === el));
    },
    'join'() {
      const name = val('in-name');
      if (!name) { msg('join-msg', 'Vul eerst je naam in.'); return; }
      const dup = playersList().find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (dup) {
        if (!confirm(name + ' doet al mee. Ben jij dat?')) { msg('join-msg', 'Kies dan een andere naam.'); return; }
        setMe(dup.id);
      } else {
        setMe(addPlayer(name, ui.joinEmoji));
      }
      ui.tab = 'holes';
      render(true);
    },
    'claim'(el) { setMe(el.dataset.id); render(true); },
    'spectate'() { S.spectator = true; LS.set(NS + 'spec', true); ui.tab = 'board'; render(true); },
    'logout'() { setMe(null); ui.hole = null; render(true); },
    'open-hole'(el) { openHole(el.dataset.id); },
    'back'() { if (history.state && history.state.hole) history.back(); else { ui.hole = null; render(true); } },
    'hole-nav'(el) {
      const list = holesList();
      const i = list.findIndex((h) => h.id === ui.hole) + +el.dataset.d;
      if (i < 0 || i >= list.length) return;
      ui.hole = list[i].id; ui.editing = false;
      history.replaceState({ hole: ui.hole }, '');
      lastKey = '';
      render(true);
    },
    'pick-player'(el) { if (!isOrg()) return; ui.pid = el.dataset.id; ui.editing = false; render(true); },
    'hole-pin'() { write('meta/current', ui.hole); toast('Iedereen ziet nu deze hole als actief.'); },
    'unpin'() { write('meta/current', null); toast('Actieve hole losgelaten.'); },
    'spin'() { const h = holeById(ui.hole); if (h) doSpin(h); },
    'spin-reset'() {
      const h = holeById(ui.hole);
      if (!h || !isOrg()) return;
      const key = spinKey(h, targetPid());
      if (!key || !confirm('Deze draai wissen en opnieuw laten draaien?')) return;
      delete ui.wheelRot[h.id + '/' + key];
      write('spins/' + h.id + '/' + key, null);
    },
    'sip'(el) {
      const sc = scoreOf(targetPid(), ui.hole) || {};
      buzz(12);
      putScore({ sips: clamp((+sc.sips || 0) + +el.dataset.d, 0, 99), dnf: false });
    },
    'sip-set'(el) { buzz(12); putScore({ sips: +el.dataset.n, dnf: false }); },
    'dnf'() { const sc = scoreOf(targetPid(), ui.hole) || {}; putScore({ dnf: !sc.dnf }); },
    'pen-add'(el) {
      const i = +el.dataset.i;
      if (i < 0) { sheetPen(); return; }
      const pn = penList()[i];
      if (!pn) return;
      const sc = scoreOf(targetPid(), ui.hole) || {};
      putScore({ pens: (sc.pens || []).filter(Boolean).concat([{ l: pn.l, n: +pn.n || 1 }]) });
    },
    'pen-custom-save'() {
      const l = val('x-l') || 'Strafslag';
      const n = clamp(+val('x-n') || 1, 1, 20);
      const sc = scoreOf(targetPid(), ui.hole) || {};
      putScore({ pens: (sc.pens || []).filter(Boolean).concat([{ l: l.slice(0, 30), n }]) });
      closeSheet();
    },
    'pen-del'(el) {
      const sc = scoreOf(targetPid(), ui.hole) || {};
      const pens = (sc.pens || []).filter(Boolean);
      pens.splice(+el.dataset.i, 1);
      putScore({ pens });
    },
    'score-done'() {
      const pid = targetPid();
      const h = holeById(ui.hole);
      const sc = scoreOf(pid, ui.hole) || {};
      if (!h || !(sc.dnf || +sc.sips > 0)) return;
      const first = !sc.done;
      ui.editing = false;
      putScore({ done: true });
      if (first) {
        const info = holeInfo(h, pid);
        const saved = scoreOf(pid, h.id);
        const term = termFor(saved, strokesOf(saved, info.par), info.par);
        buzz(term.cls === 'hio' ? [60, 40, 60, 40, 160] : 30);
        if (term.cls === 'hio') confetti(['🎯', '⛳', '🏆', '✨']); else if (term.cls === 'good') confetti();
        toast(term.t + ' genoteerd', term.cls === 'hio' ? 'gold' : '');
      }
      render(true);
    },
    'score-edit'() { ui.editing = true; render(true); },
    'toggle-edit-holes'() { ui.editHoles = !ui.editHoles; render(true); },
    'hole-add'() { sheetHole(null); },
    'hole-edit'(el, ev) { ev.stopPropagation(); sheetHole(el.dataset.id); },
    'hole-move'(el, ev) {
      ev.stopPropagation();
      const list = holesList();
      const i = list.findIndex((h) => h.id === el.dataset.id);
      const j = i + +el.dataset.d;
      if (i < 0 || j < 0 || j >= list.length) return;
      const ids = list.map((h) => h.id);
      ids.splice(j, 0, ids.splice(i, 1)[0]);
      ids.forEach((id, k) => { if (+S.data.holes[id].order !== k + 1) write('holes/' + id + '/order', k + 1); });
    },
    'seg'(el) {
      const seg = el.parentNode;
      seg.dataset.v = el.dataset.v;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
      syncSeg();
    },
    'hole-save'(el) {
      const id = el.dataset.id || 'h' + uid(6);
      const prev = S.data.holes[id] || {};
      const type = $('#h-type').dataset.v === 'wheel' ? 'wheel' : 'fixed';
      const doc = { name: val('h-name').slice(0, 40) || 'Kroeg', type, order: +prev.order || holesList().length + 1 };
      if (type === 'wheel') {
        doc.wheelMode = $('#h-mode').dataset.v === 'group' ? 'group' : 'player';
        doc.options = parseOptions(val('h-opts'));
        if (doc.options.length < 2) { msg('h-msg', 'Zet minstens twee drankjes op het rad.'); return; }
      } else {
        doc.drink = val('h-drink').slice(0, 30) || 'Drankje';
        doc.par = clamp(Math.round(+val('h-par')) || 1, 1, 20);
      }
      const note = val('h-note').slice(0, 120);
      if (note) doc.note = note;
      write('holes/' + id, doc);
      closeSheet();
      toast('Hole opgeslagen');
    },
    'hole-del'(el) {
      const id = el.dataset.id;
      if (!confirm('Deze hole en de scores erop verwijderen?')) return;
      write('holes/' + id, null);
      write('spins/' + id, null);
      Object.keys(S.data.scores).forEach((pid) => { if (S.data.scores[pid] && S.data.scores[pid][id]) write('scores/' + pid + '/' + id, null); });
      if (S.data.meta && S.data.meta.current === id) write('meta/current', null);
      if (ui.hole === id) ui.hole = null;
      closeSheet();
    },
    'settings'() { sheetSettings(); },
    'settings-save'() {
      const m = S.data.meta || {};
      const t = val('s-title').slice(0, 40) || 'Pubgolf';
      const dnf = clamp(Math.round(+val('s-dnf')) || 0, 0, 20);
      const pens = parsePens(val('s-pens'));
      const pin = val('s-pin');
      if (t !== m.title) write('meta/title', t);
      if (dnf !== dnfExtra()) write('meta/dnf', dnf);
      if (JSON.stringify(pens) !== JSON.stringify(penList())) write('meta/pens', pens.length ? pens : null);
      if (pin) write('meta/pin', hashStr('pg:' + pin));
      closeSheet();
      toast('Instellingen opgeslagen');
    },
    'profile'() { sheetProfile(); },
    'profile-save'() {
      const pid = meP();
      const name = val('p-name');
      if (!pid || !name) return;
      const me = S.data.players[pid];
      if (name !== me.name) write('players/' + pid + '/name', name.slice(0, 20));
      if (ui.joinEmoji !== me.emoji) write('players/' + pid + '/emoji', ui.joinEmoji);
      closeSheet();
    },
    'player-add'() { sheetAddPlayer(); },
    'player-add-save'() {
      const name = val('a-name');
      if (!name) { msg('a-msg', 'Vul een naam in.'); return; }
      if (playersList().some((p) => p.name.toLowerCase() === name.toLowerCase())) { msg('a-msg', 'Die naam doet al mee.'); return; }
      addPlayer(name, EMOJIS[randInt(EMOJIS.length)], true);
      const el = $('#a-name');
      if (el) { el.value = ''; el.focus(); }
      msg('a-msg', name + ' toegevoegd. Nog iemand?');
    },
    'players'() { sheetPlayers(); },
    'player-del'(el) {
      const pid = el.dataset.id;
      const p = S.data.players[pid];
      if (!p || !confirm(p.name + ' en alle scores van ' + p.name + ' verwijderen?')) return;
      write('players/' + pid, null);
      if (S.data.scores[pid]) write('scores/' + pid, null);
      Object.keys(S.data.spins).forEach((hid) => { if (S.data.spins[hid] && S.data.spins[hid][pid]) write('spins/' + hid + '/' + pid, null); });
      if (ui.pid === pid) ui.pid = null;
      const row = el.closest('.prow');
      if (row) row.remove();
    },
    'reset-scores'() {
      if (!confirm('Alle scores en rad-uitslagen van iedereen wissen? Dit kan niet ongedaan worden.')) return;
      write('scores', null);
      write('spins', null);
      write('meta/current', null);
      ui.wheelRot = {};
      toast('Alle scores zijn gewist.');
    },
    'org-on'() { sheetPin(); },
    'org-check'() {
      const pin = val('o-pin');
      const want = S.data.meta && S.data.meta.pin;
      if (want && hashStr('pg:' + pin) !== want) { msg('o-msg', 'Die pincode klopt niet.'); return; }
      setOrg(true);
      closeSheet();
      toast('Organisator-modus aan');
    },
    'org-off'() { setOrg(false); render(true); },
    async 'share'() {
      const link = shareUrl();
      try {
        if (navigator.share) { await navigator.share({ title: title(), text: 'Doe mee met ' + title() + ' ⛳🍺', url: link }); return; }
      } catch (e) { return; }
      A.copy();
    },
    async 'copy'() {
      const link = shareUrl();
      try { await navigator.clipboard.writeText(link); toast('Link gekopieerd'); }
      catch (e) { prompt('Kopieer de link:', link); }
    },
    'sheet-close'() { closeSheet(); }
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = A[el.dataset.act];
    if (!fn) return;
    if (ui.spinning && el.dataset.act !== 'back' && el.dataset.act !== 'tab') return;
    fn(el, ev);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return;
    const map = { 'in-name': 'join', 'in-db': 'save-db', 'in-pin': 'create-game', 'in-title': 'create-game', 'o-pin': 'org-check', 'a-name': 'player-add-save' };
    const act = map[ev.target.id];
    if (act) { ev.preventDefault(); const btn = $(`[data-act="${act}"]`); if (btn) btn.click(); }
  });
  window.addEventListener('popstate', (ev) => {
    const st = ev.state || {};
    ui.spinning = false;
    ui.hole = st.hole || null;
    ui.editing = false;
    if (!st.sheet) removeSheet();
    render(true);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); });
  window.addEventListener('online', resync);
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) resync(); });

  // ------------------------------------------------------------ start
  history.replaceState({ hole: ui.hole }, '');
  render(true);
  if (DB && !LOCAL) {
    connect();
    pull();
    flush();
    setInterval(tick, 5000);
  }
})();
