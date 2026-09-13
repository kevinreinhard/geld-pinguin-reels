// Prueffall fuer den Renderer - ohne Claude, ohne Veroeffentlichung.
//
// Am Design zu arbeiten heisst, oft zu rendern und nachzusehen. Ueber den
// normalen Lauf kostet das jedes Mal zwei Modellaufrufe und liefert jedes Mal
// ein anderes Skript, sodass sich zwei Staende nicht vergleichen lassen. Hier
// stehen Skript und Szenenplan fest: Was sich zwischen zwei Laeufen aendert,
// ist ausschliesslich das Design.
//
//   node scripts/musterreel.js              Muster 0 rendern
//   node scripts/musterreel.js --nr 1       ein anderes Muster
//   node scripts/musterreel.js --liste      verfuegbare Muster zeigen
//   node scripts/musterreel.js --regie      Szenen von der Bildregie planen lassen
//                                           (braucht ANTHROPIC_API_KEY)
//
// Die Muster decken zusammen alle Kartentypen ab. Wer einen neuen Typ baut,
// haengt hier ein Muster an, das ihn zeigt.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { VOICE } from "../src/config.js";
import { lauf, rendere } from "../src/render.js";

const BUILD = "build";
const flags = process.argv.slice(2);
const wert = (name, standard) => {
  const i = flags.indexOf(name);
  return i >= 0 ? flags[i + 1] : standard;
};

const pythonBin =
  process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

export const MUSTER = [
  {
    name: "dispo",
    beschreibung: "Kennzahl, Vergleich, Stichwort, Liste, Endkarte",
    title: "DISPO KOSTET RICHTIG",
    saetze: [
      "Zweitausend Euro im Dispo kosten dich rund 200 Euro Zinsen jährlich.",
      "Banken verlangen im Schnitt etwa 10 Prozent, manche über 13 Prozent.",
      "Der Dispo ist der teuerste Kredit, den du überhaupt bekommst.",
      "Ein normaler Ratenkredit liegt oft bei 6 bis 8 Prozent.",
      "Öffne heute deine Kontoumsätze und suche die Position Sollzinsen.",
      "Folge für mehr Tricks gegen Bankgebühren.",
    ],
    szenen: [
      { typ: "kennzahl", stimmung: "warnung", kicker: "2.000 Euro im Dispo",
        wert: "200", einheit: "€", fussnote: "Zinsen, jedes Jahr" },
      { typ: "vergleich", stimmung: "warnung", kicker: "Dispozins der Banken",
        zeilen: [
          { label: "Im Schnitt", wert: "10 %", anteil: 0.77, stimmung: "warnung" },
          { label: "Bei manchen", wert: "13 %", anteil: 1, stimmung: "warnung" },
        ] },
      { typ: "stichwort", stimmung: "warnung", kicker: "Merk dir das",
        begriff: "Der teuerste Kredit, den du bekommst" },
      { typ: "kennzahl", stimmung: "gut", kicker: "Ratenkredit stattdessen",
        wert: "7", einheit: "%", fussnote: "statt 10 bis 13 Prozent" },
      { typ: "liste", stimmung: "info", kicker: "Heute in fünf Minuten",
        punkte: [
          { text: "Kontoumsätze öffnen", zeichen: "ja" },
          { text: "Position Sollzinsen suchen", zeichen: "ja" },
          { text: "Umschuldung anfragen", zeichen: "ja" },
        ] },
      { typ: "endkarte", stimmung: "neutral", begriff: "Mehr gegen Bankgebühren" },
    ],
  },
  {
    name: "zinseszins",
    beschreibung: "Hook mit Pinguin, Verlauf, Vergleich, Kennzahl, Endkarte",
    title: "ZINSESZINS RECHNET MIT",
    saetze: [
      "Zweihundert Euro im Monat werden in zwanzig Jahren zu über hunderttausend.",
      "Eingezahlt hast du davon nur achtundvierzigtausend Euro.",
      "Den Rest macht der Zinseszins, und der braucht vor allem Zeit.",
      "Wer zehn Jahre später anfängt, landet bei knapp der Hälfte.",
      "Ein Sparplan ab fünfundzwanzig Euro monatlich geht bei jedem Broker.",
      "Folge für mehr über den Zinseszins.",
    ],
    szenen: [
      { typ: "hook", stimmung: "gut", begriff: "200 Euro werden 100.000" },
      { typ: "kennzahl", stimmung: "info", kicker: "Davon selbst eingezahlt",
        wert: "48.000", einheit: "€", fussnote: "in zwanzig Jahren" },
      { typ: "verlauf", stimmung: "gut", kicker: "200 € monatlich, 7 Prozent",
        werte: [0, 2.6, 5.7, 9.6, 14.6, 21, 29.2, 39.8, 53.4],
        von: "heute", bis: "in 20 Jahren", endwert: "104.000 €" },
      { typ: "vergleich", stimmung: "warnung", kicker: "Zehn Jahre später starten",
        zeilen: [
          { label: "Ab heute", wert: "104.000 €", anteil: 1, stimmung: "gut" },
          { label: "Ab in 10 Jahren", wert: "43.000 €", anteil: 0.41, stimmung: "warnung" },
        ] },
      { typ: "liste", stimmung: "info", kicker: "So fängst du an",
        punkte: [
          { text: "Depot eröffnen, dauert 15 Minuten", zeichen: "ja" },
          { text: "Sparplan ab 25 Euro einrichten", zeichen: "ja" },
          { text: "Auf den richtigen Moment warten", zeichen: "nein" },
        ] },
      { typ: "endkarte", stimmung: "neutral", begriff: "Mehr zum Zinseszins" },
    ],
  },
];

