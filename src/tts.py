"""Sprachsynthese via Edge TTS.

Liest build/tts-input.json, schreibt build/voice.mp3 und build/words.json
(Wort-Zeitstempel in Sekunden, Basis fuer die Karaoke-Untertitel).

Edge TTS liefert je nach Version und Stimme entweder Wort- oder nur
Satzgrenzen. Kommen nur Satzgrenzen an, werden die Wortzeiten innerhalb
des Satzes anhand der Wortlaenge interpoliert.

Lehnt Microsoft Edge TTS ab (HTTP 403 von den GitHub-Servern), springt eine
zweite Stimme ein: Google Translate TTS (gTTS), satzweise erzeugt. Die
Satzdauer misst ffprobe, die Wortzeiten werden wie oben interpoliert.
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile

import edge_tts

TICKS_PRO_SEKUNDE = 10_000_000  # Edge TTS rechnet in 100-Nanosekunden-Ticks


def communicate(text, voice, rate, pitch):
    """Bevorzugt Wortgrenzen; aeltere edge-tts-Versionen kennen den Parameter nicht."""
    try:
        return edge_tts.Communicate(
            text, voice, rate=rate, pitch=pitch, boundary="WordBoundary"
        )
    except TypeError:
        return edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)


def satz_in_woerter(satz, start, ende):
    """Verteilt einen Satz proportional zur Wortlaenge auf seine Zeitspanne."""
    tokens = [t for t in re.split(r"\s+", satz.strip()) if t]
    if not tokens:
        return []
    gewichte = [len(re.sub(r"[^\w]", "", t)) + 1 for t in tokens]
    gesamt = sum(gewichte)
    spanne = max(0.01, ende - start)

    woerter, cursor = [], start
    for token, gewicht in zip(tokens, gewichte):
        laenge = spanne * gewicht / gesamt
        woerter.append({"text": token, "start": cursor, "end": cursor + laenge})
        cursor += laenge
    return woerter


async def synthetisiere(text, voice, rate, pitch, audio_pfad, words_pfad):
    words, saetze = [], []

    with open(audio_pfad, "wb") as f:
        async for chunk in communicate(text, voice, rate, pitch).stream():
            typ = chunk["type"]
            if typ == "audio":
                f.write(chunk["data"])
            elif typ in ("WordBoundary", "SentenceBoundary"):
                start = chunk["offset"] / TICKS_PRO_SEKUNDE
                ende = start + chunk["duration"] / TICKS_PRO_SEKUNDE
                ziel = words if typ == "WordBoundary" else saetze
                ziel.append({"text": chunk["text"], "start": start, "end": ende})

    if not words and saetze:
        print("  Nur Satzgrenzen erhalten - Wortzeiten werden interpoliert.", file=sys.stderr)
        for s in saetze:
            words.extend(satz_in_woerter(s["text"], s["start"], s["end"]))

    if not words:
        raise RuntimeError("Edge TTS hat weder Wort- noch Satzgrenzen geliefert.")

    with open(words_pfad, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=1)

    return words[-1]["end"], "wort" if not saetze or len(words) > len(saetze) else "satz"


def dauer_der_datei(pfad):
    """Laenge einer Audiodatei in Sekunden (ffprobe)."""
    aus = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", pfad],
        check=True, capture_output=True, text=True,
    ).stdout
    return float(aus.strip())


def synthetisiere_gtts(text, audio_pfad, words_pfad):
    """Zweite Stimme: Google Translate TTS, satzweise, mit gemessenen Satzzeiten."""
    from gtts import gTTS

    saetze = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]
    if not saetze:
        raise RuntimeError("gTTS: kein Text.")

    with tempfile.TemporaryDirectory() as tmp:
        teile, zeiten, cursor = [], [], 0.0
        for i, satz in enumerate(saetze):
            teil = os.path.join(tmp, f"satz{i:03d}.mp3")
            gTTS(satz, lang="de", tld="de").save(teil)
            laenge = dauer_der_datei(teil)
            zeiten.append({"text": satz, "start": cursor, "end": cursor + laenge})
            cursor += laenge
            teile.append(teil)

        liste = os.path.join(tmp, "liste.txt")
        with open(liste, "w", encoding="utf-8") as f:
            for teil in teile:
                f.write("file '" + teil.replace("\\", "/") + "'\n")
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", liste,
             "-c:a", "libmp3lame", "-q:a", "4", audio_pfad],
            check=True,
        )

    words = []
    for z in zeiten:
        words.extend(satz_in_woerter(z["text"], z["start"], z["end"]))
    with open(words_pfad, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=1)
    return words[-1]["end"]


async def main():
    cfg = json.load(open(sys.argv[1], encoding="utf-8"))

    letzter_fehler = None
    for versuch in range(1, 4):
        try:
            dauer, quelle = await synthetisiere(
                cfg["text"], cfg["voice"], cfg.get("rate", "+0%"),
                cfg.get("pitch", "+0Hz"), cfg["audio"], cfg["words"],
            )
            print(json.dumps({"ok": True, "dauer": round(dauer, 2), "voice": cfg["voice"], "timing": quelle}))
            return
        except Exception as e:  # Edge TTS ist gelegentlich flaky
            letzter_fehler = e
            print(f"  TTS-Versuch {versuch} fehlgeschlagen: {e}", file=sys.stderr)
            await asyncio.sleep(3 * versuch)

    print("  Edge TTS ohne Erfolg - zweite Stimme (gTTS) springt ein.", file=sys.stderr)
    try:
        dauer = synthetisiere_gtts(cfg["text"], cfg["audio"], cfg["words"])
    except Exception as e:
        raise SystemExit(
            f"TTS fehlgeschlagen. Edge: {letzter_fehler} | gTTS: {e}"
        )
    print(json.dumps({"ok": True, "dauer": round(dauer, 2), "voice": "gtts-de", "timing": "satz"}))


if __name__ == "__main__":
    asyncio.run(main())
