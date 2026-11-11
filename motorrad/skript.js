/**
 * Recherche, Skript und Faktenprüfung für ein Ranglisten-Video.
 *
 * Drei getrennte Aufrufe, weil sie verschiedene Aufgaben haben:
 *  1. recherche  - sucht im Netz Kandidaten und belegte Fakten (Faktenblatt).
 *  2. schreibe   - schreibt nur aus dem Faktenblatt, ohne Netz.
 *  3. pruefe     - vergleicht jede Zahl im Skript mit dem Faktenblatt.
 * Die Kanalbeschreibung verspricht geprüfte Fakten; Schritt 3 löst das ein.
 */
import { frage } from "./claude.js";

const text = { type: "string" };
const liste = (items) => ({ type: "array", items });
const objekt = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const KANAL =
  "Du arbeitest für den deutschen YouTube-Kanal «Motorrad Kompass»: Kaufberatung und Ranglisten für " +
  "Motorradkäufer in Deutschland. Ton: ehrlich, konkret, ruhig, Du-Form. Keine Werbesprüche, keine " +
  "Beleidigungen von Käufern oder Marken, Schwächen werden genannt.";

// ---------------------------------------------------------------- 1. Recherche

const FAKTENBLATT = {
  name: "faktenblatt_abgeben",
  description: "Gibt die recherchierten Kandidaten mit belegten Fakten ab.",
  strict: true,
  input_schema: objekt({
    modelle: liste(
      objekt({
        name: { type: "string", description: "Marke und Modell, z. B. «Honda CB500F»" },
        suchbegriffe: {
          ...liste(text),
          description: "2-3 Suchbegriffe für Fotos auf Wikimedia Commons, verschiedene Schreibweisen",
        },
        fakten: {
          type: "string",
          description:
            "Stichpunkte: Bauzeit, Motor, Leistung in PS, Gewicht fahrfertig, Sitzhöhe, typischer " +
            "Gebrauchtpreis in Deutschland, bekannte Schwachstellen, Begründung für die Rangliste",
        },
        quellen: liste(text),
      }),
    ),
  }),
};

export async function recherche(thema, anzahl) {
  const ergebnis = await frage({
    system: KANAL,
    websuche: 24,
    effort: "medium",
    werkzeug: FAKTENBLATT,
    inhalt:
      `Thema des Videos: «${thema}»\n\n` +
      `Recherchiere mit der Websuche ${anzahl} Motorradmodelle, die zu diesem Thema passen, und ordne sie ` +
      `vom besten zum schwächsten Kandidaten. Nimm verbreitete Modelle, von denen es viele Fotos gibt.\n\n` +
      `Regeln:\n` +
      `- Jede Zahl (PS, Gewicht, Sitzhöhe, Preis, Baujahre) muss in einer Quelle stehen, die du gefunden hast. ` +
      `Findest du eine Zahl nicht, lass sie weg, statt sie zu schätzen.\n` +
      `- Gebrauchtpreise: Suche gezielt danach (Gebrauchtberatungen von motorradonline.de und 1000ps.de, ` +
      `Preisübersichten von Inserateportalen) und gib eine Spanne für den deutschen Markt an, mit dem Hinweis ` +
      `«Stand ${new Date().getFullYear()}». Nennt das Thema eine Preisgrenze, gehört ein Modell ohne belegte ` +
      `Preisspanne nicht in die Liste: Nimm dann ein anderes.\n` +
      `- Nenne zu jedem Modell mindestens eine echte Schwachstelle.\n` +
      `- Quellen als vollständige Adressen.\n\n` +
      `Gib das Ergebnis über das Werkzeug faktenblatt_abgeben ab.`,
  });
  if (!ergebnis.modelle?.length) throw new Error("Recherche lieferte keine Modelle.");
  return ergebnis.modelle;
}

// ---------------------------------------------------------------- 2. Skript

