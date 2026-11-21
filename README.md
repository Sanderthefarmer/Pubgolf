# ⛳ Pubgolf

Scorekaart-webapp voor een pubgolf: iedereen opent de link op z'n eigen telefoon, vult een naam in en telt per hole z'n teugen. De stand werkt live bij.

- **Teams**: een team deelt één glas en één score. Elke teamgenoot tikt op z'n eigen telefoon bij elke teug en de app telt alles op. Wie solo speelt mag een instelbaar aantal holes naar keuze overslaan; een overgeslagen hole telt als par.
- **Kroegen per spel instelbaar**: naam, adres, een vast drankje met par of een **rad** dat drankje en par bepaalt (elk team draait zelf, of één draai voor de groep).
- **Het rad zet je vooraf klaar** voor het hele spel. Een getrokken drankje verdwijnt van het rad, en met "dit drankje is er niet" mag je opnieuw draaien zonder dat drankje.
- **Opdracht per kroeg**, zoals Split the G bij The Dublin House: gelukt gaat van je score af, mislukt komt erbij. Per kroeg kun je ook eigen **straffen** instellen.
- **Kaart** met de route in volgorde, genummerde punten, je eigen locatie en een navigatieknop per kroeg.
- **Live stand en scorekaart**, met meldingen als een team een hole afrondt.
- Werkt ook met slecht bereik: scores worden op de telefoon bewaard en verstuurd zodra er weer verbinding is.

## Rollen en rechten

| Rol | Kan |
| --- | --- |
| **Organisator** (spelpincode) | teams indelen, kroegen en het rad aanpassen, een kroeg laten vervallen, elke score corrigeren, opnieuw laten draaien |
| **Speler** (naam en eigen pincode) | de score van het eigen team invullen, aan het rad draaien, een drankje als "niet verkrijgbaar" melden |
| **Toeschouwer** | alleen meekijken |

Een opgeslagen score kan de speler nog twee minuten herstellen (`editMinutes` in `config.js`). Daarna staat hij op slot en kan alleen de organisator hem aanpassen; dat is voor iedereen zichtbaar. Inloggen onder een bestaande naam kan alleen met de pincode van die speler of van de organisator.

Deze regels zitten in de app. De database zelf staat open (test mode), dus iemand met technische kennis kan er rechtstreeks in schrijven. Voor een avond met vrienden is dat genoeg; voor een wedstrijd met vreemden niet.

## Lobby en spelcodes

De link opent een lobby. Daar start je een eigen spel of doe je mee met een spelcode van vijf tekens. Elk spel heeft een eigen link, eigen kroegen, spelers en scores, en de lobby onthoudt per toestel welke spellen je opende.

Een spel maak je aan in vijf stappen:

1. **Het spel**: naam en organisator-pincode. Wie het spel aanmaakt is de organisator.
2. **Kroegen**: vink de kroegen aan die meedoen, zet ze op volgorde en voeg eigen kroegen toe. De 14 kroegen van Pubgolf Zwolle staan klaar.
3. **Drankjes**: per kroeg een vast drankje met par, of het rad.
4. **Het rad**: welke drankjes erop staan en of een getrokken drankje verdwijnt.
5. **Overzicht** en aanmaken.

Alles is daarna nog aan te passen via **Kroegen bewerken** en **Het rad instellen**.

Er is geen build-stap. Het is één statische pagina (`index.html`, `app.js`, `style.css`).

## Online zetten

### 1. Database voor de live scores

De app synchroniseert via een gratis Firebase Realtime Database.

1. Ga naar [console.firebase.google.com](https://console.firebase.google.com) en maak een project aan (Analytics mag uit).
2. Kies links **Build → Realtime Database → Create Database**, locatie België, en start in **test mode**.
3. Kopieer de URL bovenaan (`https://…-default-rtdb.europe-west1.firebasedatabase.app`).

Zet die URL in `config.js` bij `db`, of plak hem in de app zelf. In dat laatste geval zit de URL in de uitnodigingslink en moet wie via de lobby wil meedoen hem ook eerst plakken.

Test mode betekent dat iedereen met de URL kan lezen en schrijven. Firebase sluit die toegang na 30 dagen automatisch.

### 2. De site

Zet de bestanden op een statische host. Met GitHub Pages: **Settings → Pages → Deploy from a branch**, kies de branch en de map `/ (root)`. Gratis GitHub Pages vereist een publieke repo.

## Op de avond zelf

1. De organisator opent de site, kiest **Nieuw spel starten** en loopt de stappen door.
2. Deel de link of QR-code via **Meer → Nodig iedereen uit**, of geef de spelcode door. Iedereen kiest een naam en een pincode van 4 cijfers.
3. Deel de teams in via **Meer → Teams indelen**, voordat de eerste hole begint. Spelers zonder telefoon voeg je toe via **Speler toevoegen**.
4. Bij elke kroeg: open de hole, draai eventueel aan het rad, tik bij elke teug en tik op **Glas leeg**.

Onderweg: is een kroeg dicht of te druk, laat hem dan vervallen via **Bewerken**. Is een vast drankje er niet, pas het dan bij de kroeg aan. Telefoon leeg? Log met je naam en pincode in op een ander toestel, of laat je teamgenoot of de organisator tikken.

Een nieuwe avond met een schone lei? Start in de lobby een nieuw spel, of gebruik **Meer → Alle scores wissen** om hetzelfde spel opnieuw te spelen.

## Kaart

De kaart gebruikt kaarttegels van OpenStreetMap. Adressen worden in de browser omgezet naar een punt op de kaart via de zoekdienst van OpenStreetMap (Nominatim); daarbij wordt alleen het adres van de kroeg verstuurd. Vul bij **Spelinstellingen** de stad in, dan vindt de app adressen zonder plaatsnaam.

## Zonder database

Kies op het startscherm **Alleen op dit toestel spelen**. Eén telefoon houdt dan de scores van iedereen bij; lokale spellen staan los van spellen in een database.

## Lokaal ontwikkelen

```sh
node tools/dev-server.js
# open http://localhost:8787/?db=http://localhost:8787/db
```

De dev-server serveert de app en een nagemaakte Firebase-database, zodat je live sync met meerdere tabbladen kunt testen. `tools/e2e.js` speelt een hele avond na met meerdere telefoons (vereist het npm-pakket `playwright`).

In `vendor/` staan [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) voor de QR-code en [Leaflet](https://leafletjs.com) (BSD-2-Clause) voor de kaart.
