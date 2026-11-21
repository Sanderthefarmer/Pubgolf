/* End-to-end test: speelt een avondje pubgolf na met meerdere telefoons tegelijk.
 *
 *   node tools/dev-server.js &          (app + nagemaakte database)
 *   node tools/e2e.js                   (vereist het npm-pakket `playwright`)
 *   SHOTS=/tmp/shots node tools/e2e.js  (bewaart ook screenshots)
 */
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8787';
const G = 't' + Date.now().toString(36);
const URL_ = `${BASE}/?db=${BASE}/db&g=${G}`;
const SHOTS = process.env.SHOTS || '';
if (SHOTS) require('fs').mkdirSync(SHOTS, { recursive: true });
const shot = (page, name, fullPage) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png', fullPage: !!fullPage }) : null);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fits = async (page, label) => { const r = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); ok(r[0] <= r[1], 'geen horizontale overflow: ' + label + ' (' + r.join('/') + ')'); };

(async () => {
  const browser = await chromium.launch();
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') { console.log(`[${name}] console.error:`, m.text()); } });
    page.on('pageerror', e => { console.log(`[${name}] PAGEERROR:`, e.message); fails++; });
    page.on('dialog', d => d.accept());
    return { ctx, page, name };
  };
  const A = await mk('A'), B = await mk('B');
  const a = A.page, b = B.page;

  // 1. A maakt spel
  await a.goto(URL_);
  await a.waitForSelector('#in-title');
  await shot(a, '01-create');
  await a.fill('#in-pin', '1234');
  await a.click('[data-act="create-game"]');
  await a.waitForSelector('#in-name');
  await a.fill('#in-name', 'Sander');
  await a.click('.emoji >> nth=3');
  await shot(a, '02-join');
  ok(await a.inputValue('#in-name') === 'Sander', 'naam blijft staan na emoji-keuze');
  await a.click('[data-act="join"]');
  await a.waitForSelector('.hole');
  ok(await a.locator('.hole').count() === 9, 'A ziet 9 holes');
  await shot(a, '03-holes');

  // 2. B doet mee
  await b.goto(URL_);
  await b.waitForSelector('#in-name');
  ok((await b.textContent('h1')).includes('Pubgolf Zwolle'), 'B ziet de speltitel');
  await b.fill('#in-name', 'Piet');
  await b.click('[data-act="join"]');
  await b.waitForSelector('.hole');
  ok(await b.locator('.hole').count() === 9, 'B ziet 9 holes');

  // 3. A scoort hole-in-one op hole 1
  await a.click('.hole >> nth=0');
  await a.waitForSelector('.counter');
  await shot(a, '04-hole-editor');
  await a.click('[data-act="sip-set"][data-n="1"]');
  await a.click('[data-act="score-done"]');
  await a.waitForSelector('.saved');
  ok((await a.textContent('.saved')).includes('Hole-in-one'), 'A: hole-in-one opgeslagen');
  await shot(a, '05-hole-saved');

  // 4. B ziet het live
  await b.click('[data-act="tab"][data-tab="board"]');
  await b.waitForFunction(() => document.querySelector('.brow') && document.querySelector('.board').textContent.includes('−1'), null, { timeout: 5000 }).then(() => ok(true, 'B ziet score van A live (−1)')).catch(() => ok(false, 'B ziet score van A live (−1)'));
  ok(await b.locator('.toast').count() >= 1, 'B krijgt een melding');
  await shot(b, '06-board');

  // 5. B draait het rad op hole 3
  await b.click('[data-act="tab"][data-tab="holes"]');
  await b.click('.hole >> nth=2');
  await b.waitForSelector('.wheel');
  await shot(b, '07-wheel');
  ok(await b.locator('.counter').count() === 0, 'geen score-editor voor het draaien');
  await b.click('[data-act="spin"]');
  await sleep(2000);
  await shot(b, '08-wheel-spinning');
  await fits(b, 'tijdens draaien');
  await b.waitForSelector('.spin-result', { timeout: 8000 });
  await b.waitForSelector('.counter');
  const drink = await b.textContent('.spin-result b');
  ok(!!drink, 'rad-uitslag: ' + drink);
  await sleep(400);
  await shot(b, '09-wheel-result');
  await fits(b, 'rad-uitslag');
  await b.click('[data-act="sip"][data-d="1"]');
  await b.click('[data-act="sip"][data-d="1"]');
  await b.click('[data-act="pen-add"][data-i="0"]');
  await sleep(100);
  await shot(b, '10-editor-pen', true);
  await b.click('[data-act="score-done"]');
  await b.waitForSelector('.saved');
  ok((await b.textContent('.saved-n')).trim() === '3', 'B: 2 teugen + 1 straf = 3');

  // 6. A scorekaart
  await a.click('[data-act="tab"][data-tab="card"]');
  await a.waitForSelector('table.sc');
  await sleep(500);
  ok((await a.textContent('table.sc')).includes('Piet'), 'A ziet Piet op de scorekaart');
  await shot(a, '11-card');
  await fits(a, 'scorekaart');

  // 7. organisator bewerkt hole 2
  await a.click('[data-act="tab"][data-tab="holes"]');
  await a.click('[data-act="toggle-edit-holes"]');
  await shot(a, '12-edit-holes');
  await a.click('[data-act="hole-edit"] >> nth=1');
  await a.waitForSelector('#h-name');
  await a.fill('#h-name', 'Café Test');
  await a.fill('#h-par', '4');
  await shot(a, '13-sheet-hole');
  await a.click('[data-act="hole-save"]');
  await sleep(600);
  ok(await a.locator('.sheet').count() === 0, 'sheet gesloten na opslaan');
  await b.click('[data-act="back"]');
  await b.waitForSelector('.hole');
  await b.waitForFunction(() => document.body.textContent.includes('Café Test'), null, { timeout: 5000 }).then(() => ok(true, 'B ziet aangepaste hole')).catch(() => ok(false, 'B ziet aangepaste hole'));
  // omhoog verplaatsen
  await a.click('[data-act="hole-move"][data-d="-1"] >> nth=1');
  await sleep(500);
  ok((await a.textContent('.hole >> nth=0')).includes('Café Test'), 'hole verplaatst naar positie 1');
  await a.click('[data-act="hole-move"][data-d="1"] >> nth=0');
  await sleep(500);
  ok((await a.textContent('.hole >> nth=1')).includes('Café Test'), 'hole terug naar positie 2');
  await a.click('[data-act="toggle-edit-holes"]');

  // 8. gastspeler + score invullen voor een ander
  await a.click('[data-act="tab"][data-tab="more"]');
  await shot(a, '14-more', true);
  await fits(a, 'meer');
  await a.click('[data-act="player-add"]');
  await a.fill('#a-name', 'Kees');
  await a.click('[data-act="player-add-save"]');
  await a.click('.sheet [data-act="sheet-close"]');
  await sleep(400);
  await a.click('[data-act="tab"][data-tab="holes"]');
  await a.click('.hole >> nth=0');
  await a.waitForSelector('.who');
  await a.click('.who [data-act="pick-player"]:has-text("Kees")');
  await a.waitForSelector('.counter');
  await a.click('[data-act="sip-set"][data-n="3"]');
  await a.click('[data-act="score-done"]');
  await sleep(300);
  await shot(a, '15-hole-org', true);
  await fits(a, 'hole organisator');
  await b.click('[data-act="tab"][data-tab="board"]');
  await b.waitForFunction(() => document.querySelectorAll('.brow').length === 3, null, { timeout: 5000 }).then(() => ok(true, 'B ziet 3 spelers')).catch(() => ok(false, 'B ziet 3 spelers'));

  // 9. offline wachtrij
  await B.ctx.setOffline(true);
  await b.click('[data-act="tab"][data-tab="holes"]');
  await b.click('.hole >> nth=0');
  await b.waitForSelector('.counter');
  await b.click('[data-act="sip-set"][data-n="2"]');
  await b.click('[data-act="score-done"]');
  await sleep(800);
  const st = await b.textContent('.status');
  ok(/wacht/.test(st), 'B offline: status toont wachtrij (' + st.trim() + ')');
  await shot(b, '16-offline');
  await a.click('[data-act="back"]');
  await a.click('[data-act="tab"][data-tab="card"]');
  await sleep(500);
  const before = await a.evaluate(() => [...document.querySelectorAll('table.sc tbody tr')].find(r => r.textContent.includes('Piet')).children[1].textContent);
  ok(before.trim() === '·', 'A ziet offline score nog niet');
  await B.ctx.setOffline(false);
  await a.waitForFunction(() => [...document.querySelectorAll('table.sc tbody tr')].find(r => r.textContent.includes('Piet')).children[1].textContent.trim() === '2', null, { timeout: 20000 }).then(() => ok(true, 'na herverbinden komt de score bij A aan')).catch(() => ok(false, 'na herverbinden komt de score bij A aan'));
  await b.waitForFunction(() => /Live/.test(document.querySelector('.status').textContent), null, { timeout: 20000 }).then(() => ok(true, 'B weer Live')).catch(() => ok(false, 'B weer Live'));

  // 10. herladen: nog ingelogd
  await b.reload();
  await b.waitForSelector('.tabs');
  ok(await b.locator('#in-name').count() === 0, 'B blijft ingelogd na herladen');

  // 11. terugknop
  await b.goto(URL_);
  await b.waitForSelector('.tabs');
  ok(await b.locator('.hero').count() === 1, 'na herladen sta je nog in dezelfde hole');
  await b.click('[data-act="tab"][data-tab="holes"]');
  await b.waitForSelector('.hole');
  await b.click('.hole >> nth=4');
  await b.waitForSelector('.hero');
  await b.goBack();
  await b.waitForSelector('.hole');
  ok(await b.locator('.hero').count() === 0, 'terugknop sluit hole-detail');

  // 12. groepsrad op hole 6
  await a.click('[data-act="tab"][data-tab="holes"]');
  await a.click('.hole >> nth=5');
  await a.waitForSelector('.hero');
  await a.click('.hero [data-act="hole-edit"]');
  await a.waitForSelector('#h-mode');
  await a.click('#h-mode [data-v="group"]');
  await a.click('[data-act="hole-save"]');
  await sleep(500);
  await a.click('[data-act="hole-pin"]');
  await b.waitForFunction(() => { const n = document.querySelector('.now'); return n && n.textContent.includes('We zijn nu bij') && n.textContent.includes('Hole 6'); }, null, { timeout: 5000 }).then(() => ok(true, 'B ziet de actieve hole')).catch(() => ok(false, 'B ziet de actieve hole'));
  await b.click('.now');
  await b.waitForSelector('.wheel');
  await sleep(300);
  await a.click('[data-act="spin"]');
  await sleep(1500);
  await shot(b, '17-group-spin-b');
  await a.waitForSelector('.spin-result', { timeout: 9000 });
  await b.waitForSelector('.spin-result', { timeout: 9000 });
  const da = await a.textContent('.spin-result b'), dbb = await b.textContent('.spin-result b');
  await fits(a, 'groepsrad A'); await fits(b, 'groepsrad B');
  ok(da === dbb, 'groepsrad: zelfde uitslag bij A en B (' + da + ')');

  // 13. niet-organisator kan geen andere speler kiezen
  ok(await b.locator('.who').count() === 0, 'B heeft geen organisator-knoppen');
  await b.click('[data-act="tab"][data-tab="more"]');
  await b.click('[data-act="org-on"]');
  await b.fill('#o-pin', '9999');
  await b.click('[data-act="org-check"]');
  ok((await b.textContent('#o-msg')).includes('klopt niet'), 'foute pincode geweigerd');
  await b.fill('#o-pin', '1234');
  await b.click('[data-act="org-check"]');
  await sleep(500);
  ok(await b.locator('[data-act="settings"]').count() === 1, 'juiste pincode ontgrendelt');
  await b.click('[data-act="settings"]');
  await shot(b, '18-settings');
  await b.click('.sheet [data-act="sheet-close"]');

  await a.click('[data-act="tab"][data-tab="board"]');
  await sleep(400);
  await shot(a, '19-board-final');

  // 14. lokale modus
  const C = await mk('C');
  await C.page.goto(`${BASE}/?db=local&g=${G}`);
  await C.page.waitForSelector('#in-title');
  await C.page.click('[data-act="create-game"]');
  await C.page.waitForSelector('#in-name');
  await C.page.fill('#in-name', 'Solo');
  await C.page.click('[data-act="join"]');
  await C.page.waitForSelector('.hole');
  ok((await C.page.textContent('.status')).includes('Lokaal'), 'lokale modus werkt');

  // 15. setup-scherm zonder database
  const D = await mk('D');
  await D.page.goto(BASE + '/');
  await D.page.waitForSelector('#in-db');
  await shot(D.page, '20-setup');
  await D.page.fill('#in-db', BASE + '/db/');
  await D.page.click('[data-act="save-db"]');
  await D.page.waitForSelector('#in-title, #in-name', { timeout: 8000 });
  ok(true, 'database koppelen via setup-scherm werkt');

  // 16. lokaal spel overzetten naar database
  const E = await mk('E');
  const G2 = G + 'x';
  await E.page.goto(`${BASE}/?db=local&g=${G2}`);
  await E.page.waitForSelector('#in-title');
  await E.page.fill('#in-title', 'Lokaal Feest');
  await E.page.click('[data-act="create-game"]');
  await E.page.waitForSelector('#in-name');
  await E.page.fill('#in-name', 'Lokale Lot');
  await E.page.click('[data-act="join"]');
  await E.page.waitForSelector('.hole');
  await E.page.click('.hole >> nth=0');
  await E.page.click('[data-act="sip-set"][data-n="2"]');
  await E.page.click('[data-act="score-done"]');
  await sleep(200);
  await E.page.goto(`${BASE}/?db=${BASE}/db&g=${G2}`);
  await E.page.waitForSelector('[data-act="create-from-local"]');
  await E.page.fill('#in-pin', '4321');
  await E.page.click('[data-act="create-from-local"]');
  await E.page.waitForSelector('.tabs');
  await sleep(800);
  const remote = await (await fetch(`${BASE}/db/games/${G2}.json`)).json();
  ok(remote && remote.meta.title === 'Lokaal Feest' && Object.keys(remote.holes).length === 9 && Object.keys(remote.players).length === 1 && !!remote.scores, 'lokaal spel staat in de database');
  ok((await E.page.textContent('.status')).includes('Live'), 'na overzetten Live en ingelogd');

  console.log(fails ? `\n${fails} FAILS` : '\nALL PASS');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
