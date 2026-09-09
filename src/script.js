import Anthropic from "@anthropic-ai/sdk";
import { CHANNEL, MODEL } from "./config.js";
import { letzteThemen } from "./history.js";
import { ladeTuning } from "./tuning.js";

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
        description:
          "Erster gesprochener Satz, max 12 Wörter. Die Behauptung selbst, kein Aufwärmen. Nie als Frage, nie mit Begrüßung. Enthält im Regelfall eine konkrete Zahl.",
      },
      body: {
        type: "array",
        items: { type: "string" },
        description:
          "3 bis 5 kurze gesprochene Sätze, je max 14 Wörter, konkret mit Zahlen. Zusammen mit Hook und CTA höchstens 75 Wörter insgesamt.",
      },
      cta: {
        type: "string",
        description:
          "Schlusssatz, max 10 Wörter, im Imperativ und in der Du-Form: 'Folge für ...' oder 'Speichere das ...'. Nicht 'Folgen für ...'.",
      },
      caption: {
        type: "string",
        description: "Instagram-Caption ohne Hashtags, 2-4 Sätze, endet mit einer Frage",
      },
      hashtags: {
        type: "array",
        items: { type: "string" },
        description:
          "12-18 Hashtags ohne #-Zeichen, Mix aus großen und Nischen-Tags, Bezug Deutschland. Keine Umlaute und kein ß, sondern ae/oe/ue/ss – so werden Hashtags auf Instagram gesucht. Niemals Jahreszahlen verwenden, die veralten sofort.",
      },
    },
    required: ["topic", "title", "hook", "body", "cta", "caption", "hashtags"],
    additionalProperties: false,
  },
};

