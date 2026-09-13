// Bildregie: uebersetzt das fertige Skript in einen Szenenplan.
//
// Das Skript sagt, was gesprochen wird. Hier wird entschieden, was dabei zu
// sehen ist - eine Karte je gesprochenem Satz, mit eigenem Typ, eigener
// Stimmung und eigenen Daten. Ohne diesen Schritt liefe wieder 25 Sekunden
// lang derselbe Farbverlauf, und genau daran sind die bisherigen Reels
// gescheitert: Wer nichts zu sehen bekommt, wischt weiter.

import Anthropic from "@anthropic-ai/sdk";
import { CHANNEL, MODEL, VIDEO } from "./config.js";
import { STIMMUNGEN } from "./marke.js";

const client = new Anthropic();

export const TYPEN = [
  "hook", "kennzahl", "vergleich", "liste", "verlauf", "stichwort", "endkarte",
];

const TOOL = {
  name: "bildregie",
  description: "Legt fuer jeden gesprochenen Satz die Bildkarte fest, die dazu zu sehen ist.",
  input_schema: {
    type: "object",
    properties: {
      szenen: {
        type: "array",
        description:
          "Genau eine Szene je gesprochenem Satz, in derselben Reihenfolge wie die Saetze.",
        items: {
          type: "object",
          properties: {
            satz: { type: "integer", description: "Index des Satzes, beginnend bei 0" },
            typ: { type: "string", enum: TYPEN },
            stimmung: {
              type: "string",
              enum: Object.keys(STIMMUNGEN),
              description:
                "warnung = Kosten, Verlust, Fehler. gut = Ertrag, Vorteil, Loesung. " +
                "info = neutrale Erklaerung. neutral = Marke, Einstieg, Abspann.",
            },
            kicker: {
              type: "string",
              description:
                "Zeile ueber der Aussage, hoechstens 30 Zeichen. Nennt die Bezugsgroesse: " +
                "'Dispozins im Schnitt', '2.000 Euro, ein Jahr'. Leer lassen, wenn die " +
                "Karte ohne auskommt.",
            },
            wert: { type: "string", description: "kennzahl: die Zahl selbst, deutsch geschrieben, z.B. '11,7' oder '1.247'" },
            einheit: { type: "string", description: "kennzahl: '%', '€', 'Jahre' - kurz" },
            fussnote: { type: "string", description: "kennzahl: worauf sich die Zahl bezieht, hoechstens 60 Zeichen" },
            zeilen: {
              type: "array",
              description: "vergleich: zwei oder drei Groessen, die gegeneinander stehen",
              items: {
                type: "object",
                properties: {
                  label: { type: "string", description: "hoechstens 22 Zeichen" },
                  wert: { type: "string", description: "z.B. '234 €'" },
                  anteil: { type: "number", description: "Balkenlaenge relativ, 0 bis 1" },
                  stimmung: { type: "string", enum: Object.keys(STIMMUNGEN) },
                },
                required: ["label", "wert", "anteil", "stimmung"],
              },
            },
            punkte: {
              type: "array",
              description: "liste: zwei bis vier Punkte",
              items: {
                type: "object",
                properties: {
                  text: { type: "string", description: "hoechstens 46 Zeichen" },
                  zeichen: { type: "string", enum: ["ja", "nein", "punkt"] },
                },
                required: ["text", "zeichen"],
              },
            },
            werte: {
              type: "array",
              items: { type: "number" },
              description:
                "verlauf: sechs bis zehn Stuetzwerte einer Entwicklung, aufsteigend oder fallend",
            },
            von: { type: "string", description: "verlauf: Beschriftung links, z.B. 'heute'" },
            bis: { type: "string", description: "verlauf: Beschriftung rechts, z.B. 'in 20 Jahren'" },
            endwert: { type: "string", description: "verlauf: der Wert am Ende, z.B. '104.000 €'" },
            begriff: {
              type: "string",
              description:
                "stichwort, hook, endkarte: die grosse Zeile. Hoechstens 5 Woerter.",
            },
            erlaeuterung: {
              type: "string",
              description: "stichwort: ein kurzer Satz darunter, hoechstens 70 Zeichen",
            },
            bildsuche: {
              type: "string",
              description:
                "Optional, nur fuer hook und stichwort: ein englisches Suchwort fuer " +
                "echtes Filmmaterial im Hintergrund, z.B. 'counting euro banknotes'. " +
                "Leer lassen, wenn ein Diagramm die Aussage besser traegt.",
            },
          },
          required: ["satz", "typ", "stimmung"],
        },
      },
    },
    required: ["szenen"],
  },
};

