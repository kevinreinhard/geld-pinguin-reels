/**
 * Ein Claude-Aufruf, der immer über ein Werkzeug antwortet.
 *
 * Opus 5.5 lehnt erzwungene Werkzeugwahl ab (400), deshalb "auto" plus klare
 * Anweisung im Auftrag und notfalls eine Nachfrage. Die Websuche läuft auf
 * Anthropics Seite; eine lange Suchrunde endet mit "pause_turn" und wird
 * einfach weitergeschickt.
 */
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ maxRetries: 4 });

export const MODELL = "claude-opus-5-5";

export async function frage({ system, inhalt, werkzeug, websuche = 0, effort = "medium", maxTokens = 32000 }) {
  const tools = [werkzeug];
  if (websuche) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: websuche });

  const messages = [{ role: "user", content: inhalt }];

  for (let runde = 1; runde <= 8; runde++) {
    const antwort = await client.beta.messages
      .stream({
        model: MODELL,
        max_tokens: maxTokens,
        // Lehnt ein Sicherheitsfilter ab, übernimmt das Ersatzmodell im selben Aufruf.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort },
        system,
        tools,
        messages,
      })
      .finalMessage();

    if (antwort.stop_reason === "refusal") {
      throw new Error(`Modell hat abgelehnt (${antwort.stop_details?.category ?? "unbekannt"}).`);
    }

    const ruf = antwort.content.find((b) => b.type === "tool_use" && b.name === werkzeug.name);
    if (ruf) return ruf.input;

    if (antwort.stop_reason === "max_tokens") {
      throw new Error(`Antwort abgeschnitten (max_tokens) vor ${werkzeug.name}.`);
    }

    messages.push({ role: "assistant", content: antwort.content });
    if (antwort.stop_reason === "pause_turn") continue;
    messages.push({ role: "user", content: `Gib das Ergebnis jetzt über das Werkzeug ${werkzeug.name} ab.` });
  }
  throw new Error(`Kein Aufruf von ${werkzeug.name} nach 8 Runden.`);
}
