# geld.pinguin – automatische Reel-Produktion

Baut viermal täglich ein fertiges Instagram-Reel und veröffentlicht es selbst.
Kein Klick nötig, nachdem die Einrichtung einmal steht.

**Einrichtung:** [Anleitung als Webseite](https://claude.ai/code/artifact/beac596a-e3bf-4bde-8c7f-4d7ceba2fb96) · Kurzfassung in [SETUP.md](SETUP.md)

---

## Was pro Lauf passiert

| # | Schritt | Womit |
|---|---|---|
| 1 | Themensäule ziehen, zuletzt genutzte abwerten | `src/pillar.js` |
| 2 | Skript, Titel, Caption und Hashtags schreiben | Claude Opus 5, `src/script.js` |
| 3 | Text einsprechen, Wort-Zeitstempel mitnehmen | Edge TTS, `src/tts.py` |
| 4 | Bildregie: zu jedem Satz die Karte festlegen, die dabei zu sehen ist | Claude Opus 5, `src/regie.js` |
| 5 | Szenenkarten zeichnen: Zahlen, Balken, Kurven, Listen, Maskottchen | Pillow, `src/karten.py` |
| 6 | Video montieren: Hintergrund, Karten, Untertitel, optional B-Roll | ffmpeg + libass, `src/render.js` |
| 7 | Video öffentlich ablegen | GitHub Release oder R2, `src/upload.js` |
| 8 | Reel-Container anlegen, warten, veröffentlichen | Instagram Graph API, `src/instagram.js` |
| 9 | Optional: dasselbe Video als YouTube Short | `src/youtube.js` |
| 10 | Bildqualität benoten, Thema in die Historie schreiben | `scripts/qa.js`, `data/history.json` |

Ergebnis: 1080 × 1920, 30 fps, H.264/AAC, 20–30 Sekunden, 3–5 MB.

---

## Was im Bild passiert

Bis September 2026 lief 25 Sekunden lang derselbe Farbverlauf, Zahlen kamen nur
als Fließtext vorbei. Vier Runden Prompt-Arbeit haben die Views von 134 auf 148
bewegt – **am Text lag es nicht.**

Seitdem plant eine eigene Bildregie zu jedem gesprochenen Satz eine Karte. Sechs
Typen stehen zur Wahl:

| Typ | Wofür | Was sich bewegt |
|---|---|---|
| `kennzahl` | Der Satz dreht sich um eine Zahl | Die Zahl zählt hoch |
| `vergleich` | Zwei bis drei Größen stehen gegeneinander | Die Balken wachsen versetzt |
| `verlauf` | Eine Entwicklung über Zeit | Die Kurve wächst von links |
| `liste` | Zwei bis vier Schritte oder Merkmale | Punkte klappen nacheinander herein |
| `stichwort` | Eine Aussage, die kein Diagramm hergibt | Karte fährt ein |
| `hook` / `endkarte` | Einstieg und Abspann | Der Pinguin |

Jede Szene hat eine Stimmung – Kosten sind rot, Ertrag grün, Erklärung blau –,
die Karte, Balken und den Farbschleier im Hintergrund einfärbt. Bei jedem Satz
wechselt damit sichtbar das Bild.

Zwei Regeln liegen dem zugrunde und sind keine Geschmacksfrage: **Jede
gesprochene Zahl gehört ins Bild**, und **alle drei bis vier Sekunden muss
sichtbar etwas passieren.**

---

## Lokal ausprobieren

```bash
npm install
pip install -r requirements.txt
# ffmpeg muss im PATH sein
```

```bash
# Nur den Text sehen, nichts rendern
node src/index.js --script-only

# Komplettes Video bauen, aber nicht posten  ->  build/reel.mp4
node src/index.js --no-publish

# Alles inklusive Veröffentlichung
node src/index.js

# Einen fertigen Beitrag wiederholen, statt ein neues Skript zu schreiben
node src/index.js --skript data/wiederholung.json
```

`--skript` lädt eine zuvor erzeugte `script.json` (sie hängt als Artefakt an
jedem Workflow-Lauf). Gedacht für den Fall, dass am Renderer etwas kaputt war:
Der Text ist in Ordnung, nur das Bild war es nicht — dann soll genau dieser
Beitrag zurück, nicht irgendein anderer. Im Workflow steht dafür das Feld
**skript**.

Voraussetzung: `ANTHROPIC_API_KEY` in der Umgebung, für den letzten Befehl zusätzlich
`IG_ACCESS_TOKEN` sowie `GITHUB_REPOSITORY` und `GITHUB_TOKEN` (oder die R2-Variablen).

**Am Design arbeiten – ohne Modellaufrufe:**

```bash
npm run layout                  # läuft ein Kartentyp über? (5 Sekunden, statisch)
npm run vorschau                # Instagram-Oberfläche über das Bild legen
npm run muster                  # festes Musterreel rendern, kein API-Schlüssel nötig
node scripts/musterreel.js --liste
npm run qa                      # Claude benotet build/reel.mp4 (braucht den Schlüssel)
```

`musterreel.js` nutzt feste Skripte und feste Szenenpläne. Zwischen zwei Läufen
ändert sich damit nur das Design – sonst lässt sich nicht sagen, ob eine Änderung
etwas gebracht hat.

---

## Stellschrauben

Fast alles steckt in **`src/config.js`**:

| Was | Wo |
|---|---|
| Themensäulen und ihre Gewichtung | `PILLARS` |
| Tonalität, Zielgruppe, Sprache | `CHANNEL` |
| Sprecherstimmen, Sprechtempo | `VOICE.stimmen`, `VOICE.rate` |
| Untertitel: Grösse, Farbe, Wörter pro Einblendung | `CAPTIONS` |
| Videolänge-Grenzen, Qualität | `VIDEO` |

Alles Gestalterische steht in **`src/marke.js`**: Farben, Stimmungen,
Schriftpfade und die Bildaufteilung (wo Titel, Karte, Untertitel und
Fortschrittsbalken sitzen). Von dort wandern die Werte als JSON nach
`src/karten.py` – ein Hexwert gehört nie in den Renderer.

Weitere Stimmen anzeigen:

```bash
edge-tts --list-voices | grep "^de-"
```

**Echtes Filmmaterial:** Mit einem kostenlosen Schlüssel von
[pexels.com/api](https://www.pexels.com/api/) in `PEXELS_API_KEY` sucht die
Bildregie zu passenden Szenen selbst einen hochkanten Clip und legt ihn
abgedunkelt hinter die Karte – höchstens zweimal pro Reel. Ohne Schlüssel
passiert nichts, das Reel läuft auf seinem gezeichneten Hintergrund.

**Eigene Schrift:** TTF nach `assets/fonts/` legen und `FONT_NAME` auf den
Familiennamen setzen. Ohne alles davon läuft es mit Anton, ersatzweise DejaVu Sans.

**Musik:** MP3s nach `assets/music/` legen – sie werden leise untergemischt.
Achte auf die Lizenz: Reels, die über die API kommen, können Instagrams eigene
Musikbibliothek nicht nutzen, also nur lizenzfreie Tracks verwenden.

---

## Kosten

| Posten | Pro Reel | Bei 4 Reels/Tag |
|---|---|---|
| Claude Opus 5 (Skript) | ~0.04 CHF | ~5 CHF/Monat |
| Edge TTS | gratis | gratis |
| GitHub Actions | ~3 Min. | im Gratis-Kontingent öffentlicher Repos |
| Instagram API | gratis | gratis |

---

## Zum Posting-Rhythmus

Eingestellt sind **4 Reels pro Tag** um 8, 12, 18 und 21 Uhr deutscher Zeit.

Ursprünglich lief der Kanal auf 8× täglich. Die Insights zeigten danach, dass die
kleine Testverteilung, die Instagram einem jungen Konto gibt, sich auf zu viele
Beiträge verteilt – keiner sammelt genug Signal. Vier Posts bündeln dieselbe
Aufmerksamkeit auf halb so vielen Reels.

Die API-Grenze von 100 Beiträgen in 24 Stunden ist dabei nie der Engpass, die
Reichweite ist es. Der Zeitplan steht in einer Zeile, siehe SETUP.md Abschnitt 7.

---

## Grenzen

- **Synthetische Stimme.** Edge TTS ist gut, aber hörbar KI. Nach dem Bild ist
  die Stimme der größte verbliebene Qualitätsabstand. Für eine natürlichere
  lässt sich `src/tts.py` gegen ElevenLabs tauschen – dann fallen Kosten an.
- **Kein Qualitäts-Gate.** Die Bildkontrolle benotet jeden Lauf, blockiert ihn
  aber nicht: Ein Modellurteil über Geschmack soll den Tagesbeitrag nicht kosten.
  Willst du vorher drüberschauen, setze den Cron aus und starte den Workflow mit
  `publish = false`.
- **Keine Fotos, keine Gesichter.** Die Bildsprache ist gezeichnet. Das ist eine
  Entscheidung, keine Lücke – Stockmaterial zu Finanzthemen ist beliebig, und ein
  Diagramm trägt die Aussage besser als ein Büroclip.

---

## Qualität dauerhaft verbessern

`scripts/qa.js` legt Claude acht Einzelbilder des fertigen Reels vor und lässt
sechs Dimensionen benoten – Hook, Lesbarkeit, Bildwechsel, Information, Marke,
Sicherheitsränder. Ergebnis nach `data/qualitaet.json`, Verlauf nach
`data/qualitaet-verlauf.json`. Der Verlauf ist der eigentliche Wert: Er zeigt
über Wochen, ob eine Designänderung etwas gebracht hat.

Dazu drei Helfer in `.claude/`:

| | Was |
|---|---|
| Skill `reel-qualitaet` | Der Kreis aus rendern, ansehen, ändern, wieder ansehen |
| Agent `reel-kritiker` | Sieht sich gerenderte Reels an und benennt Mängel konkret |
| Agent `reel-designer` | Setzt die Befunde in `karten.py` und `marke.js` um |