async function main() {
  if (flags.includes("--liste")) {
    MUSTER.forEach((m, i) => console.log(`  ${i}  ${m.name.padEnd(12)} ${m.beschreibung}`));
    return;
  }

  const nr = Number(wert("--nr", "0"));
  const muster = MUSTER[nr];
  if (!muster) throw new Error(`Muster ${nr} gibt es nicht. --liste zeigt alle.`);

  fs.mkdirSync(BUILD, { recursive: true });
  const text = muster.saetze.join(" ");
  // Der Dateiname traegt den Musternamen. Ohne ihn laeuft ein Wechsel von
  // --nr 1 auf --nr 0 mit der zwischengespeicherten Aufnahme des anderen
  // Musters, und die Szenen sitzen auf den falschen Zeiten.
  const voicePfad = path.posix.join(BUILD, `muster-${muster.name}.mp3`);
  const wordsPfad = path.posix.join(BUILD, `muster-${muster.name}.json`);

  // Die Sprachaufnahme wird wiederverwendet: Sie ist bei gleichem Text immer
  // dieselbe und kostet sonst bei jedem Durchgang eine halbe Minute.
  if (!fs.existsSync(wordsPfad) || wert("--neu", null) !== null) {
    console.log(`[1] Sprachaufnahme (${muster.name})`);
    const eingabe = path.posix.join(BUILD, `muster-${muster.name}-tts.json`);
    fs.writeFileSync(eingabe, JSON.stringify({
      text, voice: VOICE.stimmen[0], rate: VOICE.rate, pitch: VOICE.pitch,
      audio: voicePfad, words: wordsPfad,
    }));
    await lauf(pythonBin, ["src/tts.py", eingabe]);
  } else {
    console.log(`[1] Sprachaufnahme aus dem Zwischenspeicher`);
  }

  let szenen = muster.szenen.map((s, i) => ({ satz: i, kicker: "", ...s }));
  if (flags.includes("--regie")) {
    console.log("[2] Bildregie von Claude planen lassen");
    const { planeBilder } = await import("../src/regie.js");
    szenen = await planeBilder({ topic: muster.name, title: muster.title }, muster.saetze);
  }
  szenen.forEach((s, i) => console.log(`    ${i + 1}. ${s.typ} (${s.stimmung})`));

  console.log("[3] Rendern");
  const video = await rendere({
    skript: { title: muster.title },
    voicePfad, wordsPfad, text, szenen, saetze: muster.saetze,
  });
  console.log(`\nFertig: ${video.pfad}`);
  console.log("Beurteilen:  node scripts/qa.js");
}

// Nur ausfuehren, wenn die Datei direkt gestartet wurde. Der Workflow
// importiert sie, um MUSTER auszulesen - ohne diese Pruefung wuerde allein
// der Import ein Video rendern.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error("\nFEHLER: " + e.message);
    process.exit(1);
  });
}
