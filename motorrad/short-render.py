"""Schnitt für die Shorts von Motorrad Kompass: hochkant, ein Modell, unter einer Minute.

Aufruf: python motorrad/short-render.py build/motorrad-shorts/1/plan.json

Aufbau des Bildes (1080x1920): oben Modellname und Aufhänger, darunter das Foto
im Querformat mit langsamem Zoom, dann drei Kennzahlen, dann die Untertitel.
Rechts und ganz unten bleibt frei, dort liegen die Knöpfe und der Titel von YouTube.
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

W, H, FPS = 1080, 1920, 30
FOTO_B, FOTO_H, FOTO_Y = 1080, 720, 500
GROSS = (1620, 1080)  # Arbeitsgrösse für den Zoom
DUNKEL, AKZENT, WEISS = (16, 20, 24), (255, 107, 26), (255, 255, 255)
RAND = 50
NUTZBAR = 900  # rechts davon liegen die Knöpfe von YouTube

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


def passend(zeichner, text, art, groesse, breite, kleinste=14):
    while groesse > kleinste and zeichner.textlength(text, font=schrift(art, groesse)) > breite:
        groesse -= 2
    return schrift(art, groesse)


def rahmen(foto, plan, credit):
    """Alles ausser dem Foto: unscharfer Hintergrund, Schrift, Kennzahlen. Das Fotofenster bleibt durchsichtig."""
    bild = ImageOps.fit(foto, (W, H), Image.LANCZOS).filter(ImageFilter.GaussianBlur(45))
    bild = Image.blend(bild, Image.new("RGB", (W, H), DUNKEL), 0.72).convert("RGBA")
    z = ImageDraw.Draw(bild)

    z.rectangle([RAND, 232, RAND + 10, 462], fill=AKZENT)
    z.text((RAND + 34, 226), "MOTORRAD KOMPASS", font=schrift("fett", 30), fill=AKZENT)
    name = plan["name"].upper()
    z.text((RAND + 34, 264), name, font=passend(z, name, "titel", 112, W - 2 * RAND - 34, kleinste=56), fill=WEISS)
    z.text((RAND + 34, 412), plan["hook"], font=passend(z, plan["hook"], "fett", 42, W - 2 * RAND - 34, kleinste=26),
           fill=(225, 228, 232))

    z.rectangle([0, FOTO_Y - 6, W, FOTO_Y], fill=AKZENT)
    z.rectangle([0, FOTO_Y, W, FOTO_Y + FOTO_H], fill=(0, 0, 0, 0))
    if credit:
        font = passend(z, credit, "normal", 20, W - 40)
        breite = z.textlength(credit, font=font)
        z.rectangle([0, FOTO_Y + FOTO_H - 34, breite + 28, FOTO_Y + FOTO_H], fill=(0, 0, 0, 150))
        z.text((14, FOTO_Y + FOTO_H - 29), credit, font=font, fill=WEISS)

    kennzahlen = plan.get("kennzahlen", [])[:3]
    abstand, y = 16, FOTO_Y + FOTO_H + 40
    feld = (NUTZBAR - RAND - abstand * (len(kennzahlen) - 1)) // max(1, len(kennzahlen))
    for i, k in enumerate(kennzahlen):
        x = RAND + i * (feld + abstand)
        z.rounded_rectangle([x, y, x + feld, y + 150], radius=14, fill=(*DUNKEL, 235))
        z.rectangle([x, y, x + feld, y + 6], fill=AKZENT)
        label = k["label"].upper()
        z.text((x + 20, y + 22), label, font=passend(z, label, "fett", 24, feld - 40), fill=(200, 205, 210))
        z.text((x + 20, y + 58), k["wert"], font=passend(z, k["wert"], "titel", 62, feld - 40, kleinste=30), fill=WEISS)
    return bild


def gruppen(woerter):
    """Untertitel in kurzen Happen: höchstens drei Wörter oder 18 Zeichen, neue Gruppe nach einer Sprechpause."""
    aus, aktuell = [], []
    for w in woerter:
        text = " ".join(x["text"] for x in aktuell + [w])
        pause = aktuell and w["start"] - aktuell[-1]["end"] > 0.35
        if aktuell and (len(aktuell) == 3 or len(text) > 18 or pause):
            aus.append(aktuell)
            aktuell = []
        aktuell.append(w)
    if aktuell:
        aus.append(aktuell)
    return aus


def ass_zeit(sekunden):
    h, rest = divmod(max(0.0, sekunden), 3600)
    m, s = divmod(rest, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def untertitel(woerter, pfad):
    kopf = (
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {W}\nPlayResY: {H}\nWrapStyle: 2\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding\n"
        # Oben mittig ausgerichtet, MarginV = Abstand von oben; rechts Platz für die Knöpfe.
        "Style: U,Anton,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,1,0,1,5,2,8,50,180,1470,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    teile = gruppen(woerter)
    zeilen = []
    for i, gruppe in enumerate(teile):
        ende = teile[i + 1][0]["start"] if i + 1 < len(teile) else gruppe[-1]["end"] + 0.4
        ende = min(ende, gruppe[-1]["end"] + 0.6)
        text = " ".join(w["text"] for w in gruppe).upper().replace("{", "").replace("}", "")
        zeilen.append(f"Dialogue: 0,{ass_zeit(gruppe[0]['start'])},{ass_zeit(ende)},U,,0,0,0,,{text}")
    with open(pfad, "w", encoding="utf-8") as f:
        f.write(kopf + "\n".join(zeilen) + "\n")


def ffmpeg(*argumente):
    subprocess.run(["ffmpeg", "-y", "-v", "error", *argumente], check=True)


def tondauer(pfad):
    aus = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", pfad],
        check=True, capture_output=True, text=True,
    ).stdout
    return float(aus.strip())


def main():
    plan = json.load(open(sys.argv[1], encoding="utf-8"))
    ordner = os.path.dirname(sys.argv[1])
    arbeit = os.path.join(ordner, "schnitt")
    os.makedirs(arbeit, exist_ok=True)

    gesamt = round((tondauer(plan["audio"]) + 0.7) * FPS)
    anzahl = max(3, round(gesamt / FPS / 4.5))
    je, rest = divmod(gesamt, anzahl)

    clips = []
    for n in range(anzahl):
        bilder = je + (1 if n < rest else 0)
        eintrag = plan["bilder"][n % len(plan["bilder"])]
        foto = ImageOps.exif_transpose(Image.open(eintrag["datei"])).convert("RGB")
        quelle = os.path.join(arbeit, f"foto-{n:02d}.jpg")
        ImageOps.fit(foto, GROSS, Image.LANCZOS, centering=(0.5, 0.5)).save(quelle, quality=92)
        karte = os.path.join(arbeit, f"karte-{n:02d}.png")
        rahmen(foto, plan, eintrag.get("credit", "")).save(karte)

        zoom = f"1+0.12*on/{bilder}" if n % 2 == 0 else f"1.12-0.12*on/{bilder}"
        filter_ = (
            f"[0:v]zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={bilder}:s={FOTO_B}x{FOTO_H}:fps={FPS},"
            f"pad={W}:{H}:0:{FOTO_Y}:black[bg];[bg][1:v]overlay=0:0:format=auto,format=yuv420p[v]"
        )
        ziel = os.path.join(arbeit, f"clip-{n:02d}.mp4")
        ffmpeg("-i", quelle, "-i", karte, "-filter_complex", filter_, "-map", "[v]", "-frames:v", str(bilder),
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", str(FPS), ziel)
        clips.append(ziel)

    liste = os.path.join(arbeit, "clips.txt")
    with open(liste, "w", encoding="utf-8") as f:
        for clip in clips:
            f.write("file '" + os.path.abspath(clip).replace("\\", "/") + "'\n")

    ass = os.path.join(arbeit, "untertitel.ass").replace("\\", "/")
    untertitel(json.load(open(plan["woerter"], encoding="utf-8")), ass)

    dauer = gesamt / FPS
    video = os.path.join(ordner, "video.mp4")
    ffmpeg("-f", "concat", "-safe", "0", "-i", liste, "-i", plan["audio"],
           "-vf", f"subtitles={ass}:fontsdir=assets/fonts",
           "-af", "apad", "-t", f"{dauer:.4f}",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", str(FPS),
           "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-movflags", "+faststart", video)

    kontrolle = os.path.join(ordner, "kontrolle")
    os.makedirs(kontrolle, exist_ok=True)
    for i, anteil in enumerate([0.04, 0.5, 0.92]):
        ffmpeg("-ss", f"{dauer * anteil:.2f}", "-i", video, "-frames:v", "1", "-vf", "scale=540:-1",
               os.path.join(kontrolle, f"bild-{i}.jpg"))

    print(json.dumps({"ok": True, "dauer": round(dauer, 1), "einstellungen": len(clips)}))


if __name__ == "__main__":
    main()
