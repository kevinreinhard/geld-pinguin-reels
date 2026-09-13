---
name: reel-qualitaet
description: Das Aussehen der geld.pinguin-Reels messen und verbessern. Nutzen, wenn die Videos schlecht aussehen, ein neuer Kartentyp gebaut werden soll, eine Designänderung zu prüfen ist, oder allgemein gefragt wird, wie man die Reels hochwertiger macht.
---

# Bildqualität der Reels

Ein Kreis aus vier Schritten: rendern, ansehen, ändern, wieder ansehen. Er ist
absichtlich so aufgebaut, dass jede Änderung an einem Bild gemessen wird und
nicht an einer Vermutung.

## Der Kreis

```bash
python scripts/layoutprobe.py         # läuft irgendein Kartentyp über? (5 Sekunden)
node scripts/musterreel.js --nr 0     # rendert build/reel.mp4, kein API-Schlüssel nötig
node scripts/qa.js                    # Claude benotet das Ergebnis (braucht ANTHROPIC_API_KEY)
```

`layoutprobe.py` rendert jeden Kartentyp mit absichtlich zu langen Texten und
prüft, ob Farbe außerhalb der erlaubten Fläche liegt. Sie läuft in beiden
Workflows als Sperre, bevor irgendetwas gerendert oder gepostet wird. Zweimal
ist genau dieser Fehler vorher durchgerutscht — einmal bis auf Instagram. Wer
einen Kartentyp ändert, führt sie aus, bevor er rendert.

`musterreel.js` arbeitet mit festen Skripten und festen Szenenplänen. Das ist der
Punkt: Zwischen zwei Läufen ändert sich nur das Design, nie der Inhalt — sonst
lässt sich nicht sagen, ob eine Änderung etwas gebracht hat. `--liste` zeigt die
Muster, `--regie` lässt stattdessen die echte Bildregie planen.

`qa.js` schneidet acht Einzelbilder heraus, legt sie Claude vor und schreibt die
Noten nach `data/qualitaet.json`. Der Verlauf steht in
`data/qualitaet-verlauf.json` — dort sieht man über Wochen, ob es aufwärtsgeht.

Ohne API-Schlüssel übernimmt der Agent **reel-kritiker** dieselbe Aufgabe: Er
holt die Einzelbilder selbst und sieht sie sich an.

## Wenn etwas verbessert werden soll

1. **Zuerst rendern und ansehen.** Nicht aus dem Code schließen, wie es aussieht.
   Das ist der häufigste Fehler bei dieser Arbeit — der Code sagt, was gemeint
   war, das Bild zeigt, was daraus geworden ist.
2. **Befund holen** — `qa.js` oder den Agenten `reel-kritiker`. Er benennt
   höchstens sechs Mängel, sortiert nach Schwere.
3. **Einen Mangel nach dem anderen** über den Agenten `reel-designer` beheben.
   Fünf Änderungen auf einmal, und niemand weiß mehr, welche die Verbesserung war.
4. **Neu rendern, neu benoten.** Ist die Note nicht gestiegen, war es keine
   Verbesserung — dann zurücknehmen, nicht schönreden.

Beide Agenten lassen sich parallel auf verschiedene Muster ansetzen, wenn mehrere
Kartentypen gleichzeitig zu prüfen sind.

## Wo die Stellschrauben sitzen

| Datei | Zuständig |
|---|---|
| `src/marke.js` | Farben, Stimmungen, Bildaufteilung — einzige Quelle der Wahrheit |
| `src/karten.py` | Kartenaufbau, Typografie, Diagramme, Animation |
| `src/pinguin.py` | Maskottchen |
| `src/regie.js` | Welcher Kartentyp zu welchem Satz kommt |
| `src/ass.js` | Untertitel, Titelzeile, Wasserzeichen |
| `src/render.js` | Hintergrund, B-Roll, ffmpeg |

## Was schon gemessen ist

Die erste Fassung des Kanals hatte 25 Sekunden lang denselben Farbverlauf im
Bild, Zahlen liefen nur als Fließtext durch. Vier Runden Prompt-Arbeit haben die
Views von 134 auf 148 bewegt — **am Text lag es nicht.** Der Umbau auf
Szenenkarten kam daher, nicht aus Geschmack.

Zwei Dinge sind deshalb keine Geschmacksfrage:

**Jede gesprochene Zahl gehört ins Bild.** Eine Zahl, die nur zu hören ist, ist
verloren. Steht sie als Karte, bleibt sie.

**Alle drei bis vier Sekunden muss sichtbar etwas passieren.** Sehen zwei
aufeinanderfolgende Einzelbilder gleich aus, ist der Abschnitt dazwischen ein
Standbild — und genau dort wird weitergewischt.

## Sicherheitsränder

Instagram legt über das Bild: oben rund 200 Pixel Kopfzeile, unten rund 420 Pixel
Caption und Ton-Zeile, rechts eine rund 140 Pixel breite Buttonspalte in der
unteren Bildhälfte. Die Bildaufteilung in `marke.js` hält das ein. Wer etwas
verschiebt, prüft es gegen diese Ränder.

## Neuer Kartentyp

1. Malfunktion in `karten.py` ergänzen und in `Maler.TYPEN` eintragen.
2. Typ in `src/regie.js` in `TYPEN`, ins Tool-Schema und in den Prompt aufnehmen —
   samt den Feldern, die er braucht.
3. Prüfung in `pruefeSzenen` ergänzen: Fehlen die Felder, muss der Typ auf
   `stichwort` zurückfallen. Ein Modell liefert nicht in hundert Prozent der
   Fälle vollständige Daten, und ein Absturz kostet den Beitrag des Tages.
4. Ein Muster in `scripts/musterreel.js` anhängen, das den Typ zeigt.
