"""Fotos eines Motorradmodells von Wikimedia Commons holen.

Aufruf: python motorrad/commons.py '<JSON-Liste Suchbegriffe>' <Zielordner> <Kürzel> [max]

Nimmt nur JPEG-Querformate mit freier Lizenz (gemeinfrei, CC0, CC BY, CC BY-SA),
lädt die 1920er-Fassung und eine 640er-Vorschau für die Bildauswahl und gibt die
Liste mit Urheber und Lizenz als JSON aus. Der Nachweis ist Pflicht: Ohne ihn
darf ein CC-Bild nicht ins Video.
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from PIL import Image, ImageOps

API = "https://commons.wikimedia.org/w/api.php"
UA = "MotorradKompassBot/1.0 (Videorecherche; python-urllib)"


def hole(url, binaer=False):
    for versuch in range(3):
        try:
            anfrage = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(anfrage, timeout=40) as antwort:
                daten = antwort.read()
            return daten if binaer else json.loads(daten.decode("utf-8"))
        except Exception as fehler:  # Commons drosselt gelegentlich
            if versuch == 2:
                raise
            print(f"  Commons-Versuch {versuch + 1}: {fehler}", file=sys.stderr)
            time.sleep(20 * (versuch + 1))  # 429: Wikimedia will Abstand, nicht Tempo


def lizenzrang(kurz):
    """0 = ohne Auflagen, 1 = Namensnennung, 2 = Namensnennung + gleiche Bedingungen, None = nicht erlaubt."""
    k = (kurz or "").lower().strip()
    if "nc" in k.split("-") or "nd" in k.split("-"):
        return None
    if k.startswith("cc0") or k.startswith("public domain") or k == "pd":
        return 0
    if k.startswith("cc by-sa") or k.startswith("cc-by-sa"):
        return 2
    if k.startswith("cc by") or k.startswith("cc-by"):
        return 1
    return None


def ohne_html(wert):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", wert or ""))).strip()


def suche(begriff):
    parameter = {
        "action": "query", "format": "json", "generator": "search",
        "gsrnamespace": "6", "gsrsearch": f"{begriff} filetype:bitmap", "gsrlimit": "25",
        "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": "1920",
    }
    daten = hole(API + "?" + urllib.parse.urlencode(parameter))
    seiten = list((daten.get("query") or {}).get("pages", {}).values())
    seiten.sort(key=lambda s: s.get("index", 999))
    return seiten


def main():
    begriffe = json.loads(sys.argv[1])
    ordner, kuerzel = sys.argv[2], sys.argv[3]
    hoechstens = int(sys.argv[4]) if len(sys.argv) > 4 else 10
    os.makedirs(ordner, exist_ok=True)

    kandidaten, gesehen = [], set()
    for begriff in begriffe:
        for seite in suche(begriff):
            info = (seite.get("imageinfo") or [{}])[0]
            titel = seite.get("title", "")
            if titel in gesehen or info.get("mime") != "image/jpeg" or not info.get("thumburl"):
                continue
            breite, hoehe = info.get("width", 0), info.get("height", 0)
            if breite < 1600 or breite < hoehe * 1.2:
                continue
            meta = info.get("extmetadata") or {}
            lizenz = ohne_html((meta.get("LicenseShortName") or {}).get("value"))
            rang = lizenzrang(lizenz)
            if rang is None:
                continue
            gesehen.add(titel)
            kandidaten.append({
                "titel": titel.replace("File:", ""),
                "autor": ohne_html((meta.get("Artist") or {}).get("value"))[:80] or "unbekannt",
                "lizenz": lizenz,
                "seite": info.get("descriptionurl", ""),
                "rang": rang,
                "url": info["thumburl"],
            })
        time.sleep(0.5)

    # Stabile Sortierung: erst die Lizenz mit den wenigsten Auflagen, dann die Trefferreihenfolge.
    kandidaten.sort(key=lambda k: k["rang"])

    ergebnis = []
    for kandidat in kandidaten:
        if len(ergebnis) >= hoechstens:
            break
        nummer = len(ergebnis)
        datei = os.path.join(ordner, f"{kuerzel}-{nummer}.jpg")
        vorschau = os.path.join(ordner, f"{kuerzel}-{nummer}-klein.jpg")
        try:
            with open(datei, "wb") as f:
                f.write(hole(kandidat.pop("url"), binaer=True))
            bild = ImageOps.exif_transpose(Image.open(datei)).convert("RGB")
            bild.save(datei, quality=92)
            bild.thumbnail((640, 640))
            bild.save(vorschau, quality=80)
        except Exception as fehler:
            print(f"  Bild übersprungen ({kandidat['titel']}): {fehler}", file=sys.stderr)
            continue
        kandidat.update({"datei": datei.replace("\\", "/"), "vorschau": vorschau.replace("\\", "/")})
        ergebnis.append(kandidat)
        time.sleep(2)

    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(ergebnis, ensure_ascii=False))


if __name__ == "__main__":
    main()
