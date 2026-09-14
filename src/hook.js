// Pruefung des ersten Satzes.
//
// In den ersten zwei Sekunden entscheidet sich, ob jemand bleibt. Die
// Bildkontrolle hat den Hook ueber Wochen als schwaechste Dimension gemeldet,
// und der Befund war jedes Mal derselbe: Der Satz nennt eine Groesse, aber
// nicht, was auf dem Spiel steht. "Sechs Euro Aufpreis im Jahr" ist eine
// Preisangabe. "Der Unfallgegner hat kein Geld - dann zahlst du" ist die Sache.
//
// Zwei Stufen. Was sich abzaehlen laesst, wird abgezaehlt - das kostet nichts
// und faengt die groben Faelle. Alles andere beurteilt ein Modell.

import Anthropic from "@anthropic-ai/sdk";
import { CHANNEL, MODEL } from "./config.js";

const client = new Anthropic();

// Ein Hook faengt nie mit Aufwaermen an.
const AUFWAERMER =
  /^(hallo|hey|moin|servus|guten (tag|morgen)|wusstest du|schon gewusst|lass uns|heute (geht es|sprechen|reden)|in diesem (reel|video)|kennst du|stell dir vor|viele (leute|menschen) (wissen|denken) nicht)/i;

// Zahlwoerter, weil die Sprachsynthese grosse Zahlen ausgeschrieben braucht.
const ZAHLWORT =
  /\b(null|ein|eine|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwanzig|dreissig|dreißig|vierzig|fünfzig|hundert|tausend|million|prozent|euro)\w*/i;

const ANREDE = /\b(du|dich|dir|dein|deine|deinen|deinem|deiner|deines)\b/i;

/**
 * Was sich ohne Modell feststellen laesst.
 *
 * Harte Maengel sind Regelverstoesse - eine Frage als Hook ist immer falsch.
 * Weiche sind Anzeichen, kein Urteil: "Der Unfallgegner hat kein Geld, dann
 * zahlst du" nennt keine Zahl und ist trotzdem ein starker Hook. Sie fliessen
 * nur in die Rueckmeldung ein, wenn das Modell den Satz ohnehin verwirft.
 *
 * @returns {{hart: string[], weich: string[]}}
 */
export function mechanischePruefung(hook) {
  const text = String(hook ?? "").trim();
  const hart = [];
  const weich = [];

  if (!text) return { hart: ["Hook fehlt."], weich: [] };
  const woerter = text.split(/\s+/).filter(Boolean);

  if (AUFWAERMER.test(text)) {
    hart.push("beginnt mit Aufwaermen statt mit der Sache");
  }
  if (text.endsWith("?")) {
    hart.push("ist eine Frage - eine Frage laesst sich wegwischen, eine Behauptung nicht");
  }
  if (woerter.length > 14) {
    hart.push(`hat ${woerter.length} Woerter, hoechstens 14 sind vorgesehen`);
  }
  if (!/\d/.test(text) && !ZAHLWORT.test(text)) {
    weich.push("nennt weder Zahl noch Betrag noch Frist");
  }
  if (!ANREDE.test(text)) {
    weich.push("spricht niemanden an - es geht um ein Thema statt um den Zuschauer");
  }
  return { hart, weich };
}

const TOOL = {
  name: "hook_urteil",
  description: "Beurteilt den ersten gesprochenen Satz eines Reels.",
  input_schema: {
    type: "object",
    properties: {
      einsatz: {
        type: "integer",
        description:
          "0 bis 100. Steht im Satz, was schiefgeht oder was es kostet - oder nur eine " +
          "Groesse? Eine Preisangabe ohne Folge ist kein Einsatz.",
      },
      sofort: {
        type: "integer",
        description: "0 bis 100. Steht die Sache in den ersten drei Woertern, ohne Vorrede?",
      },
      konkret: {
        type: "integer",
        description: "0 bis 100. Zahl, Frist, Betrag oder Institution beim Namen genannt?",
      },
      verstaendlich: {
        type: "integer",
        description: "0 bis 100. In einem Durchgang zu erfassen, ohne Vorwissen?",
      },
      tauglich: {
        type: "boolean",
        description:
          "Wuerde dieser Satz jemanden stoppen, der schnell wischt? Sei streng - " +
          "im Zweifel nein.",
      },
      warum: {
        type: "string",
        description:
          "Ein Satz. Bei tauglich=false: woran es liegt, so konkret, dass man es " +
          "beim naechsten Versuch anders machen kann.",
      },
      besser: {
        type: "string",
        description:
          "Nur bei tauglich=false: derselbe Inhalt als starker Hook, hoechstens " +
          "12 Woerter. Er dient als Beispiel fuer den naechsten Versuch, nicht als Ersatz.",
      },
    },
    required: ["einsatz", "sofort", "konkret", "verstaendlich", "tauglich", "warum"],
  },
};

