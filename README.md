# Wechselkalender

Gemeinsamer Betreuungskalender für Eltern im Wechselmodell – **ohne Server, ohne Konto, ohne Kosten**.
Die Daten liegen ausschließlich lokal auf den Handys; Änderungen werden als Links
(z. B. über WhatsApp) ausgetauscht und beim Antippen übernommen.

## Funktionen

- Monatsansicht, Tage farblich markiert: Elternteil 1 / Elternteil 2 / Beide / Nicht da (Dritte: Oma, Klassenfahrt …) / frei – Namen und Farben aller vier Markierungen frei wählbar (voller Farbwähler)
- Übergabe-Streifen entstehen **automatisch** an jedem Wechsel zwischen zwei Tagen (Mama/Papa/Beide/Nicht da; nur „frei" zählt nicht). Die Kachel trägt immer die Farbe der Seite, der der Tag gehört; der schmale Streifen sitzt dort, wo die Übergabe stattfindet: „früh" = oben auf dem ersten Tag der neuen Seite (Farbe der abgebenden Seite), „abends" = unten auf dem letzten Tag der alten Seite (Farbe der übernehmenden Seite). Die Standard-Zeit steht in den Einstellungen; zum Umstellen tippt man genau an die Stelle, wo die Übergabe hin soll (oben = früh, unten = abends)
- Monatswechsel per Pfeiltasten oder Wischgeste; Tippen auf den Monatsnamen springt zu „heute"
- Tage antippen (einen oder mehrere) → in der Leiste unten wählen, zu wem sie gehören
- Notiz pro Tag und Person (💬 bei einem ausgewählten Tag, max. 120 Zeichen): Tage mit Notiz tragen eine kleine weiße Ecke, Antippen zeigt die Texte mit Autor in der Leiste, am PC erscheinen sie als Tooltip – Notizen wandern beim Teilen mit
- Aufgaben-Marker (abschaltbar in den Einstellungen): Tage auswählen → 🎒 → wer bringt und holt (Rucksack-Badges links oben/unten) plus eine Sonderaufgabe (Stern-Badge rechts) mit optionalem Kommentar (z. B. „Papa – Mama beim Sport") – alle in der Farbe der Person, beim Antippen und am PC-Tooltip als Text
- Kind-Modus: dritte Rolle fürs Kind – sieht den ganzen Kalender und bekommt Stände wie die Eltern per Link („Push" über WhatsApp), darf aber als einziges Write eigene Notizen schreiben und zurückschicken; Einstellungen und Rollenwechsel sind PIN-geschützt (Alltagssperre, keine echte Sicherheit), und beim Zusammenführen zählen Kalender-Änderungen grundsätzlich nur, wenn sie von einem Elternteil stammen
- Änderungsvorschläge mit Ziel **pro Tag** – auch gemischt in einem Vorschlag („WE 21./22. zu mir, dafür 28./29. zu dir") – mit Annehmen / Ablehnen / Zurückziehen / **Gegenvorschlag** (lehnt das Original ab und schickt die angepasste Variante zurück)
- Unter dem Kalender: offene Vorschläge plus die letzten 3 entschiedenen; der komplette **Verlauf** liegt im Menü (⋮) und wird nach 90 Tagen automatisch zusammengefasst
- Import-Vorschau direkt im Kalender: Ein empfangener Link zeigt den vorläufigen Stand im Kalender an, geänderte Tage bekommen einen gestrichelten Farbrand; man kann durch die Monate blättern, Details als Liste (alt → neu) ansehen und erst dann übernehmen oder verwerfen
- Teilen-Knopf zeigt zuerst, was verschickt wird, mit optionaler Nachricht dazu – dann als Link ins Android-Teilen-Menü (WhatsApp etc.) oder wahlweise **Link kopieren** zum Selbst-Einfügen; die Nachricht erscheint beim Empfänger im Import-Dialog
- Abgleich-Link bringt ein zweites Handy auf den aktuellen Stand (ab dem aktuellen Monat; die Vergangenheit bleibt lokal, so bleibt der Link klein)
- Muster-Assistent: füllt einen Zeitraum mit dem Wechsel-Rhythmus (wöchentlich / 14-täglich / 2-2-3 / 2-2-5-5 / 3-4-4-3 / jedes 2. Wochenende; Wechseltag wählbar) – einzelne Tage danach wie gewohnt änderbar
- Bilanz: Tage, Wochenendtage und ganze Wochenenden pro Seite für Monat und Jahr, als Text kopierbar
- Ferien & Feiertage: Feiertage des gewählten Bundeslands werden offline berechnet (rote Unterstreichung), Ferien als Zeiträume eingetragen (gepunktete Unterstreichung, syncen per Link)
- Kalender-Export als .ics (zusammenhängende Blöcke als ganztägige Termine, z. B. für Google-/Arbeitskalender) und Druckansicht des Monats
- Rückgängig- und Wiederherstellen-Knöpfe unten links für die letzten eigenen Aktionen (bis zu 10 Schritte, bis zum nächsten Neuladen; immer sichtbar und ausgegraut, wenn gerade nichts zurückzunehmen bzw. wiederherzustellen ist)
- Vergangene Monate sind gegen versehentliches Ändern gesperrt; entsperren über das Menü (⋮)
- Backup als JSON-Datei exportieren / importieren
- App komplett zurücksetzbar (Einstellungen, ganz unten): löscht nach Sicherheitsabfrage alle lokalen Daten dieses Geräts – Kalender, Einstellungen, Archiv und Rettungskopien; der Stand auf dem anderen Handy bleibt unberührt
- Sicherheitsnetz für Updates: die App friert das fertige Kalenderbild automatisch ein (eine Kopie, die überschrieben wird – nichts sammelt sich an; aktualisiert beim Start und zwingend vor jedem Update). Kann eine künftige Version die Originaldaten nicht mehr lesen, zeigt der Kalender vergangene Monate einfach weiter an – statisch, nur lesen, 📦 in der Legende; unlesbare Altdaten werden nie überschrieben, sondern als Rettungskopie weggelegt (die letzten 3, über das Menü als Datei sicherbar)
- Installierbar als PWA („Zum Startbildschirm hinzufügen"), offline nutzbar; Aussehen wählbar in den Einstellungen: Hell / Mittel / Dunkel oder Auto (folgt der Systemeinstellung) – gilt pro Gerät und wandert nicht über Links mit

## Technik

Bewusst ohne Build-Prozess: reines HTML/CSS/JavaScript.

| Datei | Zweck |
|---|---|
| `index.html` | App-Gerüst |
| `style.css` | Gestaltung (Themes Hell/Mittel/Dunkel über `data-theme`, Auto über `prefers-color-scheme`) |
| `app.js` | Gesamte Logik: Kalender, Ereignis-Protokoll, Link-Sync |
| `manifest.webmanifest` | PWA-Manifest (Name, Icons, Standalone-Modus) |
| `sw.js` | Service Worker (Offline-Cache) |
| `icons/` | App-Icons |

### Datenmodell (Ereignis-Protokoll)

Jede Änderung ist ein Ereignis mit eindeutiger ID, Autor (`A`/`B`) und Zeitstempel:

- `assign` – Tag gehört ab jetzt `A` / `B` / `AB` (Beide) / `X` (Nicht da) / `null` (frei)
- `ho` – abweichende Übergabe-Zeit für einen Wechseltag (`m` früh / `e` abends);
  der Wechseltag selbst wird aus den Zuweisungen abgeleitet (Vortag ≠ Tag)
- `note` – kurze Notiz zu einem Tag, eine je Autor (`A`/`B`/`K` = Kind; leerer Text = gelöscht)
- `school` – Aufgaben-Marker: wer bringt/holt (`bring`/`pick`) plus eine Sonderaufgabe (`xwho`/`xnote`; alles leer = entfernt)
- `range` / `rangedel` – Zeitraum mit Label (z. B. Ferien) bzw. dessen Löschung
- `req` – Änderungsvorschlag: Ziel-Zuordnung pro Tag (`changes: { "2026-11-21": "A", … }`)
- `res` – Antwort auf einen Vorschlag (angenommen / abgelehnt / zurückgezogen)

Der Kalender ist die **Ableitung** aus allen Ereignissen: Pro Tag gewinnt der jüngste
Zeitstempel (direkte Zuweisung oder angenommene Anfrage). Dadurch ist das Zusammenführen
idempotent – Links können doppelt angetippt oder in beliebiger Reihenfolge übernommen
werden, ohne dass etwas kaputtgeht.

**Speicher bleibt klein:** Beim Start räumt die App automatisch auf. Zuweisungen ohne
Wirkung (ein neuerer Eintrag für denselben Tag gewinnt ohnehin) werden gelöscht, und
entschiedene Vorschläge bleiben 90 Tage als Verlauf sichtbar und werden danach zum
Endstand zusammengefasst (mit deterministischen IDs, damit beide Handys beim Aufräumen
zum selben Ergebnis kommen). Es bleibt also dauerhaft rund ein Ereignis pro belegtem
Tag (~100 Bytes) übrig – und der Abgleich-Link enthält ohnehin nur den Stand ab dem
aktuellen Monat.

**Sicherheitsnetz für Versionswechsel:** Updates tauschen nur die App-Hülle,
der Speicher (`localStorage`) bleibt unberührt. Zusätzlich schreibt die laufende
Version bei jedem Start – und verpflichtend, sobald ein Update gefunden wird
(`updatefound`) bzw. bevor sie sich dafür neu lädt – das fertig berechnete
Kalenderbild in ein Lese-Archiv (`wk_archive_v1`) sowie eine rohe Rettungskopie
(`wk_rescue_v1`, die letzten 3). Es ist eine einzelne Kopie, die überschrieben
wird – sie wächst nicht an und wird nur geschrieben, wenn sich etwas geändert
hat; vergangene Tage übernimmt sie dabei aus ihrer Vorgängerkopie, damit nichts
verloren geht. Das Archiv-Format ist eingefroren (v1, wird nur additiv
erweitert), damit jede künftige Version es anzeigen kann. Kann eine künftige
Version die Originaldaten nicht mehr lesen, überschreibt sie nichts, sondern
sichert den Stand als Rettungskopie – und der Kalender zeigt vergangene Monate
direkt aus dem Archiv an (statisch, nur lesen). Spielregel für
Schema-Änderungen: Felder nur ergänzen, nie umdeuten; `version` nur bei echter
Inkompatibilität erhöhen – und dann mit Migration.

### Sync-Links

Ein Link enthält die Ereignisse als JSON → deflate-komprimiert → base64url im
URL-Fragment (`#s=…`). Das Fragment wird nie an einen Server übertragen –
auch beim späteren Hosting sieht der Webserver die Kalenderdaten nicht.

## Entwickeln

Ordner in VS Code öffnen, Dateien ändern, `index.html` im Browser neu laden – fertig.
Direkt per Doppelklick (file://) funktioniert alles außer Service Worker/Installation;
für die volle PWA-Erfahrung einen kleinen statischen Server nutzen, z. B.:

```
npx serve .
```

## Veröffentlichen (kostenlos)

Eine der folgenden Möglichkeiten, alle gratis:

1. **GitHub Pages**: Repository anlegen, Dateien pushen, in den Repo-Einstellungen
   Pages aktivieren (Branch `main`, Ordner `/`). URL: `https://<name>.github.io/<repo>/`
2. **Netlify Drop**: <https://app.netlify.com/drop> öffnen und den Projektordner
   per Drag & Drop hineinziehen – fertige URL in Sekunden.
3. **Cloudflare Pages**: ähnlich, mit eigenem Account.

Danach: Link auf beiden Handys öffnen → Chrome-Menü → „Zum Startbildschirm hinzufügen".

Nach Änderungen an den Dateien die Versionsnummer in `sw.js` (`CACHE = 'wechselkalender-…'`)
hochzählen. Installierte Geräte erkennen die neue Version beim nächsten Öffnen und laden
sich automatisch einmal neu (außer mitten in einem Dialog oder einer Import-Vorschau).

## Erstes Einrichten zu zweit

1. Elternteil 1 öffnet die App, vergibt Namen/Farben, markiert die Tage.
2. Menü (⋮) → **Abgleich teilen** → Link per WhatsApp an Elternteil 2.
3. Elternteil 2 tippt den Link an, übernimmt die Daten und wählt „Wer bist du?".
4. Ab jetzt nach jeder Änderung einfach den **Teilen**-Knopf nutzen.

## Grenzen (bewusste Design-Entscheidung)

- Es gibt keinen zentralen Server: Synchron ist nur, was per Link geteilt wurde.
- Handy verloren = Daten weg, sofern kein Backup exportiert oder der Stand nicht
  per Abgleich beim anderen Elternteil vorhanden ist.
