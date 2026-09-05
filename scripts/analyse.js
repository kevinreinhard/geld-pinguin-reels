/**
 * Der Analyse-Agent.
 *
 * Liest die gemessenen Kennzahlen, die Themen-Historie und die aktuellen
 * Stellschrauben, lässt Claude beides bewerten und schreibt einen Bericht.
 * Änderungsvorschläge werden nur übernommen, wenn genug Daten vorliegen.
 *
 * Die harte Schwelle steht bewusst hier im Code und nicht nur im Prompt:
 * Ein Sprachmodell findet in jedem Rauschen ein Muster, wenn man es fragt.
 * Mit neun Reels und einstelligen Views wäre jede "Optimierung" Zufall,
 * der sich als Erkenntnis verkleidet.
 */
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { CHANNEL, MODEL, PILLARS } from "../src/config.js";
import { ladeHistorie } from "../src/history.js";
import { GRENZEN, ladeTuning, speichereTuning } from "../src/tuning.js";

const client = new Anthropic();

// Ab wann darf überhaupt nachjustiert werden.
const SCHWELLE = {
  reels: 15,        // mindestens so viele veröffentlichte Reels
  gesamtViews: 150, // und so viele Views insgesamt
};

const TOOL = {
  name: "kanal_analyse",
  description:
    "Liefert die Bewertung der Kanaldaten und, falls die Datenlage es hergibt, konkrete Änderungen an den Stellschrauben.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      datenlage: {
        type: "string",
        enum: ["zu duenn", "erste tendenzen", "belastbar"],
        description: "Wie tragfähig sind die Daten für Schlussfolgerungen?",
      },
      zusammenfassung: {
        type: "string",
        description: "3-5 Sätze Lagebild in Klartext. Was ist passiert, was bedeutet es?",
      },
      erkenntnisse: {
        type: "array",
        items: {
          type: "object",
          properties: {
            beobachtung: { type: "string", description: "Was in den Daten steht" },
            beleg: { type: "string", description: "Die konkreten Zahlen, auf denen das beruht" },
            sicherheit: { type: "string", enum: ["hoch", "mittel", "gering"] },
          },
          required: ["beobachtung", "beleg", "sicherheit"],
          additionalProperties: false,
        },
        description: "0 bis 5 Beobachtungen. Lieber keine als erfundene.",
      },
      naechster_schritt: {
        type: "string",
        description:
          "Die eine Sache, die der Kanalinhaber diese Woche tun sollte. Darf auch ausserhalb der Automatisierung liegen.",
      },
      aenderungen_vorgeschlagen: {
        type: "boolean",
        description: "Sollen Stellschrauben geändert werden? Bei dünner Datenlage immer false.",
      },
      saeulenGewichte: {
        type: "array",
        items: {
          type: "object",
          properties: {
            saeule: { type: "string", enum: PILLARS.map((p) => p.key) },
            gewicht: { type: "number" },
          },
          required: ["saeule", "gewicht"],
          additionalProperties: false,
        },
        description:
          "Nur bei aenderungen_vorgeschlagen. Gewicht zwischen 0.25 und 5 je Säule. Leere Liste lässt alles unverändert.",
      },
      zielWoerter: {
        type: "integer",
        description: "Nur bei aenderungen_vorgeschlagen. Ziel für die Wortzahl, 45 bis 90.",
      },
      hookHinweise: {
        type: "array",
        items: { type: "string" },
        description:
          "Nur bei aenderungen_vorgeschlagen. Bis zu 5 kurze Anweisungen, die dem Skript-Prompt angehängt werden. Konkret und aus den Daten begründet, keine Allgemeinplätze.",
      },
      begruendung: {
        type: "string",
        description: "Warum diese Änderungen, oder warum bewusst keine.",
      },
    },
    required: [
      "datenlage", "zusammenfassung", "erkenntnisse", "naechster_schritt",
      "aenderungen_vorgeschlagen", "saeulenGewichte", "zielWoerter",
      "hookHinweise", "begruendung",
    ],
    additionalProperties: false,
  },
};

