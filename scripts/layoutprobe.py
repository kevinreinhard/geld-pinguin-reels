"""Belastungsprobe fuer die Szenenkarten - findet Ueberlauf, bevor er live geht.

Zweimal hintereinander ist genau dieser Fehler durchgerutscht: einmal wurde
'mehrere 1.000 Euro' still zu 'mehrere 1.00' gekuerzt, einmal lief
'DURCHSCHNITTLICHE ERSTATTUNG' ueber die Kartenkante hinaus - und zwar im
Hook, wo es am meisten kostet. Beide Male ist es erst der Bildkontrolle
aufgefallen, also nach dem Rendern und einmal sogar nach dem Posten.

Diese Probe rendert jeden Kartentyp mit absichtlich zu langen Texten und
prueft, ob Farbe ausserhalb der erlaubten Flaeche liegt. Sie braucht weder
Modellaufruf noch ffmpeg und laeuft in wenigen Sekunden.

    python scripts/layoutprobe.py

Rueckgabecode 1, wenn etwas ueberlaeuft.
"""

import json
import os
import subprocess
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
import karten  # noqa: E402

LANG = "Durchschnittliche Erstattung bei freiwilliger Abgabe"
LAENGER = "Eine Aussage, die viel zu lang ist fuer die Karte und trotzdem passen muss"

FAELLE = [
    {"typ": "kennzahl", "stimmung": "gut", "kicker": LANG,
     "wert": "1.234.567,89", "einheit": "Prozentpunkte", "fussnote": LAENGER},
    {"typ": "vergleich", "stimmung": "warnung", "kicker": LANG, "zeilen": [
        {"label": "Eine sehr lange Bezeichnung ohne Ende", "wert": "1.234.567 €",
         "anteil": 1, "stimmung": "warnung"},
        {"label": "Noch eine lange Bezeichnung", "wert": "999.999 €",
         "anteil": 0.4, "stimmung": "gut"},
        {"label": "Und eine dritte", "wert": "1 €", "anteil": 0.05, "stimmung": "info"},
    ]},
    {"typ": "liste", "stimmung": "info", "kicker": LANG, "punkte": [
        {"text": LAENGER, "zeichen": "ja"},
        {"text": LAENGER, "zeichen": "nein"},
        {"text": "Kurz", "zeichen": "punkt"},
        {"text": LAENGER, "zeichen": "ja"},
    ]},
    {"typ": "verlauf", "stimmung": "gut", "kicker": LANG,
     "werte": [0, 3, 5, 9, 14, 21, 29, 40, 53], "von": "eine lange Beschriftung",
     "bis": "eine noch laengere Beschriftung", "endwert": "1.234.567 €"},
    {"typ": "stichwort", "stimmung": "warnung", "kicker": LANG,
     "begriff": LAENGER, "erlaeuterung": LAENGER},
    {"typ": "hook", "stimmung": "neutral", "begriff": LAENGER},
    # Ein einziges, nicht umbrechbares Wort. Genau daran ist die Pruefung
    # vorbeigelaufen: Die Zeilenzahl stimmte, die Breite nicht.
    {"typ": "hook", "stimmung": "warnung", "begriff": "Gehaltserhoehungsverhandlung"},
    {"typ": "stichwort", "stimmung": "info",
     "begriff": "Grundstuecksverkehrsgenehmigungszustaendigkeit",
     "erlaeuterung": "Rentenversicherungsbeitragsbemessungsgrenze"},
    {"typ": "endkarte", "stimmung": "neutral", "begriff": LAENGER},
]

# Toleranz: Der Lichtsaum des Pinguins und der weiche Kartenschatten duerfen
# ueber die Kartenkante hinausreichen, sie tragen keine Information.
SCHWACH = 90


def marke():
    """Holt das Designsystem aus src/marke.js - eine Quelle der Wahrheit."""
    roh = subprocess.run(
        ["node", "-e",
         "import('./src/marke.js').then(m=>console.log(JSON.stringify(m.markenSpezifikation())))"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(roh.stdout)


def pruefe(maler, szene, rand):
    """Liefert die Liste der Verstoesse fuer eine Szene."""
    bild = maler.zeichne_szene(szene, 1.0, 1.0, 0)
    alpha = bild.getchannel("A").point(lambda v: 255 if v > SCHWACH else 0)
    kasten = alpha.getbbox()
    if not kasten:
        return ["zeichnet gar nichts"]

    links, oben, rechts, unten = kasten
    fehler = []
    if links < rand["x0"]:
        fehler.append(f"links {rand['x0'] - links} px ueber den Rand")
    if rechts > rand["x1"]:
        fehler.append(f"rechts {rechts - rand['x1']} px ueber den Rand")
    if oben < rand["y0"]:
        fehler.append(f"oben {rand['y0'] - oben} px ueber die Buehne")
    if unten > rand["y1"]:
        fehler.append(f"unten {unten - rand['y1']} px ueber die Buehne")
    return fehler


def main():
    spez = marke()
    L = spez["layout"]
    maler = karten.Maler({"marke": spez, "handle": "@geld.pinguin"})

    # Der Farbschleier der Szene ist absichtlich vollflaechig - er zaehlt nicht mit.
    maler.glanz = lambda szene: Image.new("RGBA", (maler.W, maler.H), (0, 0, 0, 0))

    rand = {
        "x0": L["randX"] - 30,
        "x1": L["breite"] - L["randX"] + 30,
        # Das Maskottchen lugt ueber die obere Kartenkante hinaus.
        "y0": L["buehneOben"] - 130,
        "y1": L["buehneUnten"] + 10,
    }
    print(f"Erlaubte Flaeche: x {rand['x0']}..{rand['x1']}, y {rand['y0']}..{rand['y1']}\n")

    schlecht = 0
    for szene in FAELLE:
        fehler = pruefe(maler, {"satz": 1, **szene}, rand)
        if fehler:
            schlecht += 1
            print(f"  FEHLER  {szene['typ']:<10} {', '.join(fehler)}")
        else:
            print(f"  ok      {szene['typ']}")

    if schlecht:
        print(f"\n{schlecht} von {len(FAELLE)} Kartentypen laufen ueber.")
        return 1
    print(f"\nAlle {len(FAELLE)} Kartentypen halten die Flaeche ein.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
