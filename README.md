# ⛳ Pubgolf

Scorekaart-webapp voor een pubgolf: iedereen opent de link op z'n eigen telefoon, vult een naam in en telt per hole z'n teugen. De stand werkt live bij.

- **Holes** met een vast drankje en par, of een **rad** dat je drankje en par bepaalt (ieder draait zelf, of één draai voor de groep).
- **Teugen tellen** met een grote +1-knop; in één keer leeg is een hole-in-one. Strafslagen en "niet opgedronken" tellen mee.
- **Live stand en scorekaart**, met meldingen als iemand een hole afrondt.
- **Organisator-modus** (pincode): holes aanpassen, de actieve hole kiezen, spelers zonder telefoon toevoegen en scores van anderen invullen.
- Werkt ook met slecht bereik: scores worden op de telefoon bewaard en verstuurd zodra er weer verbinding is.

Er is geen build-stap. Het is één statische pagina (`index.html`, `app.js`, `style.css`).

## Online zetten

### 1. Database voor de live scores

De app synchroniseert via een gratis Firebase Realtime Database.

1. Ga naar [console.firebase.google.com](https://console.firebase.google.com) en maak een project aan (Analytics mag uit).
2. Kies links **Build → Realtime Database → Create Database**, locatie België, en start in **test mode**.
3. Kopieer de URL bovenaan (`https://…-default-rtdb.europe-west1.firebasedatabase.app`).

Zet die URL in `config.js` bij `db`, of plak hem in de app zelf. In dat laatste geval zit de URL in de uitnodigingslink.

Test mode betekent dat iedereen met de URL kan lezen en schrijven. Firebase sluit die toegang na 30 dagen automatisch.

### 2. De site

Zet de bestanden op een statische host. Met GitHub Pages: **Settings → Pages → Deploy from a branch**, kies de branch en de map `/ (root)`. Gratis GitHub Pages vereist een publieke repo.

## Op de avond zelf

1. De organisator opent de site, maakt het spel aan en kiest een pincode.
2. Op het tabblad **Holes** tik je op **Holes bewerken** om de kroegen, drankjes, par en raden in te vullen.
3. Deel de link of QR-code via **Meer → Nodig iedereen uit**.
4. Bij elke kroeg: open de hole, draai eventueel aan het rad, tel je teugen en tik op **Glas leeg**.

Een nieuwe avond met een schone lei? Verander `game` in `config.js`, of gebruik **Meer → Alle scores wissen**.

## Zonder database

Kies op het startscherm **Alleen op dit toestel spelen**. Eén telefoon houdt dan de scores van iedereen bij. Koppel je later alsnog een database, dan kun je het lokale spel overnemen.

## Lokaal ontwikkelen

```sh
node tools/dev-server.js
# open http://localhost:8787/?db=http://localhost:8787/db
```

De dev-server serveert de app en een nagemaakte Firebase-database, zodat je live sync met meerdere tabbladen kunt testen. `tools/e2e.js` speelt een hele avond na met meerdere telefoons (vereist het npm-pakket `playwright`).

De QR-code komt uit [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), opgenomen in `vendor/`.
