---
name: pinguin-report
description: Kennzahlen des Instagram-Kanals geld.pinguin abholen, auswerten und den Befund erklären. Nutzen, wenn nach Reichweite, Views, Followern, der Performance einzelner Reels oder danach gefragt wird, ob die Automatisierung etwas bringt.
---

# Kanalanalyse geld.pinguin

Beantwortet die Frage „läuft der Kanal?" mit gemessenen Zahlen statt mit Vermutungen.

## Ablauf

Beide Skripte brauchen Zugangsdaten in der Umgebung. Sind sie nicht gesetzt, frag
danach, statt zu raten — sie stehen als Secrets im Repo `kevinreinhard/geld-pinguin-reels`.

```bash
node scripts/insights.js   # braucht IG_ACCESS_TOKEN
node scripts/analyse.js    # braucht ANTHROPIC_API_KEY
```

`insights.js` hängt eine Messung an `data/performance.json` an.
`analyse.js` schreibt einen Bericht nach `data/berichte/JJJJ-MM-TT.md` und passt
`data/tuning.json` an — aber nur oberhalb der Datenschwelle im Skript.

Lies danach den erzeugten Bericht und gib den Befund im Chat wieder.

## Wie du die Zahlen liest

**Views sind nicht vergleichbar zwischen unterschiedlich alten Reels.** Ein Reel von
gestern hatte weniger Zeit als eines von letzter Woche. Vergleiche nur ähnlich alte
Beiträge oder rechne auf Views pro Tag um.

**Einstellige Unterschiede sind Rauschen.** Bei 3 gegen 9 Views gibt es kein Thema,
das „besser funktioniert" — es gibt nur Zufall. Sag das, statt es zu deuten. Die
Versuchung, in wenigen Datenpunkten ein Muster zu erkennen, ist der häufigste Fehler
bei dieser Art Auswertung.

**Der Engpass liegt fast immer beim Publikum, nicht am Inhalt.** Solange die
Followerzahl im niedrigen zweistelligen Bereich liegt, verteilt Instagram jeden
Beitrag nur an eine winzige Testgruppe. Kein Prompt und keine Hashtag-Liste ändert
daran etwas. Wenn die Daten das zeigen, sag es deutlich, statt Optimierungen
vorzuschlagen, die nichts bewirken können.

**Was tatsächlich zählt, in dieser Reihenfolge:** ob überhaupt Reach über null
entsteht, ob die Followerzahl sich bewegt, und erst danach, welches Thema besser lief.

## Wenn nach Verbesserungen gefragt wird

Die Stellschrauben stehen in `data/tuning.json` und sind in `src/tuning.js`
hart begrenzt: Säulengewichte 0.25 bis 5, Zielwortzahl 45 bis 90, höchstens
fünf Hook-Hinweise. Ändere sie über `speichereTuning()`, nie von Hand — die
Funktion prüft und kappt die Werte.

Die Posting-Zeiten (`postSlots`) sind bewusst der Handarbeit vorbehalten. Der
Analyse-Agent fasst sie nicht an.

Änderungen am Quellcode selbst — Prompt, Rendering, Themensäulen — bespricht man
mit dem Kanalinhaber, statt sie automatisch vorzunehmen.
