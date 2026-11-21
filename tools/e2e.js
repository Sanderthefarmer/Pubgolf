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
let fails = 0, geoCalls = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fits = async (page, label) => { const r = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); ok(r[0] <= r[1], 'geen horizontale overflow: ' + label + ' (' + r.join('/') + ')'); };

(async () => {
  const browser = await chromium.launch();
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await ctx.route('https://tile.openstreetmap.org/**', (r) => r.abort());
    await ctx.route('https://nominatim.openstreetmap.org/**', (r) => {
      geoCalls++;
      const q = new URL(r.request().url()).searchParams.get('q') || '';
      if (/Onbestaand/.test(q)) return r.fulfill({ json: [] });
      return r.fulfill({ json: [{ lat: String(52.5100 + (geoCalls % 7) * 0.0006), lon: String(6.0900 + (geoCalls % 5) * 0.0011), display_name: q }] });
    });
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
  await a.fill('#in-ppin', '1111');
  await a.click('.emoji >> nth=3');
  await shot(a, '02-join');
  ok(await a.inputValue('#in-name') === 'Sander', 'naam blijft staan na emoji-keuze');
  await a.click('[data-act="join"]');
  await a.waitForSelector('.hole');
  ok(await a.locator('.hole').count() === 14, 'A ziet de 14 kroegen van Zwolle');
  ok((await a.textContent('.hole >> nth=0')).includes('Beugeltje') && (await a.textContent('.hole >> nth=13')).includes('Vliegende Paard'), 'kroegen staan in de opgegeven volgorde');
  ok((await a.textContent('.hole >> nth=7')).includes('Guinness') && (await a.textContent('.hole >> nth=7')).includes('Split the G'), 'Dublin House: Guinness met Split the G');
  await shot(a, '03-holes');

  // 2. B doet mee
  await b.goto(URL_);
  await b.waitForSelector('#in-name');
  ok((await b.textContent('h1')).includes('Pubgolf Zwolle'), 'B ziet de speltitel');
  await b.fill('#in-name', 'Piet');
  await b.click('[data-act="join"]');
  ok((await b.textContent('#join-msg')).includes('pincode'), 'meedoen zonder pincode kan niet');
  await b.fill('#in-ppin', '2222');
  await b.click('[data-act="join"]');
  await b.waitForSelector('.hole');
  ok(await b.locator('.hole').count() === 14, 'B ziet 14 kroegen');

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
  await b.waitForFunction(() => document.querySelector('.brow') && document.querySelector('.board').textContent.includes('−2'), null, { timeout: 5000 }).then(() => ok(true, 'B ziet score van A live (−2)')).catch(() => ok(false, 'B ziet score van A live (−2)'));
  ok(await b.locator('.toast').count() >= 1, 'B krijgt een melding');
  await shot(b, '06-board');

  // 5. organisator maakt van hole 3 een rad; B draait
  await a.click('[data-act="tab"][data-tab="holes"]');
  await a.click('[data-act="toggle-edit-holes"]');
  await a.click('[data-act="hole-edit"] >> nth=2');
  await a.waitForSelector('#h-type');
  await a.click('#h-type [data-v="wheel"]');
  await a.click('[data-act="hole-save"]');
  await sleep(500);
  await a.click('[data-act="toggle-edit-holes"]');
  await b.click('[data-act="tab"][data-tab="holes"]');
  await b.waitForFunction(() => { const h = document.querySelectorAll('.hole')[2]; return h && h.textContent.includes('Rad'); }, null, { timeout: 5000 });
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
  await a.fill('#h-hp', 'Naar de wc, 2');
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
  await a.click('.who [data-act="pick-unit"]:has-text("Kees")');
  await a.waitForSelector('.counter');
  await a.click('[data-act="sip-set"][data-n="3"]');
  await a.click('[data-act="score-done"]');
  await sleep(300);
  await shot(a, '15-hole-org', true);
  await fits(a, 'hole organisator');
  await b.click('[data-act="tab"][data-tab="board"]');
  await b.waitForFunction(() => document.querySelectorAll('[data-flip]').length === 3, null, { timeout: 5000 }).then(() => ok(true, 'B ziet 3 spelers')).catch(() => ok(false, 'B ziet 3 spelers'));

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
  await a.waitForSelector('#h-type');
  await a.click('#h-type [data-v="wheel"]');
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
  ok(remote && remote.meta.title === 'Lokaal Feest' && Object.keys(remote.holes).length === 14 && Object.keys(remote.players).length === 1 && !!remote.scores, 'lokaal spel staat in de database');
  ok((await E.page.textContent('.status')).includes('Live'), 'na overzetten Live en ingelogd');

  // 17. opdracht bij The Dublin House (hole 8): Split the G
  await b.click('[data-act="tab"][data-tab="holes"]');
  await b.click('.hole >> nth=7');
  await b.waitForSelector('.hero-task');
  ok((await b.textContent('.hero')).includes('Split the G') && (await b.textContent('.hero-task')).includes('−2'), 'hole toont opdracht met −2 / +2');
  ok((await b.getAttribute('.hero .addr', 'href')).includes('google.com/maps/dir'), 'navigatielink naar het adres');
  await b.click('[data-act="sip-set"][data-n="3"]');
  await sleep(150);
  ok(await b.isDisabled('[data-act="score-done"]'), 'opslaan kan pas na keuze gelukt/mislukt');
  await b.click('[data-act="task"][data-v="w"]');
  await sleep(150);
  await shot(b, '21-opdracht', true);
  await b.click('[data-act="score-done"]');
  await b.waitForSelector('.saved');
  ok((await b.textContent('.saved-n')).trim() === '1', 'Split the G gelukt: 3 teugen − 2 = 1');
  ok((await b.textContent('.saved')).includes('opdracht gelukt'), 'samenvatting noemt de opdracht');
  await b.click('[data-act="score-edit"]');
  await b.click('[data-act="task"][data-v="l"]');
  await b.click('[data-act="score-done"]');
  await b.waitForSelector('.saved');
  ok((await b.textContent('.saved-n')).trim() === '5', 'Split the G mislukt: 3 teugen + 2 = 5');
  await a.click('[data-act="tab"][data-tab="card"]');
  await a.waitForFunction(() => { const r = [...document.querySelectorAll('table.sc tbody tr')].find(x => x.textContent.includes('Piet')); return r && r.children[8].textContent.trim() === '5'; }, null, { timeout: 5000 }).then(() => ok(true, 'A ziet de opdracht-score op de scorekaart')).catch(() => ok(false, 'A ziet de opdracht-score op de scorekaart'));

  // 18. straf per kroeg (hole 2)
  await b.click('[data-act="tab"][data-tab="holes"]');
  await b.click('.hole >> nth=1');
  await b.waitForSelector('.counter');
  ok((await b.textContent('.hero-pen')).includes('Naar de wc'), 'hole toont de straf van deze kroeg');
  await b.click('[data-act="sip-set"][data-n="4"]');
  await b.click('.chip.here');
  await b.click('[data-act="score-done"]');
  await b.waitForSelector('.saved');
  ok((await b.textContent('.saved-n')).trim() === '6', 'straf van de kroeg telt mee: 4 + 2 = 6');

  // 19. kaart met de route
  await a.click('[data-act="tab"][data-tab="map"]');
  await a.waitForSelector('#map.leaflet-container');
  await a.waitForFunction(() => document.querySelectorAll('#map .pin').length === 14, null, { timeout: 30000 }).then(() => ok(true, 'kaart toont 14 genummerde punten')).catch(async () => ok(false, 'kaart toont 14 punten (nu ' + await a.locator('#map .pin').count() + ')'));
  ok(await a.locator('.rt').count() === 14, 'routelijst met 14 kroegen in volgorde');
  ok((await a.textContent('.rt >> nth=7')).includes('Dublin House'), 'Dublin House is nummer 8 op de route');
  await fits(a, 'kaart');
  await sleep(400);
  await shot(a, '22-kaart');
  await b.click('[data-act="tab"][data-tab="map"]');
  await b.waitForFunction(() => document.querySelectorAll('#map .pin').length === 14, null, { timeout: 8000 }).then(() => ok(true, 'B ziet dezelfde punten zonder zelf adressen op te zoeken')).catch(() => ok(false, 'B ziet dezelfde punten'));
  ok(await b.locator('#map .pin.done').count() >= 3, 'gespeelde holes zijn groen op de kaart van B');
  const pin8 = b.locator('#map .pin', { hasText: /^8$/ });
  await pin8.click({ force: true });
  await b.waitForSelector('.leaflet-popup [data-hole]');
  await shot(b, '23-kaart-popup');
  await b.click('.leaflet-popup [data-hole]');
  await b.waitForSelector('.hero');
  ok((await b.textContent('.hero h2')).includes('Dublin House'), 'punt op de kaart opent de juiste hole');
  await b.goBack();
  await b.waitForSelector('#map .pin');
  ok(await b.locator('#map .pin').count() === 14, 'kaart staat er nog na terugkeren');

  // 20. adres wijzigen zoekt het punt opnieuw op; onbekend adres blijft van de kaart
  await a.click('[data-act="tab"][data-tab="holes"]');
  await a.click('[data-act="toggle-edit-holes"]');
  await a.click('[data-act="hole-edit"] >> nth=0');
  await a.fill('#h-addr', 'Onbestaandestraat 1');
  await a.click('[data-act="hole-save"]');
  await sleep(700);
  await a.click('[data-act="toggle-edit-holes"]');
  await a.click('[data-act="tab"][data-tab="map"]');
  await a.waitForFunction(() => document.querySelectorAll('#map .pin').length === 13, null, { timeout: 5000 }).then(() => ok(true, 'onbekend adres verdwijnt van de kaart')).catch(() => ok(false, 'onbekend adres verdwijnt van de kaart'));
  ok((await a.textContent('.v-map')).includes('nog niet op de kaart'), 'melding over ontbrekend adres');

  // 20b. het rad van het spel vooraf instellen; een kroeg kan een eigen rad krijgen
  await a.click('[data-act="tab"][data-tab="more"]');
  await a.click('[data-act="wheel-edit"]');
  await a.waitForSelector('#w-opts');
  ok((await a.textContent('.sheet')).includes('in gebruik bij'), 'rad-scherm toont bij welke kroegen het geldt');
  await a.fill('#w-opts', 'Cola, 1\nWater, 2\nSpa rood, 3');
  await sleep(150);
  ok(await a.locator('#w-prev svg.wheel path').count() === 3, 'voorbeeld van het rad werkt live bij');
  await shot(a, '25-rad-instellen', true);
  await a.click('[data-act="wheel-save"]');
  await sleep(500);
  await a.click('[data-act="tab"][data-tab="holes"]');
  await a.click('.hole >> nth=2');
  await a.waitForSelector('.wheel-legend');
  ok((await a.textContent('.wheel-legend')).includes('Cola') && !(await a.textContent('.wheel-legend')).includes('Wijn'), 'kroeg met rad gebruikt het rad van het spel');
  await a.click('.hero [data-act="hole-edit"]');
  await a.waitForSelector('#h-wsrc');
  ok(!(await a.isVisible('#h-opts')), 'bij "rad van het spel" geen eigen lijst');
  await a.click('#h-wsrc [data-v="own"]');
  await a.fill('#h-opts', 'Thee, 1\nKoffie, 2');
  await a.click('[data-act="hole-save"]');
  await sleep(500);
  ok((await a.textContent('.wheel-legend')).includes('Thee') && !(await a.textContent('.wheel-legend')).includes('Cola'), 'eigen rad van de kroeg gaat voor');
  await a.click('[data-act="spin"]');
  await a.waitForSelector('.spin-result', { timeout: 9000 });
  ok(/Thee|Koffie/.test(await a.textContent('.spin-result b')), 'draai komt van het eigen rad');
  await sleep(2600);

  // 21. nieuw spel met eigen kroegen
  await a.click('[data-act="tab"][data-tab="more"]');
  await a.click('[data-act="new-game"]');
  await a.fill('#n-game', 'Feest ' + G);
  await a.click('[data-act="new-game-go"]');
  await a.waitForSelector('#c-route');
  ok(a.url().includes('g=feest-' + G), 'nieuw spel krijgt eigen link');
  await a.click('#c-route [data-v="empty"]');
  await a.fill('#in-pin', '1111');
  await a.click('[data-act="create-game"]');
  await a.waitForSelector('#in-name');
  await a.fill('#in-name', 'Sander');
  await a.fill('#in-ppin', '1111');
  await a.click('[data-act="join"]');
  await a.waitForSelector('[data-act="hole-add"]');
  ok(await a.locator('.hole').count() === 0, 'nieuw spel begint zonder kroegen');
  await a.click('[data-act="hole-add"]');
  await a.fill('#h-name', 'Eigen Kroeg');
  await a.fill('#h-drink', 'Radler');
  await a.fill('#h-task', 'Zing het volkslied');
  await a.fill('#h-win', '1');
  await a.fill('#h-lose', '3');
  await shot(a, '24-kroeg-bewerken', true);
  await a.click('[data-act="hole-save"]');
  await a.waitForSelector('.hole');
  ok((await a.textContent('.hole')).includes('Eigen Kroeg') && (await a.textContent('.hole')).includes('Zing het volkslied'), 'eigen kroeg met opdracht toegevoegd');

  // ================= Scenario: vanavond — 7 spelers, drie teams van 2 en één solo =================
  const G3 = G + 't';
  const U3 = `${BASE}/?db=${BASE}/db&g=${G3}`;
  const O = await mk('O'), P = await mk('P'), Q = await mk('Q');
  const o = O.page, p2 = P.page, q = Q.page;
  const txt = (page, sel) => page.textContent(sel).then((x) => (x || '').replace(/\s+/g, ' ').trim());
  const goHole = async (page, n) => { await page.click('[data-act="tab"][data-tab="holes"]'); await sleep(150); await page.click(`.hole >> nth=${n - 1}`); await page.waitForSelector('.hero'); await sleep(150); };
  const count = (page, want) => page.waitForFunction((w) => { const b = document.querySelector('.cnum b'); return b && b.textContent === w; }, String(want), { timeout: 20000 }).then(() => true).catch(() => false);
  const forge = (page, act, data) => page.evaluate(([a, d]) => { const b = document.createElement('button'); b.dataset.act = a; Object.assign(b.dataset, d || {}); document.body.appendChild(b); b.click(); b.remove(); }, [act, data || {}]);

  await o.goto(U3);
  await o.waitForSelector('#in-title');
  await o.fill('#in-pin', '1234');
  await o.click('[data-act="create-game"]');
  await o.waitForSelector('#in-name');
  await o.fill('#in-name', 'Sander');
  await o.fill('#in-ppin', '1111');
  await o.click('[data-act="join"]');
  await o.waitForSelector('.hole');
  for (const [page, name, pin] of [[p2, 'Piet', '2222'], [q, 'Lotte', '3333']]) {
    await page.goto(U3);
    await page.waitForSelector('#in-name');
    await page.fill('#in-name', name);
    await page.fill('#in-ppin', pin);
    await page.click('[data-act="join"]');
    await page.waitForSelector('.hole');
  }
  // vier spelers zonder eigen telefoon
  await o.click('[data-act="tab"][data-tab="more"]');
  await o.click('[data-act="player-add"]');
  for (const n of ['Emma', 'Daan', 'Bram', 'Kees']) { await o.fill('#a-name', n); await o.click('[data-act="player-add-save"]'); }
  await o.click('.sheet [data-act="sheet-close"]');
  await o.waitForFunction(() => !document.querySelector('.sheet'));

  // teams indelen: Sander+Piet, Lotte+Emma, Daan+Bram en Kees solo
  await o.click('[data-act="teams"]');
  await o.waitForSelector('select[aria-label="Team van Sander"]');
  for (const [name, choice] of [['Sander', 'new'], ['Piet', { index: 1 }], ['Lotte', 'new'], ['Emma', { index: 2 }], ['Daan', 'new'], ['Bram', { index: 3 }]]) {
    await o.selectOption(`select[aria-label="Team van ${name}"]`, choice);
    await sleep(200);
  }
  await shot(o, '30-teams', true);
  await fits(o, 'teams indelen');
  await o.click('.sheet [data-act="sheet-close"]');
  await o.waitForFunction(() => !document.querySelector('.sheet'));
  await o.click('[data-act="tab"][data-tab="board"]');
  await o.waitForFunction(() => document.querySelectorAll('[data-flip]').length === 4, null, { timeout: 5000 }).then(() => ok(true, '7 spelers vormen 3 teams en 1 solo')).catch(() => ok(false, '7 spelers vormen 3 teams en 1 solo'));
  const boardTxt = await txt(o, '.board');
  ok(['Sander & Piet', 'Lotte & Emma', 'Daan & Bram', 'Kees'].every((n) => boardTxt.includes(n)), 'stand toont de teams en de solospeler');

  // samen één glas: beide teamgenoten tikken, de teugen tellen op
  await goHole(o, 1);
  await goHole(p2, 1);
  ok((await txt(p2, '.score h3')) === 'Score van jullie team', 'teamgenoten delen één score');
  await o.click('[data-act="sip"][data-d="1"]');
  await p2.click('[data-act="sip"][data-d="1"]');
  await o.click('[data-act="sip"][data-d="1"]');
  await p2.click('[data-act="sip"][data-d="1"]');
  ok(await count(o, 4) && await count(p2, 4), '2x een kwart en 2x een kwart is samen 4 teugen, op beide telefoons');
  const who = await txt(o, '.bywho');
  ok(who.includes('Sander 2') && who.includes('Piet 2'), 'de app laat zien wie hoeveel teugen nam');
  await shot(o, '31-team-teller', true);
  await fits(o, 'team-teller');
  await p2.click('[data-act="sip"][data-d="-1"]');
  await p2.click('[data-act="sip"][data-d="-1"]');
  ok(await count(p2, 2) && await p2.isDisabled('[data-act="sip"][data-d="-1"]'), 'je kunt alleen je eigen teugen terugnemen, niet die van je teamgenoot');
  await p2.click('[data-act="sip"][data-d="1"]');
  await p2.click('[data-act="sip"][data-d="1"]');
  await count(p2, 4);
  await p2.click('[data-act="score-done"]');
  await p2.waitForSelector('.saved');
  await o.waitForSelector('.saved', { timeout: 6000 });
  ok((await txt(o, '.saved-n')) === '4', 'opslaan door één teamgenoot geldt voor het hele team');

  // rechten: een ander team kan er niet aan komen
  await goHole(q, 1);
  ok(await q.locator('.who').count() === 0 && await q.locator('[data-act="hole-edit"]').count() === 0, 'een speler ziet geen organisator-knoppen');
  for (const act of ['reset-scores', 'pick-unit', 'hole-del', 'spin-reset', 'teams', 'settings']) await forge(q, act, { id: 'x' });
  await sleep(600);
  ok((await txt(q, '#toasts')).includes('alleen de organisator'), 'organisator-acties worden geweigerd voor spelers');
  ok(await q.locator('.sheet').count() === 0 && (await txt(o, '.saved-n')) === '4', 'valsspelen via verborgen knoppen lukt niet');

  // op slot: na de correctietijd kan alleen de organisator nog aanpassen
  ok(await p2.locator('[data-act="score-edit"]').count() === 1, 'kort na het opslaan mag je nog corrigeren');
  await p2.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 3 * 60000; });
  await goHole(p2, 1);
  await p2.waitForSelector('.saved');
  ok(await p2.locator('.lock').count() === 1 && await p2.locator('[data-act="score-edit"]').count() === 0, 'daarna staat de score op slot voor spelers');
  await forge(p2, 'score-edit');
  await forge(p2, 'sip', { d: '-1' });
  await forge(p2, 'sip-set', { n: '1' });
  await sleep(600);
  ok((await txt(o, '.saved-n')) === '4' && await p2.locator('.counter').count() === 0, 'een score op slot is ook via omwegen niet te verlagen');
  await o.click('[data-act="score-edit"]');
  await o.waitForSelector('.counter');
  await o.click('[data-act="sip-set"][data-n="3"]');
  await o.click('[data-act="score-done"]');
  await o.waitForSelector('.saved');
  ok((await txt(o, '.saved-n')) === '3' && (await txt(o, '.saved')).includes('aangepast door Sander'), 'de organisator kan corrigeren en dat is zichtbaar');
  await q.waitForFunction(() => [...document.querySelectorAll('.prow')].some((r) => r.textContent.includes('Sander & Piet') && r.textContent.includes('aangepast')), null, { timeout: 6000 }).then(() => ok(true, 'andere teams zien dat een score is aangepast')).catch(() => ok(false, 'andere teams zien dat een score is aangepast'));

  // solo: vier holes naar keuze overslaan
  await goHole(o, 2);
  await o.click('.who [data-act="pick-unit"]:has-text("Kees")');
  await sleep(200);
  ok((await txt(o, '[data-act="skip"]')).includes('nog 4 van 4'), 'de solospeler mag 4 holes overslaan');
  for (const n of [2, 3, 4, 5]) {
    if (n > 2) await goHole(o, n);
    await o.click('[data-act="skip"]');
    await o.waitForSelector('.saved');
  }
  ok((await txt(o, '.saved')).includes('Overgeslagen') && (await txt(o, '.saved')).includes('4 van 4'), 'overgeslagen holes worden bijgehouden');
  await shot(o, '32-overgeslagen', true);
  await goHole(o, 6);
  ok(await o.isDisabled('[data-act="skip"]'), 'na 4 keer overslaan is het op');
  await o.click('[data-act="sip-set"][data-n="2"]');
  await o.click('[data-act="score-done"]');
  await o.waitForSelector('.saved');
  await o.click('.who [data-act="pick-unit"]:has-text("Daan")');
  await sleep(200);
  ok(await o.locator('.counter').count() === 1 && await o.locator('[data-act="skip"]').count() === 0, 'een team van twee kan niet overslaan');
  await q.click('[data-act="tab"][data-tab="board"]');
  await q.waitForFunction(() => [...document.querySelectorAll('[data-flip]')].some((r) => r.textContent.includes('Kees') && r.textContent.includes('4 overgeslagen') && r.textContent.includes('5/14')), null, { timeout: 6000 }).then(() => ok(true, 'overgeslagen holes tellen als par en als gespeeld in de stand')).catch(() => ok(false, 'overgeslagen holes tellen als par en als gespeeld in de stand'));
  await shot(q, '33-stand-teams');

  // het rad: een getrokken drankje verdwijnt, en "is er niet" geeft een nieuwe draai
  await o.click('[data-act="tab"][data-tab="more"]');
  await o.click('[data-act="wheel-edit"]');
  await o.fill('#w-opts', 'Alfa, 2\nBeta, 3\nGamma, 4');
  await o.click('[data-act="wheel-save"]');
  await o.waitForFunction(() => !document.querySelector('.sheet'));
  await o.click('[data-act="tab"][data-tab="holes"]');
  await o.click('[data-act="toggle-edit-holes"]');
  for (const n of [7, 9, 10]) {
    await o.click(`[data-act="hole-edit"] >> nth=${n - 1}`);
    await o.waitForSelector('#h-type');
    await o.click('#h-type [data-v="wheel"]');
    await o.click('[data-act="hole-save"]');
    await o.waitForFunction(() => !document.querySelector('.sheet'));
    await sleep(200);
  }
  await o.click('[data-act="toggle-edit-holes"]');
  const spin = async (page) => { await page.click('[data-act="spin"]'); await page.waitForSelector('.spin-result', { timeout: 9000 }); await sleep(300); return (await txt(page, '.spin-result b')).split(' ').slice(1).join(' '); };
  await goHole(o, 7);
  ok((await txt(o, '.wheel-legend')).includes('Alfa') && (await txt(o, '.wheel-legend')).includes('Gamma'), 'eerste rad-kroeg: alle drankjes staan erop');
  const d1 = await spin(o);
  await goHole(o, 9);
  ok(!(await txt(o, '.wheel-legend')).includes(d1) && (await txt(o, '.used')).includes(d1), 'een getrokken drankje is van het rad (' + d1 + ')');
  await shot(o, '34-rad-zonder-gehad', true);
  const d2 = await spin(o);
  ok(d2 !== d1, 'tweede draai geeft een ander drankje (' + d2 + ')');
  await goHole(o, 10);
  const d3 = await spin(o);
  ok(d3 !== d1 && d3 !== d2, 'derde draai geeft het laatste drankje (' + d3 + ')');
  await goHole(q, 10);
  await o.click('[data-act="drink-na"]');
  await o.waitForSelector('[data-act="spin"]');
  ok((await txt(o, '.na')).includes(d3), '"dit drankje is er niet" haalt het bij deze kroeg van het rad');
  ok((await txt(o, '.wheel-card')).includes('begint opnieuw') && !(await txt(o, '.wheel-legend')).includes(d3), 'is alles op, dan begint het rad opnieuw zonder het ontbrekende drankje');
  await q.waitForFunction((d) => { const l = document.querySelector('.wheel-legend'); return l && !l.textContent.includes(d); }, d3, { timeout: 6000 }).then(() => ok(true, 'ook andere teams krijgen dat drankje hier niet meer')).catch(() => ok(false, 'ook andere teams krijgen dat drankje hier niet meer'));
  const d4 = await spin(o);
  ok(d4 !== d3, 'opnieuw draaien geeft een drankje dat er wel is (' + d4 + ')');
  ok(await q.locator('[data-act="spin-reset"]').count() === 0 && await o.locator('[data-act="spin-reset"]').count() === 1, 'zomaar opnieuw draaien kan alleen de organisator');

  // inloggen op een ander toestel kan alleen met je eigen pincode
  const R = await mk('R');
  const r = R.page;
  await r.goto(U3);
  await r.waitForSelector('#in-name');
  await r.click('.rejoin [data-act="claim"]:has-text("Piet")');
  await r.waitForSelector('#c-pin');
  await r.fill('#c-pin', '9999');
  await r.click('[data-act="claim-check"]');
  ok((await txt(r, '#c-msg')).includes('klopt niet'), 'andermans naam overnemen lukt niet zonder pincode');
  await r.fill('#c-pin', '2222');
  await r.click('[data-act="claim-check"]');
  await r.waitForSelector('.round');
  ok((await txt(r, '.round')).includes('Sander & Piet'), 'telefoon leeg: met je pincode log je op een ander toestel weer in');
  const T = await mk('T');
  await T.page.goto(U3);
  await T.page.waitForSelector('#in-name');
  await T.page.fill('#in-name', 'lotte');
  await T.page.fill('#in-ppin', '0000');
  await T.page.click('[data-act="join"]');
  await T.page.waitForSelector('#c-pin');
  ok(await T.page.locator('.tabs').count() === 0, 'een tweede keer meedoen onder dezelfde naam vraagt om de pincode');

  // geen bereik: teugen van beide teamgenoten worden later samengevoegd
  await goHole(o, 11);
  await o.click('.who [data-act="pick-unit"]:has-text("Sander")');
  await sleep(200);
  await goHole(r, 11);
  await R.ctx.setOffline(true);
  await r.click('[data-act="sip"][data-d="1"]');
  await r.click('[data-act="sip"][data-d="1"]');
  await o.click('[data-act="sip"][data-d="1"]');
  await sleep(700);
  ok(await count(o, 1) && /wacht/.test(await txt(r, '.status')), 'zonder bereik blijven de teugen op de telefoon in de wachtrij staan');
  await R.ctx.setOffline(false);
  ok(await count(o, 3) && await count(r, 3), 'terug online worden de teugen van beide teamgenoten opgeteld, niets raakt kwijt');

  // een kroeg is dicht: hij vervalt en telt voor niemand mee
  await goHole(o, 12);
  await o.click('.hero [data-act="hole-edit"]');
  await o.waitForSelector('#h-off');
  await o.click('#h-off');
  await o.click('[data-act="hole-save"]');
  await o.waitForFunction(() => !document.querySelector('.sheet'));
  await q.click('[data-act="tab"][data-tab="holes"]');
  await q.waitForFunction(() => { const x = document.querySelector('.round'); return x && x.textContent.includes('van 13 holes') && document.querySelectorAll('.hole.off').length === 1; }, null, { timeout: 6000 }).then(() => ok(true, 'kroeg dicht: hij vervalt en telt voor niemand mee')).catch(() => ok(false, 'kroeg dicht: hij vervalt en telt voor niemand mee'));
  await fits(q, 'holes met vervallen kroeg');
  await shot(q, '35-holes-team');

  console.log(fails ? `\n${fails} FAILS` : '\nALL PASS');
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
