"""Sprachsynthese via Edge TTS.

Liest build/tts-input.json, schreibt build/voice.mp3 und build/words.json
(Wort-Zeitstempel in Sekunden, Basis fuer die Karaoke-Untertitel).

Edge TTS liefert je nach Version und Stimme entweder Wort- oder nur
Satzgrenzen. Kommen nur Satzgrenzen an, werden die Wortzeiten innerhalb
des Satzes anhand der Wortlaenge interpoliert.
"""
import asyncio
import json
import re
import sys

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

    raise SystemExit(f"TTS nach 3 Versuchen fehlgeschlagen: {letzter_fehler}")


if __name__ == "__main__":
    asyncio.run(main())