/** Verdichtet die Rohmessungen zu dem, was für die Bewertung zählt. */
function bereiteDatenAuf() {
  let messungen = [];
  try {
    messungen = JSON.parse(fs.readFileSync("data/performance.json", "utf8")).messungen ?? [];
  } catch {
    throw new Error("data/performance.json fehlt. Erst scripts/insights.js laufen lassen.");
  }
  if (!messungen.length) throw new Error("Noch keine Messungen vorhanden.");

  const neueste = messungen[messungen.length - 1];
  const vorherige = messungen.length > 1 ? messungen[messungen.length - 2] : null;
  const historie = ladeHistorie();

  // Historie und Messung über den Permalink zusammenführen: nur so weiss man,
  // welche Themensäule und welche Länge hinter welchen Zahlen steckt.
  const nachLink = new Map(historie.map((h) => [h.permalink, h]));
  const reels = neueste.beitraege
    .filter((b) => b.typ === "REELS")
    .map((b) => {
      const h = nachLink.get(b.permalink);
      return {
        veroeffentlicht: b.veroeffentlicht,
        alterTage: +((Date.now() - new Date(b.veroeffentlicht)) / 864e5).toFixed(1),
        views: b.views ?? 0,
        reach: b.reach ?? 0,
        interaktionen: b.total_interactions ?? 0,
        gespeichert: b.saved ?? 0,
        titel: h?.title ?? null,
        saeule: h?.pillar ?? null,
        dauer: h?.dauer ?? null,
        stundeUTC: new Date(b.veroeffentlicht).getUTCHours(),
        automatisiert: Boolean(h),
      };
    })
    .sort((a, b) => new Date(b.veroeffentlicht) - new Date(a.veroeffentlicht));

  return {
    konto: neueste.konto,
    kontoVorwoche: vorherige?.konto ?? null,
    messungen: messungen.length,
    reels,
    gesamtViews: reels.reduce((a, r) => a + r.views, 0),
    automatisierteReels: reels.filter((r) => r.automatisiert).length,
  };
}

function systemPrompt(daten, tuning, genugDaten) {
  const saeulen = PILLARS.map((p) => `${p.key} (Standardgewicht ${p.gewicht})`).join(", ");
  return `Du analysierst die Kennzahlen des Instagram-Kanals ${CHANNEL.handle}, ${CHANNEL.sprache}, Markt Deutschland.

Der Kanal wird automatisiert bespielt: Ein Skript wählt eine Themensäule, lässt ein Reel-Skript schreiben, vertont und rendert es und veröffentlicht es.

Themensäulen: ${saeulen}

Stellschrauben, die du verändern darfst:
- saeulenGewichte: wie oft eine Säule gezogen wird, ${GRENZEN.gewicht.min} bis ${GRENZEN.gewicht.max}
- zielWoerter: Ziel-Wortzahl des Sprechtexts, ${GRENZEN.zielWoerter.min} bis ${GRENZEN.zielWoerter.max}, aktuell ${tuning.zielWoerter}
- hookHinweise: bis zu ${GRENZEN.hookHinweise.anzahl} kurze Anweisungen, die dem Skript-Prompt angehängt werden

${
  genugDaten
    ? "Die Datenlage überschreitet die Mindestschwelle. Du darfst Änderungen vorschlagen, wenn du sie an konkreten Zahlen festmachen kannst."
    : `ACHTUNG: Die Datenlage liegt unter der Mindestschwelle von ${SCHWELLE.reels} Reels und ${SCHWELLE.gesamtViews} Views. Setze aenderungen_vorgeschlagen zwingend auf false. Vorschläge würden ohnehin verworfen. Deine Aufgabe ist dann ausschliesslich das Lagebild.`
}

Wie du arbeitest:
- Unterscheide zwischen Beobachtung und Erklärung. "Reel A hat mehr Views als B" ist eine Beobachtung. "Weil das Thema besser ist" ist eine Vermutung, und meist eine falsche.
- Berücksichtige das Alter: Ein Reel von gestern hatte weniger Zeit als eines von letzter Woche. Vergleiche nie rohe Views zwischen unterschiedlich alten Beiträgen.
- Bei ein- und zweistelligen Zahlen ist der Unterschied zwischen 3 und 9 Views Rauschen, kein Signal. Sag das, statt es zu deuten.
- Wenn du nichts Belastbares siehst, ist eine leere Erkenntnisliste die richtige Antwort. Erfundene Muster sind schädlicher als keine.
- naechster_schritt darf und soll auch ausserhalb der Automatisierung liegen, wenn dort der Engpass ist.

Rufe immer das Tool kanal_analyse auf. Antworte ausschliesslich über das Tool.`;
}

