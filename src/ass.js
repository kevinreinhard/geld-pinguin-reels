import { CAPTIONS, VIDEO } from "./config.js";

/** Sekunden -> ASS-Zeitstempel H:MM:SS.cc */
function zeit(sek) {
  const s = Math.max(0, sek);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s - h * 3600 - m * 60;
  const ganze = Math.floor(rest);
  const cs = Math.round((rest - ganze) * 100);
  const [sec, hundert] = cs === 100 ? [ganze + 1, 0] : [ganze, cs];
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(hundert).padStart(2, "0")}`;
}

/** Zeichen, die libass als Tag-Steuerung lesen wuerde, entschaerfen. */
function esc(text) {
  return String(text).replace(/\\/g, "/").replace(/[{}]/g, "").trim();
}

const SATZZEICHEN = /^([.!?…])/;

/**
 * Edge TTS liefert Woerter ohne Satzzeichen. Um trotzdem am Satzende umbrechen
 * zu koennen, laufen wir die Wortliste gegen den Originaltext und merken uns,
 * welchem Wort ein Punkt, Ausrufe- oder Fragezeichen folgt.
 */
export function annotiereWoerter(words, quelltext) {
  let cursor = 0;
  return words.map((w) => {
    const roh = w.text.trim();
    let idx = quelltext.indexOf(roh, cursor);
    if (idx === -1) idx = quelltext.toLowerCase().indexOf(roh.toLowerCase(), cursor);

    // Wort im Quelltext nicht gefunden: nur auf das Token selbst schauen
    if (idx === -1) {
      const treffer = roh.match(/([.!?…])$/);
      return { ...w, anzeige: roh, satzende: Boolean(treffer) };
    }

    cursor = idx + roh.length;
    const treffer = quelltext.slice(cursor).match(SATZZEICHEN);
    return {
      ...w,
      anzeige: treffer ? roh + treffer[1] : roh,
      satzende: Boolean(treffer),
    };
  });
}

/** Teilt n Elemente moeglichst gleichmaessig auf gruppen Gruppen auf. */
function verteile(elemente, gruppen) {
  const basis = Math.floor(elemente.length / gruppen);
  const rest = elemente.length % gruppen;
  const ergebnis = [];
  let i = 0;
  for (let g = 0; g < gruppen; g++) {
    const groesse = basis + (g < rest ? 1 : 0);
    ergebnis.push(elemente.slice(i, i + groesse));
    i += groesse;
  }
  return ergebnis.filter((g) => g.length);
}

/**
 * Gruppiert die Wort-Zeitstempel zu Untertitel-Chunks: erst nach Saetzen
 * trennen, dann jeden Satz gleichmaessig aufteilen. So entstehen keine
 * Einzelwort-Reste am Satzende.
 */
export function chunkeWoerter(words) {
  const saetze = [];
  let aktuell = [];
  for (const w of words) {
    aktuell.push(w);
    if (w.satzende) {
      saetze.push(aktuell);
      aktuell = [];
    }
  }
  if (aktuell.length) saetze.push(aktuell);

  const chunks = [];
  for (const satz of saetze) {
    const dauer = satz[satz.length - 1].end - satz[0].start;
    const gruppen = Math.max(
      1,
      Math.ceil(satz.length / CAPTIONS.maxWoerterProChunk),
      Math.ceil(dauer / CAPTIONS.maxSekundenProChunk),
    );
    chunks.push(...verteile(satz, gruppen));
  }
  return chunks;
}

function kopf(fontname) {
  const c = CAPTIONS;
  // ASS-Format: Name, Fontname, Fontsize, Primary(gesungen), Secondary(ungesungen),
  // Outline, Back, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,
  // BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${VIDEO.breite}
PlayResY: ${VIDEO.hoehe}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${fontname},${c.fontSize},${c.aktivFarbe},${c.ruheFarbe},${c.outlineFarbe},&H64000000,0,0,0,0,100,100,2,0,1,${c.outlineStaerke},4,5,90,90,0,1
Style: Titel,${fontname},${c.titleFontSize},&H00FFFFFF&,&H00FFFFFF&,${c.outlineFarbe},&H64000000,0,0,0,0,100,100,6,0,1,6,3,5,90,90,0,1
Style: Handle,${fontname},44,&H00FFFFFF&,&H00FFFFFF&,${c.outlineFarbe},&H64000000,0,0,0,0,100,100,3,0,1,4,2,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
}

/**
 * Baut die komplette ASS-Datei.
 * @param words     Wort-Zeitstempel aus Edge TTS (Sekunden, ohne Vorlauf)
 * @param quelltext Der gesprochene Originaltext - liefert die Satzzeichen
 * @param offset    Vorlauf in Sekunden, um den das Audio spaeter verschoben wird
 */
export function baueAss({ words, quelltext, offset, dauer, titel, handle, fontname }) {
  const c = CAPTIONS;
  const zeilen = [kopf(fontname)];
  const mitte = VIDEO.breite / 2;

  // Titelkarte: liegt die ganze Laufzeit oben, fliegt sanft ein
  if (titel) {
    zeilen.push(
      `Dialogue: 0,${zeit(0.15)},${zeit(dauer)},Titel,,0,0,0,,` +
        `{\\pos(${mitte},${c.titleYPosition})\\fad(250,300)\\alpha&H20&}${esc(titel)}`,
    );
  }

  // Handle unten als dezentes Wasserzeichen
  if (handle) {
    zeilen.push(
      `Dialogue: 0,${zeit(0.4)},${zeit(dauer)},Handle,,0,0,0,,` +
        `{\\pos(${mitte},${c.handleY})\\fad(400,300)\\alpha&H50&}${esc(handle)}`,
    );
  }

  const chunks = chunkeWoerter(annotiereWoerter(words, quelltext ?? ""));

  chunks.forEach((chunk, i) => {
    const start = chunk[0].start + offset;
    // Ein Chunk steht, bis der naechste uebernimmt - so entstehen in den
    // Sprechpausen keine Loecher, in denen der Bildschirm leer ist.
    const letzterChunk = i + 1 === chunks.length;
    const ende = letzterChunk
      ? Math.min(chunk[chunk.length - 1].end + offset + 0.5, dauer)
      : Math.min(chunks[i + 1][0].start + offset, dauer);

    // Karaoke: jedes Wort bekommt seine eigene Einfaerbe-Dauer in Centisekunden.
    let text = "";
    chunk.forEach((w, j) => {
      const wStart = w.start + offset;
      const wEnde = j + 1 < chunk.length ? chunk[j + 1].start + offset : ende;
      const cs = Math.max(6, Math.round((wEnde - wStart) * 100));
      text += `{\\kf${cs}}${esc(w.anzeige ?? w.text)} `;
    });

    // Pop-in: kurz kleiner starten, dann auf 100 % skalieren
    const tags =
      `{\\pos(${mitte},${c.yPosition})\\fad(70,70)` +
      `\\fscx86\\fscy86\\t(0,110,\\fscx100\\fscy100)}`;

    zeilen.push(
      `Dialogue: 1,${zeit(start)},${zeit(ende)},Cap,,0,0,0,,${tags}${text.trimEnd()}`,
    );
  });

  return zeilen.join("\n") + "\n";
}
