# YouTube-Kanaltexte

Zum Kopieren in YouTube Studio → **Anpassen** → **Basisinfos** bzw. **Branding**.

---

## Kanalbeschreibung

> YouTube erlaubt 1.000 Zeichen. Der Text unten nutzt rund 780 — Luft für Ergänzungen.
> Nur die ersten ein bis zwei Zeilen sind in der Vorschau sichtbar, deshalb steht das
> Versprechen ganz vorn.

```
Finanzwissen für Deutschland – in 25 Sekunden statt 25 Minuten.

Jeden Tag ein konkretes Thema: was der Dispo wirklich kostet, warum Steuerklasse drei aufs Jahr gerechnet keinen Euro spart, welche Zeile auf deiner Abrechnung dich dreistellig im Jahr kostet. Ein Video, eine Idee, Zahlen statt Adjektiven.

Für alle, die ihre Finanzen endlich sortieren wollen und weder Vorwissen noch Lust auf Fachchinesisch haben. Kein Motivationsgerede, keine Kurse, keine Geheimtipps.

Themen: Sparen und Fixkosten, ETFs und Zinseszins, gesetzliche Rente und Altersvorsorge, Steuererklärung und Freibeträge, Girokonto und Bankgebühren, Versicherungen, brutto und netto.

Auch auf Instagram: @geld.pinguin

Keine Anlageberatung. Alles hier ist Bildung, keine Empfehlung für einzelne Produkte oder Wertpapiere. Angaben ohne Gewähr.
```

---

## Kurzfassung für „Über mich" in der Suche

```
Finanzwissen für Deutschland – jeden Tag ein Thema in 25 Sekunden. Kein Fachchinesisch, keine Geheimtipps.
```

---

## Kanal-Keywords

Unter **Einstellungen → Kanal → Basisinfos → Keywords**. Kommagetrennt:

```
Finanzen, Finanzbildung, Geld sparen, ETF, Altersvorsorge, Steuererklärung, Rente, Girokonto, Bankgebühren, Versicherungen, Finanzen für Anfänger, Geldtipps, Deutschland, Shorts
```

---

## Banner

Datei: `assets/youtube-banner.png`, 2560 × 1440 Pixel.

Hochladen unter **Anpassen → Branding → Banner-Bild**.

YouTube schneidet das Banner je nach Gerät unterschiedlich zu. Sichtbar auf **allen**
Geräten ist nur ein Bereich von 1546 × 423 Pixeln in der Mitte — der gesamte Text
liegt dort drin, an den Rändern steht bewusst nichts.

Neu erzeugen, etwa nach einer Textänderung:

```bash
node scripts/banner.js
```

Text und Farben stehen oben in `scripts/banner.js`.