const SYSTEM = `Du beurteilst den ersten gesprochenen Satz von Reels des Kanals ${CHANNEL.handle} -
Finanzbildung fuer Deutschland, ${CHANNEL.zielgruppe}.

Dieser Satz ist die ganze Chance des Reels. Wer ihn nicht interessant findet,
wischt weiter, und dann spielt der Rest keine Rolle mehr.

Was einen Hook traegt - so bauen ihn reichweitenstarke deutsche Finanzkanaele:
- Ein Verlust, den niemand bemerkt: "Diese Zeile auf deiner Abrechnung kostet dich 340 Euro im Jahr."
- Eine ueberraschend grosse, konkrete Zahl mit Folge: "Zweitausend Euro im Dispo kosten dich 200 Euro - jedes Jahr."
- Ein verbreiteter Irrtum, sofort widersprochen: "Tagesgeld ist sicher. Deine Kaufkraft ist es nicht."
- Eine Frist, die gleich ablaeuft.

Der haeufigste Fehler dieses Kanals, und du sollst ihn zuverlaessig erkennen:
Der Satz nennt eine Groesse, aber nicht, was auf dem Spiel steht.
"Sechs Euro Aufpreis im Jahr" ist eine Preisangabe - sie kostet niemanden Schlaf.
"Der Unfallgegner hat kein Geld, dann zahlst du" ist die Sache selbst.
Eine Zahl allein ist kein Hook. Die Zahl belegt den Einsatz, sie ersetzt ihn nicht.

Ebenfalls schwach: Fragen als Einstieg, Begruessungen, einordnende Vorreden,
"Wusstest du", und Saetze, die ueber ein Thema reden statt zum Zuschauer.

Sei streng. Dieser Kanal hat ein Reichweitenproblem, und Nachsicht beim Hook
ist genau die Stelle, an der es entsteht. Ein Satz, bei dem du zoegerst, ist
nicht tauglich.

Antworte ausschliesslich ueber das Tool hook_urteil.`;

/** Fragt Claude nach einem Urteil ueber den Hook. */
async function bewerte(hook, thema) {
  const antwort = await client.messages.create({
    model: MODEL.id,
    max_tokens: 2000,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "hook_urteil" },
    messages: [
      {
        role: "user",
        content: `Thema des Reels: ${thema}\n\nDer erste gesprochene Satz:\n"${hook}"`,
      },
    ],
  });
  const block = antwort.content.find((b) => b.type === "tool_use");
  if (!block) throw new Error("kein Urteil erhalten");
  return block.input;
}

/**
 * Vollstaendige Pruefung eines Hooks.
 *
 * Faellt die Modellbewertung aus, zaehlt nur die mechanische Pruefung. Ein
 * ausgefallener Beitrag waere der teurere Fehler - der Hook ist wichtig, aber
 * nicht wichtiger als ueberhaupt zu senden.
 *
 * @returns {Promise<{tauglich: boolean, maengel: string[], note: number|null, besser: string}>}
 */
export async function pruefeHook(hook, thema = "") {
  const { hart, weich } = mechanischePruefung(hook);

  let urteil = null;
  try {
    urteil = await bewerte(hook, thema);
  } catch (e) {
    console.warn(`  Hook-Urteil uebersprungen: ${e.message.slice(0, 120)}`);
    return { tauglich: hart.length === 0, maengel: hart, note: null, besser: "" };
  }

  const tauglich = Boolean(urteil.tauglich) && hart.length === 0;
  const maengel = [...hart];
  if (!tauglich) {
    if (urteil.warum) maengel.push(urteil.warum);
    maengel.push(...weich);
  }

  const noten = [urteil.einsatz, urteil.sofort, urteil.konkret, urteil.verstaendlich]
    .map(Number)
    .filter(Number.isFinite);
  const note = noten.length ? Math.round(noten.reduce((a, b) => a + b, 0) / noten.length) : null;

  return { tauglich, maengel, note, besser: String(urteil.besser ?? "").trim() };
}