const VIDEO = {
  name: "video_abgeben",
  description: "Gibt das fertige Videoskript ab.",
  strict: true,
  input_schema: objekt({
    titel: { type: "string", description: "YouTube-Titel, höchstens 70 Zeichen" },
    thumbnailText: { type: "string", description: "Höchstens 3 Wörter in Grossbuchstaben für das Vorschaubild" },
    beschreibung: { type: "string", description: "2-3 Sätze für die Videobeschreibung" },
    tags: liste(text),
    intro: { type: "string", description: "Gesprochener Einstieg, 60-80 Wörter" },
    modelle: liste(
      objekt({
        rang: { type: "integer" },
        name: text,
        kennzahlen: liste(objekt({ label: text, wert: text })),
        text: { type: "string", description: "Gesprochener Text, 150-180 Wörter" },
      }),
    ),
    outro: { type: "string", description: "Gesprochener Schluss, 40-60 Wörter" },
  }),
};

function skriptAuftrag(thema, modelle) {
  const blatt = modelle
    .map((m, i) => `### ${i + 1}. ${m.name}\n${m.fakten}`)
    .join("\n\n");
  return (
    `Thema des Videos: «${thema}»\n\n` +
    `Schreibe das Skript für ein Ranglisten-Video mit genau diesen ${modelle.length} Modellen. Das Video zählt ` +
    `herunter: Es beginnt mit Platz ${modelle.length} und endet mit Platz 1. Die Reihenfolge im Faktenblatt ist ` +
    `ein Vorschlag (1 = bester), du darfst sie begründet ändern.\n\n` +
    `Der Text wird von einer Computerstimme gesprochen und nicht gelesen:\n` +
    `- kurze Sätze, keine Klammern, keine Aufzählungszeichen, keine Abkürzungen ausser PS und Kilo\n` +
    `- Zahlen so schreiben, wie man sie spricht («48 PS», «rund 3500 Euro», «790 Millimeter Sitzhöhe»)\n` +
    `- intro: die ersten zwei Sätze sagen, was der Zuschauer bekommt und warum er dranbleiben soll, ohne Begrüssung\n` +
    `- je Modell: für wen es passt, was es zuverlässig oder empfehlenswert macht, eine echte Schwachstelle, ` +
    `worauf beim Gebrauchtkauf zu achten ist. Beginne jeden Modelltext mit «Platz N» und dem Namen.\n` +
    `- outro: kurzes Fazit und eine Frage an die Zuschauer für die Kommentare\n\n` +
    `Fakten: Verwende ausschliesslich Zahlen und Aussagen aus dem Faktenblatt unten. Was dort nicht steht, ` +
    `kommt nicht vor. Preise immer als ungefähre Spanne. Fehlt eine Angabe, lass sie einfach weg: Sprich nicht ` +
    `über fehlende Daten, die Quellenlage oder die Recherche. Dass Preise schwanken, steht in der Beschreibung.\n\n` +
    `kennzahlen: genau 3 je Modell, label höchstens 12 Zeichen (z. B. «Leistung», «Gewicht», «Gebraucht ab»), ` +
    `wert höchstens 12 Zeichen (z. B. «48 PS», «189 kg», «3500 €»).\n\n` +
    `Titel: weckt Neugier, verspricht nichts, was das Video nicht hält, keine Beschimpfungen.\n\n` +
    `## Faktenblatt\n\n${blatt}\n\n` +
    `Gib das Ergebnis über das Werkzeug video_abgeben ab.`
  );
}

export async function schreibe(thema, modelle, korrekturen = null, vorher = null) {
  let inhalt = skriptAuftrag(thema, modelle);
  if (korrekturen) {
    inhalt +=
      `\n\n## Überarbeitung\n\nDein erster Entwurf:\n${JSON.stringify(vorher)}\n\n` +
      `Die Faktenprüfung hat diese Fehler gefunden. Behebe jeden, ändere sonst nichts:\n` +
      korrekturen.map((k) => `- ${k.stelle}: ${k.problem} -> ${k.korrektur}`).join("\n");
  }
  const s = await frage({ system: KANAL, effort: "high", werkzeug: VIDEO, inhalt });

  if (s.modelle.length !== modelle.length) {
    throw new Error(`Skript hat ${s.modelle.length} statt ${modelle.length} Modelle.`);
  }
  // Absteigend sortieren: Das Video zählt herunter.
  s.modelle.sort((a, b) => b.rang - a.rang);
  s.titel = s.titel.replace(/[<>]/g, "").slice(0, 100);
  return s;
}

