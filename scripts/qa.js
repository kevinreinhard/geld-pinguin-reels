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
      // Die sechs Noten stehen flach nebeneinander, nicht in einem
      // Unterobjekt. Verschachtelt kam beim ersten Messlauf eine Zeichenkette
      // statt eines Objekts zurueck, und die Auswertung zeigte "0/100" an.
      ...Object.fromEntries(
        Object.entries(DIMENSIONEN).map(([k, frage]) => [
          k, { type: "integer", description: `0 bis 100. ${frage}` },
        ]),
      ),
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
    required: [...Object.keys(DIMENSIONEN), "maengel", "staerkste", "urteil"],
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

/**
 * Der Szenenplan des zuletzt gerenderten Reels, sofern er zur Datei passt.
 *
 * Ohne ihn werden die Bilder gleichmaessig verteilt - und dann liegen bei
 * sieben Szenen und acht Bildern regelmaessig zwei Schnitte zwischen zwei
 * Proben. Die Bildkontrolle sieht die Schnitte nicht und meldet Stillstand,
 * den es nicht gibt. Das war ein Fehler im Messgeraet, nicht im Video.
 */
function szenenplan(dauer) {
  try {
    const spez = JSON.parse(fs.readFileSync(path.posix.join(BUILD, "szenen.json"), "utf8"));
    if (Math.abs(spez.dauer - dauer) > 1.5) return null;   // gehoert zu einem anderen Video
    return spez.szenen.filter((s) => s.ende - s.start > 0.8);
  } catch {
    return null;
  }
}

/**
 * Waehlt die Zeitpunkte aus.
 *
 * Mit Szenenplan wird je Szene zweimal geschaut: kurz nach dem Schnitt und
 * kurz davor. Zwei Bilder derselben Szene zeigen, ob sich innerhalb der Szene
 * etwas bewegt; der Sprung zum naechsten Paar zeigt den Schnitt. Beides laesst
 * sich so beurteilen, statt es zu erraten.
 */
function zeitpunkte(dauer, szenen, anzahl) {
  if (!szenen?.length) {
    const zeiten = [{ t: 0.6 }, { t: 1.4 }];
    for (let i = 0; i < anzahl - 2; i++) {
      zeiten.push({ t: +(2.2 + ((dauer - 3.0) * i) / (anzahl - 3)).toFixed(2) });
    }
    return zeiten;
  }

  const paare = [];
  for (const [i, s] of szenen.entries()) {
    const frueh = +Math.min(s.ende - 0.15, s.start + 0.55).toFixed(2);
    const spaet = +Math.max(s.start + 0.15, s.ende - 0.35).toFixed(2);
    paare.push([
      { t: frueh, szene: i + 1, typ: s.typ, wann: "kurz nach dem Schnitt" },
      { t: spaet, szene: i + 1, typ: s.typ, wann: "kurz vor dem naechsten Schnitt" },
    ]);
  }

  // Passen nicht alle Paare ins Budget, entfallen mittlere Szenen - Anfang und
  // Ende des Reels wiegen schwerer als die Mitte.
  const zeiten = [];
  const reihenfolge = [...paare.keys()].sort((a, b) => {
    const rang = (i) => (i === 0 ? 0 : i === paare.length - 1 ? 1 : 2 + i);
    return rang(a) - rang(b);
  });
  for (const i of reihenfolge) {
    if (zeiten.length + 2 > anzahl) break;
    zeiten.push(...paare[i]);
  }
  return zeiten.sort((a, b) => a.t - b.t);
}

/** Schneidet die Einzelbilder heraus, an denen die Beurteilung haengt. */
async function einzelbilder(datei, anzahl = 10) {
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

  const szenen = szenenplan(dauer);
  const zeiten = zeitpunkte(dauer, szenen, anzahl);

  const bilder = [];
  for (const [i, z] of zeiten.entries()) {
    const ziel = path.posix.join(ordner, `b${i}.jpg`);
    // Halbe Kantenlaenge reicht: Was hier nicht mehr lesbar ist, ist auf dem
    // Handy auch nicht lesbar.
    await lauf(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(z.t), "-i", datei,
        "-frames:v", "1", "-vf", "scale=540:960", "-q:v", "4", ziel],
      { still: true },
    );
    if (fs.existsSync(ziel)) bilder.push({ ...z, datei: ziel });
  }
  return { dauer, bilder, szenen };
}

/** Holt die sechs Noten aus der Antwort und begrenzt sie auf 0 bis 100. */
function noten(eingabe) {
  const raus = {};
  for (const k of Object.keys(DIMENSIONEN)) {
    const n = Number(eingabe?.[k] ?? eingabe?.noten?.[k]);
    raus[k] = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
  }
  return raus;
}

function schnitt(werte) {
  const zahlen = Object.values(werte).filter((v) => Number.isFinite(v));
  return zahlen.length ? Math.round(zahlen.reduce((a, b) => a + b, 0) / zahlen.length) : 0;
}

export async function pruefe(datei) {
  const { dauer, bilder, szenen } = await einzelbilder(datei);
  console.log(
    `  ${bilder.length} Einzelbilder aus ${dauer.toFixed(1)}s entnommen` +
      (szenen ? ` (${szenen.length} Szenen, je zwei Bilder)` : " (gleichmaessig verteilt)"),
  );

  const inhalt = [];
  bilder.forEach((b, i) => {
    const woher = b.szene
      ? `Bild ${i + 1} - Sekunde ${b.t}, Szene ${b.szene} (${b.typ}), ${b.wann}`
      : `Bild ${i + 1} - Sekunde ${b.t}`;
    inhalt.push({ type: "text", text: woher });
    inhalt.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: fs.readFileSync(b.datei).toString("base64"),
      },
    });
  });
  const rahmen = szenen
    ? `Das Reel ist ${dauer.toFixed(1)} Sekunden lang und hat ${szenen.length} Szenen, ` +
      `also ${szenen.length - 1} Schnitte: ${szenen.map((s) => s.start.toFixed(1)).slice(1).join(", ")} Sekunden.

` +
      "Zu jeder Szene siehst du zwei Bilder - eines kurz nach ihrem Schnitt, eines kurz " +
      "vor dem naechsten. Beurteile damit zweierlei getrennt: Unterscheiden sich die " +
      "beiden Bilder einer Szene, bewegt sich innerhalb der Szene etwas. Unterscheiden " +
      "sich die Bilder benachbarter Szenen, traegt der Schnitt. Schliesse nicht von " +
      "zwei aehnlichen Bildern auf einen fehlenden Schnitt - die Schnittzeiten stehen " +
      "oben, und zwischen zwei Bildern koennen mehrere liegen."
    : `Das Reel ist ${dauer.toFixed(1)} Sekunden lang. Benote es.`;
  inhalt.push({ type: "text", text: rahmen });

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

  const werte = noten(block.input);
  if (Object.values(werte).every((v) => v === null)) {
    throw new Error("Antwort enthaelt keine lesbaren Noten: " +
      JSON.stringify(block.input).slice(0, 300));
  }
  return {
    datum: new Date().toISOString(),
    datei,
    dauer: +dauer.toFixed(2),
    noten: werte,
    gesamt: schnitt(werte),
    maengel: Array.isArray(block.input.maengel) ? block.input.maengel : [],
    staerkste: String(block.input.staerkste ?? ""),
    urteil: String(block.input.urteil ?? ""),
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
    if (v === null) {
      console.log(`    ${k.padEnd(13)}   -  (keine Note)`);
      continue;
    }
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
