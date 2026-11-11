"""Schnitt für Motorrad Kompass: Fotos mit langsamem Zoom, Einblendungen, Ton.

Aufruf: python motorrad/render.py build/motorrad/plan.json

Der Plan nennt je Abschnitt (intro, modell, outro) die Tondatei und die Fotos.
Jede Einstellung ist ein Foto mit Zoom und einer durchsichtigen Einblendung
(Titelkarte, Kennzahlen, Bauchbinde, Bildnachweis). Gerechnet wird in ganzen
Bildern, damit Bild und Ton auch nach neun Minuten noch zusammenpassen.
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont, ImageOps

W, H, FPS = 1920, 1080, 30
GROSS = (2880, 1620)  # Arbeitsgrösse für den Zoom; kleiner zittert sichtbar
DUNKEL, AKZENT, WEISS = (16, 20, 24), (255, 107, 26), (255, 255, 255)

SCHRIFTEN = {
    "titel": ["assets/fonts/Anton-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "C:/Windows/Fonts/impact.ttf"],
    "fett": ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"],
    "normal": ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/arial.ttf"],
}


def schrift(art, groesse):
    for pfad in SCHRIFTEN[art]:
        if os.path.exists(pfad):
            return ImageFont.truetype(pfad, groesse)
    return ImageFont.load_default(groesse)


def passend(zeichner, text, art, groesse, breite, kleinste=28):
    """Grösste Schrift bis `groesse`, bei der der Text in `breite` passt."""
    while groesse > kleinste and zeichner.textlength(text, font=schrift(art, groesse)) > breite:
        groesse -= 4
    return schrift(art, groesse)


def umbruch(zeichner, text, font, breite):
    zeilen, zeile = [], ""
    for wort in text.split():
        probe = (zeile + " " + wort).strip()
        if zeile and zeichner.textlength(probe, font=font) > breite:
            zeilen.append(zeile)
            zeile = wort
        else:
            zeile = probe
    return zeilen + ([zeile] if zeile else [])


def leer():
    bild = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    return bild, ImageDraw.Draw(bild)


def nachweis(zeichner, text):
    if not text:
        return
    font = schrift("normal", 22)
    breite = zeichner.textlength(text, font=font)
    zeichner.rectangle([W - breite - 36, H - 46, W, H], fill=(0, 0, 0, 150))
    zeichner.text((W - breite - 18, H - 38), text, font=font, fill=WEISS)


def verlauf_links(bild, breite=1250, staerke=235):
    """Dunkler Verlauf von links, damit weisse Schrift auf jedem Foto lesbar bleibt."""
    schicht = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    z = ImageDraw.Draw(schicht)
    for x in range(breite):
        z.line([(x, 0), (x, H)], fill=(0, 0, 0, int(staerke * (1 - x / breite) ** 1.3)))
    return Image.alpha_composite(bild, schicht)


def karte_titel(abschnitt, credit):
    bild, _ = leer()
    bild = verlauf_links(bild)
    z = ImageDraw.Draw(bild)
    z.rectangle([90, 600, 102, 900], fill=AKZENT)
    z.text((130, 590), f"PLATZ {abschnitt['rang']}", font=schrift("titel", 96), fill=AKZENT)
    z.text((130, 720), abschnitt["name"], font=passend(z, abschnitt["name"], "titel", 170, 1150), fill=WEISS)
    nachweis(z, credit)
    return bild


def karte_kennzahlen(abschnitt, credit):
    bild, z = leer()
    kennzahlen = abschnitt.get("kennzahlen", [])[:3]
    feld, abstand, y = 540, 30, 810
    start = (W - (len(kennzahlen) * feld + (len(kennzahlen) - 1) * abstand)) // 2
    for i, k in enumerate(kennzahlen):
        x = start + i * (feld + abstand)
        z.rounded_rectangle([x, y, x + feld, y + 200], radius=18, fill=(*DUNKEL, 225))
        z.rectangle([x, y, x + feld, y + 8], fill=AKZENT)
        z.text((x + 34, y + 30), k["label"].upper(), font=passend(z, k["label"].upper(), "fett", 34, feld - 68), fill=(200, 205, 210))
        z.text((x + 34, y + 78), k["wert"], font=passend(z, k["wert"], "titel", 96, feld - 68), fill=WEISS)
    z.rounded_rectangle([60, 50, 60 + 120, 50 + 90], radius=14, fill=(*AKZENT, 240))
    z.text((84, 54), f"#{abschnitt['rang']}", font=schrift("titel", 64), fill=WEISS)
    nachweis(z, credit)
    return bild


def karte_bauchbinde(abschnitt, credit):
    bild, z = leer()
    text = f"#{abschnitt['rang']}  {abschnitt['name']}"
    font = passend(z, text, "titel", 54, 900)
    breite = z.textlength(text, font=font)
    z.rounded_rectangle([60, 940, 60 + breite + 70, 1030], radius=14, fill=(*DUNKEL, 215))
    z.rectangle([60, 940, 72, 1030], fill=AKZENT)
    z.text((96, 950), text, font=font, fill=WEISS)
    nachweis(z, credit)
    return bild


def karte_text(zeilen_gross, zeile_klein, credit):
    """Abgedunkeltes Bild mit grosser Schrift in der Mitte: Einstieg und Schluss."""
    bild = Image.new("RGBA", (W, H), (0, 0, 0, 135))
    z = ImageDraw.Draw(bild)
    font = schrift("titel", 124)
    zeilen = umbruch(z, zeilen_gross.upper(), font, W - 320)
    if len(zeilen) > 3:
        font = schrift("titel", 92)
        zeilen = umbruch(z, zeilen_gross.upper(), font, W - 320)
    hoehe = font.size + 22
    y = (H - hoehe * len(zeilen)) // 2 - 30
    for zeile in zeilen:
        z.text(((W - z.textlength(zeile, font=font)) // 2, y), zeile, font=font, fill=WEISS)
        y += hoehe
    if zeile_klein:
        klein = schrift("fett", 44)
        z.text(((W - z.textlength(zeile_klein, font=klein)) // 2, y + 26), zeile_klein, font=klein, fill=AKZENT)
    nachweis(z, credit)
    return bild


def einblendung(abschnitt, nummer, credit):
    typ = abschnitt["typ"]
    if typ == "intro":
        return karte_text(abschnitt["titelzeile"], "MOTORRAD KOMPASS", credit)
    if typ == "outro":
        return karte_text("Welches Motorrad fehlt?", "Schreib es in die Kommentare", credit)
    if nummer == 0:
        return karte_titel(abschnitt, credit)
    if nummer == 1:
        return karte_kennzahlen(abschnitt, credit)
    return karte_bauchbinde(abschnitt, credit)


def ffmpeg(*argumente):
    subprocess.run(["ffmpeg", "-y", "-v", "error", *argumente], check=True)


def tondauer(pfad):
    aus = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", pfad],
        check=True, capture_output=True, text=True,
    ).stdout
    return float(aus.strip())


def vorbereitet(quelle, ziel):
    """Foto auf die Arbeitsgrösse zuschneiden (Mitte), damit ffmpeg nichts raten muss."""
    if not os.path.exists(ziel):
        bild = ImageOps.exif_transpose(Image.open(quelle)).convert("RGB")
        ImageOps.fit(bild, GROSS, Image.LANCZOS, centering=(0.5, 0.5)).save(ziel, quality=92)
    return ziel


def einstellung(foto, karte, bilder, ziel, hinein):
    zoom = f"1+0.10*on/{bilder}" if hinein else f"1.10-0.10*on/{bilder}"
    filter_ = (
        f"[0:v]zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={bilder}:s={W}x{H}:fps={FPS}[bg];"
        f"[bg][1:v]overlay=0:0:format=auto,format=yuv420p[v]"
    )
    ffmpeg("-i", foto, "-i", karte, "-filter_complex", filter_, "-map", "[v]", "-frames:v", str(bilder),
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", str(FPS), ziel)


def vorschaubild(plan, ordner):
    quelle = plan["thumbnail"]
    bild = ImageOps.fit(ImageOps.exif_transpose(Image.open(quelle["bild"])).convert("RGB"), (1280, 720), Image.LANCZOS)
    bild = bild.convert("RGBA")
    schicht = Image.new("RGBA", (1280, 720), (0, 0, 0, 0))
    z = ImageDraw.Draw(schicht)
    for x in range(900):
        z.line([(x, 0), (x, 720)], fill=(0, 0, 0, int(240 * (1 - x / 900) ** 1.2)))
    bild = Image.alpha_composite(bild, schicht)
    z = ImageDraw.Draw(bild)
    woerter = quelle["text"].upper().split()[:3]
    # Anton ist deutlich höher als seine Nenngrösse: Zeilenhöhe messen statt schätzen.
    fonts = [passend(z, wort, "titel", 150, 620, kleinste=80) for wort in woerter]
    hoehen = [z.textbbox((0, 0), wort, font=f, stroke_width=6)[3] + 18 for wort, f in zip(woerter, fonts)]
    y = (720 - sum(hoehen)) // 2
    for i, (wort, font) in enumerate(zip(woerter, fonts)):
        z.text((60, y), wort, font=font, fill=AKZENT if i == len(woerter) - 1 else WEISS,
               stroke_width=6, stroke_fill=(0, 0, 0))
        y += hoehen[i]
    bild.convert("RGB").save(os.path.join(ordner, "thumbnail.jpg"), quality=92)


def main():
    plan = json.load(open(sys.argv[1], encoding="utf-8"))
    ordner = os.path.dirname(sys.argv[1])
    arbeit = os.path.join(ordner, "schnitt")
    os.makedirs(arbeit, exist_ok=True)

    clips, toene, laufzeit = [], [], 0.0
    for a, abschnitt in enumerate(plan["segmente"]):
        pause = 0.8 if abschnitt["typ"] != "modell" else 0.5
        gesamt = round((tondauer(abschnitt["audio"]) + pause) * FPS)
        takt = 3.5 if abschnitt["typ"] == "intro" else 6.5
        anzahl = max(2 if abschnitt["typ"] == "modell" else 1, round(gesamt / FPS / takt))
        je, rest = divmod(gesamt, anzahl)

        for n in range(anzahl):
            bilder = je + (1 if n < rest else 0)
            foto = abschnitt["bilder"][n % len(abschnitt["bilder"])]
            quelle = vorbereitet(foto["datei"], os.path.join(arbeit, "foto-" + os.path.basename(foto["datei"])))
            karte = os.path.join(arbeit, f"karte-{a:02d}-{n:02d}.png")
            einblendung(abschnitt, n, foto.get("credit", "")).save(karte)
            ziel = os.path.join(arbeit, f"clip-{a:02d}-{n:02d}.mp4")
            einstellung(quelle, karte, bilder, ziel, hinein=(n % 2 == 0))
            clips.append(ziel)

        ton = os.path.join(arbeit, f"ton-{a:02d}.wav")
        ffmpeg("-i", abschnitt["audio"], "-af", "apad", "-t", f"{gesamt / FPS:.4f}", "-ar", "44100", "-ac", "2", ton)
        toene.append(ton)
        laufzeit += gesamt / FPS
        print(f"  Abschnitt {a + 1}/{len(plan['segmente'])} ({abschnitt['typ']}): {anzahl} Einstellungen, {gesamt / FPS:.1f} s", flush=True)

    def liste(name, dateien):
        pfad = os.path.join(arbeit, name)
        with open(pfad, "w", encoding="utf-8") as f:
            for datei in dateien:
                f.write("file '" + os.path.abspath(datei).replace("\\", "/") + "'\n")
        return pfad

    video = os.path.join(ordner, "video.mp4")
    ffmpeg("-f", "concat", "-safe", "0", "-i", liste("clips.txt", clips),
           "-f", "concat", "-safe", "0", "-i", liste("ton.txt", toene),
           "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", video)

    vorschaubild(plan, ordner)

    # Einzelbilder für die Sichtkontrolle: je eines aus jeder Einstellungsart.
    kontrolle = os.path.join(ordner, "kontrolle")
    os.makedirs(kontrolle, exist_ok=True)
    for i, anteil in enumerate([0.01, 0.06, 0.14, 0.17, 0.35, 0.5, 0.7, 0.99]):
        ffmpeg("-ss", f"{laufzeit * anteil:.2f}", "-i", video, "-frames:v", "1", "-vf", "scale=960:-1",
               os.path.join(kontrolle, f"bild-{i}.jpg"))

    # Alle verwendeten Fotos auf einem Bogen: So fällt ein falsches Modell auf, ohne das Video durchzusehen.
    fotos = []
    for abschnitt in plan["segmente"]:
        if abschnitt["typ"] == "modell":
            fotos += [(abschnitt["name"], f["datei"]) for f in abschnitt["bilder"]]
    spalten = 6
    bogen = Image.new("RGB", (spalten * 320, ((len(fotos) + spalten - 1) // spalten) * 200), DUNKEL)
    z = ImageDraw.Draw(bogen)
    for i, (name, datei) in enumerate(fotos):
        x, y = (i % spalten) * 320, (i // spalten) * 200
        bogen.paste(ImageOps.fit(Image.open(datei).convert("RGB"), (320, 180)), (x, y))
        z.text((x + 6, y + 182), name[:34], font=schrift("normal", 14), fill=WEISS)
    bogen.save(os.path.join(kontrolle, "fotos.jpg"), quality=85)

    print(json.dumps({"ok": True, "dauer": round(laufzeit, 1), "einstellungen": len(clips)}))


if __name__ == "__main__":
    main()