// ---------------------------------------------------------------- 3. Prüfung

const PRUEFUNG = {
  name: "pruefung_abgeben",
  description: "Gibt das Ergebnis der Faktenprüfung ab. Leere Liste = fehlerfrei.",
  strict: true,
  input_schema: objekt({
    fehler: liste(objekt({ stelle: text, problem: text, korrektur: text })),
  }),
};

export async function pruefe(skript, modelle) {
  const blatt = modelle.map((m) => `### ${m.name}\n${m.fakten}`).join("\n\n");
  const ergebnis = await frage({
    system:
      "Du bist Faktenprüfer. Du vergleichst ein Videoskript Satz für Satz mit einem Faktenblatt. " +
      "Du meldest nur echte Abweichungen, keinen Stil.",
    effort: "medium",
    werkzeug: PRUEFUNG,
    inhalt:
      `Prüfe jede Zahl und jede Sachaussage im Skript (intro, Modelltexte, kennzahlen, outro, titel) gegen das ` +
      `Faktenblatt. Melde: Zahlen, die abweichen; Aussagen, die im Faktenblatt nicht stehen; Modell und Fakt ` +
      `vertauscht; Titel, der mehr verspricht als der Inhalt hält. Gerundete Werte («rund 190 Kilo» bei 189 kg) ` +
      `sind in Ordnung.\n\n## Faktenblatt\n\n${blatt}\n\n## Skript\n\n${JSON.stringify(skript, null, 1)}\n\n` +
      `Gib das Ergebnis über das Werkzeug pruefung_abgeben ab.`,
  });
  return ergebnis.fehler ?? [];
}

// ---------------------------------------------------------------- Bildauswahl

const AUSWAHL = {
  name: "bilder_waehlen",
  description: "Gibt die Nummern der brauchbaren Bilder ab, beste zuerst.",
  strict: true,
  input_schema: objekt({ gut: liste({ type: "integer" }) }),
};

/** Claude sieht die Vorschaubilder an und wählt die, die das Modell wirklich zeigen. */
export async function waehleBilder(name, vorschauen) {
  const inhalt = [];
  vorschauen.forEach((b64, i) => {
    inhalt.push({ type: "text", text: `Bild ${i}:` });
    inhalt.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } });
  });
  inhalt.push({
    type: "text",
    text:
      `Welche dieser Bilder taugen für ein YouTube-Video über das Motorrad «${name}»?\n` +
      `Brauchbar ist ein Bild nur, wenn es ein echtes Foto ist, das Motorrad das Hauptmotiv ist, es erkennbar ` +
      `dieses Modell (oder eine direkte Variante davon) zeigt, und es scharf und ordentlich belichtet ist.\n` +
      `Unbrauchbar: andere Modelle, Detailaufnahmen ohne erkennbares Motorrad, Zeichnungen, Logos, Unfälle, ` +
      `Menschen als Hauptmotiv, erkennbare Gesichter in Nahaufnahme, Polizei- und Behördenfahrzeuge, ` +
      `politische oder historische Symbole, ` +
      `starke Wasserzeichen.\n` +
      `Sortiere die brauchbaren von der besten zur schwächsten Aufnahme; an erster Stelle möglichst eine ` +
      `Seitenansicht des ganzen Motorrads. Bist du beim Modell unsicher, lass das Bild weg.\n` +
      `Gib das Ergebnis über das Werkzeug bilder_waehlen ab.`,
  });
  const ergebnis = await frage({
    system: "Du bist Bildredaktor eines Motorradkanals und sehr streng bei der Modellzuordnung.",
    effort: "low",
    maxTokens: 8000,
    werkzeug: AUSWAHL,
    inhalt,
  });
  return (ergebnis.gut ?? []).filter((n) => Number.isInteger(n) && n >= 0 && n < vorschauen.length);
}
