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

/**
 * Woerter, an denen eine Untertitelzeile nicht enden darf.
 *
 * Artikel, Praepositionen und Konjunktionen zeigen auf das, was danach kommt.
 * Endet die Zeile auf ihnen, steht ein Fragment im Bild, das ohne Ton nichts
 * bedeutet - "mehr ab wegen" war eines. Wer ein Reel stumm schaut, und das ist
 * die Mehrheit, liest genau diese Zeile.
 */
const KLEBER = new Set(
  ("der die das den dem des ein eine einen einem einer eines kein keine keinen " +
   "mein dein sein ihr ihre deinen deiner deinem " +
   "in im an am auf aus bei beim mit nach von vom zu zum zur fuer für ueber über " +
   "unter vor hinter neben zwischen ohne gegen um durch wegen trotz seit ab als " +
   "und oder aber denn sondern dass weil wenn ob wie damit obwohl also " +
   "nicht nur schon noch mehr rund etwa circa bis pro je").split(" "),
);

/** Grobe Kosten fuer eine Zeile von Wort s bis e. Kleiner ist besser. */
function kosten(worte, s, e, n, maxSekunden) {
  const laenge = e - s;
  let k = Math.abs(laenge - 3) * 1.2;

  // Eine Zeile, die zu lange steht, ist ein Standbild fuer sich.
  const dauer = worte[e - 1].end - worte[s].start;
  if (dauer > maxSekunden) k += (dauer - maxSekunden) * 9;

  if (e < n) {
    const letztes = String(worte[e - 1].anzeige ?? worte[e - 1].text ?? "");
    const blank = letztes.replace(/[.,!?…:;]+$/, "").toLowerCase();
    if (KLEBER.has(blank)) k += 9;          // Zeile endet auf einem Fuellwort
    if (/^[\d.,]+$/.test(blank)) k += 8;    // "100" gehoert zu seiner Einheit
    if (/[,;:]$/.test(letztes)) k -= 3;     // Komma ist eine echte Atempause
    if (laenge === 1) k += 4;               // Einzelwortzeilen wirken wie Fehler
  }
  return k;
}

/**
 * Teilt einen Satz in Zeilen - nicht nach fester Wortzahl, sondern an den
 * Stellen, an denen ein Umbruch am wenigsten weh tut. Vollstaendige Suche
 * ueber alle Aufteilungen; bei hoechstens rund fuenfzehn Woertern je Satz
 * kostet das nichts.
 */
function segmentiere(worte, maxWorte, maxSekunden) {
  const n = worte.length;
  if (n <= 1) return [worte];

  const besser = Array(n + 1).fill(null);
  besser[0] = { summe: 0, von: 0 };
  for (let e = 1; e <= n; e++) {
    for (let s = Math.max(0, e - maxWorte); s < e; s++) {
      if (!besser[s]) continue;
      const summe = besser[s].summe + kosten(worte, s, e, n, maxSekunden);
      if (!besser[e] || summe < besser[e].summe) besser[e] = { summe, von: s };
    }
  }

  const zeilen = [];
  for (let e = n; e > 0; e = besser[e].von) zeilen.unshift(worte.slice(besser[e].von, e));
  return zeilen;
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
    chunks.push(
      ...segmentiere(satz, CAPTIONS.maxWoerterProChunk, CAPTIONS.maxSekundenProChunk),
    );
  }
  return chunks;
}

function kopf(fontname) {
  const c = CAPTIONS;
  // Auf hellem Grund bekommen die Untertitel einen deckenden Kasten
  // (BorderStyle 3), auf dunklem eine Kontur (BorderStyle 1). Der Text darin
  // bleibt in beiden Faellen derselbe - was sich aendert, ist nur, worauf er
  // liegt. Ohne Kasten verschwindet weisse Schrift auf Gelb.
  const rand = c.kasten
    ? { stil: 3, staerke: 18, schatten: 0 }
    : { stil: 1, staerke: c.outlineStaerke, schatten: 4 };
  // Der Kasten nutzt BackColour; ohne Kasten bleibt dort ein weicher Schatten.
  const kastenFarbe = c.kasten ? c.outlineFarbe.replace("&H00", "&H14") : "&H64000000";

  // Titel und Wasserzeichen liegen direkt auf dem Hintergrund und tragen ihre
  // Farbe aus dem Thema - deshalb hier weder Kontur noch Schatten.
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
Style: Cap,${fontname},${c.fontSize},${c.gesprochenFarbe},${c.kommendFarbe},${c.outlineFarbe},${kastenFarbe},0,0,0,0,100,100,2,0,${rand.stil},${rand.staerke},${rand.schatten},5,90,90,0,1
Style: Titel,${fontname},${c.titleFontSize},${c.aktivFarbe},${c.aktivFarbe},${c.outlineFarbe},&H64000000,0,0,0,0,100,100,9,0,1,0,0,5,90,90,0,1
Style: Handle,${fontname},38,${c.handleFarbe},${c.handleFarbe},${c.outlineFarbe},&H64000000,0,0,0,0,100,100,4,0,1,0,0,5,60,60,0,1

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

    // Pop-in: kurz kleiner starten, dann auf 100 % skalieren.
    //
    // Ausgeblendet wird nur der allerletzte Chunk. Dazwischen loest ein Chunk
    // den naechsten hart ab: Beim Ausblenden sank die Deckkraft auf rund
    // 40 Prozent, und die Bildkontrolle hat das gelbe Wort auf dunklem Grund
    // zweimal als praktisch unlesbar gemeldet. Ein Untertitel, den man in
    // dem Moment liest, in dem er verschwindet, ist nutzlos.
    // Auch nicht eingeblendet: Die 60 Millisekunden Blende haben genuegt, um
    // eine Zeile auf einem Standbild halb durchsichtig zu erwischen. Das
    // Hereinskalieren unten reicht als Auftritt vollkommen.
    const ausblenden = letzterChunk ? 180 : 0;
    const tags =
      `{\\pos(${mitte},${c.yPosition})\\fad(0,${ausblenden})` +
      `\\fscx86\\fscy86\\t(0,110,\\fscx100\\fscy100)}`;

    zeilen.push(
      `Dialogue: 1,${zeit(start)},${zeit(ende)},Cap,,0,0,0,,${tags}${text.trimEnd()}`,
    );
  });

  return zeilen.join("\n") + "\n";
}
