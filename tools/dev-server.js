#!/usr/bin/env node
/* Lokale ontwikkelserver: serveert de app én een nagemaakte Firebase Realtime
 * Database (REST + streaming) onder /db, zodat je live sync kunt testen zonder
 * echt Firebase-project.
 *
 *   node tools/dev-server.js            → http://localhost:8787
 *   open http://localhost:8787/?db=http://localhost:8787/db
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.PORT || 8787;
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

let db = null;
const subs = new Set();

const keysOf = (p) => p.split('/').filter(Boolean);
function getAt(keys) {
  let o = db;
  for (const k of keys) { if (o == null || typeof o !== 'object') return null; o = o[k]; }
  return o === undefined ? null : o;
}
function prune(o) {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const k of Object.keys(o)) { o[k] = prune(o[k]); if (o[k] == null) delete o[k]; }
    return Object.keys(o).length ? o : null;
  }
  return o === undefined ? null : o;
}
function setAt(keys, value) {
  if (!keys.length) { db = prune(value); return; }
  if (db == null || typeof db !== 'object') db = {};
  let o = db;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  if (value == null) delete o[keys[keys.length - 1]]; else o[keys[keys.length - 1]] = value;
  db = prune(db);
}
function notify(changed, event, data) {
  for (const s of subs) {
    const a = s.keys, b = changed;
    const n = Math.min(a.length, b.length);
    let common = 0;
    while (common < n && a[common] === b[common]) common++;
    if (common < n) continue;                       // andere tak
    if (b.length >= a.length) send(s.res, event, { path: '/' + b.slice(a.length).join('/'), data });
    else send(s.res, 'put', { path: '/', data: getAt(a) });
  }
}
const send = (res, event, data) => res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, PATCH, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': '*' };

  if (u.pathname.startsWith('/db/') || u.pathname === '/db.json') {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (process.env.FAIL_WRITES && req.method !== 'GET') { res.writeHead(503, cors); res.end('{}'); return; }
    const keys = keysOf(decodeURIComponent(u.pathname.replace(/^\/db/, '').replace(/\.json$/, '')));
    if (req.method === 'GET' && (req.headers.accept || '').includes('text/event-stream')) {
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }, cors));
      const sub = { keys, res };
      subs.add(sub);
      send(res, 'put', { path: '/', data: getAt(keys) });
      const ka = setInterval(() => send(res, 'keep-alive', null), 30000);
      req.on('close', () => { clearInterval(ka); subs.delete(sub); });
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (code, v) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, cors)); res.end(JSON.stringify(v)); };
      let val = null;
      if (body) { try { val = JSON.parse(body); } catch (e) { return json(400, { error: 'Invalid JSON' }); } }
      if (req.method === 'GET') return json(200, getAt(keys));
      if (req.method === 'PUT') { setAt(keys, val); notify(keys, 'put', val); return json(200, val); }
      if (req.method === 'DELETE') { setAt(keys, null); notify(keys, 'put', null); return json(200, null); }
      if (req.method === 'PATCH') {
        for (const k of Object.keys(val || {})) setAt(keys.concat(keysOf(k)), val[k]);
        notify(keys, 'patch', val);
        return json(200, val);
      }
      return json(405, { error: 'Method not allowed' });
    });
    return;
  }

  let file = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, () => console.log('Pubgolf dev-server: http://localhost:' + PORT + '/?db=http://localhost:' + PORT + '/db'));
