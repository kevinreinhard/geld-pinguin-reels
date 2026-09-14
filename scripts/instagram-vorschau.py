"""Legt Instagrams Bedienoberflaeche ueber ein Einzelbild des Reels.

Die Bildaufteilung in src/marke.js ist ein Kompromiss: Wer alles nach oben
schiebt, ist sicher vor Caption und Ton-Zeile, verschenkt aber die halbe
Flaeche. Wer nach unten schiebt, nutzt das Bild und riskiert, dass die App
darueberliegt. Darueber laesst sich endlos streiten - oder man sieht nach.

Die Masse stammen aus Metas Vorgaben fuer Reels im Format 1080x1920: oben die
Kopfzeile, unten Profilzeile, Caption und Ton-Zeile, rechts die Buttonspalte.
Sie sind eine gute Naeherung, kein Pixelabgleich mit jedem Geraet - auf einem
schmalen Display schiebt sich die Oberflaeche weiter herein.

    python scripts/instagram-vorschau.py                 build/reel.mp4, drei Zeitpunkte
    python scripts/instagram-vorschau.py video.mp4 4.5   ein bestimmter Zeitpunkt

Ergebnis: build/instagram-vorschau.png
"""

import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter

W, H = 1080, 1920

# Was die App ueber das Video legt.
KOPFZEILE = (0, 0, W, 210)          # Status- und Titelzeile
UNTEN = (0, 1500, W, H)             # Profil, Caption, Ton-Zeile
BUTTONS = (920, 980, W, 1520)       # Spalte rechts: Gefaellt mir, Kommentar, Teilen


def zeichne_oberflaeche(bild):
    """Malt eine grobe Nachbildung der Reels-Oberflaeche auf das Bild."""
    ebene = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ebene)

    # Verlauf nach unten, wie ihn Instagram hinter die Caption legt
    for i in range(UNTEN[1], H):
        anteil = (i - UNTEN[1]) / (H - UNTEN[1])
        d.line([(0, i), (W, i)], fill=(0, 0, 0, int(30 + 150 * anteil)))
    for i in range(0, KOPFZEILE[3]):
        anteil = 1 - i / KOPFZEILE[3]
        d.line([(0, i), (W, i)], fill=(0, 0, 0, int(120 * anteil)))

    # Profilzeile und Caption
    d.ellipse([46, 1556, 122, 1632], fill=(255, 255, 255, 210))
    d.rounded_rectangle([146, 1572, 430, 1608], radius=18, fill=(255, 255, 255, 210))
    d.rounded_rectangle([446, 1570, 590, 1612], radius=21, outline=(255, 255, 255, 210), width=4)
    for i, breite in enumerate((820, 640)):
        d.rounded_rectangle([46, 1668 + i * 52, 46 + breite, 1700 + i * 52],
                            radius=14, fill=(255, 255, 255, 150))
    d.rounded_rectangle([46, 1790, 520, 1822], radius=14, fill=(255, 255, 255, 120))

    # Buttonspalte rechts
    for i in range(4):
        y = BUTTONS[1] + 30 + i * 128
        d.ellipse([968, y, 1032, y + 64], fill=(255, 255, 255, 205))
        d.rounded_rectangle([976, y + 78, 1024, y + 98], radius=10, fill=(255, 255, 255, 150))

    # Kopfzeile
    d.rounded_rectangle([46, 96, 300, 134], radius=16, fill=(255, 255, 255, 200))
    d.ellipse([1000, 96, 1044, 140], fill=(255, 255, 255, 200))

    zusammen = bild.convert("RGBA")
    zusammen.alpha_composite(ebene)
    return zusammen


def markiere_zonen(bild):
    """Zeichnet die Grenzen der drei Zonen ein, damit sie messbar sind."""
    d = ImageDraw.Draw(bild)
    for kasten, text in ((KOPFZEILE, "Kopfzeile"), (UNTEN, "Caption und Ton"),
                         (BUTTONS, "Buttons")):
        d.rectangle(kasten, outline=(255, 60, 60, 255), width=5)
        d.text((kasten[0] + 16, kasten[1] + 12), f"{text}  y={kasten[1]}",
               fill=(255, 120, 120, 255))
    return bild


def einzelbild(video, sekunde, ziel):
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(sekunde),
         "-i", video, "-frames:v", "1", ziel],
        check=True,
    )
    return Image.open(ziel)


def main():
    video = sys.argv[1] if len(sys.argv) > 1 else "build/reel.mp4"
    if not os.path.exists(video):
        print(f"{video} gibt es nicht. Erst rendern: npm run muster")
        return 1

    if len(sys.argv) > 2:
        zeiten = [float(sys.argv[2])]
    else:
        roh = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", video], capture_output=True, text=True, check=True)
        dauer = float(roh.stdout.strip())
        zeiten = [round(dauer * a, 2) for a in (0.08, 0.45, 0.82)]

    os.makedirs("build", exist_ok=True)
    kacheln = []
    for i, t in enumerate(zeiten):
        roh = einzelbild(video, t, f"build/vorschau-roh{i}.png")
        kacheln.append(markiere_zonen(zeichne_oberflaeche(roh)).convert("RGB"))

    breite = 420
    hoehe = int(H * breite / W)
    blatt = Image.new("RGB", (breite * len(kacheln) + 10 * (len(kacheln) + 1), hoehe + 20),
                      (28, 28, 28))
    for i, k in enumerate(kacheln):
        blatt.paste(k.resize((breite, hoehe), Image.LANCZOS), (10 + i * (breite + 10), 10))
    blatt.save("build/instagram-vorschau.png")
    print(f"build/instagram-vorschau.png  (Sekunde {', '.join(str(t) for t in zeiten)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
