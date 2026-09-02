# geld.pinguin – automatische Reel-Produktion

Baut alle drei Stunden ein fertiges Instagram-Reel und veröffentlicht es selbst.
Kein Klick nötig, nachdem die Einrichtung einmal steht.

**Einrichtung:** [Anleitung als Webseite](https://claude.ai/code/artifact/beac596a-e3bf-4bde-8c7f-4d7ceba2fb96) · Kurzfassung in [SETUP.md](SETUP.md)

---

## Was pro Lauf passiert

| # | Schritt | Womit |
|---|---|---|
| 1 | Themensäule ziehen, zuletzt genutzte abwerten | `src/pillar.js` |
| 2 | Skript, Titel, Caption und Hashtags schreiben | Claude Opus 5, `src/script.js` |
| 3 | Text einsprechen, Wort-Zeitstempel mitnehmen | Edge TTS, `src/tts.py` |
| 4 | Video rendern: Verlauf, Titelkarte, Karaoke-Untertitel | ffmpeg + libass, `src/render.js` |
| 5 | Video öffentlich ablegen | GitHub Release oder R2, `src/upload.js` |
| 6 | Reel-Container anlegen, warten, veröffentlichen | Instagram Graph API, `src/instagram.js` |
| 7 | Thema in die Historie schreiben | `data/history.json` |

Ergebnis: 1080 × 1920, 30 fps, H.264/AAC, ca. 25–35 Sekunden, 4–6 MB.

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
```

Voraussetzung: `ANTHROPIC_API_KEY` in der Umgebung, für den letzten Befehl zusätzlich
`IG_ACCESS_TOKEN` sowie `GITHUB_REPOSITORY` und `GITHUB_TOKEN` (oder die R2-Variablen).

---

## Stellschrauben

Fast alles steckt in **`src/config.js`**:

| Was | Wo |
|---|---|
| Themensäulen und ihre Gewichtung | `PILLARS` |
| Tonalität, Zielgruppe, Sprache | `CHANNEL` |
| Sprecherstimmen, Sprechtempo | `VOICE.stimmen`, `VOICE.rate` |
| Untertitel: Grösse, Farbe, Position, Wörter pro Einblendung | `CAPTIONS` |
| Hintergrund-Farbpaletten | `PALETTEN` |
| Videolänge-Grenzen, Qualität | `VIDEO` |

Weitere Stimmen anzeigen:

```bash
edge-tts --list-voices | grep "^de-"
```

**Eigene Hintergründe** statt der generierten Verläufe: MP4-Dateien nach
`assets/backgrounds/` legen (hochkant, mind. 1080 × 1920). Pro Reel wird eine
zufällig gewählt, geloopt und abgedunkelt.

**Eigene Schrift:** TTF nach `assets/fonts/` legen und `FONT_NAME` auf den
Familiennamen setzen. Ohne alles davon läuft es mit Anton, ersatzweise DejaVu Sans.

**Musik:** MP3s nach `assets/music/` legen – sie werden leise untergemischt.
Achte auf die Lizenz: Reels, die über die API kommen, können Instagrams eigene
Musikbibliothek nicht nutzen, also nur lizenzfreie Tracks verwenden.

---

## Kosten

| Posten | Pro Reel | Bei 8 Reels/Tag |
|---|---|---|
| Claude Opus 5 (Skript) | ~0.04 CHF | ~10 CHF/Monat |
| Edge TTS | gratis | gratis |
| GitHub Actions | ~4 Min. | im Gratis-Kontingent öffentlicher Repos |
| Instagram API | gratis | gratis |

---

## Zum Posting-Rhythmus

Acht Reels pro Tag sind sehr viel. Instagrams API erlaubt für diesen Kanal 100 Beiträge in 24 Stunden,
das ist nicht der Engpass – die Reichweite ist es. Erfahrungsgemäss verteilt sich bei
diesem Takt dieselbe Aufmerksamkeit auf mehr Beiträge, und stark gleichförmiger
Auto-Content kann zusätzlich gedrosselt werden.

Die Empfehlung: die ersten ein bis zwei Wochen auf 8× laufen lassen, in den Insights
die durchschnittlichen Aufrufe pro Reel beobachten und dann den Cron auf
4× oder 6× täglich reduzieren, falls die Werte pro Beitrag deutlich sinken.
Der Zeitplan steht in einer Zeile, siehe SETUP.md Abschnitt 7.

---

## Grenzen

- **Kein Bildmaterial.** Die Reels sind Text auf animiertem Verlauf plus Stimme.
  Wer echte Clips will, füllt `assets/backgrounds/`.
- **Synthetische Stimme.** Edge TTS ist gut, aber hörbar KI. Für eine natürlichere
  Stimme lässt sich `src/tts.py` gegen ElevenLabs tauschen – dann fallen Kosten an.
- **Kein Qualitäts-Gate.** Jedes generierte Skript geht live. Willst du vorher
  drüberschauen, setze den Cron aus und starte den Workflow mit `publish = false`,
  bis du zufrieden bist.
