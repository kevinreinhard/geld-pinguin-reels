// Bildkontrolle: Claude sieht sich das fertige Reel an und benotet es.
//
// Warum ueberhaupt: Der Renderer kann nicht wissen, ob ein Text abgeschnitten
// ist, ob eine Zahl vor dem Hintergrund untergeht oder ob das Video nach vier
// Sekunden aussieht wie ein Standbild. Ein Blick darauf beantwortet das - und
// nur ein Modell mit Augen kann diesen Blick automatisch werfen.
//
//   node scripts/qa.js                    fertiges build/reel.mp4 pruefen
//   node scripts/qa.js --datei x.mp4      eine andere Datei pruefen
//   node scripts/qa.js --streng           Rueckgabecode 1, wenn die Note zu tief ist
//   node scripts/qa.js --kein-verlauf     Ergebnis nur anzeigen, nichts speichern
//
// Das Ergebnis landet in data/qualitaet.json (letzter Stand) und wird an
// data/qualitaet-verlauf.json angehaengt. Die Entwicklung ueber die Zeit ist
// der eigentliche Wert: Sie zeigt, ob eine Designaenderung etwas gebracht hat.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "../src/config.js";
import { lauf } from "../src/render.js";

const BUILD = "build";
const STAND = "data/qualitaet.json";
const VERLAUF = "data/qualitaet-verlauf.json";
const MINDESTWERT = Number(process.env.QA_MINDESTWERT ?? 55);

const flags = process.argv.slice(2);
const wert = (name, standard) => {
  const i = flags.indexOf(name);
  return i >= 0 ? flags[i + 1] : standard;
};

const DIMENSIONEN = {
  hook: "Halten die ersten zwei Sekunden jemanden auf, der schnell wischt?",
  lesbarkeit: "Ist jeder Text gross genug, kontrastreich und vollstaendig sichtbar?",
  bildwechsel: "Passiert genug? Wirkt irgendein Abschnitt wie ein Standbild?",
  information: "Traegt das Bild die Aussage - oder muss man zuhoeren, um sie zu verstehen?",
  marke: "Wirkt das wie ein Kanal mit Handschrift oder wie eine Vorlage von der Stange?",
  sicherheit: "Liegt Wichtiges unter den Bedienelementen von Instagram?",
};

const TOOL = {
  name: "bildkontrolle",
  description: "Benotet ein fertiges Reel und benennt die konkreten Maengel.",
  input_schema: {
    type: "object",
    properties: {
      noten: {
        type: "object",
        description: "Je Dimension 0 bis 100.",
        properties: Object.fromEntries(
          Object.keys(DIMENSIONEN).map((k) => [k, { type: "integer" }]),
        ),
        required: Object.keys(DIMENSIONEN),
      },
      maengel: {
        type: "array",
        description:
          "Konkrete Befunde, schwerster zuerst. Hoechstens sechs. Nur was auf den " +
          "Bildern tatsaechlich zu sehen ist.",
        items: {
          type: "object",
          properties: {
            bereich: { type: "string", enum: Object.keys(DIMENSIONEN) },
            schwere: { type: "string", enum: ["schwer", "mittel", "klein"] },
            befund: { type: "string", description: "Was ist zu sehen, in einem Satz" },
            bild: { type: "string", description: "In welchem der gezeigten Bilder, z.B. 'Bild 3'" },
            vorschlag: {
              type: "string",
              description:
                "Was im Code zu aendern waere. Konkret: Zahlenwert, Position, Farbe - " +
                "keine allgemeinen Ratschlaege.",
            },
          },
          required: ["bereich", "schwere", "befund", "vorschlag"],
        },
      },
      staerkste: { type: "string", description: "Was an diesem Reel am besten funktioniert" },
      urteil: { type: "string", description: "Zwei Saetze Gesamteindruck" },
    },
    required: ["noten", "maengel", "staerkste", "urteil"],
  },
};

const SYSTEM = `Du bist Bildkritiker fuer den deutschen Finanzbildungs-Kanal @geld.pinguin
auf Instagram Reels und YouTube Shorts.

Du siehst Einzelbilder eines fertig gerenderten Reels in zeitlicher Reihenfolge.
Benote, was du siehst, und benenne Maengel so konkret, dass man sie im Code
beheben kann.

Zu den Koordinaten - lies das genau, sonst misst du falsch:
Das Video ist 1080x1920. Die Bilder, die du siehst, sind auf **540x960**
verkleinert. Was du im Bild misst, musst du also verdoppeln, bevor du eine
Pixelangabe nennst. Nenne Pixelwerte immer im Massstab 1080x1920.

Worauf es ankommt:
${Object.entries(DIMENSIONEN).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

Massstab ist nicht "ganz nett fuer ein automatisch erzeugtes Video", sondern der
Vergleich mit dem, was auf Instagram taeglich gegen dieses Reel antritt. 60 ist
brauchbar, 80 ist gut, 90 vergibst du nur, wenn du nichts mehr zu bemaengeln hast.

Instagram legt ueber das Bild (Angaben in 1080x1920, in Klammern das, was du im
verkleinerten Bild misst):
- oben eine Kopfzeile bis y=200 (bei dir: bis y=100)
- unten Caption und Ton-Zeile ab y=1500 (bei dir: ab y=750)
- rechts eine Buttonspalte ab x=940 in der unteren Bildhaelfte (bei dir: ab x=470)
Was dort liegt, ist verdeckt. Was ausserhalb dieser Zonen liegt, ist in Ordnung -
melde es nicht. Pruefe vor jedem Befund zu Sicherheitsraendern, ob die Zahl nach
der Umrechnung wirklich in der Zone liegt.

Sei streng und praezise. "Koennte besser sein" hilft niemandem - "Die Fussnote in
Bild 2 steht in 44 Pixel Grauton auf dunkelblau und ist auf dem Handy nicht lesbar"
schon. Erfinde nichts, was auf den Bildern nicht zu sehen ist.

Antworte ausschliesslich ueber das Tool bildkontrolle.`;

