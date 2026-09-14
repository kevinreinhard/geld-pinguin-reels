// Auswertung der bisherigen Hooks.
//
// Der erste Satz ist die ganze Chance eines Reels, und die Bildkontrolle meldet
// ihn seit Wochen als schwaechste Stelle. src/hook.js prueft jeden neuen Hook
// vor dem Rendern - hier wird geschaut, was der Kanal bisher gemacht hat, und
// daraus werden Anweisungen fuer den Skript-Prompt abgeleitet.
//
//   node scripts/hooks.js              auswerten und anzeigen
//   node scripts/hooks.js --schreiben  Erkenntnisse in data/tuning.json ablegen
//
// Die Warnung vorweg, sie steht auch im Bericht: Bei zweistelligen Viewzahlen
// ist der Unterschied zwischen zwei Mustern Rauschen. Diese Auswertung darf
// deshalb erst ab einer Mindestmenge Zahlen deuten - darunter beschreibt sie
// nur, was da ist.

import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "../src/config.js";
import { ladeHistorie } from "../src/history.js";
import { GRENZEN, ladeTuning, speichereTuning } from "../src/tuning.js";
import { mechanischePruefung } from "../src/hook.js";

const flags = new Set(process.argv.slice(2));

// Ab hier darf gedeutet werden. Darunter wird nur beschrieben.
const MINDEST_REELS = 15;
const MINDEST_VIEWS = 150;

/**
 * Ordnet einen Hook einem Muster zu.
 *
 * Bewusst mechanisch: Ein Modell wuerde jedes Mal etwas andere Kategorien
 * bilden, und dann liesse sich ueber die Wochen nichts vergleichen.
 */
export function muster(hook) {
  const t = String(hook ?? "").toLowerCase();

  if (/\b(bis|ab|noch bis|frist|stichtag|endet|läuft ab|laeuft ab|jahresende|31\.)\b/.test(t)) {
    return "frist";
  }
  if (/\b(kostet|kosten|verlierst|verschenkst|zahlst du drauf|drauf|weg|zu viel)\b/.test(t)) {
    return "verlust";
  }
  if (/\b(aber|trotzdem|stimmt nicht|ist es nicht|denken|glauben|irrtum|mythos)\b/.test(t)) {
    return "irrtum";
  }
  if (/^\s*(\d|null|ein|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|hundert|tausend|zwei?tausend)/i.test(t)) {
    return "zahl zuerst";
  }
  if (/\d|prozent|euro/.test(t)) return "zahl im satz";
  return "aussage ohne zahl";
}

/** Views je Beitrag aus der juengsten Messung. */
function views() {
  try {
    const daten = JSON.parse(fs.readFileSync("data/performance.json", "utf8"));
    const letzte = daten.messungen?.[daten.messungen.length - 1];
    const karte = new Map();
    for (const b of letzte?.beitraege ?? []) {
      if (b.permalink) karte.set(b.permalink, Number(b.views) || 0);
    }
    return karte;
  } catch {
    return new Map();
  }
}

function auswertung() {
  const zahlen = views();
  const posts = ladeHistorie()
    .filter((p) => p.hook)
    .map((p) => {
      const { hart, weich } = mechanischePruefung(p.hook);
      return {
        hook: p.hook,
        thema: p.topic,
        saeule: p.pillar,
        zeit: p.zeit,
        muster: muster(p.hook),
        views: zahlen.get(p.permalink) ?? null,
        maengel: [...hart, ...weich],
      };
    });

  const gruppen = new Map();
  for (const p of posts) {
    const g = gruppen.get(p.muster) ?? { anzahl: 0, views: [], beispiele: [] };
    g.anzahl += 1;
    if (Number.isFinite(p.views)) g.views.push(p.views);
    if (g.beispiele.length < 2) g.beispiele.push(p.hook);
    gruppen.set(p.muster, g);
  }

  const gemessen = posts.filter((p) => Number.isFinite(p.views));
  const gesamtViews = gemessen.reduce((a, p) => a + p.views, 0);
  return { posts, gruppen, gemessen, gesamtViews };
}

function zeige({ posts, gruppen, gemessen, gesamtViews }) {
  console.log(`\n${posts.length} Hooks in der Historie, davon ${gemessen.length} mit Messwerten.`);
  console.log(`Summe Views: ${gesamtViews}\n`);

  console.log("Muster:");
  for (const [name, g] of [...gruppen].sort((a, b) => b[1].anzahl - a[1].anzahl)) {
    const schnitt = g.views.length
      ? (g.views.reduce((a, b) => a + b, 0) / g.views.length).toFixed(1)
      : "-";
    console.log(`  ${name.padEnd(18)} ${String(g.anzahl).padStart(2)}x   Views im Schnitt: ${schnitt}`);
    for (const b of g.beispiele) console.log(`      "${b}"`);
  }

  const schwach = posts.filter((p) => p.maengel.length);
  console.log(`\nHooks mit mechanischem Befund: ${schwach.length} von ${posts.length}`);
  for (const p of schwach.slice(-6)) {
    console.log(`  "${p.hook}"`);
    for (const m of p.maengel) console.log(`      ${m}`);
  }
}

