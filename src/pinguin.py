"""Zeichnet das Maskottchen von @geld.pinguin.

Kein Bildmaterial im Repo, keine externe Abhaengigkeit: Der Pinguin entsteht aus
Ellipsen und Polygonen. Gezeichnet wird vierfach vergroessert und danach
heruntergerechnet - ImageDraw kennt keine Kantenglaettung, Lanczos schon.

Bildflaeche ist immer ein Quadrat von 400x400 Einheiten; die Figur steht darin
mittig und beruehrt unten den Rand.
"""

from PIL import Image, ImageDraw

SS = 4  # Supersampling

KOERPER = (24, 36, 62)
KOERPER_HELL = (44, 62, 98)
BAUCH = (250, 251, 253)
BAUCH_SCHATTEN = (214, 222, 236)
SCHNABEL = (255, 163, 72)
SCHNABEL_DUNKEL = (226, 124, 38)
AUGE = (255, 255, 255)
PUPILLE = (15, 22, 36)

E = 400  # Einheiten der Zeichenflaeche


def _box(v):
    return [k * SS for k in v]


def _fluegel(seite, farbe):
    """Ein Fluegel als eigene Ebene, damit er gedreht am Koerper anliegen kann."""
    ebene = Image.new("RGBA", (E * SS, E * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(ebene)
    d.ellipse(_box((176, 150, 224, 310)), fill=farbe)
    ebene = ebene.rotate(-22 if seite == "links" else 22, resample=Image.BICUBIC, center=(200 * SS, 170 * SS))
    return ebene


def zeichne(groesse=512, schal=(255, 200, 69), blick=0.0, augen="offen"):
    """Liefert den Pinguin als RGBA-Bild der Kantenlaenge `groesse`.

    blick verschiebt die Pupillen (-1 bis 1) - so kann der Pinguin die Zahl
    ansehen, die neben ihm steht.
    """
    bild = Image.new("RGBA", (E * SS, E * SS), (0, 0, 0, 0))

    # --- Fuesse (zuerst, der Koerper deckt die Ansaetze ab) ---
    d = ImageDraw.Draw(bild)
    d.ellipse(_box((132, 352, 198, 388)), fill=SCHNABEL_DUNKEL)
    d.ellipse(_box((202, 352, 268, 388)), fill=SCHNABEL_DUNKEL)
    d.ellipse(_box((128, 346, 194, 382)), fill=SCHNABEL)
    d.ellipse(_box((206, 346, 272, 382)), fill=SCHNABEL)

    # --- Fluegel ---
    for seite in ("links", "rechts"):
        f = _fluegel(seite, KOERPER)
        if seite == "rechts":
            f = f.transpose(Image.FLIP_LEFT_RIGHT)
        bild.alpha_composite(f.crop((0, 0, E * SS, E * SS)),
                             (-62 * SS if seite == "links" else 62 * SS, 0))

    # --- Rumpf ---
    d = ImageDraw.Draw(bild)
    d.ellipse(_box((76, 168, 324, 366)), fill=KOERPER)
    d.ellipse(_box((110, 216, 290, 358)), fill=BAUCH)

    # --- Kopf ---
    d.ellipse(_box((106, 34, 294, 222)), fill=KOERPER)

    # Gesichtsfeld: sitzt tief im Kopf, laesst oben eine dunkle Kappe stehen
    d.ellipse(_box((132, 86, 268, 212)), fill=BAUCH)
    d.ellipse(_box((150, 74, 250, 140)), fill=BAUCH)

    # --- Augen ---
    for cx in (172, 228):
        d.ellipse(_box((cx - 23, 100, cx + 23, 150)), fill=AUGE)
        d.ellipse(_box((cx - 23, 100, cx + 23, 150)), outline=BAUCH_SCHATTEN, width=SS)
        if augen == "zu":
            d.arc(_box((cx - 20, 112, cx + 20, 146)), start=190, end=350,
                  fill=PUPILLE, width=4 * SS)
            continue
        px = cx + 8 * blick
        d.ellipse(_box((px - 12, 116, px + 12, 144)), fill=PUPILLE)
        d.ellipse(_box((px - 3, 120, px + 5, 128)), fill=AUGE)

    # --- Schnabel ---
    d.polygon([(v * SS) for p in [(200, 158), (230, 180), (200, 202), (170, 180)] for v in p]
              if False else [(p[0] * SS, p[1] * SS) for p in
                             [(200, 158), (230, 180), (200, 202), (170, 180)]],
              fill=SCHNABEL)
    d.polygon([(p[0] * SS, p[1] * SS) for p in
               [(170, 180), (230, 180), (200, 202)]], fill=SCHNABEL_DUNKEL)

    # --- Schal in der Markenfarbe ---
    # Er sitzt genau auf der Naht zwischen Kopf und Rumpf und macht aus einem
    # Pinguin unseren Pinguin.
    if schal:
        dunkler = tuple(max(0, c - 45) for c in schal)
        d.polygon([(p[0] * SS, p[1] * SS) for p in
                   [(242, 226), (280, 218), (296, 300), (258, 306)]], fill=dunkler)
        d.rounded_rectangle(_box((112, 200, 288, 244)), radius=22 * SS, fill=schal)
        d.ellipse(_box((236, 202, 292, 242)), fill=schal)

    return bild.resize((groesse, groesse), Image.LANCZOS)


if __name__ == "__main__":
    import sys
    ziel = sys.argv[1] if len(sys.argv) > 1 else "build/pinguin.png"
    zeichne(512).save(ziel)
    print(ziel)