/** Holt gleichmaessig verteilte Einzelbilder, plus einen fruehen Blick auf den Hook. */
async function einzelbilder(datei, anzahl = 8) {
  const out = await lauf(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", datei],
    { still: true },
  );
  const dauer = parseFloat(out.trim());
  if (!Number.isFinite(dauer)) throw new Error(`${datei} ist kein lesbares Video.`);

  const ordner = path.posix.join(BUILD, "qa");
  fs.rmSync(ordner, { recursive: true, force: true });
  fs.mkdirSync(ordner, { recursive: true });

  // Der Hook entscheidet, deshalb liegen zwei der Zeitpunkte in der ersten Sekunde.
  const zeiten = [0.6, 1.4];
  for (let i = 0; i < anzahl - 2; i++) {
    zeiten.push(+(2.2 + ((dauer - 3.0) * i) / (anzahl - 3)).toFixed(2));
  }

  const bilder = [];
  for (const [i, t] of zeiten.entries()) {
    const ziel = path.posix.join(ordner, `b${i}.jpg`);
    // Halbe Kantenlaenge reicht: Was hier nicht mehr lesbar ist, ist auf dem
    // Handy auch nicht lesbar.
    await lauf(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(t), "-i", datei,
        "-frames:v", "1", "-vf", "scale=540:960", "-q:v", "4", ziel],
      { still: true },
    );
    if (fs.existsSync(ziel)) bilder.push({ zeit: t, datei: ziel });
  }
  return { dauer, bilder };
}

function schnitt(noten) {
  const werte = Object.values(noten).filter((v) => Number.isFinite(v));
  return werte.length ? Math.round(werte.reduce((a, b) => a + b, 0) / werte.length) : 0;
}

export async function pruefe(datei) {
  const { dauer, bilder } = await einzelbilder(datei);
  console.log(`  ${bilder.length} Einzelbilder aus ${dauer.toFixed(1)}s entnommen`);

  const inhalt = [];
  bilder.forEach((b, i) => {
    inhalt.push({ type: "text", text: `Bild ${i + 1} - Sekunde ${b.zeit}` });
    inhalt.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: fs.readFileSync(b.datei).toString("base64"),
      },
    });
  });
  inhalt.push({
    type: "text",
    text: `Das Reel ist ${dauer.toFixed(1)} Sekunden lang. Benote es.`,
  });

  const client = new Anthropic();
  const antwort = await client.messages.create({
    model: MODEL.id,
    max_tokens: MODEL.maxTokens,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "bildkontrolle" },
    messages: [{ role: "user", content: inhalt }],
  });

  const block = antwort.content.find((b) => b.type === "tool_use");
  if (!block) throw new Error("Keine Bewertung erhalten.");

  return {
    datum: new Date().toISOString(),
    datei,
    dauer: +dauer.toFixed(2),
    gesamt: schnitt(block.input.noten),
    ...block.input,
  };
}

function speichere(ergebnis) {
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(STAND, JSON.stringify(ergebnis, null, 2), "utf8");

  let verlauf = [];
  try {
    verlauf = JSON.parse(fs.readFileSync(VERLAUF, "utf8"));
  } catch {
    verlauf = [];
  }
  // Im Verlauf stehen nur die Zahlen. Er soll ueber Monate lesbar bleiben.
  verlauf.push({
    datum: ergebnis.datum,
    gesamt: ergebnis.gesamt,
    noten: ergebnis.noten,
    schwere: ergebnis.maengel.filter((m) => m.schwere === "schwer").length,
  });
  fs.writeFileSync(VERLAUF, JSON.stringify(verlauf.slice(-200), null, 2), "utf8");
}

export function zeige(e) {
  console.log(`\n  Gesamtnote: ${e.gesamt}/100`);
  for (const [k, v] of Object.entries(e.noten)) {
    const balken = "#".repeat(Math.round(v / 5)).padEnd(20, ".");
    console.log(`    ${k.padEnd(13)} ${String(v).padStart(3)}  ${balken}`);
  }
  console.log(`\n  Stark:  ${e.staerkste}`);
  console.log(`  Urteil: ${e.urteil}`);
  if (e.maengel.length) {
    console.log("\n  Maengel:");
    for (const m of e.maengel) {
      console.log(`    [${m.schwere}] ${m.bereich}${m.bild ? " (" + m.bild + ")" : ""}`);
      console.log(`      ${m.befund}`);
      console.log(`      -> ${m.vorschlag}`);
    }
  }
}

async function main() {
  const datei = wert("--datei", path.posix.join(BUILD, "reel.mp4"));
  if (!fs.existsSync(datei)) throw new Error(`${datei} gibt es nicht. Erst rendern.`);
  console.log(`Bildkontrolle fuer ${datei}`);

  const ergebnis = await pruefe(datei);
  speichere(ergebnis);
  zeige(ergebnis);
  console.log(`\n  Gespeichert: ${STAND}`);

  if (flags.includes("--streng") && ergebnis.gesamt < MINDESTWERT) {
    console.error(`\nFEHLER: Note ${ergebnis.gesamt} liegt unter ${MINDESTWERT}.`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error("\nFEHLER: " + e.message);
    process.exit(1);
  });
}