const TOOL = {
  name: "hook_erkenntnisse",
  description: "Leitet aus den bisherigen Hooks Anweisungen fuer den Skript-Prompt ab.",
  input_schema: {
    type: "object",
    properties: {
      hinweise: {
        type: "array",
        items: { type: "string" },
        description:
          `Hoechstens ${GRENZEN.hookHinweise.anzahl} Anweisungen, je hoechstens ` +
          `${GRENZEN.hookHinweise.laenge} Zeichen. Sie werden dem Skript-Prompt ` +
          "woertlich angehaengt und gelten fuer jedes kuenftige Reel. Deshalb: " +
          "Anweisungen, keine Beobachtungen. Nicht 'Viele Hooks nennen nur eine Zahl', " +
          "sondern 'Nenne im ersten Satz die Folge, nicht nur den Betrag'.",
      },
      begruendung: {
        type: "string",
        description: "Zwei bis vier Saetze: worauf sich die Anweisungen stuetzen.",
      },
    },
    required: ["hinweise", "begruendung"],
  },
};

async function leiteAb(a, darfDeuten) {
  const liste = a.posts
    .map((p) => `- [${p.muster}] "${p.hook}"` + (Number.isFinite(p.views) ? ` (${p.views} Views)` : ""))
    .join("\n");

  const system = `Du wertest die Hooks des Finanzbildungs-Kanals @geld.pinguin aus und
leitest daraus Anweisungen fuer den Prompt ab, der kuenftige Skripte schreibt.

Was einen Hook traegt: ein Verlust, den niemand bemerkt; eine ueberraschende Zahl
mit Folge; ein Irrtum, sofort widersprochen; eine Frist. Was ihn nicht traegt:
eine Groesse ohne Einsatz, eine Frage, eine Vorrede.

${darfDeuten
  ? "Die Datenlage reicht, um Viewzahlen vorsichtig zu deuten. Vergleiche nur aehnlich alte Beitraege und sag deutlich, wenn ein Unterschied im Rauschen liegt."
  : `Die Datenlage reicht NICHT, um Viewzahlen zu deuten - unter ${MINDEST_REELS} Reels oder ${MINDEST_VIEWS} Views ist jeder Unterschied Zufall. Leite deine Anweisungen ausschliesslich aus dem Handwerk ab: aus dem, was an den Formulierungen selbst schwach ist. Nenne keine Zahl als Begruendung.`}

Deine Anweisungen landen woertlich im Prompt und gelten fuer jedes kuenftige
Reel. Schreib sie als Anweisung, nicht als Beobachtung, und wiederhole nicht,
was ohnehin schon im Prompt steht - such das, was diese konkreten Hooks
schwaecher macht, als sie sein muessten.

Antworte ausschliesslich ueber das Tool hook_erkenntnisse.`;

  const client = new Anthropic();
  const antwort = await client.messages.create({
    model: MODEL.id,
    max_tokens: MODEL.maxTokens,
    thinking: { type: "adaptive" },
    system,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "hook_erkenntnisse" },
    messages: [{ role: "user", content: `Die bisherigen Hooks:\n\n${liste}` }],
  });
  const block = antwort.content.find((b) => b.type === "tool_use");
  if (!block) throw new Error("keine Erkenntnisse erhalten.");
  return block.input;
}

async function main() {
  const a = auswertung();
  zeige(a);

  const darfDeuten = a.posts.length >= MINDEST_REELS && a.gesamtViews >= MINDEST_VIEWS;
  console.log(
    darfDeuten
      ? "\nDatenlage reicht, um Viewzahlen vorsichtig zu deuten."
      : `\nDatenlage reicht nicht zum Deuten (${a.posts.length}/${MINDEST_REELS} Reels, ` +
        `${a.gesamtViews}/${MINDEST_VIEWS} Views). Die Anweisungen stuetzen sich aufs Handwerk.`,
  );

  if (!flags.has("--schreiben")) {
    console.log("\nNichts geschrieben. Mit --schreiben landen die Anweisungen in data/tuning.json.");
    return;
  }

  const ergebnis = await leiteAb(a, darfDeuten);
  console.log("\nAbgeleitete Anweisungen:");
  for (const h of ergebnis.hinweise) console.log(`  - ${h}`);

  const tuning = ladeTuning({ still: true });
  speichereTuning(
    { ...tuning, hookHinweise: ergebnis.hinweise },
    `Hook-Auswertung: ${ergebnis.begruendung}`,
  );
  console.log("\nIn data/tuning.json geschrieben.");
}

main().catch((e) => {
  console.error("\nFEHLER: " + e.message);
  process.exit(1);
});
