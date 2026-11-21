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
  /** Ga naar een adres binnen de app en laad de pagina echt opnieuw, ook als alleen het #-deel verandert. */
  function goTo(u) {
    const base = (x) => x.split('#')[0];
    if (u === location.href) location.reload();
    else if (base(u) === base(location.href)) { history.pushState(null, '', u); location.reload(); }   // alleen het #-deel wijzigt: adres eerst zetten, dan herladen
    else location.href = u;
  }
  const restart = () => goTo(location.origin + location.pathname);
  // Lijn-iconen (24×24) voor een strakke, op elk toestel gelijke weergave.
  const ICONS = {
    flag: '<path d="M6 21V4"/><path d="M6 4.5l11 3.2L6 11"/><path d="M3 21h7"/>',
    map: '<path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4z"/><path d="M9 4v13.5M15 6.5V20"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3.2 4M16 6h3a3 3 0 0 1-3.2 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/>',
    grid: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 10h16M10 4v16"/>',
    more: '<path d="M5 7h14M5 12h14M5 17h14"/>',
    nav: '<path d="M12 3l7 18-7-4-7 4 7-18z"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    up: '<path d="M6 14l6-6 6 6"/>',
    down: '<path d="M6 10l6 6 6-6"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    back: '<path d="M15 6l-6 6 6 6"/>'
  };
  const ico = (name) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
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
  const CFG_GAME = cleanGame(CFG.game);   // leeg: de link opent de lobby, een spel heeft een eigen code in de link
  const DB = normalizeDb(param('db')) || CFG_DB || normalizeDb(LS.get('pg.db', ''));
  const GAME = cleanGame(param('g')) || CFG_GAME;
  if (param('db') && DB) LS.set('pg.db', DB);
  const LOCAL = DB === 'local';
  const nsFor = (game) => 'pg.' + hashStr(DB + '|' + game) + '.';
  const NS = nsFor(GAME);
  const gameUrl = (game, path) => DB + '/games/' + game + (path ? '/' + path : '') + '.json';

  // ------------------------------------------------------------ defaults
  const DEFAULT_WHEEL = [
    { label: 'Bier', par: 2 }, { label: 'Wijn', par: 3 }, { label: 'Shotje', par: 1 },
    { label: 'Mixdrankje', par: 3 }, { label: 'Speciaalbier', par: 4 }, { label: 'Fris / 0.0', par: 2 }
  ];
  const DEFAULT_DRINK = { type: 'fixed', drink: 'Drankje naar keuze', par: 3 };
  // Standaardroute: Pubgolf Zwolle, 14 kroegen in loopvolgorde.
  const ROUTE_CITY = 'Zwolle';
  const ROUTE_ZWOLLE = [
    { name: 'Café ’t Beugeltje', addr: 'Krabbestraat 63' },
    { name: 'Café De Tagrijn', addr: 'Buitenkant 8' },
    { name: '’t Swolsch Café', addr: 'Melkmarkt 37' },
    { name: 'De Belgische Keijzer', addr: 'Melkmarkt 58' },
    { name: 'Café De Blauwvinger', addr: 'Melkmarktstraat 6' },
    { name: 'DAVO', addr: 'Grote Kerkplein 9' },
    { name: 'Het Refter', addr: 'Bethlehemkerkplein 35A' },
    { name: 'The Dublin House', addr: 'Bethlehemkerkplein 46', drink: 'Guinness', par: 4, task: 'Split the G', win: -2, lose: 2 },
    { name: 'Café De Gezelligheid', addr: 'Gasthuisplein 11' },
    { name: 'Café Koos', addr: 'Nieuwe Markt 11' },
    { name: 'Café De Hete Brij', addr: 'Nieuwe Markt 9' },
    { name: 'Jack’s Music Bar', addr: 'Sassenstraat 29' },
    { name: 'Bonabo Social Club', addr: 'Voorstraat 3' },
    { name: 'Het Vliegende Paard', addr: 'Voorstraat 17' }
  ];
  function seedHoles(route) {
    const holes = {};
    route.forEach((h, i) => { holes['h' + uid(6)] = Object.assign({ order: i + 1 }, DEFAULT_DRINK, clone(h)); });
    return holes;
  }
  const DEFAULT_PENS = [
    { l: 'Gemorst', n: 1 }, { l: 'Te laat bij de hole', n: 1 }, { l: 'Glas omgegooid', n: 2 }
  ];
  const EMOJIS = ['🍺', '🍻', '🍷', '🥃', '🍸', '🍹', '⛳', '🏌️', '🦄', '🦊', '🐻', '🐸', '🐧', '🦁', '🐯', '🐵',
    '🐷', '🐮', '🦆', '🦈', '🐙', '🚀', '🔥', '⚡', '👑', '🎩', '🤠', '😎', '🤡', '👻', '🍕', '🌮'];

  // ------------------------------------------------------------ store
  function norm(d) {
    d = d && typeof d === 'object' ? d : {};
    return { meta: d.meta || null, holes: d.holes || {}, players: d.players || {}, teams: d.teams || {}, scores: d.scores || {}, spins: d.spins || {}, na: d.na || {} };
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
    tab: 'holes', hole: (history.state && history.state.hole) || null, uid: null, editing: false,
    editHoles: false, spinning: false, wiz: null, joinEmoji: EMOJIS[randInt(EMOJIS.length)], wheelRot: {}, scroll: {}
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
  const url = (path) => gameUrl(GAME, path);

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
    if (LOCAL || !DB || !GAME || pulling) return;
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
    if (LOCAL || !DB || !GAME || typeof EventSource === 'undefined') return;
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
    if (LOCAL || !DB || !GAME) return;
    const streamOk = es && es.readyState === 1 && now() - lastEventAt < 75000;
    if (!streamOk && (!es || es.readyState === 2 || now() - lastEventAt > 75000)) connect();
    if (!streamOk || now() - lastPullAt > 30000) pull();
    if (S.outbox.length) flush();
  }
  function resync() {
    if (LOCAL || !DB || !GAME) return;
    connect();
    pull();
    flush();
  }

  // Meldingen over scores van anderen en binnenkomende rad-uitslagen
  function snapshot() {
    const m = { sc: {}, sp: {}, na: {} };
    for (const u in S.data.scores) {
      const row = S.data.scores[u] || {};
      for (const hid in row) m.sc[u + '/' + hid] = row[hid] && row[hid].done ? 1 : 0;
    }
    for (const hid in S.data.spins) {
      const row = S.data.spins[hid] || {};
      for (const key in row) m.sp[hid + '/' + key] = (row[key] && row[key].t) || 1;
    }
    for (const hid in S.data.na) for (const id in S.data.na[hid] || {}) m.na[hid + '/' + id] = 1;
    return m;
  }
  let snap = snapshot(), announce = false;
  function afterRemote() {
    const next = snapshot();
    if (announce) {
      const fresh = [];
      for (const k in next.sc) if (next.sc[k] && !snap.sc[k]) fresh.push(k);
      if (fresh.length <= 3) fresh.forEach(announceScore);
      for (const k in next.na) {
        if (snap.na[k]) continue;
        const [hid, id] = k.split('/');
        const x = (S.data.na[hid] || {})[id];
        const hole = S.data.holes[hid];
        if (x && hole && x.by !== S.me) toast(`${(S.data.players[x.by] || {}).name || 'De organisator'} meldt: ${x.l} is er niet bij ${hole.name || 'deze kroeg'}`);
      }
      for (const k in next.sp) {
        if (next.sp[k] !== snap.sp[k] && !ui.spinning && ui.hole) {
          const [hid, key] = k.split('/');
          const hole = holeById(hid);
          if (hid === ui.hole && hole && key === spinKey(hole, targetUnit())) {
            const sp = S.data.spins[hid][key];
            const n = spinOpts(sp, hole).length;
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
    const [uidKey, hid] = k.split('/');
    const u = unitById(uidKey);
    const hole = holeById(hid);
    if (!u || !hole) return;
    const sc = scoreOf(uidKey, hid);
    const own = uidKey === myUnit();
    if (sc && sc.skip) { if (!own) toast(`${u.emoji} ${u.name} slaat hole ${holeNo(hid)} over`); return; }
    const info = holeInfo(hole, uidKey);
    const st = strokesOf(sc, info.par, hole);
    if (st == null) return;
    const term = termFor(sc, st, info.par, hole);
    if (own) {
      // Een teamgenoot (of de organisator) sloeg de hole van mijn team op: ik krijg dezelfde uitslag in beeld.
      if (term.cls === 'hio' || term.cls === 'good') confetti();
      splash(term.t.replace(' 🎯', ''), term.cls, pts(st));
      return;
    }
    toast(`${u.emoji} ${u.name}: ${term.cls === 'hio' ? 'in één keer leeg 🎯' : pts(st)} op hole ${holeNo(hid)}`, term.cls === 'hio' ? 'gold' : '');
  }

  // ------------------------------------------------------------ domein
  const title = () => (S.data.meta && S.data.meta.title) || 'Pubgolf';
  const dnfExtra = () => { const n = S.data.meta ? +S.data.meta.dnf : NaN; return Number.isFinite(n) ? n : 3; };
  const soloSkips = () => { const n = S.data.meta ? +S.data.meta.soloSkips : NaN; return Number.isFinite(n) ? clamp(Math.round(n), 0, 20) : 4; };
  const wheelOnce = () => !(S.data.meta && S.data.meta.wheelOnce === false);
  const penList = () => (S.data.meta && Array.isArray(S.data.meta.pens) ? S.data.meta.pens.filter(Boolean) : []);
  const isOrg = () => LOCAL || S.org;
  const holesList = () => Object.keys(S.data.holes).map((id) => Object.assign({ id }, S.data.holes[id]))
    .filter((h) => h && typeof h === 'object')
    .sort((a, b) => (+a.order || 0) - (+b.order || 0) || (a.id < b.id ? -1 : 1));
  /** Kroegen die meetellen: een vervallen kroeg (dicht, te druk) blijft in de lijst staan maar telt niet. */
  const liveHoles = () => holesList().filter((h) => !h.off);
  const holeById = (id) => (S.data.holes[id] ? Object.assign({ id }, S.data.holes[id]) : null);
  const holeNo = (id) => holesList().findIndex((h) => h.id === id) + 1;
  const playersList = () => Object.keys(S.data.players).map((id) => Object.assign({ id }, S.data.players[id]))
    .filter((p) => p && p.name)
    .sort((a, b) => (+a.t || 0) - (+b.t || 0) || (a.id < b.id ? -1 : 1));
  const meP = () => (S.me && S.data.players[S.me] ? S.me : null);

  // Teams. De score hoort bij een "eenheid": een team, of een speler zonder team (solo).
  const teamsList = () => Object.keys(S.data.teams).map((id) => Object.assign({ id }, S.data.teams[id]))
    .filter((t) => t && typeof t === 'object')
    .sort((a, b) => (+a.t || 0) - (+b.t || 0) || (a.id < b.id ? -1 : 1));
  const unitId = (pid) => { const p = pid && S.data.players[pid]; return p ? (p.team && S.data.teams[p.team] ? p.team : pid) : null; };
  function unitsList() {
    const players = playersList();
    const out = [];
    teamsList().forEach((t) => {
      const members = players.filter((p) => p.team === t.id);
      if (!members.length) return;
      out.push({ id: t.id, team: true, members, name: t.name || members.map((p) => p.name).join(' & '), emoji: members.slice(0, 2).map((p) => p.emoji || '🍺').join('') });
    });
    players.filter((p) => !(p.team && S.data.teams[p.team])).forEach((p) => out.push({ id: p.id, team: false, members: [p], name: p.name, emoji: p.emoji || '🍺' }));
    return out;
  }
  const unitById = (id) => (id && unitsList().find((u) => u.id === id)) || null;
  const myUnit = () => unitId(meP());
  const targetUnit = () => (isOrg() && ui.uid && unitById(ui.uid) ? ui.uid : myUnit());
  const scoreOf = (u, hid) => (u && S.data.scores[u] && S.data.scores[u][hid]) || null;
  /** Teugen van het hele team: elke speler telt z'n eigen teugen, de app telt ze op. */
  function sipsOf(sc) {
    let n = 0;
    if (sc && sc.by && typeof sc.by === 'object') for (const k in sc.by) n += Math.max(0, +sc.by[k] || 0);
    return n;
  }
  /** Onder welke naam de teugen van dit toestel geteld worden. */
  const scoreKey = (u) => { const me = meP(); return me && unitId(me) === u ? me : 'org'; };

  // Rechten. Spelers vullen alleen de score van hun eigen team in; een opgeslagen score gaat na een paar minuten op slot.
  const EDIT_MIN = +CFG.editMinutes >= 0 ? +CFG.editMinutes : 2;
  const canScore = (u) => !!u && (isOrg() || u === myUnit());
  const locked = (sc) => !!(sc && sc.done) && !isOrg() && now() - (+sc.dt || 0) > EDIT_MIN * 60000;

  // Solo spelen: wie alleen speelt terwijl anderen in teams zitten, mag een aantal holes overslaan.
  const hasTeams = () => unitsList().some((u) => u.members.length > 1);
  const skipsAllowed = (u) => { const x = unitById(u); return x && x.members.length === 1 && hasTeams() ? soloSkips() : 0; };
  const skipsUsed = (u) => liveHoles().filter((h) => { const sc = scoreOf(u, h.id); return sc && sc.skip && sc.done; }).length;

  // Het rad van het spel wordt vooraf ingesteld en geldt voor elke kroeg met een rad, tenzij die kroeg een eigen rad heeft.
  const gameWheel = () => {
    const w = S.data.meta && Array.isArray(S.data.meta.wheel) ? S.data.meta.wheel.filter((o) => o && o.label) : [];
    return w.length ? w : DEFAULT_WHEEL;
  };
  const ownWheel = (hole) => (hole && Array.isArray(hole.options) ? hole.options.filter((o) => o && o.label) : []);
  const wheelOpts = (hole) => { const own = ownWheel(hole); return own.length ? own : gameWheel(); };
  const spinKey = (hole, u) => (hole.wheelMode === 'group' ? '_group' : u);
  function spinOf(hole, u) {
    const row = S.data.spins[hole.id] || {};
    const key = spinKey(hole, u);
    return (key && row[key]) || null;
  }
  /** De vakken zoals ze op het rad stonden toen er gedraaid werd. */
  const spinOpts = (sp, hole) => (sp && Array.isArray(sp.o) && sp.o.filter(Boolean).length ? sp.o.filter(Boolean) : wheelOpts(hole));
  const naList = (hid) => Object.keys(S.data.na[hid] || {}).map((id) => Object.assign({ id }, S.data.na[hid][id])).filter((x) => x && x.l);
  /** Wat er nu nog op het rad staat: zonder wat hier niet verkrijgbaar is en zonder wat deze draaier al eerder trok. */
  function wheelState(hole, u) {
    const all = wheelOpts(hole);
    const key = spinKey(hole, u);
    const na = naList(hole.id).map((x) => x.l);
    let used = [];
    if (wheelOnce() && key) {
      for (const hid in S.data.spins) {
        if (hid === hole.id || !S.data.holes[hid]) continue;
        const sp = (S.data.spins[hid] || {})[key];
        if (sp && sp.label && all.some((o) => o.label === sp.label) && !used.includes(sp.label)) used.push(sp.label);
      }
    }
    const avail = all.filter((o) => !na.includes(o.label));
    let opts = avail.filter((o) => !used.includes(o.label));
    let reset = false;
    if (!opts.length && avail.length) { opts = avail; reset = true; used = []; }   // alles al gehad: het rad begint opnieuw
    return { opts, na, used: used.filter((l) => !na.includes(l)), reset };
  }
  /** Drankje en par van een hole voor een team (bij een rad hangt dat van de draai af). */
  function holeInfo(hole, u) {
    if (hole.type !== 'wheel') return { drink: hole.drink || 'Drankje', par: Math.max(1, +hole.par || 1) };
    const sp = spinOf(hole, u);
    if (sp && sp.label) return { drink: sp.label, par: Math.max(1, +sp.par || 1), spin: sp };
    const sc = scoreOf(u, hole.id);
    if (sc && sc.done && sc.par && !sc.skip) return { drink: sc.drink || 'Rad', par: +sc.par };
    if (sc && sc.done && sc.skip) {
      const o = wheelOpts(hole);
      return { drink: 'Het rad', par: Math.max(1, Math.round(o.reduce((a, x) => a + (+x.par || 1), 0) / Math.max(1, o.length))) };
    }
    return { drink: null, par: null, needSpin: true };
  }
  const penTotal = (sc) => (sc && Array.isArray(sc.pens) ? sc.pens.reduce((a, p) => a + (p ? +p.n || 0 : 0), 0) : 0);
  const city = () => (S.data.meta && S.data.meta.city) || '';
  const holePens = (hole) => (hole && Array.isArray(hole.hp) ? hole.hp.filter(Boolean) : []);
  /** Punten erbij of eraf door de opdracht van een kroeg (bijv. Split the G). */
  const taskMod = (hole, sc) => (hole && hole.task && sc ? (sc.task === 'w' ? +hole.win || 0 : sc.task === 'l' ? +hole.lose || 0 : 0) : 0);
  const fmtMod = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '±0');
  const hasGeo = (h) => !!h && h.lat != null && h.lng != null && Number.isFinite(+h.lat) && Number.isFinite(+h.lng);
  function navUrl(h) {
    const dest = h.addr ? [h.name, h.addr, city()].filter(Boolean).join(', ')
      : hasGeo(h) ? (+h.lat).toFixed(6) + ',' + (+h.lng).toFixed(6) : [h.name, city()].filter(Boolean).join(', ');
    return 'https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=' + encodeURIComponent(dest);
  }
  /** Punten op een hole: elke teug is één punt. Overslaan telt als 0. */
  function strokesOf(sc, _par, hole) {
    if (!sc || !sc.done) return null;
    if (sc.skip) return 0;   // een overgeslagen hole telt als 0 punten
    return Math.max(0, sipsOf(sc) + (sc.dnf ? dnfExtra() : 0) + penTotal(sc) + taskMod(hole, sc));
  }
  const isOneGo = (sc, hole) => !!sc && !sc.skip && !sc.dnf && sipsOf(sc) === 1 && !penTotal(sc) && taskMod(hole, sc) <= 0;
  function termFor(sc, strokes, _par, hole) {
    if (sc.skip) return { t: 'Overgeslagen', cls: 'par' };
    if (sc.dnf) return { t: 'Niet opgedronken', cls: 'bad' };
    if (isOneGo(sc, hole)) return { t: 'In één keer leeg! 🎯', cls: 'hio' };
    return { t: 'Glas leeg', cls: 'par' };
  }
  const pts = (n) => n + ' ' + (n === 1 ? 'punt' : 'punten');
  function totals(u) {
    const t = { str: 0, n: 0, hio: 0, skips: 0 };
    for (const h of liveHoles()) {
      const sc = scoreOf(u, h.id);
      const st = strokesOf(sc, null, h);
      if (st == null) continue;
      t.str += st; t.n++;
      if (sc.skip) t.skips++;
      else if (isOneGo(sc, h)) t.hio++;
    }
    return t;
  }
  /** Stand: de minste punten (teugen) staat bovenaan, de meeste punten onderaan. */
  function ranking() {
    const rows = unitsList().map((u) => Object.assign({ u }, totals(u.id)));
    rows.sort((a, b) => (b.n > 0) - (a.n > 0) || a.str - b.str || b.n - a.n || (a.u.name < b.u.name ? -1 : 1));
    let rank = 0;
    rows.forEach((r, i) => {
      if (i === 0 || r.n === 0 || rows[i - 1].str !== r.str || rows[i - 1].n === 0) rank = i + 1;
      r.rank = r.n ? rank : null;
    });
    return rows;
  }
  function currentHoleId() {
    const cur = S.data.meta && S.data.meta.current;
    if (cur && S.data.holes[cur] && !S.data.holes[cur].off) return cur;
    const u = myUnit();
    if (!u) return null;
    const next = liveHoles().find((h) => { const sc = scoreOf(u, h.id); return !(sc && sc.done); });
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
  const PAPER = ['#ffc53d', '#4ade80', '#5aa9ff', '#ff6b5e', '#c69cff', '#ffffff'];
  function confetti(emojis) {
    const set = emojis || ['🎉', '⛳', '🍺', '✨'];
    const layer = document.createElement('div');
    layer.className = 'confetti';
    for (let i = 0; i < 44; i++) {
      const s = document.createElement('span');
      s.style.left = Math.random() * 100 + '%';
      s.style.animationDelay = Math.random() * 0.4 + 's';
      s.style.setProperty('--x', (Math.random() * 120 - 60).toFixed(0) + 'px');
      s.style.setProperty('--r', (360 + Math.random() * 540).toFixed(0) + 'deg');
      if (i % 4 === 0) {
        s.textContent = set[(i / 4) % set.length];
        s.style.fontSize = 20 + Math.random() * 16 + 'px';
      } else {
        const paper = document.createElement('i');
        paper.style.background = PAPER[i % PAPER.length];
        s.appendChild(paper);
      }
      layer.appendChild(s);
    }
    document.body.appendChild(layer);
    setTimeout(() => layer.remove(), 2800);
  }
  /** Grote uitslag over het hele scherm, zoals op tv bij golf. Blokkeert geen tikken. */
  function splash(text, cls, sub) {
    document.querySelectorAll('.splash').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'splash ' + (cls || '');
    el.innerHTML = `<div class="splash-in"><b>${esc(text)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1750);
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
    let pegs = '';
    for (let i = 0; i < n && n > 1; i++) {
      const a = (i * step * Math.PI) / 180;
      pegs += `<circle cx="${(100 + 90 * Math.sin(a)).toFixed(2)}" cy="${(100 - 90 * Math.cos(a)).toFixed(2)}" r="2.6" fill="#fff" stroke="#0a1a13" stroke-width="0.8"/>`;
    }
    return `<svg class="wheel" viewBox="0 0 200 200" style="transform:rotate(${rot}deg)" aria-hidden="true">
      <defs><radialGradient id="wheel-gloss" cx="50%" cy="50%" r="50%"><stop offset="55%" stop-color="#fff" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.22"/></radialGradient></defs>
      ${g}<circle cx="100" cy="100" r="${R}" fill="url(#wheel-gloss)" pointer-events="none"/>${pegs}
      <circle cx="100" cy="100" r="15" fill="#0a1a13" stroke="#fff" stroke-width="3"/><circle cx="100" cy="100" r="5" fill="#ffc53d"/></svg>`;
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
    if (ui.spinning || hole.off) return;
    const u = targetUnit();
    const group = hole.wheelMode === 'group';
    const key = spinKey(hole, u);
    if (!key || !(group ? meP() || isOrg() : canScore(u))) return;
    if (spinOf(hole, u)) { render(true); return; }
    if (group && !LOCAL) {
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
          playSpin(+cur.i || 0, spinOpts(cur, hole).length, hole.id + '/_group');
          return;
        }
      } catch (e) { /* offline: gewoon draaien */ }
      ui.spinning = false;
    }
    const opts = wheelState(hole, u).opts;
    if (!opts.length) { toast('Er staat niets meer op het rad. Vraag de organisator.'); return; }
    const i = randInt(opts.length);
    const spin = { i, label: opts[i].label, par: Math.max(1, +opts[i].par || 1), o: opts.map((o) => ({ label: o.label, par: Math.max(1, +o.par || 1) })), t: now(), by: S.me || '' };
    ui.spinning = true;
    write('spins/' + hole.id + '/' + key, spin);
    ui.spinning = false;
    playSpin(i, opts.length, hole.id + '/' + key);
  }

  // ------------------------------------------------------------ kaart
  // De Leaflet-kaart leeft in één eigen element dat na elke render opnieuw in
  // de pagina wordt gehangen, zodat zoom en positie bewaard blijven.
  let map = null, mapEl = null, mapLayer = null, meMarker = null, mapSig = '', mapFitSig = '';
  const mapPoints = () => holesList().map((h, i) => ({ h, i })).filter((x) => hasGeo(x.h));
  function fitMap() {
    const pts = mapPoints();
    if (!map || !pts.length) return;
    if (pts.length === 1) map.setView([+pts[0].h.lat, +pts[0].h.lng], 17);
    else map.fitBounds(pts.map((x) => [+x.h.lat, +x.h.lng]), { padding: [30, 30] });
  }
  function syncMap() {
    if (!map) return;
    const L = window.L;
    const mine = myUnit();
    const cur = currentHoleId();
    const pts = mapPoints();
    const rows = pts.map((x) => {
      const sc = scoreOf(mine, x.h.id);
      return [x.h.id, x.i, +x.h.lat, +x.h.lng, x.h.name || '', x.h.addr || '', x.h.id === cur, !!(sc && sc.done) && !x.h.off, x.h.off ? 'Vervalt' : holeLine(x.h, mine), !!x.h.off];
    });
    const sig = JSON.stringify(rows);
    if (sig === mapSig) return;
    mapSig = sig;
    mapLayer.clearLayers();
    if (pts.length > 1) {
      L.polyline(rows.map((r) => [r[2], r[3]]), { color: '#0a1a13', weight: 4, opacity: 0.75, dashArray: '1 9', lineCap: 'round' }).addTo(mapLayer);
    }
    pts.forEach((x, k) => {
      const r = rows[k];
      const icon = L.divIcon({ className: 'pin-wrap', html: `<div class="pin ${r[6] ? 'cur' : ''} ${r[7] ? 'done' : ''} ${r[9] ? 'off' : ''}">${r[1] + 1}</div>`, iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -14] });
      L.marker([r[2], r[3]], { icon, zIndexOffset: r[6] ? 1000 : 0 })
        .bindPopup(`<b>${r[1] + 1}. ${esc(r[4])}</b>${r[5] ? '<br>' + esc(r[5]) : ''}<br>${r[8]}
          <div class="pop-btns"><button class="btn" data-hole="${r[0]}">Bekijk</button><a class="btn ghost" href="${esc(navUrl(x.h))}" target="_blank" rel="noopener">Navigeer</a></div>`, { closeButton: false, minWidth: 200 })
        .addTo(mapLayer);
    });
    const fitSig = JSON.stringify(rows.map((r) => [r[0], r[2], r[3]]));
    if (fitSig !== mapFitSig) { mapFitSig = fitSig; fitMap(); }
  }
  function mountMap() {
    const slot = $('#map-slot');
    if (!slot) return;
    const L = window.L;
    if (!L) { slot.innerHTML = '<div class="empty">De kaart kon niet laden. De route hieronder werkt wel.</div>'; return; }
    if (!mapEl) { mapEl = document.createElement('div'); mapEl.id = 'map'; }
    slot.appendChild(mapEl);
    if (!map) {
      map = L.map(mapEl, { zoomControl: true });
      map.setView([52.5126, 6.0936], 15);
      map.attributionControl.setPrefix(false);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
      mapLayer = L.layerGroup().addTo(map);
      map.on('popupopen', (e) => {
        const btn = e.popup.getElement().querySelector('[data-hole]');
        if (btn) btn.onclick = () => openHole(btn.dataset.hole);
      });
      mapSig = ''; mapFitSig = '';
    } else {
      map.invalidateSize(false);
    }
    syncMap();
  }
  /** Adres → coördinaten via OpenStreetMap (Nominatim). Geeft null als het niet lukt. */
  async function geocode(addr) {
    const c = city();
    const q = addr + (c && !addr.toLowerCase().includes(c.toLowerCase()) ? ', ' + c : '');
    try {
      const res = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q));
      const j = res.ok ? await res.json() : null;
      const hit = Array.isArray(j) ? j[0] : null;
      if (hit && Number.isFinite(+hit.lat) && Number.isFinite(+hit.lon)) return { lat: +(+hit.lat).toFixed(6), lng: +(+hit.lon).toFixed(6) };
    } catch (e) { /* geen bereik of geblokkeerd */ }
    return null;
  }
  async function locateHole(id) {
    const h = S.data.holes[id];
    if (!h || !h.addr) return false;
    const addr = h.addr;
    const g = await geocode(addr);
    const cur = S.data.holes[id];
    if (!g || !cur || cur.addr !== addr) return false;
    write('holes/' + id + '/lat', g.lat);
    write('holes/' + id + '/lng', g.lng);
    return true;
  }
  let geoBusy = false, geoAuto = false;
  async function geoFill(quiet) {
    if (geoBusy) return;
    geoBusy = true;
    let found = 0, miss = 0;
    try {
      for (const h of holesList()) {
        if (hasGeo(h) || !h.addr) continue;
        if (await locateHole(h.id)) found++; else miss++;
        await new Promise((r) => setTimeout(r, 1100));   // Nominatim: hooguit één verzoek per seconde
      }
    } finally {
      geoBusy = false;
    }
    if (!quiet) toast(miss ? `${found} gevonden, ${miss} niet gevonden` : found ? `${found} ${found === 1 ? 'kroeg' : 'kroegen'} op de kaart gezet` : 'Alles staat al op de kaart');
    render(lastKey === 'tab:map');
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
  const gameCode = () => { const abc = 'abcdefghjkmnpqrstuvwxyz23456789'; let c = ''; for (let i = 0; i < 5; i++) c += abc[randInt(abc.length)]; return c; };
  function openGame(code) {
    const q = [];
    if (LOCAL) q.push('db=local'); else if (DB !== CFG_DB) q.push('db=' + encodeURIComponent(DB));
    q.push('g=' + code);
    goTo(location.origin + location.pathname + '#' + q.join('&'));
  }
  /** Onthoudt op dit toestel welke spellen je opende, zodat de lobby ze kan tonen. */
  let remembered = '';
  function rememberGame() {
    if (!GAME || !S.data.meta || remembered === title()) return;
    remembered = title();
    const list = (LS.get('pg.recent', []) || []).filter((x) => x && !(x.g === GAME && x.db === DB));
    list.unshift({ g: GAME, db: DB, t: remembered, at: now() });
    LS.set('pg.recent', list.slice(0, 8));
  }
  function viewLobby() {
    const recent = (LS.get('pg.recent', []) || []).filter((x) => x && x.db === DB && x.g).slice(0, 5);
    return `<div class="center-screen">
      <div class="logo">⛳</div>
      <h1>Pubgolf</h1>
      <p class="mut">Start een eigen spel, of doe mee met de spelcode die je van de organisator kreeg.</p>
      <button class="btn big" data-act="lobby-new">Nieuw spel starten</button>
      <div class="or"><span>of</span></div>
      <label class="field"><span>Spelcode</span>
        <input id="in-code" type="text" maxlength="12" autocapitalize="characters" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="bijv. ZW7KQ"></label>
      <button class="btn ghost" data-act="lobby-join">Meedoen met deze code</button>
      <p id="lobby-msg" class="msg"></p>
      ${recent.length ? `<div class="rejoin"><p class="mut">Eerder op dit toestel:</p>
        <div class="stack">${recent.map((x) => `<button class="btn ghost" data-act="lobby-open" data-g="${esc(x.g)}">${esc(x.t || 'Pubgolf')}<span class="code">${esc(x.g.toUpperCase())}</span></button>`).join('')}</div></div>` : ''}
      ${CFG_DB ? '' : `<button class="linkbtn" data-act="change-db">${LOCAL ? 'Database koppelen' : 'Andere database'}</button>`}
    </div>`;
  }
  function viewMissing() {
    return `<div class="center-screen">
      <div class="logo">⛳</div>
      <h1>Spel niet gevonden</h1>
      <p class="mut">Er is geen spel met de code <b>${esc(GAME.toUpperCase())}</b>. Controleer de link of de code, of start zelf een spel.</p>
      <button class="btn big" data-act="to-lobby">Naar de lobby</button>
      <button class="btn ghost" data-act="retry">Opnieuw proberen</button>
    </div>`;
  }

  // Nieuw spel aanmaken in stappen: spel, kroegen, drankjes, het rad, overzicht.
  const WIZ_STEPS = ['Het spel', 'Kroegen', 'Drankjes', 'Het rad', 'Overzicht'];
  function wizInit() {
    ui.wiz = {
      step: 0, title: 'Pubgolf Zwolle', pin: '', once: true, nn: '', na: '', busy: false, msg: '',
      pubs: ROUTE_ZWOLLE.map((h) => Object.assign({ on: true, type: 'fixed', drink: '', par: 3 }, clone(h))),
      wheel: clone(DEFAULT_WHEEL)
    };
  }
  const wizWheel = () => ui.wiz.wheel.map((o) => ({ label: String(o.label || '').trim().slice(0, 30), par: clamp(Math.round(+o.par) || 1, 1, 20) })).filter((o) => o.label);
  function viewWizard() {
    const w = ui.wiz;
    const chosen = w.pubs.map((pub, i) => ({ pub, i })).filter((x) => x.pub.on);
    const onWheel = chosen.filter((x) => x.pub.type === 'wheel');
    let body = '';
    if (w.step === 0) {
      body = `<p class="mut">Geef je spel een naam. Je krijgt daarna een spelcode en een link om te delen.</p>
        <label class="field"><span>Naam van het spel</span><input type="text" maxlength="40" data-w="title" value="${esc(w.title)}"></label>
        ${LOCAL ? '' : `<label class="field"><span>Organisator-pincode</span><input type="text" inputmode="numeric" maxlength="8" autocomplete="off" data-w="pin" value="${esc(w.pin)}" placeholder="bijv. 1234"></label>`}
        <div class="card note"><b>Jij wordt de organisator.</b> Alleen jij kunt straks kroegen, teams en het rad aanpassen en scores corrigeren. De rest doet mee met een eigen naam en telt alleen de teugen van het eigen team, of kijkt mee.</div>`;
    } else if (w.step === 1) {
      let k = 0;
      body = `<p class="mut">Vink de kroegen aan die meedoen en zet ze met de pijltjes in de goede volgorde.</p>
        <div class="rowbar between"><span class="mut small"><b>${chosen.length}</b> van ${w.pubs.length} gekozen</span>
          <span class="chips"><button class="chip" data-act="wiz" data-do="all">Alles</button><button class="chip" data-act="wiz" data-do="none">Geen</button></span></div>
        <div class="wlist">${w.pubs.map((pub, i) => `<div class="wrow ${pub.on ? 'on' : ''}">
          <button class="wmain" data-act="wiz" data-do="tog" data-i="${i}" aria-pressed="${pub.on ? 'true' : 'false'}">
            <span class="check">${pub.on ? ++k : ''}</span>
            <span class="pn"><b>${esc(pub.name)}</b><small>${esc(pub.addr || 'geen adres')}</small></span></button>
          <button class="mini" data-act="wiz" data-do="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Omhoog">${ico('up')}</button>
          <button class="mini" data-act="wiz" data-do="down" data-i="${i}" ${i === w.pubs.length - 1 ? 'disabled' : ''} aria-label="Omlaag">${ico('down')}</button></div>`).join('')}</div>
        <div class="card"><h3>Eigen kroeg toevoegen</h3>
          <label class="field"><span>Naam</span><input type="text" maxlength="40" data-w="nn" value="${esc(w.nn)}" placeholder="Naam van de kroeg"></label>
          <label class="field"><span>Adres (voor de kaart)</span><input type="text" maxlength="80" data-w="na" value="${esc(w.na)}" placeholder="bijv. Melkmarkt 37"></label>
          <button class="btn ghost" data-act="wiz" data-do="add">+ Toevoegen aan de route</button></div>`;
    } else if (w.step === 2) {
      body = `<p class="mut">Kies per kroeg een vast drankje, of laat het rad beslissen.</p>
        <div class="rowbar"><span class="chips"><button class="chip" data-act="wiz" data-do="allfixed">Alles vast</button><button class="chip" data-act="wiz" data-do="allwheel">Alles op het rad</button></span></div>
        ${chosen.map((x, k) => `<div class="card wpub">
          <div class="wpub-h"><span class="rt-no">${k + 1}</span><b>${esc(x.pub.name)}</b></div>
          <div class="seg"><button data-act="wiz" data-do="type" data-i="${x.i}" data-v="fixed" class="${x.pub.type === 'wheel' ? '' : 'on'}">🍺 Vast drankje</button>
            <button data-act="wiz" data-do="type" data-i="${x.i}" data-v="wheel" class="${x.pub.type === 'wheel' ? 'on' : ''}">🎡 Rad</button></div>
          ${x.pub.type === 'wheel' ? '<p class="mut small">Het rad bepaalt hier het drankje.</p>'
            : `<div class="wfix"><input type="text" maxlength="30" data-w="p.${x.i}.drink" value="${esc(x.pub.drink || '')}" placeholder="Drankje naar keuze" aria-label="Drankje bij ${esc(x.pub.name)}"></div>`}
          ${x.pub.task ? `<p class="hole-task">🎯 Opdracht: ${esc(x.pub.task)} · gelukt ${fmtMod(+x.pub.win || 0)}, mislukt ${fmtMod(+x.pub.lose || 0)}</p>` : ''}
        </div>`).join('')}`;
    } else if (w.step === 3) {
      body = `<p class="mut">${onWheel.length ? 'Het rad geldt bij: ' + esc(onWheel.map((x) => x.pub.name).join(', ')) + '.' : 'Geen enkele kroeg gebruikt nu het rad. Je kunt doorgaan; het rad is later ook nog aan te passen.'}</p>
        <div class="wheel-box small" id="wiz-prev">${wheelPreview(wizWheel())}</div>
        <div class="wlist">${w.wheel.map((o, i) => `<div class="wrow on"><input type="text" maxlength="30" data-w="w.${i}.label" value="${esc(o.label || '')}" placeholder="Drankje" aria-label="Drankje ${i + 1} op het rad">
          <button class="mini danger" data-act="wiz" data-do="wdel" data-i="${i}" aria-label="Verwijder">✕</button></div>`).join('')}</div>
        <button class="btn ghost" data-act="wiz" data-do="wadd">+ Drankje op het rad</button>
        <button class="chip wide ${w.once ? 'on' : ''}" data-act="wiz" data-do="once">Een getrokken drankje verdwijnt van het rad</button>`;
    } else {
      const wh = wizWheel();
      body = `<p class="mut">Klopt het zo? Alles is na het aanmaken nog aan te passen.</p>
        <div class="card"><h3>${esc(w.title || 'Pubgolf')}</h3>
          <p class="mut small">${chosen.length} ${chosen.length === 1 ? 'kroeg' : 'kroegen'} · ${chosen.length - onWheel.length} met een vast drankje · ${onWheel.length} met het rad</p>
          <div class="sum">${chosen.map((x, k) => `<div><span class="rt-no">${k + 1}</span><span class="pn"><b>${esc(x.pub.name)}</b>
            <small>${x.pub.type === 'wheel' ? '🎡 Het rad' : esc((x.pub.drink || '').trim() || 'Drankje naar keuze')}${x.pub.task ? ' · 🎯 ' + esc(x.pub.task) : ''}</small></span></div>`).join('')}</div>
          ${onWheel.length ? `<p class="mut small">Op het rad: ${wh.map((o) => esc(o.label)).join(', ')}.${w.once ? ' Een getrokken drankje verdwijnt.' : ''}</p>` : ''}</div>`;
    }
    return `<div class="wiz">
      <div class="wiz-top"><button class="icon" data-act="wiz" data-do="back">${ico('back')}${w.step ? 'Terug' : 'Lobby'}</button><span>Stap ${w.step + 1} van ${WIZ_STEPS.length}</span></div>
      <div class="steps">${WIZ_STEPS.map((x, i) => `<i class="${i <= w.step ? 'on' : ''}"></i>`).join('')}</div>
      <h1>${WIZ_STEPS[w.step]}</h1>
      ${body}
      <div class="wiz-nav"><p id="wiz-msg" class="msg">${esc(w.msg || '')}</p>
        <button class="btn big" data-act="wiz" data-do="${w.step === WIZ_STEPS.length - 1 ? 'create' : 'next'}" ${w.busy ? 'disabled' : ''}>${w.step === WIZ_STEPS.length - 1 ? 'Spel aanmaken' : 'Volgende: ' + WIZ_STEPS[w.step + 1].toLowerCase()}</button></div>
    </div>`;
  }
  async function wizCreate() {
    const w = ui.wiz;
    if (!w || w.busy) return;
    const fail = (text) => { w.busy = false; w.msg = text; render(true); };
    w.busy = true; w.msg = 'Spel aanmaken…';
    render(true);
    try {
      let code = '';
      for (let k = 0; k < 6 && !code; k++) {
        const c = gameCode();
        if (LOCAL) { if (!LS.get(nsFor(c) + 'data', null)) code = c; continue; }
        const res = await fetch(gameUrl(c, 'meta/created'), { cache: 'no-store' });
        if (!res.ok) return fail(httpError(res.status));
        if ((await res.json()) == null) code = c;
      }
      if (!code) return fail('Geen vrije spelcode gevonden. Probeer het opnieuw.');
      const holes = {};
      w.pubs.filter((pub) => pub.on).forEach((pub, i) => {
        const h = { order: i + 1, name: String(pub.name || '').trim().slice(0, 40) || 'Kroeg', type: pub.type === 'wheel' ? 'wheel' : 'fixed' };
        if (h.type === 'wheel') h.wheelMode = 'player';
        else { h.drink = String(pub.drink || '').trim().slice(0, 30) || 'Drankje naar keuze'; h.par = clamp(Math.round(+pub.par) || 3, 1, 20); }
        if (pub.addr) h.addr = String(pub.addr).slice(0, 80);
        if (hasGeo(pub)) { h.lat = +pub.lat; h.lng = +pub.lng; }
        if (pub.task) { h.task = pub.task; h.win = +pub.win || 0; h.lose = +pub.lose || 0; }
        holes['h' + uid(6)] = h;
      });
      const wheel = wizWheel();
      const data = {
        meta: { title: String(w.title || '').trim().slice(0, 40) || 'Pubgolf', pin: LOCAL ? '' : hashStr('pg:' + w.pin), dnf: 3, soloSkips: 4,
          pens: DEFAULT_PENS, wheel: wheel.length >= 2 ? wheel : DEFAULT_WHEEL, wheelOnce: !!w.once, city: ROUTE_CITY, created: now() },
        holes
      };
      if (LOCAL) LS.set(nsFor(code) + 'data', data);
      else {
        const res = await fetch(gameUrl(code, ''), { method: 'PUT', body: JSON.stringify(data) });
        if (!res.ok) return fail(httpError(res.status));
      }
      LS.set(nsFor(code) + 'org', true);   // wie het spel aanmaakt is de organisator
      ui.wiz = null;
      openGame(code);
    } catch (e) {
      fail('Geen verbinding met de database. Probeer het opnieuw.');
    }
  }

  function viewJoin() {
    const players = playersList();
    return `<div class="center-screen join">
      <div class="logo">⛳</div>
      <h1>${esc(title())}</h1>
      <p class="gcode">Spelcode <b>${esc(GAME.toUpperCase())}</b></p>
      <p class="mut">Vul je naam in${LOCAL ? '' : ', kies een pincode'} en kies een poppetje.</p>
      <label class="field"><span>Je naam</span>
        <input id="in-name" type="text" maxlength="20" autocomplete="given-name" autocapitalize="words" placeholder="Naam"></label>
      ${LOCAL ? '' : `<label class="field"><span>Pincode van 4 cijfers, om later weer in te loggen</span>
        <input id="in-ppin" type="text" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="bijv. 2468"></label>`}
      <div class="emoji-grid">${EMOJIS.map((e) => `<button class="emoji ${e === ui.joinEmoji ? 'on' : ''}" data-act="pick-emoji" data-e="${e}">${e}</button>`).join('')}</div>
      <button class="btn big" data-act="join">Meedoen</button>
      <p id="join-msg" class="msg"></p>
      ${players.length ? `<div class="rejoin"><p class="mut">Deed je al mee? Tik op je naam:</p>
        <div class="chips">${players.map((p) => `<button class="chip" data-act="claim" data-id="${p.id}">${esc(p.emoji || '🍺')} ${esc(p.name)}</button>`).join('')}</div></div>` : ''}
      <button class="btn ghost" data-act="spectate">Alleen meekijken</button>
    </div>`;
  }

  function holeLine(h, u) {
    if (h.type === 'wheel') {
      const info = holeInfo(h, u);
      if (info.drink && !info.needSpin) return `🎡 ${esc(info.drink)}`;
      return '🎡 Rad bepaalt je drankje';
    }
    return `${drinkIcon(h.drink)} ${esc(h.drink || 'Drankje')}`;
  }
  function viewHoles() {
    const list = holesList();
    const live = list.filter((h) => !h.off);
    const mine = myUnit();
    const cur = currentHoleId();
    const units = unitsList();
    let html = '';
    if (mine) {
      const t = totals(mine);
      const row = ranking().find((r) => r.u.id === mine);
      const u = unitById(mine);
      const allowed = skipsAllowed(mine);
      html += `<section class="round">
        <div class="round-top"><div><span class="lbl">${u && u.team ? esc(u.name) : 'Jouw ronde'}</span><b>${t.n} van ${live.length} holes</b></div>
          <div class="round-stats"><div><span class="lbl">Punten</span><b>${t.n ? t.str : '–'}</b></div>
            <div><span class="lbl">Plek</span><b>${row && row.rank ? row.rank + 'e' : '–'}</b></div></div></div>
        <div class="bar"><i style="width:${live.length ? Math.round((100 * t.n) / live.length) : 0}%"></i></div>
        ${allowed ? `<p class="mut small">Je speelt solo en mag ${allowed} holes naar keuze overslaan. Nog ${Math.max(0, allowed - t.skips)} over.</p>` : ''}
      </section>`;
    }
    if (cur) {
      const h = holeById(cur);
      const pinned = S.data.meta && S.data.meta.current === cur;
      html += `<button class="now" data-act="open-hole" data-id="${cur}">
        <span class="now-l">${pinned ? 'We zijn nu bij' : (mine && unitById(mine).team ? 'Jullie volgende hole' : 'Jouw volgende hole')}</span>
        <span class="now-t">Hole ${holeNo(cur)} · ${esc(h.name || '')}</span><span class="now-go">${ico('chev')}</span></button>`;
    }
    if (isOrg()) {
      html += `<div class="rowbar"><button class="chip ${ui.editHoles ? 'on' : ''}" data-act="toggle-edit-holes">${ico('edit')} ${ui.editHoles ? 'Klaar met bewerken' : 'Kroegen bewerken'}</button></div>`;
    }
    if (!list.length) html += '<div class="empty">Nog geen kroegen. De organisator kan ze toevoegen.</div>';
    list.forEach((h, i) => {
      const info = holeInfo(h, mine);
      const sc = scoreOf(mine, h.id);
      const st = h.off ? null : strokesOf(sc, info.par, h);
      const doneN = units.filter((u) => { const x = scoreOf(u.id, h.id); return x && x.done; }).length;
      html += `<div class="hole ${h.id === cur ? 'cur' : ''} ${st != null ? 'done' : ''} ${h.off ? 'off' : ''}" data-act="open-hole" data-id="${h.id}" role="button" tabindex="0">
        <div class="hole-no">${i + 1}</div>
        <div class="hole-main"><div class="hole-name">${esc(h.name || 'Hole ' + (i + 1))}</div>
          <div class="hole-sub">${h.off ? 'Vervalt · telt niet mee' : holeLine(h, mine)}</div>
          ${h.task && !h.off ? `<div class="hole-task">🎯 ${esc(h.task)}</div>` : ''}
          <div class="hole-meta">${[h.addr ? esc(h.addr) : '', doneN && !h.off ? doneN + '/' + units.length + ' klaar' : ''].filter(Boolean).join(' · ')}</div></div>
        ${ui.editHoles && isOrg()
          ? `<div class="hole-tools"><button class="mini" data-act="hole-move" data-id="${h.id}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Omhoog">${ico('up')}</button>
             <button class="mini" data-act="hole-move" data-id="${h.id}" data-d="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Omlaag">${ico('down')}</button>
             <button class="mini" data-act="hole-edit" data-id="${h.id}" aria-label="Bewerken">${ico('edit')}</button></div>`
          : st != null
            ? (sc.skip ? '<div class="hole-score"><span class="rel">overgeslagen</span></div>'
              : `<div class="hole-score"><b>${st}</b><span class="rel par">${st === 1 ? 'punt' : 'punten'}</span></div>`)
            : `<div class="hole-go">${ico('chev')}</div>`}
      </div>`;
    });
    if (isOrg()) html += '<button class="btn ghost wide" data-act="hole-add">+ Kroeg toevoegen</button>';
    return html;
  }

  const RING = 339.3;   // omtrek van de voortgangsring (r = 54)
  const LOCK_NOTE = '<p class="lock">🔒 Deze score staat op slot. Alleen de organisator kan hem nog aanpassen.</p>';
  const scoreTitle = (u) => (u.id === myUnit() ? (u.team ? 'Score van jullie team' : 'Jouw score') : 'Score van ' + esc(u.name));
  /** Wie hoeveel teugen telde, zodat een team ziet hoe het totaal is opgebouwd. */
  function byLine(u, sc) {
    const by = (sc && sc.by) || {};
    if (u.members.length < 2 && !(+by.org > 0)) return '';
    const parts = u.members.map((p) => `<span class="${p.id === S.me ? 'me' : ''}">${esc(p.emoji || '🍺')} ${esc(p.name)} <b>${+by[p.id] || 0}</b></span>`);
    if (+by.org > 0) parts.push(`<span>organisator <b>${+by.org}</b></span>`);
    return `<div class="bywho">${parts.join('')}</div>`;
  }
  function scoreEditor(h, uidKey, info, sc) {
    const u = unitById(uidKey);
    const sips = clamp(sipsOf(sc), 0, 99);
    const pens = Array.isArray(sc.pens) ? sc.pens.filter(Boolean) : [];
    const draft = Object.assign({}, sc, { done: true, skip: false });
    const preview = sc.dnf || sips > 0 ? strokesOf(draft, info.par, h) : null;
    const term = preview != null ? termFor(draft, preview, info.par, h) : null;
    const needTask = !!h.task && !sc.task;
    const allPens = holePens(h).concat(penList());
    const ringCls = sips === 0 ? '' : 'even';
    const canDec = +((sc.by || {})[scoreKey(uidKey)]) > 0 || (isOrg() && sips > 0);
    const allowed = skipsAllowed(uidKey);
    const left = allowed - skipsUsed(uidKey);
    return `<section class="card score">
      <h3>${scoreTitle(u)}</h3>
      <p class="mut small">${u.members.length > 1 ? 'Jullie delen één glas. Tik op de cirkel bij elke teug, wie er ook drinkt: alle teugen tellen samen.' : 'Tik op de cirkel bij elke teug. Elke teug is 1 punt.'}</p>
      <div class="counter ${sc.dnf ? 'dim' : ''}">
        <button class="cbtn" data-act="sip" data-d="-1" aria-label="Eén teug minder" ${canDec ? '' : 'disabled'}>−</button>
        <button class="tap ${ringCls}" data-act="sip" data-d="1" aria-label="Eén teug erbij">
          <svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-bg" cx="60" cy="60" r="54"/>
            <circle class="ring-fg" cx="60" cy="60" r="54" stroke-dasharray="${RING}" stroke-dashoffset="${(RING * (1 - clamp(sips / 6, 0, 1))).toFixed(1)}"/></svg>
          <span class="cnum"><b>${sips}</b><span>${sips === 1 ? 'teug' : 'teugen'}</span></span>
        </button>
        <div class="tap-hint"><span class="lbl">Elke tik</span><b>+1</b>teug</div>
      </div>
      ${byLine(u, sc)}
      <div class="quick">${[1, 2, 3, 4, 5, 6].map((n) => `<button class="chip ${!sc.dnf && sips === n ? 'on' : ''}" data-act="sip-set" data-n="${n}">${n === 1 ? '1× 🎯' : n}</button>`).join('')}</div>
      <button class="chip wide ${sc.dnf ? 'on bad' : ''}" data-act="dnf">🚫 Niet opgedronken (+${dnfExtra()} punten)</button>
      ${h.task ? `<h4>Opdracht</h4>
        <p class="task-t">🎯 ${esc(h.task)}</p>
        <div class="duo"><button class="chip ${sc.task === 'w' ? 'on good' : ''}" data-act="task" data-v="w">✅ Gelukt ${fmtMod(+h.win || 0)}</button>
          <button class="chip ${sc.task === 'l' ? 'on bad' : ''}" data-act="task" data-v="l">❌ Mislukt ${fmtMod(+h.lose || 0)}</button></div>` : ''}
      <h4>Strafpunten</h4>
      <div class="chips">${allPens.map((pn, i) => `<button class="chip ${i < holePens(h).length ? 'here' : ''}" data-act="pen-add" data-i="${i}">+${+pn.n || 1} ${esc(pn.l)}</button>`).join('')}
        <button class="chip" data-act="pen-add" data-i="-1">+1 Anders</button></div>
      ${pens.length ? `<div class="pens">${pens.map((pn, i) => `<span class="pen">+${+pn.n || 0} ${esc(pn.l)} <button data-act="pen-del" data-i="${i}" aria-label="Verwijder">✕</button></span>`).join('')}</div>` : ''}
      <div class="result ${term && !needTask ? term.cls : ''}">${term == null ? '<span>Nog geen teugen geteld</span>'
        : needTask ? '<span>Kies nog of de opdracht gelukt is</span>'
        : `<b>${esc(term.t)}</b><span>${pts(preview)}</span>`}</div>
      <button class="btn big" data-act="score-done" ${preview == null || needTask ? 'disabled' : ''}>${sc.done ? 'Klaar ✓' : 'Glas leeg — score opslaan ✓'}</button>
      ${allowed && !sc.done ? `<button class="btn ghost" data-act="skip" ${left > 0 ? '' : 'disabled'}>Deze hole overslaan (nog ${Math.max(0, left)} van ${allowed})</button>` : ''}
    </section>`;
  }
  function scoreSummary(h, uidKey, info, sc) {
    const u = unitById(uidKey);
    const lock = locked(sc);
    const edBy = sc.ed && sc.ed.by ? (sc.ed.by === 'org' ? 'de organisator' : (S.data.players[sc.ed.by] || {}).name || 'iemand') : '';
    const foot = lock ? LOCK_NOTE : (isOrg() || !EDIT_MIN ? '' : `<p class="mut small center">Aanpassen kan tot ${EDIT_MIN} minuten na het opslaan, daarna alleen door de organisator.</p>`);
    if (sc.skip) {
      return `<section class="card score saved">
        <h3>${scoreTitle(u)}</h3>
        <div class="saved-row"><div class="saved-n">–</div>
          <div class="saved-t"><b>Overgeslagen</b><span>telt als 0 punten · ${skipsUsed(uidKey)} van ${skipsAllowed(uidKey)} gebruikt</span></div></div>
        ${lock || !canScore(uidKey) ? '' : '<button class="btn ghost" data-act="unskip">Toch spelen</button>'}${foot}
      </section>`;
    }
    const st = strokesOf(sc, info.par, h);
    const term = termFor(sc, st, info.par, h);
    const pen = penTotal(sc);
    const mod = taskMod(h, sc);
    const n = sipsOf(sc);
    return `<section class="card score saved ${term.cls}">
      <h3>${scoreTitle(u)}</h3>
      <div class="saved-row"><div class="saved-n">${st}</div>
        <div class="saved-t"><b>${esc(term.t)}</b>
          <span>${n === 1 ? '1 teug' : n + ' teugen'}${sc.dnf ? ' + ' + dnfExtra() + ' niet opgedronken' : ''}${pen ? ' + ' + pen + ' straf' : ''}${h.task && sc.task ? ' · opdracht ' + (sc.task === 'w' ? 'gelukt ' : 'mislukt ') + fmtMod(mod) : ''}</span></div>
        <div class="rel big par">${st === 1 ? 'punt' : 'punten'}</div></div>
      ${byLine(u, sc)}
      ${edBy ? `<p class="mut small">✏️ Na het opslaan aangepast door ${esc(edBy)}.</p>` : ''}
      ${lock || !canScore(uidKey) ? '' : '<button class="btn ghost" data-act="score-edit">Aanpassen</button>'}${foot}
    </section>`;
  }
  function viewHole(h) {
    const list = holesList();
    const idx = list.findIndex((x) => x.id === h.id);
    const tu = targetUnit();
    const info = holeInfo(h, tu);
    const sc = scoreOf(tu, h.id) || {};
    const units = unitsList();
    const pinned = S.data.meta && S.data.meta.current === h.id;
    const hp = holePens(h);
    let html = `<div class="subbar">
      <button class="icon" data-act="back" aria-label="Terug">${ico('back')}Holes</button>
      <span>Hole ${idx + 1} van ${list.length}</span>
      <span class="nav"><button class="icon" data-act="hole-nav" data-d="-1" ${idx <= 0 ? 'disabled' : ''} aria-label="Vorige">${ico('back')}</button>
      <button class="icon" data-act="hole-nav" data-d="1" ${idx >= list.length - 1 ? 'disabled' : ''} aria-label="Volgende">${ico('chev')}</button></span></div>`;

    html += `<section class="hero">
      <div class="hero-no">${idx + 1}</div>
      <h2>${esc(h.name || 'Hole ' + (idx + 1))}</h2>
      ${h.addr ? `<a class="addr" href="${esc(navUrl(h))}" target="_blank" rel="noopener">${ico('pin')}${esc(h.addr)} · <u>Navigeer</u></a>` : ''}
      ${h.off ? '<div class="hero-pen">Deze kroeg vervalt en telt niet mee.</div>' : `<div class="tiles"><div class="tile"><span class="lbl">Drankje</span><b>${h.type === 'wheel' ? '🎡 ' + (info.drink && !info.needSpin ? esc(info.drink) : 'Het rad') : drinkIcon(h.drink) + ' ' + esc(h.drink || 'Drankje')}</b></div></div>`}
      ${h.task && !h.off ? `<div class="hero-task"><b>🎯 Opdracht: ${esc(h.task)}</b><span>Gelukt ${fmtMod(+h.win || 0)} · Mislukt ${fmtMod(+h.lose || 0)}</span></div>` : ''}
      ${hp.length && !h.off ? `<div class="hero-pen">⚠️ Straf hier: ${hp.map((x) => esc(x.l) + ' +' + (+x.n || 1)).join(' · ')}</div>` : ''}
      ${h.note ? `<p class="hero-note">${esc(h.note)}</p>` : ''}
      ${pinned ? '<span class="badge">📍 Hier zijn we nu</span>' : ''}
      ${isOrg() ? `<div class="chips center">${pinned || h.off ? '' : `<button class="chip" data-act="hole-pin">${ico('pin')} Maak actief</button>`}
        <button class="chip" data-act="hole-edit" data-id="${h.id}">${ico('edit')} Bewerken</button></div>` : ''}
    </section>`;
    if (h.off) return html;

    if (isOrg() && units.length > 1) {
      html += `<div class="who"><span class="mut small">Score invullen voor</span><div class="chips scroll">
        ${units.map((u) => `<button class="chip ${u.id === tu ? 'on' : ''}" data-act="pick-unit" data-id="${u.id}">${esc(u.emoji)} ${esc(u.name)}</button>`).join('')}</div></div>`;
    }

    const skipped = !!(sc.skip && sc.done);
    if (h.type === 'wheel' && !skipped) {
      const sp = spinOf(h, tu);
      const ws = wheelState(h, tu);
      const opts = sp ? spinOpts(sp, h) : ws.opts;
      const key = h.id + '/' + spinKey(h, tu);
      const step = opts.length ? 360 / opts.length : 360;
      const rot = sp && opts.length ? (ui.wheelRot[key] != null ? ui.wheelRot[key] : -((+sp.i || 0) + 0.5) * step) : 0;
      const group = h.wheelMode === 'group';
      const maySpin = group ? !!(meP() || isOrg()) : canScore(tu);
      const anyDone = group ? units.some((u) => { const x = scoreOf(u.id, h.id); return x && x.done && !x.skip; }) : !!sc.done;
      const naRows = naList(h.id);
      html += `<section class="card wheel-card">
        <h3>Het rad</h3>
        <p class="mut small">${group ? 'Eén draai geldt voor de hele groep.' : (units.some((u) => u.team) ? 'Elk team draait voor z\'n eigen drankje.' : 'Iedereen draait zelf voor z\'n eigen drankje.')}</p>
        ${opts.length ? `<div class="wheel-box"><div class="pointer"></div>${wheelSvg(opts, rot)}</div>` : '<div class="empty">Er staat niets meer op dit rad. De organisator kan de kroeg aanpassen.</div>'}
        ${sp
          ? `<div class="spin-result"><span>${group ? 'Het drankje is' : (tu === myUnit() ? (unitById(tu).team ? 'Jullie drankje' : 'Jouw drankje') : 'Drankje van ' + esc((unitById(tu) || {}).name))}</span>
              <b>${drinkIcon(sp.label)} ${esc(sp.label)}</b></div>
              ${maySpin && !anyDone ? '<button class="btn ghost" data-act="drink-na">Dit drankje is er niet</button>' : ''}
              ${isOrg() ? '<button class="btn ghost" data-act="spin-reset">Opnieuw laten draaien</button>' : ''}`
          : maySpin && opts.length
            ? '<button class="btn big spin-btn" data-act="spin">Draai aan het rad!</button>'
            : ''}
        ${!sp && opts.length ? `<p class="wheel-legend">${opts.map((o) => esc(o.label)).join(' · ')}</p>` : ''}
        ${!sp && ws.reset ? '<p class="mut small">Alle drankjes zijn al een keer getrokken. Het rad begint opnieuw.</p>' : ''}
        ${!sp && ws.used.length ? `<p class="mut small used">Al gehad en van het rad: ${ws.used.map(esc).join(', ')}.</p>` : ''}
        ${naRows.length ? `<p class="mut small na">Hier niet verkrijgbaar: ${naRows.map((x) => esc(x.l) + (isOrg() ? ` <button class="linkbtn" data-act="na-del" data-id="${x.id}">terugzetten</button>` : '')).join(', ')}.</p>` : ''}
      </section>`;
    }

    const allowed = skipsAllowed(tu);
    if (tu && skipped && !ui.editing) {
      html += scoreSummary(h, tu, info, sc);
    } else if (tu && info.par != null) {
      const show = sc.done && (!ui.editing || locked(sc));
      html += show || !canScore(tu) ? (sc.done ? scoreSummary(h, tu, info, sc) : '') : scoreEditor(h, tu, info, sc);
    } else if (tu && h.type === 'wheel') {
      html += `<section class="card"><p class="mut">Draai eerst aan het rad, daarna kun je je teugen tellen.</p>
        ${allowed && canScore(tu) ? `<button class="btn ghost" data-act="skip" ${allowed - skipsUsed(tu) > 0 ? '' : 'disabled'}>Deze hole overslaan (nog ${Math.max(0, allowed - skipsUsed(tu))} van ${allowed})</button>` : ''}</section>`;
    } else if (!tu) {
      html += '<section class="card"><p class="mut">Je kijkt alleen mee. Doe mee via <b>Meer → Meedoen</b> om scores in te vullen.</p></section>';
    }

    html += `<section class="card"><h3>Iedereen op deze hole</h3><div class="plist">`;
    if (!units.length) html += '<p class="mut">Nog geen spelers.</p>';
    units.forEach((u) => {
      const pi = holeInfo(h, u.id);
      const ps = scoreOf(u.id, h.id);
      const st = strokesOf(ps, pi.par, h);
      let right = '<span class="mut">—</span>', sub = '';
      if (ps && ps.skip && ps.done) {
        right = '<span class="rel">overgeslagen</span>';
        sub = 'telt als 0 punten';
      } else if (st != null) {
        const term = termFor(ps, st, pi.par, h);
        right = `<b>${st}</b><span class="rel par">${st === 1 ? 'punt' : 'punten'}</span>`;
        sub = term.t + (h.type === 'wheel' ? ' · ' + pi.drink : '') + (h.task && ps.task ? ' · opdracht ' + (ps.task === 'w' ? 'gelukt' : 'mislukt') : '') + (ps.ed ? ' · aangepast' : '');
      } else if (ps && (sipsOf(ps) > 0 || ps.dnf)) {
        sub = 'bezig… ' + sipsOf(ps) + (sipsOf(ps) === 1 ? ' teug' : ' teugen');
        right = '<span class="busy">🍺</span>';
      } else if (h.type === 'wheel' && pi.drink) {
        sub = pi.drink;
      }
      html += `<div class="prow ${u.id === myUnit() ? 'me' : ''}" ${isOrg() ? `data-act="pick-unit" data-id="${u.id}" role="button"` : ''}>
        <span class="av ${u.team ? 'duo' : ''}">${esc(u.emoji)}</span>
        <span class="pn"><b>${esc(u.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
        <span class="pr">${right}</span></div>`;
    });
    html += '</div></section>';
    return html;
  }

  function viewMap() {
    const list = holesList();
    const cur = currentHoleId();
    const missing = list.filter((h) => h.addr && !hasGeo(h)).length;
    let html = `<div id="map-slot" class="map-slot"></div>
      <div class="btnrow"><button class="btn ghost" data-act="locate">${ico('pin')} Waar ben ik?</button><button class="btn ghost" data-act="map-fit">Hele route</button></div>`;
    if (missing) {
      html += `<p class="mut small center">${missing === 1 ? 'Eén kroeg staat' : missing + ' kroegen staan'} nog niet op de kaart.
        ${geoBusy ? 'Adressen opzoeken…' : '<button class="linkbtn" data-act="geo-all">Adressen opzoeken</button>'}</p>`;
    }
    html += '<section class="card"><h3>Route in volgorde</h3><div class="route">';
    if (!list.length) html += '<p class="mut">Nog geen kroegen.</p>';
    list.forEach((h, i) => {
      html += `<div class="rt ${h.id === cur ? 'cur' : ''}">
        <button class="rt-main" data-act="open-hole" data-id="${h.id}"><span class="rt-no">${i + 1}</span>
          <span class="pn"><b>${esc(h.name || 'Hole ' + (i + 1))}</b><small>${esc(h.addr || 'geen adres')}</small></span></button>
        <a class="mini" href="${esc(navUrl(h))}" target="_blank" rel="noopener" aria-label="Navigeer naar ${esc(h.name || '')}">${ico('nav')}</a></div>`;
    });
    html += '</div></section>';
    return html;
  }

  function viewBoard() {
    const rows = ranking();
    if (!rows.length) return '<div class="empty">Nog geen spelers.</div>';
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    const nHoles = liveHoles().length;
    const started = rows.filter((r) => r.n > 0);
    const pod = started.length >= 3 ? started.slice(0, 3) : [];
    const mine = myUnit();
    let html = '';
    if (pod.length) {
      html += `<div class="podium">${[pod[1], pod[0], pod[2]].map((r) => `<div class="pod p${pod.indexOf(r) + 1} ${r.u.id === mine ? 'me' : ''}" data-flip="${r.u.id}">
        <div class="pod-av ${r.u.team ? 'duo' : ''}">${esc(r.u.emoji)}</div>
        <b class="pod-name">${esc(r.u.name)}</b>
        <span class="rel big par">${pts(r.str)}</span>
        <small>${r.n}/${nHoles} holes${r.hio ? ' · ' + '🎯'.repeat(Math.min(r.hio, 3)) : ''}</small>
        <div class="pod-step">${r.rank}</div></div>`).join('')}</div>`;
    }
    html += '<div class="board">';
    rows.filter((r) => !pod.includes(r)).forEach((r) => {
      html += `<div class="brow ${r.u.id === mine ? 'me' : ''} ${r.rank === 1 ? 'lead' : ''}" data-flip="${r.u.id}">
        <div class="rank">${r.rank ? (!pod.length && medals[r.rank]) || r.rank : '–'}</div>
        <div class="av big ${r.u.team ? 'duo' : ''}">${esc(r.u.emoji)}</div>
        <div class="bmain"><b>${esc(r.u.name)}</b>
          <small>${r.n ? `${pts(r.str)} · ${r.n}/${nHoles} holes${r.skips ? ' · ' + r.skips + ' overgeslagen' : ''}${r.hio ? ' · ' + '🎯'.repeat(Math.min(r.hio, 5)) : ''}` : 'nog niet gestart'}</small></div>
        <div class="rel huge par">${r.n ? r.str : '–'}</div>
      </div>`;
    });
    html += `</div><p class="mut small center">Elke teug is 1 punt. De minste punten staan bovenaan; wie aan het eind de meeste punten heeft, verliest${rows.some((r) => skipsAllowed(r.u.id)) ? '. Een overgeslagen hole telt als 0 punten' : ''}.</p>`;
    return html;
  }

  function viewCard() {
    const holes = holesList();
    const rows = ranking();
    if (!holes.length || !rows.length) return '<div class="empty">Nog niets om te tonen.</div>';
    const mine = myUnit();
    let html = '<div class="card-scroll"><table class="sc"><thead><tr><th class="sticky">Hole</th>';
    holes.forEach((h, i) => { html += `<th class="${h.off ? 'offcol' : ''}">${i + 1}</th>`; });
    html += '<th>Tot</th></tr></thead><tbody>';
    rows.forEach((r) => {
      html += `<tr class="${r.u.id === mine ? 'me' : ''}"><th class="sticky">${esc(r.u.emoji)} ${esc(r.u.name)}</th>`;
      holes.forEach((h) => {
        const info = holeInfo(h, r.u.id);
        const sc = scoreOf(r.u.id, h.id);
        const st = h.off ? null : strokesOf(sc, info.par, h);
        if (st == null) { html += '<td class="nil">·</td>'; return; }
        if (sc.skip) { html += '<td><span class="cell skip">–</span></td>'; return; }
        const cls = sc.dnf ? 'dnf' : isOneGo(sc, h) ? 'hio' : 'even';
        html += `<td><span class="cell ${cls}">${st}</span></td>`;
      });
      html += `<td class="tot">${r.n ? r.str : '·'}</td></tr>`;
    });
    html += `</tbody></table></div>
      <div class="legend"><span><i class="cell hio">1</i> in één keer leeg</span><span><i class="cell even">3</i> punten</span>
      <span><i class="cell dnf">7</i> niet leeg</span><span><i class="cell skip">–</i> overgeslagen (0)</span></div>`;
    return html;
  }

  function shareUrl() {
    const p = [];
    if (!LOCAL && DB && DB !== CFG_DB) p.push('db=' + encodeURIComponent(DB));
    if (GAME && GAME !== CFG_GAME) p.push('g=' + GAME);
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
      html += `<section class="card"><h3>Lokaal spel</h3>
        <p class="mut">Dit spel staat alleen op dit toestel. Voeg hieronder spelers toe en vul alle scores hier in, of koppel een database zodat iedereen op z'n eigen telefoon meedoet.</p>
        <button class="btn ghost" data-act="change-db">Database koppelen</button></section>`;
    } else {
      html += `<section class="card invite"><h3>Nodig iedereen uit</h3>
        <p class="gcode">Spelcode <b>${esc(GAME.toUpperCase())}</b></p>
        <p class="mut small">Laat de QR-code scannen, deel de link in de groepsapp, of laat iedereen de spelcode invullen in de lobby.</p>
        <div class="qr">${qrSvg(link)}</div>
        <div class="link">${esc(link)}</div>
        <div class="btnrow"><button class="btn" data-act="share">Deel link</button><button class="btn ghost" data-act="copy">Kopieer</button></div></section>`;
    }
    const solo = soloSkips();
    html += `<section class="card"><h3>Spelregels</h3>
      <ul class="rules">
        <li>Elke kroeg is een hole met een drankje. <b>Elke teug is 1 punt.</b> De minste punten staan bovenaan; wie aan het eind de meeste punten heeft, verliest.</li>
        <li>Een <b>team</b> deelt één glas en drinkt het samen leeg. Elke teug telt, wie hem ook neemt: twee keer een kwart en twee keer een kwart is vier teugen.</li>
        ${solo ? `<li>Wie <b>solo</b> speelt mag ${solo} holes naar keuze overslaan. Een overgeslagen hole telt als 0 punten.</li>` : ''}
        <li>Staat er een <b>rad</b> bij de hole, dan bepaalt het rad het drankje.${wheelOnce() ? ' Een drankje dat je al trok verdwijnt van jouw rad.' : ''} Is het drankje er niet, meld dat dan en draai opnieuw.</li>
        <li>Bij sommige kroegen hoort een <b>opdracht</b>, zoals Split the G: gelukt gaat van je punten af, mislukt komt erbij.</li>
        <li>Glas niet leeg? Dan krijg je je teugen + ${dnfExtra()} punten.</li>
        ${penList().length ? `<li>Strafpunten: ${penList().map((p) => esc(p.l) + ' +' + (+p.n || 1)).join(', ')}.</li>` : ''}
        <li><b>Eerlijk spelen:</b> je vult alleen de score van je eigen team in. ${EDIT_MIN ? 'Tot ' + EDIT_MIN + ' minuten na het opslaan kun je nog iets herstellen, daarna' : 'Na het opslaan'} kan alleen de organisator een score aanpassen, en dat is voor iedereen zichtbaar.</li>
      </ul></section>`;
    html += `<section class="card"><h3>Jij</h3>`;
    if (me) {
      const u = unitById(myUnit());
      const mates = u ? u.members.filter((p) => p.id !== pid).map((p) => p.name) : [];
      const allowed = skipsAllowed(myUnit());
      html += `<div class="prow"><span class="av big">${esc(me.emoji || '🍺')}</span><span class="pn"><b>${esc(me.name)}</b>
          <small>${isOrg() ? 'Organisator' : 'Speler'} · ${u && u.team ? esc(u.name) + (mates.length ? ' (met ' + esc(mates.join(', ')) + ')' : '') : 'solo' + (allowed ? ', mag ' + allowed + ' holes overslaan' : '')}</small></span></div>
        <div class="btnrow"><button class="btn ghost" data-act="profile">Profiel wijzigen</button><button class="btn ghost" data-act="logout">Wissel speler</button></div>`;
    } else {
      html += '<p class="mut">Je kijkt alleen mee en kunt niets aanpassen.</p><button class="btn" data-act="logout">Meedoen</button>';
    }
    html += '</section>';
    html += '<section class="card"><h3>Organisator</h3>';
    if (isOrg()) {
      html += `<p class="mut small">Als organisator deel je de teams in, pas je kroegen en het rad aan en kun je elke score corrigeren.</p>
        <div class="stack">
          <button class="btn ghost" data-act="teams">Teams indelen</button>
          <button class="btn ghost" data-act="settings">Spelinstellingen en strafpunten</button>
          <button class="btn ghost" data-act="wheel-edit">Het rad instellen</button>
          <button class="btn ghost" data-act="player-add">Speler toevoegen (zonder telefoon)</button>
          <button class="btn ghost" data-act="players">Spelers beheren</button>
          <button class="btn ghost" data-act="unpin">Actieve hole loslaten</button>
          <button class="btn ghost danger" data-act="reset-scores">Alle scores wissen</button>
          ${LOCAL ? '' : '<button class="btn ghost" data-act="org-off">Organisator-modus uit</button>'}
        </div>`;
    } else {
      html += '<p class="mut small">Alleen de organisator kan teams, kroegen en het rad aanpassen en scores van anderen corrigeren.</p><button class="btn ghost" data-act="org-on">Ontgrendel met pincode</button>';
    }
    html += '</section>';
    const st = statusInfo();
    html += `<section class="card"><h3>Verbinding</h3>
      <p class="mut small">${LOCAL ? 'Lokaal spel, alles blijft op dit toestel.' : `Status: <b>${st.txt}</b>${S.err ? ' · ' + esc(S.err) : ''}. Scores die je zonder bereik invult worden bewaard en verstuurd zodra er weer verbinding is.`}</p>
      <div class="btnrow"><button class="btn ghost" data-act="reload">Ververs</button><button class="btn ghost" data-act="to-lobby">Naar de lobby</button></div>
      <p class="mut tiny">Spelcode: ${esc(GAME.toUpperCase())}. In de lobby start je een nieuw spel of open je een ander spel.</p></section>`;
    return html;
  }

  function viewMain() {
    const hole = ui.hole ? holeById(ui.hole) : null;
    if (ui.hole && !hole) ui.hole = null;
    const st = statusInfo();
    const tabs = [['holes', 'flag', 'Holes'], ['map', 'map', 'Kaart'], ['board', 'trophy', 'Stand'], ['card', 'grid', 'Scores'], ['more', 'more', 'Meer']];
    let body;
    if (hole) body = viewHole(hole);
    else if (ui.tab === 'map') body = viewMap();
    else if (ui.tab === 'board') body = viewBoard();
    else if (ui.tab === 'card') body = viewCard();
    else if (ui.tab === 'more') body = viewMore();
    else body = viewHoles();
    return `<header class="top"><div class="brand"><span class="brand-mark">${ico('flag')}</span><b>${esc(title())}</b></div>
        <button class="status ${st.cls}" data-act="status"><i></i>${st.txt}</button></header>
      <main class="view ${hole ? 'v-hole' : 'v-' + ui.tab}">${body}</main>
      <div class="tabfade"></div>
      <nav class="tabs">${tabs.map((t) => `<button class="${!hole && ui.tab === t[0] ? 'on' : ''}" data-act="tab" data-tab="${t[0]}">${ico(t[1])}<span>${t[2]}</span></button>`).join('')}</nav>`;
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

    let key;
    if (!DB) key = 'setup';
    else if (!GAME) key = ui.wiz ? 'wiz:' + ui.wiz.step : 'lobby';
    else if (!S.loaded && !S.data.meta) key = 'loading';
    else if (!S.data.meta) key = 'missing';
    else if (!meP() && !S.spectator) key = 'join';
    else {
      if (ui.hole && !S.data.holes[ui.hole]) ui.hole = null;
      key = ui.hole ? 'hole:' + ui.hole : 'tab:' + ui.tab;
    }
    // Op het kaart-tabblad alleen de punten bijwerken, zodat de kaart niet verspringt terwijl je sleept.
    if (!force && key === 'tab:map' && lastKey === key && map && mapEl && mapEl.isConnected) { syncMap(); paintStatus(); return; }
    const html = key === 'setup' ? viewSetup() : key === 'lobby' ? viewLobby() : key.startsWith('wiz:') ? viewWizard() : key === 'loading' ? viewLoading()
      : key === 'missing' ? viewMissing() : key === 'join' ? viewJoin() : viewMain();
    if (key === 'join' || key.startsWith('tab:') || key.startsWith('hole:')) {
      rememberGame();
      // De organisator zoekt ontbrekende adressen één keer automatisch op voor de kaart.
      if (!geoAuto && isOrg() && holesList().some((h) => h.addr && !hasGeo(h))) { geoAuto = true; setTimeout(() => geoFill(true), 300); }
    }
    const fresh = key !== lastKey;

    const keep = {};
    app.querySelectorAll('input[id],textarea[id]').forEach((el) => { keep[el.id] = el.value; });
    const focusId = typing && ae.id ? ae.id : null;
    // Posities onthouden zodat rijen in de stand naar hun nieuwe plek kunnen schuiven.
    const was = {};
    if (!fresh) app.querySelectorAll('[data-flip]').forEach((el) => { was[el.dataset.flip] = el.getBoundingClientRect(); });
    if (fresh) ui.scroll[lastKey] = window.scrollY;
    app.innerHTML = html;
    for (const id in keep) { const el = document.getElementById(id); if (el) el.value = keep[id]; }
    if (focusId) { const el = document.getElementById(focusId); if (el) el.focus({ preventScroll: true }); }
    if (key === 'tab:map') mountMap();
    document.body.classList.toggle('start', !key.startsWith('tab:') && !key.startsWith('hole:'));
    if (fresh) {
      const view = app.querySelector('.view, .center-screen, .wiz');
      if (view) view.classList.add('enter');
      window.scrollTo(0, key.startsWith('tab:') ? ui.scroll[key] || 0 : 0);
      lastKey = key;
    } else {
      app.querySelectorAll('[data-flip]').forEach((el) => {
        const from = was[el.dataset.flip];
        if (!from) return;
        const to = el.getBoundingClientRect();
        const dx = from.left - to.left, dy = from.top - to.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        el.style.zIndex = 2;
        requestAnimationFrame(() => {
          el.style.transition = 'transform 0.55s cubic-bezier(0.2, 0.8, 0.2, 1)';
          el.style.transform = '';
          setTimeout(() => { el.style.zIndex = ''; el.style.transition = ''; }, 600);
        });
      });
    }
    // De ring van de teller loopt vloeiend van de vorige stand naar de nieuwe.
    const ring = app.querySelector('.ring-fg');
    if (ring) {
      const to = ring.getAttribute('stroke-dashoffset');
      const id = ui.hole + '/' + targetUnit();
      if (ui.ring && ui.ring.id === id && ui.ring.v !== to) {
        ring.style.transition = 'none';
        ring.style.strokeDashoffset = ui.ring.v;
        void ring.getBoundingClientRect();
        ring.style.transition = '';
        ring.style.strokeDashoffset = to;
      }
      ui.ring = { id, v: to };
    }
    if (ui.bump) { ui.bump = false; const tap = app.querySelector('.tap'); if (tap) tap.classList.add('pop'); }
    document.title = title();
  }
  document.addEventListener('focusout', () => { if (dirty) setTimeout(render, 80); });

  // ------------------------------------------------------------ sheets
  function openSheet(html) {
    // Staat er al een sheet open, dan wordt alleen de inhoud vervangen (bijv. na een keuze in het teamscherm).
    const old = $('.sheet');
    const top = old ? old.scrollTop : 0;
    $('#sheet-root').innerHTML = `<div class="backdrop" data-act="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.classList.add('sheet-open');
    if (old) { const el = $('.sheet'); el.style.animation = 'none'; el.scrollTop = top; }
    if (!(history.state && history.state.sheet)) history.pushState({ hole: ui.hole, sheet: 1 }, '');
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
    const d = h || { name: '', addr: '', type: 'fixed', drink: '', par: 3, wheelMode: 'player', note: '' };
    const own = ownWheel(d);
    const opts = own.length ? own : gameWheel();
    openSheet(`<h2>${h ? 'Kroeg bewerken' : 'Nieuwe kroeg'}</h2>
      <label class="field"><span>Kroeg</span><input id="h-name" type="text" maxlength="40" value="${esc(d.name)}" placeholder="Naam van de kroeg"></label>
      <label class="field"><span>Adres (voor de kaart)</span><input id="h-addr" type="text" maxlength="80" value="${esc(d.addr || '')}" placeholder="bijv. Melkmarkt 37"></label>
      <h4>Drankje</h4>
      <div class="seg" id="h-type" data-v="${d.type === 'wheel' ? 'wheel' : 'fixed'}">
        <button data-act="seg" data-v="fixed" class="${d.type === 'wheel' ? '' : 'on'}">🍺 Vast drankje</button>
        <button data-act="seg" data-v="wheel" class="${d.type === 'wheel' ? 'on' : ''}">🎡 Rad</button></div>
      <div class="when when-fixed">
        <label class="field"><span>Drankje</span><input id="h-drink" type="text" maxlength="30" value="${esc(d.drink || '')}" placeholder="bijv. Biertje"></label>
      </div>
      <div class="when when-wheel">
        <div class="seg" id="h-mode" data-v="${d.wheelMode === 'group' ? 'group' : 'player'}">
          <button data-act="seg" data-v="player" class="${d.wheelMode === 'group' ? '' : 'on'}">Ieder draait zelf</button>
          <button data-act="seg" data-v="group" class="${d.wheelMode === 'group' ? 'on' : ''}">Eén draai voor de groep</button></div>
        <div class="seg" id="h-wsrc" data-v="${own.length ? 'own' : 'game'}">
          <button data-act="seg" data-v="game" class="${own.length ? '' : 'on'}">Rad van het spel</button>
          <button data-act="seg" data-v="own" class="${own.length ? 'on' : ''}">Eigen rad voor deze kroeg</button></div>
        <p class="mut small when-game">Op het rad van het spel staat nu: ${gameWheel().map((o) => esc(o.label)).join(', ')}. Aanpassen kan via Meer → Het rad instellen.</p>
        <label class="field when-own"><span>Drankjes op het rad — één per regel</span>
          <textarea id="h-opts" rows="6" spellcheck="false">${esc(opts.map((o) => o.label).join('\n'))}</textarea></label>
      </div>
      <h4>Opdracht (optioneel)</h4>
      <label class="field"><span>Wat moet je doen?</span><input id="h-task" type="text" maxlength="60" value="${esc(d.task || '')}" placeholder="bijv. Split the G"></label>
      <div class="two">
        <label class="field"><span>Gelukt: punten eraf</span><input id="h-win" type="number" inputmode="numeric" min="0" max="20" value="${Math.abs(d.task ? +d.win || 0 : 2)}"></label>
        <label class="field"><span>Mislukt: punten erbij</span><input id="h-lose" type="number" inputmode="numeric" min="0" max="20" value="${Math.abs(d.task ? +d.lose || 0 : 2)}"></label>
      </div>
      <h4>Straffen bij deze kroeg (optioneel)</h4>
      <label class="field"><span>Eén per regel, met het aantal punten achter een komma</span>
        <textarea id="h-hp" rows="2" spellcheck="false" placeholder="bijv. Naar de wc, 2">${esc(holePens(d).map((x) => x.l + ', ' + (+x.n || 1)).join('\n'))}</textarea></label>
      <label class="field"><span>Opmerking (optioneel)</span><input id="h-note" type="text" maxlength="120" value="${esc(d.note || '')}" placeholder="bijv. Verzamelen op het terras"></label>
      ${h ? `<h4>Lukt deze kroeg niet?</h4>
      <button class="chip wide ${d.off ? 'on bad' : ''}" id="h-off" data-act="tog" data-v="${d.off ? 1 : 0}">Deze kroeg vervalt (dicht of te druk) en telt niet mee</button>` : ''}
      <p id="h-msg" class="msg"></p>
      <button class="btn big" data-act="hole-save" data-id="${h ? h.id : ''}">Opslaan</button>
      ${h ? `<button class="btn ghost danger" data-act="hole-del" data-id="${h.id}">Kroeg verwijderen</button>` : ''}
      <button class="btn ghost" data-act="sheet-close">Annuleren</button>`);
    syncSeg();
  }
  function syncSeg() {
    const t = $('#h-type');
    const sheet = $('.sheet');
    if (t && sheet) sheet.dataset.type = t.dataset.v;
    const w = $('#h-wsrc');
    if (w && sheet) sheet.dataset.wsrc = w.dataset.v;
  }
  function sheetSettings() {
    const m = S.data.meta || {};
    openSheet(`<h2>Spelinstellingen</h2>
      <label class="field"><span>Naam van het spel</span><input id="s-title" type="text" maxlength="40" value="${esc(m.title || '')}"></label>
      <label class="field"><span>Stad (voor de kaart en navigatie)</span><input id="s-city" type="text" maxlength="40" value="${esc(m.city || '')}" placeholder="bijv. Zwolle"></label>
      <label class="field"><span>Strafpunten bij "niet opgedronken" (bovenop de teugen)</span><input id="s-dnf" type="number" inputmode="numeric" min="0" max="20" value="${dnfExtra()}"></label>
      <label class="field"><span>Aantal holes dat een solospeler mag overslaan (als de rest in teams speelt)</span><input id="s-solo" type="number" inputmode="numeric" min="0" max="20" value="${soloSkips()}"></label>
      <button class="chip wide ${wheelOnce() ? 'on' : ''}" id="s-once" data-act="tog" data-v="${wheelOnce() ? 1 : 0}">Een getrokken drankje verdwijnt van het rad</button>
      <label class="field"><span>Strafpunten — één per regel, met het aantal achter een komma</span>
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
      ${LOCAL ? '' : '<label class="field"><span>Nieuwe pincode (leeg laten = niet wijzigen)</span><input id="p-pin" type="text" inputmode="numeric" maxlength="6" autocomplete="off"></label><p id="p-msg" class="msg"></p>'}
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
  const wheelPreview = (opts) => (opts.length >= 2 ? '<div class="pointer"></div>' + wheelSvg(opts, 0) : '<div class="empty">Zet minstens twee drankjes op het rad.</div>');
  function sheetWheel() {
    const opts = gameWheel();
    const used = holesList().filter((h) => h.type === 'wheel' && !ownWheel(h).length).map((h) => h.name);
    openSheet(`<h2>Het rad</h2>
      <p class="mut small">Zet het rad klaar voordat jullie beginnen. Het geldt voor elke kroeg waar je bij het drankje voor "Rad" kiest.
        ${used.length ? 'Nu in gebruik bij: ' + esc(used.join(', ')) + '.' : 'Nog bij geen enkele kroeg in gebruik: kies bij een kroeg "Rad" als drankje.'}</p>
      <div class="wheel-box small" id="w-prev">${wheelPreview(opts)}</div>
      <label class="field"><span>Eén drankje per regel</span>
        <textarea id="w-opts" rows="7" spellcheck="false">${esc(opts.map((o) => o.label).join('\n'))}</textarea></label>
      <p id="w-msg" class="msg"></p>
      <button class="btn big" data-act="wheel-save">Opslaan</button>
      <button class="btn ghost" data-act="sheet-close">Annuleren</button>`);
  }
  function sheetTeams() {
    const players = playersList();
    const teams = teamsList();
    const solo = soloSkips();
    const names = (t) => players.filter((p) => p.team === t.id).map((p) => p.name).join(' & ');
    const label = (t, i) => t.name || 'Team ' + (i + 1) + (names(t) ? ' · ' + names(t) : '');
    openSheet(`<h2>Teams</h2>
      <p class="mut small">Een team deelt één glas en één score. Wie in geen team zit speelt solo${solo ? ' en mag ' + solo + ' holes naar keuze overslaan' : ''}. Deel de teams in vóór de eerste hole.</p>
      <button class="btn ghost" data-act="team-auto">🎲 Willekeurig indelen in teams van 2</button>
      <h4>Spelers</h4>
      <div class="plist">${players.map((p) => `<div class="prow"><span class="av">${esc(p.emoji || '🍺')}</span><span class="pn"><b>${esc(p.name)}</b></span>
        <select class="sel" data-change="team-set" data-id="${p.id}" aria-label="Team van ${esc(p.name)}">
          <option value="">Solo</option>${teams.map((t, i) => `<option value="${t.id}" ${p.team === t.id ? 'selected' : ''}>${esc(label(t, i))}</option>`).join('')}
          <option value="new">+ Nieuw team</option></select></div>`).join('') || '<p class="mut">Nog geen spelers. Laat iedereen eerst meedoen via de link.</p>'}</div>
      ${teams.length ? `<h4>Teamnamen (optioneel)</h4>
        ${teams.map((t, i) => `<div class="prow"><input class="tname" type="text" maxlength="24" data-change="team-name" data-id="${t.id}" value="${esc(t.name || '')}" placeholder="${esc(names(t) || 'Team ' + (i + 1))}" aria-label="Naam van team ${i + 1}">
          <button class="mini danger" data-act="team-del" data-id="${t.id}" aria-label="Team verwijderen">🗑️</button></div>`).join('')}` : ''}
      <button class="btn big" data-act="sheet-close">Klaar</button>`);
  }
  function sheetClaim(pid) {
    const p = S.data.players[pid];
    if (!p) return;
    openSheet(`<h2>${esc(p.emoji || '🍺')} ${esc(p.name)}</h2>
      <p class="mut small">${p.pin ? 'Vul de pincode in die je bij het meedoen koos. Kwijt? De organisator-pincode werkt ook.' : 'Deze speler is door de organisator toegevoegd. Vul de organisator-pincode in om als deze speler verder te gaan.'}</p>
      <label class="field"><span>Pincode</span><input id="c-pin" type="text" inputmode="numeric" maxlength="8" autocomplete="off"></label>
      <p id="c-msg" class="msg"></p>
      <button class="btn big" data-act="claim-check" data-id="${pid}">Verder als ${esc(p.name)}</button>
      <button class="btn ghost" data-act="sheet-close">Annuleren</button>`);
    setTimeout(() => { const el = $('#c-pin'); if (el) el.focus(); }, 50);
  }
  function sheetPen() {
    openSheet(`<h2>Strafpunt</h2>
      <label class="field"><span>Waarvoor?</span><input id="x-l" type="text" maxlength="30" placeholder="bijv. Te hard gelachen"></label>
      <label class="field"><span>Aantal punten</span><input id="x-n" type="number" inputmode="numeric" min="1" max="20" value="1"></label>
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
    if (!on) { ui.uid = null; ui.editHoles = false; }
  }
  const pinHash = (pid, pin) => hashStr('pp:' + pid + ':' + pin);
  function addPlayer(name, emoji, guest, pin) {
    const pid = 'p' + uid(7);
    const p = { name: name.slice(0, 20), emoji: emoji || '🍺', t: now() };
    if (guest) p.guest = true;
    if (pin) p.pin = pinHash(pid, pin);
    write('players/' + pid, p);
    return pid;
  }
  /** Schrijft losse velden van de score van het gekozen team. Zo overschrijven twee telefoons elkaars invoer niet,
   *  en hier zitten ook de rechten: alleen het eigen team (of de organisator), en niet meer als de score op slot zit. */
  function setScore(fields) {
    const h = ui.hole ? holeById(ui.hole) : null;
    const u = targetUnit();
    if (!h || h.off || !u) return false;
    if (!canScore(u)) { toast('Je kunt alleen de score van je eigen team invullen.'); return false; }
    const sc = scoreOf(u, h.id);
    if (locked(sc)) { ui.editing = false; toast('Deze score staat op slot. Vraag de organisator.'); render(true); return false; }
    const base = 'scores/' + u + '/' + h.id + '/';
    for (const k in fields) write(base + k, fields[k]);
    if (sc && sc.done && fields.done !== null && !('dt' in fields)) write(base + 'ed', { by: scoreKey(u), t: now() });
    return true;
  }
  function openHole(id) {
    if (!S.data.holes[id]) return;
    ui.hole = id; ui.editing = false;
    if (map) map.closePopup();
    history.pushState({ hole: id }, '');
    render(true);
  }
  // Alleen de organisator mag deze acties uitvoeren, ook als iemand de knop op een andere manier weet te bereiken.
  const ORG_ONLY = new Set(['hole-pin', 'unpin', 'spin-reset', 'na-del', 'toggle-edit-holes', 'hole-add', 'hole-edit', 'hole-move', 'hole-save', 'hole-del',
    'settings', 'settings-save', 'player-add', 'player-add-save', 'players', 'player-del', 'reset-scores', 'wheel-edit', 'wheel-save',
    'teams', 'team-auto', 'team-del', 'pick-unit', 'geo-all']);

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
    'lobby-new'() { wizInit(); history.pushState({ wz: 0 }, ''); render(true); },
    async 'lobby-join'(el) {
      const code = cleanGame(val('in-code'));
      if (code.length < 2) { msg('lobby-msg', 'Vul de spelcode in.'); return; }
      el.disabled = true;
      msg('lobby-msg', 'Zoeken…');
      try {
        let found;
        if (LOCAL) found = !!LS.get(nsFor(code) + 'data', null);
        else {
          const res = await fetch(gameUrl(code, 'meta/created'), { cache: 'no-store' });
          if (!res.ok) { msg('lobby-msg', httpError(res.status)); el.disabled = false; return; }
          found = (await res.json()) != null;
        }
        if (!found) { msg('lobby-msg', 'Geen spel gevonden met code ' + code.toUpperCase() + '.'); el.disabled = false; return; }
        openGame(code);
      } catch (e) { msg('lobby-msg', 'Geen verbinding met de database.'); el.disabled = false; }
    },
    'lobby-open'(el) { openGame(cleanGame(el.dataset.g)); },
    'to-lobby'() { restart(); },
    'wiz'(el) {
      const w = ui.wiz;
      if (!w || w.busy) return;
      const act = el.dataset.do;
      const i = +el.dataset.i;
      w.msg = '';
      if (act === 'back') { history.back(); return; }
      if (act === 'create') { wizCreate(); return; }
      if (act === 'next') {
        if (w.step === 0 && !LOCAL && String(w.pin).trim().length < 3) w.msg = 'Kies een pincode van minstens 3 tekens.';
        else if (w.step === 1 && !w.pubs.some((x) => x.on)) w.msg = 'Kies minstens één kroeg.';
        else if (w.step === 3 && w.pubs.some((x) => x.on && x.type === 'wheel') && wizWheel().length < 2) w.msg = 'Zet minstens twee drankjes op het rad.';
        else { w.step++; history.pushState({ wz: w.step }, ''); }
      } else if (act === 'tog') w.pubs[i].on = !w.pubs[i].on;
      else if (act === 'all' || act === 'none') w.pubs.forEach((x) => { x.on = act === 'all'; });
      else if (act === 'up' || act === 'down') {
        const j = i + (act === 'up' ? -1 : 1);
        if (j >= 0 && j < w.pubs.length) { const x = w.pubs[i]; w.pubs[i] = w.pubs[j]; w.pubs[j] = x; }
      } else if (act === 'add') {
        const name = String(w.nn || '').trim();
        if (!name) w.msg = 'Vul de naam van de kroeg in.';
        else { w.pubs.push({ on: true, type: 'fixed', drink: '', par: 3, name: name.slice(0, 40), addr: String(w.na || '').trim().slice(0, 80) }); w.nn = ''; w.na = ''; }
      } else if (act === 'type') w.pubs[i].type = el.dataset.v === 'wheel' ? 'wheel' : 'fixed';
      else if (act === 'allfixed' || act === 'allwheel') w.pubs.forEach((x) => { if (x.on) x.type = act === 'allwheel' ? 'wheel' : 'fixed'; });
      else if (act === 'par') w.pubs[i].par = clamp((+w.pubs[i].par || 3) + +el.dataset.d, 1, 20);
      else if (act === 'wpar') w.wheel[i].par = clamp((Math.round(+w.wheel[i].par) || 1) + +el.dataset.d, 1, 20);
      else if (act === 'wdel') w.wheel.splice(i, 1);
      else if (act === 'wadd') w.wheel.push({ label: '', par: 3 });
      else if (act === 'once') w.once = !w.once;
      render(true);
    },
    'pick-emoji'(el) {
      ui.joinEmoji = el.dataset.e;
      el.parentNode.querySelectorAll('.emoji').forEach((b) => b.classList.toggle('on', b === el));
    },
    'join'() {
      const name = val('in-name');
      const pin = val('in-ppin');
      if (!name) { msg('join-msg', 'Vul eerst je naam in.'); return; }
      const dup = playersList().find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (dup) {
        if (LOCAL) setMe(dup.id); else { msg('join-msg', name + ' doet al mee. Ben jij dat? Log dan in met je pincode.'); sheetClaim(dup.id); return; }
      } else {
        if (!LOCAL && !/^\d{4,6}$/.test(pin)) { msg('join-msg', 'Kies een pincode van 4 cijfers.'); return; }
        setMe(addPlayer(name, ui.joinEmoji, false, LOCAL ? '' : pin));
      }
      ui.tab = 'holes';
      render(true);
    },
    'claim'(el) { if (LOCAL) { setMe(el.dataset.id); render(true); } else sheetClaim(el.dataset.id); },
    'claim-check'(el) {
      const pid = el.dataset.id;
      const p = S.data.players[pid];
      const pin = val('c-pin');
      const own = p && p.pin && pinHash(pid, pin) === p.pin;
      const org = S.data.meta && S.data.meta.pin && hashStr('pg:' + pin) === S.data.meta.pin;
      if (!p || !(own || org)) { msg('c-msg', 'Die pincode klopt niet.'); return; }
      setMe(pid);
      ui.tab = 'holes';
      closeSheet();
      render(true);
    },
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
    'pick-unit'(el) { ui.uid = el.dataset.id; ui.editing = false; render(true); },
    'hole-pin'() { write('meta/current', ui.hole); toast('Iedereen ziet nu deze hole als actief.'); },
    'unpin'() { write('meta/current', null); toast('Actieve hole losgelaten.'); },
    'spin'() { const h = holeById(ui.hole); if (h) doSpin(h); },
    'spin-reset'() {
      const h = holeById(ui.hole);
      if (!h) return;
      const key = spinKey(h, targetUnit());
      if (!key || !confirm('Deze draai wissen en opnieuw laten draaien?')) return;
      delete ui.wheelRot[h.id + '/' + key];
      write('spins/' + h.id + '/' + key, null);
    },
    'drink-na'() {
      // Het getrokken drankje is hier niet te krijgen: het gaat bij deze kroeg van het rad en er mag opnieuw gedraaid worden.
      const h = holeById(ui.hole);
      const u = targetUnit();
      if (!h || h.type !== 'wheel') return;
      const group = h.wheelMode === 'group';
      if (!(group ? meP() || isOrg() : canScore(u))) return;
      const sp = spinOf(h, u);
      const sc = scoreOf(u, h.id);
      if (!sp || (sc && sc.done)) return;
      if (!confirm('"' + sp.label + '" is hier niet te krijgen? Het verdwijnt bij deze kroeg van het rad, iedereen ziet de melding en je mag opnieuw draaien.')) return;
      const key = spinKey(h, u);
      delete ui.wheelRot[h.id + '/' + key];
      write('na/' + h.id + '/' + uid(6), { l: sp.label, by: S.me || '', t: now() });
      write('spins/' + h.id + '/' + key, null);
      toast(sp.label + ' is van het rad gehaald. Draai opnieuw.');
    },
    'na-del'(el) { write('na/' + ui.hole + '/' + el.dataset.id, null); },
    'sip'(el) {
      const u = targetUnit();
      const sc = scoreOf(u, ui.hole) || {};
      const by = sc.by || {};
      const d = +el.dataset.d;
      let key = scoreKey(u);
      if (d < 0 && !(+by[key] > 0)) {
        key = isOrg() ? Object.keys(by).find((k) => +by[k] > 0) : null;
        if (!key) { if (sipsOf(sc)) toast('Alleen je teamgenoot kan z\'n eigen teugen terugnemen.'); return; }
      }
      const fields = { ['by/' + key]: clamp((+by[key] || 0) + d, 0, 99) || null };
      if (sc.dnf) fields.dnf = null;
      buzz(12);
      ui.bump = true;
      setScore(fields);
    },
    'sip-set'(el) {
      // Totaal in één keer zetten: een teamlid past z'n eigen aandeel aan, de organisator overschrijft het totaal.
      const u = targetUnit();
      const sc = scoreOf(u, ui.hole) || {};
      const by = sc.by || {};
      const n = +el.dataset.n;
      const key = scoreKey(u);
      const fields = {};
      if (key === 'org') {
        fields.by = { org: n };
      } else {
        const others = sipsOf(sc) - (+by[key] || 0);
        if (n < others) { toast('Je teamgenoot heeft al ' + others + (others === 1 ? ' teug' : ' teugen') + ' geteld.'); return; }
        fields['by/' + key] = n - others || null;
      }
      if (sc.dnf) fields.dnf = null;
      buzz(12);
      ui.bump = true;
      setScore(fields);
    },
    'dnf'() { const sc = scoreOf(targetUnit(), ui.hole) || {}; setScore({ dnf: sc.dnf ? null : true }); },
    'task'(el) { setScore({ task: el.dataset.v === 'w' ? 'w' : 'l' }); },
    'pen-add'(el) {
      const i = +el.dataset.i;
      if (i < 0) { sheetPen(); return; }
      const pn = holePens(holeById(ui.hole)).concat(penList())[i];
      if (!pn) return;
      const sc = scoreOf(targetUnit(), ui.hole) || {};
      setScore({ pens: (sc.pens || []).filter(Boolean).concat([{ l: pn.l, n: +pn.n || 1 }]) });
    },
    'pen-custom-save'() {
      const l = val('x-l') || 'Strafpunt';
      const n = clamp(+val('x-n') || 1, 1, 20);
      const sc = scoreOf(targetUnit(), ui.hole) || {};
      setScore({ pens: (sc.pens || []).filter(Boolean).concat([{ l: l.slice(0, 30), n }]) });
      closeSheet();
    },
    'pen-del'(el) {
      const sc = scoreOf(targetUnit(), ui.hole) || {};
      const pens = (sc.pens || []).filter(Boolean);
      pens.splice(+el.dataset.i, 1);
      setScore({ pens: pens.length ? pens : null });
    },
    'score-done'() {
      const u = targetUnit();
      const h = holeById(ui.hole);
      const sc = scoreOf(u, ui.hole) || {};
      if (!h || !(sc.dnf || sipsOf(sc) > 0)) return;
      if (h.task && !sc.task) { toast('Kies eerst of de opdracht gelukt is.'); return; }
      const info = holeInfo(h, u);
      if (info.par == null) return;
      ui.editing = false;
      if (sc.done) { render(true); return; }
      if (!setScore({ done: true, dt: now(), par: info.par, drink: info.drink || '' })) return;
      const saved = scoreOf(u, h.id);
      const st = strokesOf(saved, info.par, h);
      const term = termFor(saved, st, info.par, h);
      buzz(term.cls === 'hio' ? [60, 40, 60, 40, 160] : 30);
      if (term.cls === 'hio') confetti(['🎯', '⛳', '🏆', '✨']); else if (term.cls === 'good') confetti();
      splash(term.t.replace(' 🎯', ''), term.cls, pts(st));
      render(true);
    },
    'score-edit'() {
      const sc = scoreOf(targetUnit(), ui.hole);
      if (!canScore(targetUnit())) return;
      if (locked(sc)) { toast('Deze score staat op slot. Vraag de organisator.'); render(true); return; }
      ui.editing = true;
      render(true);
    },
    'skip'() {
      const u = targetUnit();
      const allowed = skipsAllowed(u);
      if (!allowed || skipsUsed(u) >= allowed) { toast('Je hebt geen holes meer om over te slaan.'); return; }
      if (!confirm('Deze hole overslaan? Hij telt als 0 punten en je hebt er daarna nog ' + (allowed - skipsUsed(u) - 1) + ' over.')) return;
      if (setScore({ skip: true, done: true, dt: now(), by: null, dnf: null, task: null, pens: null })) toast('Hole overgeslagen');
    },
    'unskip'() { ui.editing = false; setScore({ skip: null, done: null, dt: null, ed: null }); },
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
    'tog'(el) {
      const on = el.dataset.v !== '1';
      el.dataset.v = on ? '1' : '0';
      el.classList.toggle('on', on);
      if (el.id === 'h-off') el.classList.toggle('bad', on);
    },
    'hole-save'(el) {
      const id = el.dataset.id || 'h' + uid(6);
      const prev = S.data.holes[id] || {};
      const type = $('#h-type').dataset.v === 'wheel' ? 'wheel' : 'fixed';
      const doc = { name: val('h-name').slice(0, 40) || 'Kroeg', type, order: +prev.order || Math.max(0, ...holesList().map((x) => +x.order || 0)) + 1 };
      if (type === 'wheel') {
        doc.wheelMode = $('#h-mode').dataset.v === 'group' ? 'group' : 'player';
        if ($('#h-wsrc').dataset.v === 'own') {
          doc.options = parseOptions(val('h-opts'));
          if (doc.options.length < 2) { msg('h-msg', 'Zet minstens twee drankjes op het rad.'); return; }
        }
      } else {
        doc.drink = val('h-drink').slice(0, 30) || 'Drankje';
        doc.par = clamp(Math.round(+prev.par) || 3, 1, 20);   // intern; de app toont geen par meer
      }
      const addr = val('h-addr').slice(0, 80);
      if (addr) {
        doc.addr = addr;
        if (addr === prev.addr && hasGeo(prev)) { doc.lat = +prev.lat; doc.lng = +prev.lng; }
      }
      const task = val('h-task').slice(0, 60);
      if (task) {
        doc.task = task;
        doc.win = -clamp(Math.abs(Math.round(+val('h-win')) || 0), 0, 20) || 0;
        doc.lose = clamp(Math.abs(Math.round(+val('h-lose')) || 0), 0, 20);
      }
      const hp = parsePens(val('h-hp'));
      if (hp.length) doc.hp = hp;
      const note = val('h-note').slice(0, 120);
      if (note) doc.note = note;
      const off = $('#h-off');
      if (off && off.dataset.v === '1') doc.off = true;
      if (doc.off && S.data.meta && S.data.meta.current === id) write('meta/current', null);
      write('holes/' + id, doc);
      closeSheet();
      toast('Kroeg opgeslagen');
      if (addr && !hasGeo(doc)) locateHole(id).then((ok) => { if (!ok) toast('Adres niet gevonden voor de kaart.'); });
    },
    'hole-del'(el) {
      const id = el.dataset.id;
      if (!confirm('Deze hole en de scores erop verwijderen?')) return;
      write('holes/' + id, null);
      write('spins/' + id, null);
      write('na/' + id, null);
      Object.keys(S.data.scores).forEach((u) => { if (S.data.scores[u] && S.data.scores[u][id]) write('scores/' + u + '/' + id, null); });
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
      const c = val('s-city').slice(0, 40);
      if (c !== (m.city || '')) write('meta/city', c || null);
      if (dnf !== dnfExtra()) write('meta/dnf', dnf);
      const solo = clamp(Math.round(+val('s-solo')) || 0, 0, 20);
      if (solo !== soloSkips()) write('meta/soloSkips', solo);
      const once = ($('#s-once') || { dataset: { v: '1' } }).dataset.v === '1';
      if (once !== wheelOnce()) write('meta/wheelOnce', once);
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
      const pin = val('p-pin');
      if (pin && !/^\d{4,6}$/.test(pin)) { msg('p-msg', 'Een pincode heeft 4 cijfers.'); return; }
      if (pin) write('players/' + pid + '/pin', pinHash(pid, pin));
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
      if (ui.uid === pid) ui.uid = null;
      const row = el.closest('.prow');
      if (row) row.remove();
    },
    'reset-scores'() {
      if (!confirm('Alle scores en rad-uitslagen van iedereen wissen? Dit kan niet ongedaan worden.')) return;
      write('scores', null);
      write('spins', null);
      write('na', null);
      write('meta/current', null);
      ui.wheelRot = {};
      toast('Alle scores zijn gewist.');
    },
    'teams'() { sheetTeams(); },
    'team-auto'() {
      const players = playersList();
      if (players.length < 2) { toast('Er zijn minstens twee spelers nodig.'); return; }
      const scored = Object.keys(S.data.scores).length > 0;
      if ((teamsList().length || scored) && !confirm(scored ? 'Er zijn al scores ingevuld. Bij een nieuwe indeling raken die scores los van de teams. Toch opnieuw indelen?' : 'De huidige teams vervangen door een nieuwe willekeurige indeling?')) return;
      const order = players.map((p) => p.id);
      for (let i = order.length - 1; i > 0; i--) { const j = randInt(i + 1); const x = order[i]; order[i] = order[j]; order[j] = x; }
      const teams = {};
      for (let i = 0; i + 1 < order.length; i += 2) {
        const tid = 't' + uid(6);
        teams[tid] = { t: now() + i };
        write('players/' + order[i] + '/team', tid);
        write('players/' + order[i + 1] + '/team', tid);
      }
      if (order.length % 2) write('players/' + order[order.length - 1] + '/team', null);
      write('teams', teams);
      sheetTeams();
    },
    'team-del'(el) {
      const tid = el.dataset.id;
      playersList().filter((p) => p.team === tid).forEach((p) => write('players/' + p.id + '/team', null));
      write('teams/' + tid, null);
      sheetTeams();
    },
    'wheel-edit'() { sheetWheel(); },
    'wheel-save'() {
      const opts = parseOptions(val('w-opts'));
      if (opts.length < 2) { msg('w-msg', 'Zet minstens twee drankjes op het rad.'); return; }
      write('meta/wheel', opts);
      closeSheet();
      toast('Rad opgeslagen');
    },
    'locate'() {
      if (!map || !navigator.geolocation) { toast('Locatie is hier niet beschikbaar.'); return; }
      toast('Locatie zoeken…');
      navigator.geolocation.getCurrentPosition((pos) => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        if (!meMarker) meMarker = window.L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#2f7bff', fillOpacity: 1 }).addTo(map);
        else meMarker.setLatLng(ll);
        map.setView(ll, Math.max(map.getZoom(), 17));
      }, () => toast('Geen toegang tot je locatie.'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 });
    },
    'map-fit'() { fitMap(); },
    'geo-all'() { if (!geoBusy) { geoFill(false); render(true); } },
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
    if (ORG_ONLY.has(el.dataset.act) && !isOrg()) { toast('Dat kan alleen de organisator.'); return; }
    fn(el, ev);
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    const act = el.dataset ? el.dataset.change : '';
    if (!act || !isOrg()) return;
    if (act === 'team-set') {
      let tid = el.value;
      if (tid === 'new') { tid = 't' + uid(6); write('teams/' + tid, { t: now() }); }
      write('players/' + el.dataset.id + '/team', tid || null);
      sheetTeams();
    } else if (act === 'team-name') {
      write('teams/' + el.dataset.id + '/name', el.value.trim().slice(0, 24) || null);
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return;
    const enter = { 'in-name': 'join', 'in-db': 'save-db', 'in-code': 'lobby-join', 'o-pin': 'org-check', 'a-name': 'player-add-save', 'in-ppin': 'join', 'c-pin': 'claim-check' };
    const act = enter[ev.target.id];
    if (act) { ev.preventDefault(); const btn = $(`[data-act="${act}"]`); if (btn) btn.click(); }
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.id === 'w-opts') {
      const box = $('#w-prev');
      if (box) box.innerHTML = wheelPreview(parseOptions(el.value));
      return;
    }
    // Velden van de aanmaak-wizard schrijven direct naar de wizard-staat, zodat niets verloren gaat bij een volgende stap.
    const path = el.dataset ? el.dataset.w : '';
    if (!path || !ui.wiz) return;
    const k = path.split('.');
    if (k[0] === 'p' && ui.wiz.pubs[+k[1]]) ui.wiz.pubs[+k[1]][k[2]] = el.value;
    else if (k[0] === 'w' && ui.wiz.wheel[+k[1]]) {
      ui.wiz.wheel[+k[1]][k[2]] = el.value;
      const box = $('#wiz-prev');
      if (box) box.innerHTML = wheelPreview(wizWheel());
    } else if (k.length === 1) ui.wiz[k[0]] = el.value;
  });
  // Wijst het adres na "terug" of een aangepaste link naar een ander spel (of de lobby), laad dan opnieuw.
  const urlGame = () => cleanGame(new URLSearchParams(location.hash.replace(/^#/, '')).get('g') || new URLSearchParams(location.search).get('g') || '') || CFG_GAME;
  window.addEventListener('hashchange', () => { if (urlGame() !== GAME) location.reload(); });
  window.addEventListener('popstate', (ev) => {
    if (urlGame() !== GAME) { location.reload(); return; }
    const st = ev.state || {};
    if (ui.wiz) {
      // Terug in de wizard: een stap terug, of terug naar de lobby.
      if (st.wz == null) ui.wiz = null; else { ui.wiz.step = clamp(+st.wz || 0, 0, WIZ_STEPS.length - 1); ui.wiz.msg = ''; }
      render(true);
      return;
    }
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
  if (DB && !LOCAL && GAME) {
    connect();
    pull();
    flush();
    setInterval(tick, 5000);
  }
})();