function systemPrompt() {
  return `Du bist die Bildregie fuer den Reels-Kanal ${CHANNEL.handle} - Finanzbildung fuer Deutschland.

Du bekommst ein fertiges Skript, Satz fuer Satz. Deine Aufgabe: Zu jedem Satz die
Bildkarte festlegen, die waehrend dieses Satzes im Video steht.

Der Grundsatz: Was gesagt wird, muss man sehen koennen.
Eine Zahl, die nur gesprochen wird, ist verloren. Eine Zahl, die als Karte steht,
bleibt. Jede Szene traegt genau eine Information - keine Karte wiederholt, was die
vorige schon gezeigt hat.

Echtes Filmmaterial:
Fuer hook und stichwort kannst du ueber bildsuche ein englisches Suchwort angeben.
Dann laeuft abgedunkeltes Stockmaterial hinter der Karte. Setze es hoechstens
zweimal pro Reel und nur dort, wo es die Aussage traegt - ein Diagramm schlaegt
ein beliebiges Buerovideo immer.

Die Kartentypen und wann sie passen:
- kennzahl   Ein Satz dreht sich um eine einzelne Zahl. Die Zahl zaehlt im Bild hoch.
             Der staerkste Typ - nimm ihn, wann immer eine Zahl im Satz steht.
- vergleich  Zwei oder drei Groessen stehen gegeneinander (teuer gegen guenstig,
             vorher gegen nachher). Die Balken wachsen. anteil ist die relative
             Laenge: Der groesste Wert bekommt 1.
- verlauf    Eine Entwicklung ueber Zeit - Zinseszins, Kaufkraft, Schuldenstand.
             werte sind Stuetzpunkte, keine Beschriftung, nur die Form der Kurve.
- liste      Zwei bis vier Schritte oder Merkmale. ja fuer richtig, nein fuer falsch,
             punkt fuer neutral. Gut fuer den Handlungssatz gegen Ende.
- stichwort  Ein Begriff oder eine Aussage, die kein Diagramm hergibt. Sparsam
             einsetzen - hoechstens zweimal pro Reel.
- hook       Nur fuer Satz 0 erlaubt. Der Pinguin bringt die Behauptung mit.
- endkarte   Nur fuer den letzten Satz. Aufruf und Kanalname.

Regeln, die zaehlen:
- Satz 0 bekommt hook oder kennzahl. Steht im ersten Satz eine harte Zahl, nimm
  kennzahl - die Zahl ist der Grund, warum jemand haengen bleibt.
- Der letzte Satz bekommt immer endkarte.
- Zwei aufeinanderfolgende Szenen haben nie denselben Typ. Der Schnitt muss zu
  sehen sein, sonst wirkt das Video wie ein Standbild.
- Die Stimmung folgt der Sache: Kosten und Fehler sind warnung, Ertrag und Loesung
  sind gut, reine Erklaerung ist info. Ein Reel, das nur eine Stimmung kennt, ist
  langweilig - wechsle dort, wo der Inhalt wechselt.
- Alle Zahlen deutsch schreiben: Komma als Dezimaltrenner, Punkt als Tausender.
- Erfinde keine Zahlen. Was im Bild steht, muss im Satz stehen oder direkt daraus
  folgen. Runde, wenn es der Lesbarkeit dient, aber verfaelsche nichts.
- Text auf Karten ist kurz. Niemand liest im Reel einen Nebensatz.

Antworte ausschliesslich ueber das Tool bildregie.`;
}

function userPrompt(skript, saetze) {
  const liste = saetze.map((s, i) => `${i}: ${s}`).join("\n");
  return `Thema: ${skript.topic}
Titel im Video: ${skript.title}

Die gesprochenen Saetze:
${liste}

Lege fuer jeden dieser ${saetze.length} Saetze die Bildkarte fest.`;
}

// ---------------------------------------------------------------- Pruefung

const ZAHL = (v, min, max, standard) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : standard;
};