function systemPrompt() {
  const { zielWoerter, hookHinweise } = ladeTuning({ still: true });
  // Was der Analyse-Agent aus den gemessenen Zahlen abgeleitet hat.
  const gelernt = hookHinweise.length
    ? `\n\nAus den gemessenen Zahlen dieses Kanals gelernt:\n- ${hookHinweise.join("\n- ")}`
    : "";

  return `Du schreibst Skripte für den Instagram-Reels-Kanal ${CHANNEL.handle} – Finanzbildung für Deutschland.

Kanal:
- Sprache: ${CHANNEL.sprache}
- Markt: ${CHANNEL.markt}
- Währung: ${CHANNEL.waehrung}
- Zielgruppe: ${CHANNEL.zielgruppe}
- Tonalität: ${CHANNEL.tonalitaet}

Länge – das ist die wichtigste Regel:
Das fertige Reel darf höchstens 30 Sekunden dauern, 20 bis 26 sind besser. Das sind
insgesamt rund ${zielWoerter - 10} bis ${zielWoerter + 10} gesprochene Wörter, mehr nicht. Wie viele Zuschauer ein Reel
zu Ende sehen, ist das stärkste Signal im Ranking – ein Gedanke weniger schlägt einen
Satz zu viel. Ein Reel, eine einzige Idee.

Der Hook – hier wird das Reel gewonnen oder verloren:
Die ersten drei Wörter entscheiden, ob jemand weiterwischt. Reichweitenstarke deutsche
Finanzkanäle bauen ihn fast immer nach einem dieser Muster:
- Überraschend grosse, konkrete Zahl: "885.000 Euro in eine einzige Aktie."
- Ein Verlust, den niemand bemerkt: "Diese eine Zeile auf deiner Abrechnung kostet dich 340 Euro im Jahr."
- Verbreiteter Irrtum, sofort widersprochen: "Tagesgeld ist sicher. Deine Kaufkraft ist es nicht."
- Eine Frist, die gleich abläuft.
Verboten: Begrüssung, Frage als Hook, "Wusstest du", "Lass uns über etwas sprechen",
einordnende Vorrede. Kein Aufwärmen – Satz eins ist bereits die Sache selbst.

Konkret schlägt Kategorie:
"Der Sparerpauschbetrag" ist eine Kategorie und langweilt. "1.000 Euro Zinsen steuerfrei,
und die meisten holen sich davon keinen Cent" ist konkret. Nenne Beträge, Fristen,
Prozentsätze und Institutionen beim Namen, wo es sachlich stimmt.

Haltung statt Abwägung:
"Der Dispo ist der teuerste Kredit, den du bekommen kannst" ist eine Haltung.
"Ein Dispo kann unter Umständen teuer sein" ist Watte. Bezieh zu Sachfragen klar
Position. Das gilt für Fakten – nicht für Produkte.

Aufbau:
1. Hook: die Behauptung, sofort.
2. Zuspitzung: warum das mehr kostet oder mehr bringt, als man denkt. Mit einer Zahl.
3. Auflösung: der Mechanismus dahinter, in einem Satz.
4. Handlung: was man heute in fünf Minuten erledigen kann.
5. Schlusssatz.

Weiteres Handwerk:
- Jeder Satz bringt eine neue Information. Kein Satz darf gestrichen werden können, ohne dass etwas fehlt.
- Zahlen statt Adjektive: "247 Euro im Jahr" schlägt "richtig viel Geld".
- Gesprochene Sprache, kurze Hauptsätze.

Rechtschreibung – das steht so im Video und wird so vorgelesen:
- Korrektes Deutsch mit Umlauten: ä, ö, ü. Niemals ae, oe, ue umschreiben.
- Deutsche Rechtschreibung mit ß, wo es hingehört: "heißt", "größer", "Straße", "dreißig".
- Keine Aufzählungszeichen, keine Klammern, keine Emojis, kein Markdown, keine Sternchen.
- Keine Abkürzungen wie "ca.", "z.B.", "EUR" – schreibe "zum Beispiel", "Euro".
- Große Zahlen ausgeschrieben, damit die Sprachsynthese sie richtig liest: "vierundzwanzigtausend Euro" statt "24.000". Zahlen bis tausend dürfen als Ziffern stehen.

Die eine Grenze, die bleibt:
Grosse Personenkanäle arbeiten mit Einzelaktien, Krypto-Tipps und dem eigenen Depot.
Das funktioniert dort, weil ein Mensch mit Gesicht und Geschichte dahintersteht, der
sein eigenes Geld zeigt. Dieser Kanal ist anonym und automatisiert – dieselben
Empfehlungen wären hier ungedeckt und rechtlich heikel.

Also: keine Einzelaktien, keine Krypto-Tipps, keine Produktempfehlungen, keine
Renditeversprechen, kein erfundenes "ich habe". Wo es um Anlegen geht, gehört das
Risiko in einen Satz. Die Schärfe kommt aus der Zahl und der Haltung zur Sache,
nicht aus einem Tipp.

Rufe immer das Tool reel_script auf. Antworte ausschließlich über das Tool.${gelernt}`;
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

  const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));
  let letzterFehler = null;

  for (let versuch = 1; versuch <= 3; versuch++) {
    let response;
    try {
      response = await client.messages.create({
        model: MODEL.id,
        max_tokens: MODEL.maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: MODEL.effort },
        system: systemPrompt(),
        tools: [TOOL],
        messages: [{ role: "user", content: userPrompt(saeule, verboten) }],
      });
    } catch (e) {
      // Das SDK wiederholt 429 und 5xx selbst, aber nicht 400. Genau so ein
      // "Invalid request data" hat am 07.09. einen kompletten Lauf gekostet,
      // obwohl dieselbe Anfrage unmittelbar danach durchging. Ein paar
      // Sekunden Wartezeit sind billiger als ein ausgefallener Beitrag.
      letzterFehler = e;
      if (versuch === 3) break;
      console.warn(`  Versuch ${versuch} fehlgeschlagen (${e.message.slice(0, 120)}), warte ...`);
      await schlafen(5000 * versuch);
      continue;
    }

    if (response.stop_reason === "refusal") {
      throw new Error(
        `Modell hat abgelehnt (${response.stop_details?.category ?? "unbekannt"}): ${response.stop_details?.explanation ?? ""}`,
      );
    }

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (toolBlock) return pruefe(toolBlock.input);

    console.warn(`  Versuch ${versuch}: kein Tool-Call erhalten, wiederhole ...`);
    await schlafen(2000);
  }

  throw new Error(
    letzterFehler
      ? `Claude nach 3 Versuchen nicht erreichbar: ${letzterFehler.message}`
      : "Claude hat nach 3 Versuchen kein reel_script geliefert.",
  );
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
