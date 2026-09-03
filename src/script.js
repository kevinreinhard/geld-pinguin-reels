import Anthropic from "@anthropic-ai/sdk";
import { CHANNEL, MODEL } from "./config.js";
import { letzteThemen } from "./history.js";

const client = new Anthropic(); // liest ANTHROPIC_API_KEY aus der Umgebung

const TOOL = {
  name: "reel_script",
  description:
    "Liefert das fertige Skript, den Titel und die Instagram-Caption für ein Reel.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "Kurzer Themen-Slug in 2-5 Wörtern, dient der Dubletten-Erkennung",
      },
      title: {
        type: "string",
        description:
          "Titelkarte im Video, 2-4 Wörter, GROSSBUCHSTABEN, kein Punkt. Umlaute als Ä, Ö, Ü schreiben, nicht umschreiben.",
      },
      hook: {
        type: "string",
        description: "Erster gesprochener Satz. Max 12 Wörter, muss in 2 Sekunden sitzen.",
      },
      body: {
        type: "array",
        items: { type: "string" },
        description: "4 bis 7 kurze gesprochene Sätze, je max 16 Wörter, konkret mit Zahlen",
      },
      cta: {
        type: "string",
        description: "Schlusssatz, max 12 Wörter, fordert zum Folgen oder Speichern auf",
      },
      caption: {
        type: "string",
        description: "Instagram-Caption ohne Hashtags, 2-4 Sätze, endet mit einer Frage",
      },
      hashtags: {
        type: "array",
        items: { type: "string" },
        description:
          "12-18 Hashtags ohne #-Zeichen, Mix aus gross und Nische, Schweiz-Bezug. Hier keine Umlaute, sondern ae/oe/ue – so werden Hashtags auf Instagram gesucht.",
      },
    },
    required: ["topic", "title", "hook", "body", "cta", "caption", "hashtags"],
    additionalProperties: false,
  },
};

function systemPrompt() {
  return `Du schreibst Skripte für den Instagram-Reels-Kanal ${CHANNEL.handle} – Finanzbildung für die Schweiz.

Kanal:
- Sprache: ${CHANNEL.sprache}
- Währung und Kontext: ${CHANNEL.waehrung}, Schweizer Realität (Säule 3a, Krankenkasse mit Franchise, Pensionskasse, kantonale Steuern)
- Zielgruppe: ${CHANNEL.zielgruppe}
- Tonalität: ${CHANNEL.tonalitaet}

Handwerk für ein 30-Sekunden-Reel:
- Der Hook ist der ganze Job. Konkrete Zahl, Widerspruch oder teurer Irrtum. Keine Frage als Hook, keine Begrüssung, kein "Wusstest du".
- Jeder Satz im Body bringt eine neue Information. Kein Satz darf gestrichen werden können, ohne dass etwas fehlt.
- Zahlen statt Adjektive: "247 Franken im Jahr" schlägt "richtig viel Geld".
- Gesprochene Sprache, kurze Hauptsätze.

Rechtschreibung – das steht so im Video und wird so vorgelesen:
- Korrektes Deutsch mit Umlauten: ä, ö, ü. Niemals ae, oe, ue umschreiben.
- Schweizer Konvention: immer ss, nie ß. Also "heisst", "grösser", "Strasse".
- Keine Aufzählungszeichen, keine Klammern, keine Emojis, kein Markdown, keine Sternchen.
- Keine Abkürzungen wie "ca.", "z.B.", "CHF" – schreibe "zum Beispiel", "Franken".
- Grosse Zahlen ausgeschrieben, damit die Sprachsynthese sie richtig liest: "vierundzwanzigtausend Franken" statt "24'000". Kleine Zahlen bis tausend dürfen als Ziffern stehen.

Bildung, keine Beratung: keine konkreten Produkt- oder Aktienempfehlungen, keine Renditeversprechen. Wo es um Anlegen geht, gehört das Risiko in einen Satz.

Rufe immer das Tool reel_script auf. Antworte ausschliesslich über das Tool.`;
}

function userPrompt(saeule, verboteneThemen) {
  const negativ = verboteneThemen.length
    ? `\n\nDiese Themen hatten wir schon – wähle etwas deutlich anderes:\n- ${verboteneThemen.join("\n- ")}`
    : "";
  return `Schreib ein neues Reel zur Themensäule "${saeule.key}" (${saeule.beschreibung}).

Suche dir darin einen spitzen, konkreten Einzelaspekt – nicht das Oberthema abhandeln. Ein Reel, eine Idee.${negativ}`;
}

/** Ruft Claude auf und gibt das validierte Skript-Objekt zurueck. */
export async function generiereSkript(saeule) {
  const verboten = letzteThemen(40);

  for (let versuch = 1; versuch <= 3; versuch++) {
    const response = await client.messages.create({
      model: MODEL.id,
      max_tokens: MODEL.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: MODEL.effort },
      system: systemPrompt(),
      tools: [TOOL],
      messages: [{ role: "user", content: userPrompt(saeule, verboten) }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error(
        `Modell hat abgelehnt (${response.stop_details?.category ?? "unbekannt"}): ${response.stop_details?.explanation ?? ""}`,
      );
    }

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (toolBlock) return pruefe(toolBlock.input);

    console.warn(`  Versuch ${versuch}: kein Tool-Call erhalten, wiederhole ...`);
  }
  throw new Error("Claude hat nach 3 Versuchen kein reel_script geliefert.");
}

function pruefe(s) {
  if (!s.hook || !Array.isArray(s.body) || s.body.length < 3) {
    throw new Error("Skript unvollstaendig: " + JSON.stringify(s).slice(0, 300));
  }
  return {
    ...s,
    title: String(s.title).toUpperCase().replace(/[.!]$/, ""),
    hashtags: s.hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean),
  };
}

/** Der Text, der wirklich vorgelesen wird. */
export function sprechtext(skript) {
  return [skript.hook, ...skript.body, skript.cta]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

/** Die fertige Instagram-Caption inkl. Hashtags und Disclaimer. */
export function baueCaption(skript) {
  const tags = skript.hashtags.map((h) => "#" + h).join(" ");
  return `${skript.caption.trim()}\n\nKeine Anlageberatung, nur Finanzbildung.\n\n${tags}`;
}
