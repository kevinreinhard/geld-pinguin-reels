"""Kanal-Logo «Motorrad Kompass»: Kompass, dessen Ring ein Rad mit Bremsscheibe ist.

Aufruf: python motorrad/logo.py  ->  assets/motorrad/logo.png (800x800, YouTube schneidet rund zu)
Farben wie in render.py.
"""
import math
import os

from PIL import Image, ImageDraw

DUNKEL, AKZENT, WEISS = (16, 20, 24), (255, 107, 26), (255, 255, 255)
GRAU = (120, 128, 136)
ZIEL, F = 800, 4          # Endgrösse und Überabtastung für glatte Kanten
G = ZIEL * F
M = G / 2


def punkt(winkel_grad, radius):
    """Winkel 0 = oben (Norden), im Uhrzeigersinn."""
    w = math.radians(winkel_grad - 90)
    return (M + radius * math.cos(w), M + radius * math.sin(w))


def kreis(z, radius, **kw):
    z.ellipse((M - radius, M - radius, M + radius, M + radius), **kw)


def zeichnen():
    bild = Image.new("RGB", (G, G), DUNKEL)
    z = ImageDraw.Draw(bild)
    e = G / 800  # Einheit: 1 = 1 Pixel im Endbild

    # Reifen: breiter Ring, aussen schräge Profilrillen
    kreis(z, 352 * e, fill=WEISS)
    for grad in range(0, 360, 12):
        z.line((punkt(grad, 356 * e), punkt(grad + 5, 322 * e)), fill=DUNKEL, width=int(13 * e))
    kreis(z, 304 * e, fill=DUNKEL)

    # Bremsscheibe: grauer Ring mit Lochkranz, an den vier Himmelsrichtungen unterbrochen
    kreis(z, 262 * e, fill=GRAU)
    kreis(z, 212 * e, fill=DUNKEL)
    for grad in range(0, 360, 15):
        if grad % 90:
            kreis_bei = punkt(grad, 237 * e)
            r = 9 * e
            z.ellipse((kreis_bei[0] - r, kreis_bei[1] - r, kreis_bei[0] + r, kreis_bei[1] + r), fill=DUNKEL)
    for grad in (0, 90, 180, 270):
        z.polygon((punkt(grad - 7, 270 * e), punkt(grad + 7, 270 * e), punkt(grad + 9, 205 * e), punkt(grad - 9, 205 * e)),
                  fill=DUNKEL)
        z.polygon((punkt(grad - 4.5, 288 * e), punkt(grad + 4.5, 288 * e), punkt(grad, 214 * e)),
                  fill=AKZENT if grad == 0 else WEISS)

    # Nadel: zeigt nach Nordost, vordere Hälfte orange, hintere weiss
    richtung = 38
    spitze, ende = punkt(richtung, 196 * e), punkt(richtung + 180, 196 * e)
    links, rechts = punkt(richtung - 90, 52 * e), punkt(richtung + 90, 52 * e)
    z.polygon((spitze, links, rechts), fill=AKZENT)
    z.polygon((ende, links, rechts), fill=WEISS)
    # Schattenhälfte gibt der Nadel Tiefe
    z.polygon((spitze, (M, M), rechts), fill=(214, 82, 10))
    z.polygon((ende, (M, M), links), fill=(205, 210, 215))

    # Nabe
    kreis(z, 30 * e, fill=DUNKEL)
    kreis(z, 14 * e, fill=WEISS)

    return bild.resize((ZIEL, ZIEL), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    ziel = os.path.join(os.path.dirname(__file__), "..", "assets", "motorrad")
    os.makedirs(ziel, exist_ok=True)
    pfad = os.path.abspath(os.path.join(ziel, "logo.png"))
    logo = zeichnen()
    logo.save(pfad)
    # Kontrollbild: so klein und rund, wie YouTube es neben Videos zeigt
    maske = Image.new("L", (ZIEL, ZIEL), 0)
    ImageDraw.Draw(maske).ellipse((0, 0, ZIEL, ZIEL), fill=255)
    rund = Image.new("RGB", (ZIEL, ZIEL), (255, 255, 255))
    rund.paste(logo, (0, 0), maske)
    probe = Image.new("RGB", (560, 240), (255, 255, 255))
    x = 20
    for g in (176, 88, 48, 32):
        probe.paste(rund.resize((g, g), Image.Resampling.LANCZOS), (x, (240 - g) // 2))
        x += g + 30
    probe.save(os.path.join(os.path.dirname(pfad), "logo-probe.png"))
    print(pfad)
