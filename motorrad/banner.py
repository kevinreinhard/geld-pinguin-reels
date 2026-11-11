"""Kanalbanner «Motorrad Kompass».

Aufruf: python motorrad/banner.py  ->  assets/motorrad/banner.png (2560x1440)
YouTube zeigt auf allen Geräten nur die Mitte sicher an (1546x423): Logo und Schrift bleiben darin,
der Rest ist Hintergrund für Fernseher und breite Bildschirme.
"""
import os

from PIL import Image, ImageDraw, ImageFont

from logo import AKZENT, DUNKEL, WEISS, zeichnen

B, H = 2560, 1440
SICHER = (507, 508, 2053, 932)  # links, oben, rechts, unten
WURZEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TITEL = [os.path.join(WURZEL, "assets/fonts/Anton-Regular.ttf"), "C:/Windows/Fonts/impact.ttf"]
FETT = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"]
ZEILE = "Kaufberatung und Ranglisten für dein nächstes Motorrad"


def schrift(pfade, groesse):
    for pfad in pfade:
        if os.path.exists(pfad):
            return ImageFont.truetype(pfad, groesse)
    raise SystemExit("keine Schrift gefunden: " + ", ".join(pfade))


def bauen():
    bild = Image.new("RGB", (B, H), DUNKEL)
    z = ImageDraw.Draw(bild)

    # Hintergrund: feine Kompassringe, Mittelpunkt rechts ausserhalb der sicheren Mitte
    mx, my = 2180, 720
    for radius, staerke in ((1250, 3), (980, 3), (720, 4), (470, 4), (230, 5)):
        z.ellipse((mx - radius, my - radius, mx + radius, my + radius), outline=(30, 36, 42), width=staerke)
    z.line((0, my, B, my), fill=(26, 31, 37), width=3)
    z.line((mx, 0, mx, H), fill=(26, 31, 37), width=3)

    # Logo links in der sicheren Mitte 
    kante = 360
    lx, ly = SICHER[0] + 20, (H - kante) // 2
    maske = Image.new("L", (800, 800), 0)
    ImageDraw.Draw(maske).ellipse((30, 30, 770, 770), fill=255)  # nur das Rad, damit die Hintergrundlinien bis dran laufen
    gross = (kante, kante)
    bild.paste(zeichnen().resize(gross, Image.Resampling.LANCZOS), (lx, ly), maske.resize(gross, Image.Resampling.LANCZOS))

    # Schriftzug: so gross, wie er neben dem Logo in die sichere Mitte passt
    tx = lx + kante + 50
    platz = SICHER[2] - 20 - tx
    groesse = 220
    while True:
        f = schrift(TITEL, groesse)
        breite = z.textlength("MOTORRAD KOMPASS", font=f)
        if breite <= platz:
            break
        groesse -= 4
    oben = ly + 18
    z.text((tx, oben), "MOTORRAD ", font=f, fill=WEISS)
    z.text((tx + z.textlength("MOTORRAD ", font=f), oben), "KOMPASS", font=f, fill=AKZENT)

    kasten = z.textbbox((tx, oben), "MOTORRAD KOMPASS", font=f)
    z.rectangle((tx, kasten[3] + 26, tx + 150, kasten[3] + 36), fill=AKZENT)
    klein = 60
    while z.textlength(ZEILE, font=schrift(FETT, klein)) > platz:
        klein -= 2
    z.text((tx, kasten[3] + 62), ZEILE, font=schrift(FETT, klein), fill=(200, 205, 210))
    unten = kasten[3] + 62 + klein
    assert unten <= SICHER[3], f"Text ragt aus der sicheren Mitte: {unten}"
    return bild


if __name__ == "__main__":
    ziel = os.path.join(WURZEL, "assets", "motorrad")
    os.makedirs(ziel, exist_ok=True)
    banner = bauen()
    pfad = os.path.abspath(os.path.join(ziel, "banner.png"))
    banner.save(pfad, optimize=True)
    # Kontrollbild: Ausschnitt, den Handy und Desktop zeigen
    banner.crop(SICHER).save(os.path.join(ziel, "banner-probe.png"))
    print(pfad, os.path.getsize(pfad) // 1024, "KB")
