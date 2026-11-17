"""Schnitt für die Shorts von Motorrad Kompass: hochkant, ein Modell, unter einer Minute.

Aufruf: python motorrad/short-render.py build/motorrad-shorts/1/plan.json

Aufbau des Bildes (1080x1920): Das Foto füllt das ganze Hochformat und fährt seitlich
über das Motorrad, alle 2 bis 3 Sekunden wechselt die Einstellung. Modellname, Aufhänger
und die drei Kennzahlen stehen nur in den ersten 2 Sekunden und in der letzten Einstellung
im Bild; dazwischen liegen nur Bildnachweis und Untertitel über dem Foto.
Hat ein Bild einen Kling-Clip ("video", "max" in Sekunden), läuft statt der Fahrt der
geprüfte Anfang des Clips, auf die Länge der Einstellung gestreckt und auf das Hochformat beschnitten.
Rechts und ganz unten bleibt frei, dort liegen die Knöpfe und der Titel von YouTube.
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont, ImageOps

W, H, FPS = 1080, 1920, 30
MIN_BREITE = 1300  # so breit ist das Foto mindestens, damit auch Hochformate eine Fahrt bekommen
KARTE_S = 2  # so lange stehen Name und Kennzahlen am Anfang im Bild
KENN_Y = 1260
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


def rahmen(plan, credit, voll):
    """Alles über dem Foto, der Rest ist durchsichtig. Immer: dunkler Verlauf unten für die Untertitel und
    der Bildnachweis. Mit `voll` zusätzlich Verlauf oben, Modellname, Aufhänger und Kennzahlen."""
    # Deckkraft je Zeile: oben von 200 auf 0 (bis Zeile 640), unten von 0 auf 150 (Zeile 1150 bis 1600).
    maske = Image.new("L", (1, H))
    maske.putdata([round(max(200 * (1 - y / 640) if voll else 0, 150 * min(1, (y - 1150) / 450), 0)) for y in range(H)])
    bild = Image.new("RGBA", (W, H), (*DUNKEL, 255))
    bild.putalpha(maske.resize((W, H)))
    z = ImageDraw.Draw(bild)

    if credit:
        font = passend(z, credit, "normal", 20, NUTZBAR - RAND)
        z.text((RAND, KENN_Y - 36), credit, font=font, fill=WEISS, stroke_width=2, stroke_fill=(0, 0, 0))
    if not voll:
        return bild

    z.rectangle([RAND, 232, RAND + 10, 462], fill=AKZENT)
    z.text((RAND + 34, 226), "MOTORRAD KOMPASS", font=schrift("fett", 30), fill=AKZENT)
    name = plan["name"].upper()
    z.text((RAND + 34, 264), name, font=passend(z, name, "titel", 112, W - 2 * RAND - 34, kleinste=56), fill=WEISS)
    z.text((RAND + 34, 412), plan["hook"], font=passend(z, plan["hook"], "fett", 42, W - 2 * RAND - 34, kleinste=26),
           fill=(225, 228, 232))

    kennzahlen = plan.get("kennzahlen", [])[:3]
    abstand, y = 16, KENN_Y
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
    anzahl = max(3, round(gesamt / FPS / 2.5))
    je, rest = divmod(gesamt, anzahl)

    clips = []
    for n in range(anzahl):
        bilder = je + (1 if n < rest else 0)
        eintrag = plan["bilder"][n % len(plan["bilder"])]
        foto = ImageOps.exif_transpose(Image.open(eintrag["datei"])).convert("RGB")
        # Formatfüllend: Höhe = Bildhöhe, die Überbreite ist der Weg für die Kamerafahrt.
        # Kommt ein Foto zum zweiten Mal dran, dann näher, damit es nicht dieselbe Einstellung ist.
        durchlauf = n // len(plan["bilder"])
        faktor = max(H / foto.height, MIN_BREITE / foto.width) * (1.25 if durchlauf % 2 else 1)
        gross = foto.resize((round(foto.width * faktor), round(foto.height * faktor)), Image.LANCZOS)
        oben = (gross.height - H) // 2
        gross = gross.crop((0, oben, gross.width, oben + H))
        quelle = os.path.join(arbeit, f"foto-{n:02d}.jpg")
        gross.save(quelle, quality=92)
        karte = os.path.join(arbeit, f"karte-{n:02d}.png")
        rahmen(plan, eintrag.get("credit", ""), True).save(karte)
        schlicht = os.path.join(arbeit, f"schlicht-{n:02d}.png")
        rahmen(plan, eintrag.get("credit", ""), False).save(schlicht)
        # Name und Kennzahlen: in der ersten Einstellung KARTE_S lang, in der letzten ganz, sonst nie.
        grenze = bilder if n == anzahl - 1 else min(bilder, KARTE_S * FPS) if n == 0 else 0
        drueber = (
            f"[bg][1:v]overlay=0:0:format=auto:enable='lt(n,{grenze})'[mitkarte];"
            f"[mitkarte][2:v]overlay=0:0:format=auto:enable='gte(n,{grenze})',format=yuv420p[v]"
        )

        ziel = os.path.join(arbeit, f"clip-{n:02d}.mp4")
        if eintrag.get("video"):
            # Nur der geprüfte Anfang, gestreckt auf die Einstellung; beim zweiten Durchlauf
            # durch die Bilder rückwärts, damit sich derselbe Clip nicht gleich wiederholt.
            laenge = bilder / FPS
            nutz = min(eintrag["max"], laenge)
            rueck = ",reverse" if durchlauf % 2 else ""
            filter_ = (
                f"[0:v]trim=0:{nutz:.3f},setpts=PTS-STARTPTS{rueck},setpts={laenge / nutz:.4f}*PTS,fps={FPS},"
                f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H}[bg];" + drueber
            )
            eingabe = ["-i", eintrag["video"]]
        else:
            # Fahrt über 30 % der Überbreite: abwechselnd von vorn und von hinten zur Mitte des Fotos.
            weg = gross.width - W
            von, bis = (0.2 * weg, 0.5 * weg) if n % 2 == 0 else (0.8 * weg, 0.5 * weg)
            filter_ = f"[0:v]crop={W}:{H}:'{von:.1f}+({bis - von:.1f})*n/{bilder}':0[bg];" + drueber
            eingabe = ["-loop", "1", "-framerate", str(FPS), "-i", quelle]
        ffmpeg(*eingabe, "-i", karte, "-i", schlicht, "-filter_complex", filter_, "-map", "[v]", "-frames:v", str(bilder),
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