function berichtSchreiben(a, daten, uebernommen) {
  const datum = new Date().toISOString().slice(0, 10);
  const pfad = path.resolve(`data/berichte/${datum}.md`);
  fs.mkdirSync(path.dirname(pfad), { recursive: true });

  const zeilen = [
    `# Kanalanalyse ${datum}`,
    "",
    `**Datenlage:** ${a.datenlage}`,
    `**Konto:** ${daten.konto.follower} Follower, ${daten.konto.beitraege} Beiträge, ` +
      `${daten.reels.length} Reels (davon ${daten.automatisierteReels} automatisiert), ` +
      `${daten.gesamtViews} Views gesamt`,
    "",
    "## Lage",
    "",
    a.zusammenfassung,
    "",
  ];

  if (a.erkenntnisse.length) {
    zeilen.push("## Beobachtungen", "");
    for (const e of a.erkenntnisse) {
      zeilen.push(`- **${e.beobachtung}** _(Sicherheit: ${e.sicherheit})_`, `  ${e.beleg}`);
    }
    zeilen.push("");
  } else {
    zeilen.push("## Beobachtungen", "", "Keine belastbaren Muster in den Daten.", "");
  }

  zeilen.push(
    "## Nächster Schritt",
    "",
    a.naechster_schritt,
    "",
    "## Stellschrauben",
    "",
    uebernommen
      ? `Geändert. ${a.begruendung}`
      : `Unverändert. ${a.begruendung}`,
    "",
  );

  fs.writeFileSync(pfad, zeilen.join("\n"), "utf8");
  return pfad;
}

async function main() {
  const daten = bereiteDatenAuf();
  const tuning = ladeTuning({ still: true });

  const genugDaten =
    daten.reels.length >= SCHWELLE.reels && daten.gesamtViews >= SCHWELLE.gesamtViews;

  console.log(
    `  ${daten.reels.length} Reels, ${daten.gesamtViews} Views, ${daten.konto.follower} Follower`,
  );
  console.log(
    `  Schwelle für Änderungen (${SCHWELLE.reels} Reels / ${SCHWELLE.gesamtViews} Views): ` +
      (genugDaten ? "erreicht" : "noch nicht erreicht"),
  );

  const response = await client.messages.create({
    model: MODEL.id,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: systemPrompt(daten, tuning, genugDaten),
    tools: [TOOL],
    messages: [
      {
        role: "user",
        content:
          "Hier sind die aktuellen Daten des Kanals:\n\n```json\n" +
          JSON.stringify(
            {
              konto: daten.konto,
              kontoVorwoche: daten.kontoVorwoche,
              anzahlMessungen: daten.messungen,
              aktuelleStellschrauben: {
                saeulenGewichte: tuning.saeulenGewichte,
                zielWoerter: tuning.zielWoerter,
                hookHinweise: tuning.hookHinweise,
              },
              reels: daten.reels,
            },
            null,
            1,
          ) +
          "\n```\n\nAnalysiere die Lage.",
      },
    ],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block) throw new Error("Claude hat keine Analyse geliefert.");
  const a = block.input;

  // Die Schwelle gilt im Code, nicht im Vertrauen auf den Prompt.
  let uebernommen = false;
  if (a.aenderungen_vorgeschlagen && genugDaten) {
    const gewichte = Object.fromEntries(
      (a.saeulenGewichte ?? []).map((g) => [g.saeule, g.gewicht]),
    );
    speichereTuning(
      {
        saeulenGewichte: gewichte,
        zielWoerter: a.zielWoerter,
        hookHinweise: a.hookHinweise,
        postSlots: tuning.postSlots, // Zeiten bleiben Handarbeit
      },
      a.begruendung,
    );
    uebernommen = true;
    console.log("  Stellschrauben angepasst.");
  } else if (a.aenderungen_vorgeschlagen) {
    console.log("  Änderungen vorgeschlagen, aber unter der Schwelle verworfen.");
  } else {
    console.log("  Keine Änderungen vorgeschlagen.");
  }

  const pfad = berichtSchreiben(a, daten, uebernommen);
  console.log(`  Bericht: ${path.relative(process.cwd(), pfad)}`);
  console.log(`\n${a.zusammenfassung}\n`);
  console.log(`Nächster Schritt: ${a.naechster_schritt}`);

  fs.writeFileSync(
    "build/analyse-status.txt",
    uebernommen ? "geaendert" : "unveraendert",
    "utf8",
  );
}

fs.mkdirSync("build", { recursive: true });
main().catch((e) => {
  console.error("FEHLER: " + e.message);
  process.exitCode = 1;
});