const TEXT = (v, max) =>
  String(v ?? "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/**
 * Macht aus der Modellantwort einen Szenenplan, auf den sich der Renderer
 * verlassen kann. Ein fehlendes Feld darf den Lauf nicht kosten - im
 * Zweifel wird die Szene zu einem Stichwort mit dem gesprochenen Satz.
 */
export function pruefeSzenen(roh, saetze) {
  const nachIndex = new Map();
  for (const s of Array.isArray(roh) ? roh : []) {
    const i = Number(s?.satz);
    if (Number.isInteger(i) && i >= 0 && i < saetze.length && !nachIndex.has(i)) {
      nachIndex.set(i, s);
    }
  }

  const szenen = saetze.map((satz, i) => {
    const s = nachIndex.get(i) ?? {};
    const letzte = i === saetze.length - 1;
    let typ = TYPEN.includes(s.typ) ? s.typ : i === 0 ? "hook" : "stichwort";
    if (letzte) typ = "endkarte";
    else if (typ === "endkarte") typ = "stichwort";
    if (typ === "hook" && i !== 0) typ = "stichwort";

    const szene = {
      satz: i,
      typ,
      stimmung: Object.keys(STIMMUNGEN).includes(s.stimmung) ? s.stimmung : "neutral",
      kicker: TEXT(s.kicker, 34),
    };

    switch (typ) {
      case "kennzahl":
        szene.wert = TEXT(s.wert, 12);
        szene.einheit = TEXT(s.einheit, 8);
        szene.fussnote = TEXT(s.fussnote, 70);
        if (!/\d/.test(szene.wert)) return zuStichwort(szene, satz);
        break;
      case "vergleich":
        szene.zeilen = (Array.isArray(s.zeilen) ? s.zeilen : [])
          .slice(0, 3)
          .map((z) => ({
            label: TEXT(z?.label, 26),
            wert: TEXT(z?.wert, 12),
            anteil: ZAHL(z?.anteil, 0.05, 1, 0.5),
            stimmung: Object.keys(STIMMUNGEN).includes(z?.stimmung) ? z.stimmung : "neutral",
          }))
          .filter((z) => z.label || z.wert);
        if (szene.zeilen.length < 2) return zuStichwort(szene, satz);
        break;
      case "liste":
        szene.punkte = (Array.isArray(s.punkte) ? s.punkte : [])
          .slice(0, 4)
          .map((p) => ({
            text: TEXT(p?.text, 54),
            zeichen: ["ja", "nein", "punkt"].includes(p?.zeichen) ? p.zeichen : "punkt",
          }))
          .filter((p) => p.text);
        if (szene.punkte.length < 2) return zuStichwort(szene, satz);
        break;
      case "verlauf": {
        const werte = (Array.isArray(s.werte) ? s.werte : [])
          .map(Number)
          .filter(Number.isFinite)
          .slice(0, 12);
        if (werte.length < 3) return zuStichwort(szene, satz);
        szene.werte = werte;
        szene.von = TEXT(s.von, 20);
        szene.bis = TEXT(s.bis, 20);
        szene.endwert = TEXT(s.endwert, 14);
        break;
      }
      default:
        szene.begriff = TEXT(s.begriff, 60) || kurzfassung(satz);
        szene.erlaeuterung = TEXT(s.erlaeuterung, 80);
        szene.bildsuche = TEXT(s.bildsuche, 48).replace(/[^A-Za-z0-9 ]/g, "");
    }
    return szene;
  });

  // Zwei gleiche Typen hintereinander sehen aus wie ein Standbild. Genau daran
  // sind die ersten Reels gescheitert, also wird hier aufgebrochen - auch dann,
  // wenn die Bildregie gar nicht geantwortet hat und alles auf Stichwortkarten
  // zurueckgefallen ist.
  for (let i = 1; i < szenen.length; i++) {
    if (szenen[i].typ !== szenen[i - 1].typ || szenen[i].typ === "endkarte") continue;
    const zahl = zahlAusSatz(saetze[i]);
    if (szenen[i].typ !== "kennzahl" && zahl) {
      szenen[i] = { satz: i, typ: "kennzahl", stimmung: szenen[i].stimmung, kicker: "", ...zahl };
      continue;
    }
    szenen[i] = zuStichwort({ ...szenen[i] }, saetze[i]);
    // Bleibt es bei zwei gleichen Karten - etwa weil im Satz keine Zahl steht -,
    // wechselt wenigstens die Stimmung. Dann faerbt sich das Bild um, und der
    // Schnitt ist trotzdem zu sehen.
    if (szenen[i].typ === szenen[i - 1].typ && szenen[i].stimmung === szenen[i - 1].stimmung) {
      const auswahl = Object.keys(STIMMUNGEN);
      szenen[i].stimmung = auswahl[(auswahl.indexOf(szenen[i].stimmung) + 1) % auswahl.length];
    }
  }
  return szenen;
}

/**
 * Zieht die erste Zahl samt Einheit aus einem Satz.
 *
 * Notnagel fuer den Fall, dass die Bildregie ausfaellt: Statt der dritten
 * gleichen Textkarte in Folge steht dann wenigstens die Zahl gross im Bild,
 * um die es im Satz geht.
 */
function zahlAusSatz(satz) {
  const treffer = String(satz ?? "").match(
    /(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)\s*(Prozent|%|Euro|€)?/,
  );
  if (!treffer) return null;
  const einheiten = { Prozent: "%", "%": "%", Euro: "€", "€": "€" };
  return {
    wert: treffer[1],
    einheit: einheiten[treffer[2]] ?? "",
    fussnote: TEXT(satz.replace(treffer[0], " ").replace(/\s+/g, " "), 70),
  };
}

function zuStichwort(szene, satz) {
  return {
    satz: szene.satz,
    typ: szene.satz === 0 ? "hook" : "stichwort",
    stimmung: szene.stimmung,
    kicker: szene.kicker,
    begriff: szene.begriff || kurzfassung(satz),
    erlaeuterung: "",
  };
}

/** Notnagel: die ersten Woerter des Satzes als Kartentext. */
function kurzfassung(satz) {
  return String(satz ?? "")
    .replace(/[.!?…]+$/, "")
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");
}

// ---------------------------------------------------------------- Zeiten

/**
 * Ordnet jedem Satz sein Zeitfenster zu.
 *
 * Edge TTS liefert Zeitstempel je Wort. Die Saetze werden im Sprechtext
 * ueber ihre Zeichenposition wiedergefunden - Wortzaehlen waere fehleranfaellig,
 * weil die Sprachsynthese "20 Jahren" mal als ein, mal als zwei Token meldet.
 */
export function satzZeiten(words, saetze, { offset = 0, dauer }) {
  const text = saetze.join(" ");
  const grenzen = [];
  let pos = 0;
  for (const s of saetze) {
    grenzen.push([pos, pos + s.length]);
    pos += s.length + 1;
  }

  const treffer = saetze.map(() => []);
  let cursor = 0;
  for (const w of words) {
    const roh = String(w.text ?? "").trim();
    if (!roh) continue;
    let idx = text.indexOf(roh, cursor);
    if (idx === -1) idx = text.toLowerCase().indexOf(roh.toLowerCase(), cursor);
    if (idx === -1) idx = cursor;
    cursor = idx + roh.length;
    const i = grenzen.findIndex(([a, b]) => idx >= a && idx < b);
    if (i >= 0) treffer[i].push(w);
  }

  const zeiten = [];
  for (let i = 0; i < saetze.length; i++) {
    const ws = treffer[i];
    const vorher = zeiten[i - 1]?.ende ?? offset;
    if (!ws.length) {
      zeiten.push({ start: vorher, ende: vorher });
      continue;
    }
    zeiten.push({
      start: Math.max(offset, ws[0].start + offset - 0.12),
      ende: ws[ws.length - 1].end + offset,
    });
  }

  // Luecken schliessen: Eine Karte steht, bis die naechste uebernimmt.
  for (let i = 0; i < zeiten.length; i++) {
    zeiten[i].ende = i + 1 < zeiten.length ? zeiten[i + 1].start : dauer;
    if (zeiten[i].ende < zeiten[i].start) zeiten[i].ende = zeiten[i].start;
  }
  return zeiten;
}

// ---------------------------------------------------------------- Aufruf

/** Fragt Claude nach dem Szenenplan. Faellt bei Problemen auf Stichwortkarten zurueck. */
export async function planeBilder(skript, saetze) {
  let roh = null;
  for (let versuch = 1; versuch <= 2; versuch++) {
    try {
      const antwort = await client.messages.create({
        model: MODEL.id,
        max_tokens: MODEL.maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: MODEL.effort },
        system: systemPrompt(),
        tools: [TOOL],
        tool_choice: { type: "tool", name: "bildregie" },
        messages: [{ role: "user", content: userPrompt(skript, saetze) }],
      });
      const block = antwort.content.find((b) => b.type === "tool_use");
      if (block) {
        roh = block.input?.szenen;
        break;
      }
    } catch (e) {
      console.warn(`  Bildregie Versuch ${versuch}: ${e.message.slice(0, 120)}`);
      if (versuch === 2) break;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  if (!roh) console.warn("  Bildregie ohne Antwort - es laufen einfache Stichwortkarten.");
  return pruefeSzenen(roh, saetze);
}

/** Baut die vollstaendige Spezifikation fuer src/karten.py. */
export function baueSpezifikation({ szenen, zeiten, handle, dauer, ausgabe, marke }) {
  return {
    ausgabe,
    handle,
    dauer,
    marke,
    szenen: szenen.map((s, i) => ({ ...s, start: zeiten[i].start, ende: zeiten[i].ende })),
  };
}

export { VIDEO };
