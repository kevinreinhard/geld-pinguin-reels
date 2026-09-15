"""Belastungsprobe fuer die Szenenkarten - findet Ueberlauf, bevor er live geht.

Zweimal hintereinander ist genau dieser Fehler durchgerutscht: einmal wurde
'mehrere 1.000 Euro' still zu 'mehrere 1.00' gekuerzt, einmal lief
'DURCHSCHNITTLICHE ERSTATTUNG' ueber die Kartenkante hinaus - und zwar im
Hook, wo es am meisten kostet. Beide Male ist es erst der Bildkontrolle
aufgefallen, also nach dem Rendern und einmal sogar nach dem Posten.

Diese Probe rendert jeden Kartentyp mit absichtlich zu langen Texten und
prueft, ob Farbe ausserhalb der erlaubten Flaeche liegt.

Der dritte Durchrutscher hatte dann eine andere Ursache: Am 15.09. stand
"zaehlt oft ni" im Bild, und die Karte war nicht schuld - sie hat gezeichnet,
was ihr gegeben wurde. Gekuerzt hatte die Bildregie, mit einem harten Schnitt
mitten durch "nicht". Seither prueft diese Datei beides: ob eine Karte
ueberlaeuft, und ob der Szenenplan davor ein Wort anschneidet.

Beides braucht weder Modellaufruf noch ffmpeg und laeuft in wenigen Sekunden.

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


def karten_probe():
    """Teil 1: Laeuft eine Karte ueber die erlaubte Flaeche hinaus?"""
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


# ------------------------------------------------------------------ Szenenplan

# Die zweite Stelle, an der Text verstuemmelt werden kann, liegt vor dem
# Zeichnen: pruefeSzenen in src/regie.js haelt die Modellantwort auf die
# Laengen, die auf die Karte passen. Schneidet sie mitten in ein Wort, ist das
# Bild technisch fehlerfrei und die Aussage trotzdem kaputt - der Fall vom
# 15.09., der hier als erster Prueffall steht.

SAETZE = [
    "Viele Gratis-Konten kosten 120 Euro Kontofuehrung pro Jahr.",
    "Der Gehaltseingang vom Arbeitgeber zaehlt, Elterngeld zaehlt oft nicht.",
    "Diese drei Faelle reissen die Bedingung fast immer.",
    "Ueber zwanzig Jahre summiert sich der Betrag still weiter.",
    "Pruefe heute, welche Bedingung in deinem Vertrag steht.",
    "Speichern, bevor die Elternzeit beginnt.",
]

ROHSZENEN = [
    {"satz": 0, "typ": "kennzahl", "stimmung": "warnung",
     "kicker": "Wenn der Gehaltseingang ueber Monate fehlt",
     "wert": "120", "einheit": "Euro pro Jahr", "fussnote": LAENGER},
    # Der echte Fall: ein Wert, der als Aussage kommt statt als Zahl. Gekuerzt
    # stuende neben "Elterngeld" dasselbe "zaehlt" wie in der Zeile darueber.
    {"satz": 1, "typ": "vergleich", "stimmung": "warnung", "kicker": "", "zeilen": [
        {"label": "Gehalt vom Arbeitgeber", "wert": "zaehlt", "anteil": 1, "stimmung": "gut"},
        {"label": "Elterngeld von der Kasse", "wert": "zaehlt oft nicht",
         "anteil": 0.3, "stimmung": "warnung"},
    ]},
    {"satz": 2, "typ": "liste", "stimmung": "warnung", "kicker": LANG, "punkte": [
        {"text": LAENGER, "zeichen": "nein"},
        {"text": "Jobwechsel mit einer Luecke von mehreren Wochen", "zeichen": "nein"},
        {"text": "Krankengeld", "zeichen": "nein"},
    ]},
    {"satz": 3, "typ": "verlauf", "stimmung": "warnung", "kicker": LANG,
     "werte": [0, 120, 240, 360, 480, 600], "von": "im ersten Jahr",
     "bis": "nach zwanzig Jahren", "endwert": "2.400,00 Euro insgesamt"},
    {"satz": 4, "typ": "stichwort", "stimmung": "info", "kicker": "",
     "begriff": LAENGER, "erlaeuterung": LAENGER},
    {"satz": 5, "typ": "endkarte", "stimmung": "neutral", "kicker": "",
     "begriff": LAENGER, "erlaeuterung": "@geld.pinguin"},
]


def einsammeln(wert, sammlung):
    """Alle Zeichenketten aus einem verschachtelten Objekt."""
    if isinstance(wert, str):
        if wert.strip():
            sammlung.append(wert.strip())
    elif isinstance(wert, dict):
        for v in wert.values():
            einsammeln(v, sammlung)
    elif isinstance(wert, list):
        for v in wert:
            einsammeln(v, sammlung)
    return sammlung


def angeschnitten(ausgabe, quellen):
    """Ausgabetexte, die ein Wort ihrer Vorlage mittendrin abschneiden.

    Ein an der Wortgrenze gekuerzter Text ist in Ordnung - er sagt weniger,
    aber nichts Falsches. Bricht er dagegen im Wort ab, steht Unsinn im Bild.
    """
    treffer = []
    for text in ausgabe:
        for quelle in quellen:
            if len(text) < len(quelle) and quelle.startswith(text) and quelle[len(text)] != " ":
                treffer.append(f"'{text}' bricht '{quelle}' im Wort ab")
                break
    return treffer


def szenenplan(roh, saetze):
    """Laesst src/regie.js dieselbe Pruefung rechnen wie im echten Lauf."""
    code = (
        "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>"
        "import('./src/regie.js').then(m=>{const e=JSON.parse(d);"
        "console.log(JSON.stringify(m.pruefeSzenen(e.szenen,e.saetze)))}))"
    )
    # Das SDK verlangt den Schluessel schon beim Laden des Moduls. Benutzt wird
    # er nicht - diese Probe ruft kein Modell auf und soll ohne Zugangsdaten
    # laufen, auch auf einem frischen Rechner.
    umgebung = {**os.environ, "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY") or "probe"}
    ergebnis = subprocess.run(
        ["node", "-e", code],
        input=json.dumps({"szenen": roh, "saetze": saetze}),
        capture_output=True, text=True, encoding="utf-8", check=True, env=umgebung,
    )
    return json.loads(ergebnis.stdout)


def regie_probe():
    """Teil 2: Schneidet der Szenenplan ein Wort an?"""
    szenen = szenenplan(ROHSZENEN, SAETZE)
    quellen = einsammeln(ROHSZENEN, []) + SAETZE

    schlecht = 0
    for i, szene in enumerate(szenen):
        fehler = angeschnitten(einsammeln(szene, []), quellen)
        if fehler:
            schlecht += 1
            print(f"  FEHLER  Satz {i} ({szene['typ']}): {fehler[0]}")
        else:
            print(f"  ok      Satz {i} ({szene['typ']})")

    if schlecht:
        print()
        print(f"{schlecht} von {len(szenen)} Szenen schneiden ein Wort an.")
        return 1
    print()
    print(f"Alle {len(szenen)} Szenen kuerzen nur an Wortgrenzen.")
    return 0


def main():
    print("Teil 1 - laeuft eine Karte ueber?")
    karten = karten_probe()
    print()
    print("Teil 2 - schneidet der Szenenplan ein Wort an?")
    regie = regie_probe()
    return 1 if (karten or regie) else 0


if __name__ == "__main__":
    sys.exit(main())
