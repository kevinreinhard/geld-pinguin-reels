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
        nr: { type: "integer", description: "Nummer des Modells im Faktenblatt (1 = erstes)" },
        rang: { type: "integer" },
        name: { type: "string", description: "Kurzer Anzeigename, hoechstens 26 Zeichen, z. B. «Honda CBF 600»" },
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
    `wert höchstens 12 Zeichen (z. B. «48 PS», «189 kg», «ab 3500 €»). Eine Preis-Kennzahl nennt immer nur den ` +
    `Einstiegspreis als «ab … €», nie eine Spanne; die Spanne gehört in den gesprochenen Text. Nennt das Thema ` +
    `eine Preisgrenze und reicht die Spanne eines Modells darüber hinaus, sag im Text, welche Baujahre unter ` +
    `der Grenze liegen.\n\n` +
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

  const nummern = s.modelle.map((m) => m.nr).sort((a, b) => a - b).join(",");
  const soll = modelle.map((_, i) => i + 1).join(",");
  if (nummern !== soll) throw new Error(`Skript ordnet die Modelle falsch zu: nr ${nummern} statt ${soll}.`);
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
    fehler: liste(
      objekt({
        schwere: { type: "string", enum: ["schwer", "leicht"] },
        stelle: text,
        problem: text,
        korrektur: text,
      }),
    ),
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
      `Stufe jeden Befund ein. «schwer» ist nur: eine Zahl weicht vom Faktenblatt ab; eine konkrete technische ` +
      `oder preisliche Aussage widerspricht dem Faktenblatt oder ist frei erfunden; Fakten zweier Modelle sind ` +
      `vertauscht; der Titel behauptet etwas nachweislich Falsches. «leicht» ist alles andere: Formulierungen und ` +
      `Wertungen («knapp», «deshalb», «riesige Auswahl»), Allgemeinwissen über ein Modell, das im Faktenblatt ` +
      `nur nicht eigens steht (Bauart, Fahrzeugklasse), verkürzte, aber nicht falsche Angaben, und ein Titel, der ` +
      `zuspitzt, ohne zu lügen. Im Zweifel «leicht».\n\n` +
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

// ---------------------------------------------------------------- Shorts

const SHORTBLATT = {
  name: "shorts_abgeben",
  description: "Gibt die recherchierten Modelle für Kurzvideos ab.",
  strict: true,
  input_schema: objekt({
    modelle: liste(
      objekt({
        name: { type: "string", description: "Marke und Modell, z. B. «Honda CB500F»" },
        winkel: {
          type: "string",
          description: "Worum es im Kurzvideo geht, 3-6 Wörter, z. B. «Schwachstellen beim Gebrauchtkauf»",
        },
        suchbegriffe: {
          ...liste(text),
          description: "2-3 Suchbegriffe für Fotos auf Wikimedia Commons, verschiedene Schreibweisen",
        },
        fakten: {
          type: "string",
          description:
            "Stichpunkte: Bauzeit, Motor, Leistung in PS, Gewicht fahrfertig, Sitzhöhe, typischer " +
            "Gebrauchtpreis in Deutschland, bekannte Schwachstellen, für wen das Modell passt",
        },
        quellen: liste(text),
      }),
    ),
  }),
};

/** Sucht Modelle für die Shorts des Tages. `erledigt` = bisherige Shorts als «Modell – Winkel», neueste zuletzt. */
export async function rechercheShorts(anzahl, erledigt) {
  const ergebnis = await frage({
    system: KANAL,
    websuche: 14,
    effort: "medium",
    werkzeug: SHORTBLATT,
    inhalt:
      `Der Kanal bringt täglich Kurzvideos (Shorts, rund 40 Sekunden) über je ein Motorradmodell. ` +
      `Recherchiere mit der Websuche ${anzahl} Modelle für die nächsten Shorts.\n\n` +
      `Auswahl:\n` +
      `- Modelle, die in Deutschland oft gebraucht gehandelt werden und von denen es viele Fotos gibt. ` +
      `Mische Marken und Klassen (Naked, Reiseenduro, Tourer, Sportler, Cruiser, Roller, 125er).\n` +
      `- Gib jedem Modell einen eigenen Winkel, zum Beispiel: Schwachstellen beim Gebrauchtkauf; für wen sie passt; ` +
      `was sie im Unterhalt kostet; warum sie so beliebt ist; welches Baujahr man nehmen sollte. ` +
      `Nimm den Winkel, zu dem du die besten Belege findest, und wechsle zwischen den Modellen ab.\n` +
      `- Keines der letzten 60 Modelle der Liste unten wiederholen. Ältere Modelle dürfen wiederkommen, ` +
      `aber nur mit einem anderen Winkel.\n\n` +
      `Regeln:\n` +
      `- Jede Zahl (PS, Gewicht, Sitzhöhe, Preis, Baujahre) muss in einer Quelle stehen, die du gefunden hast. ` +
      `Findest du eine Zahl nicht, lass sie weg, statt sie zu schätzen.\n` +
      `- Gebrauchtpreise als Spanne für den deutschen Markt, «Stand ${new Date().getFullYear()}».\n` +
      `- Nenne zu jedem Modell mindestens eine echte Schwachstelle.\n` +
      `- Quellen als vollständige Adressen.\n\n` +
      `## Bisherige Shorts (älteste zuerst)\n\n${erledigt.length ? erledigt.join("\n") : "noch keine"}\n\n` +
      `Gib das Ergebnis über das Werkzeug shorts_abgeben ab.`,
  });
  if (!ergebnis.modelle?.length) throw new Error("Recherche lieferte keine Modelle.");
  return ergebnis.modelle;
}

const SHORT = {
  name: "short_abgeben",
  description: "Gibt das fertige Skript für ein Kurzvideo ab.",
  strict: true,
  input_schema: objekt({
    titel: { type: "string", description: "YouTube-Titel, höchstens 60 Zeichen, nennt das Modell" },
    hook: { type: "string", description: "Zeile unter dem Modellnamen im Bild, höchstens 36 Zeichen" },
    beschreibung: { type: "string", description: "1-2 Sätze für die Videobeschreibung" },
    tags: liste(text),
    kennzahlen: liste(objekt({ label: text, wert: text })),
    text: { type: "string", description: "Gesprochener Text, 90-115 Wörter" },
  }),
};

export async function schreibeShort(modell, korrekturen = null, vorher = null) {
  let inhalt =
    `Schreibe das Skript für ein Kurzvideo (YouTube Short, hochkant, rund 40 Sekunden) über das Modell ` +
    `«${modell.name}». Winkel: ${modell.winkel}.\n\n` +
    `Der Text wird von einer Computerstimme gesprochen und nicht gelesen:\n` +
    `- 90 bis 115 Wörter, kurze Sätze, keine Klammern, keine Aufzählungszeichen, keine Abkürzungen ausser PS und Kilo\n` +
    `- Zahlen so schreiben, wie man sie spricht («48 PS», «rund 3500 Euro»)\n` +
    `- Der erste Satz nennt das Modell und macht neugierig auf den Winkel, ohne Begrüssung und ohne «in diesem Video»\n` +
    `- danach zwei bis drei konkrete Punkte zum Winkel, darunter eine echte Schwachstelle\n` +
    `- letzter Satz: ein klares Fazit oder eine kurze Frage an die Zuschauer\n\n` +
    `Fakten: Verwende ausschliesslich Zahlen und Aussagen aus dem Faktenblatt unten. Was dort nicht steht, ` +
    `kommt nicht vor. Preise immer als ungefähre Spanne. Fehlt eine Angabe, lass sie einfach weg.\n\n` +
    `kennzahlen: genau 3, label höchstens 12 Zeichen (z. B. «Leistung», «Gewicht», «Gebraucht ab»), wert ` +
    `höchstens 10 Zeichen (z. B. «48 PS», «189 kg», «ab 3500 €»). Eine Preis-Kennzahl nennt nur den Einstiegspreis.\n\n` +
    `Titel: weckt Neugier, verspricht nichts, was das Video nicht hält, keine Beschimpfungen, keine Hashtags.\n\n` +
    `## Faktenblatt\n\n### ${modell.name}\n${modell.fakten}\n\n` +
    `Gib das Ergebnis über das Werkzeug short_abgeben ab.`;
  if (korrekturen) {
    inhalt +=
      `\n\n## Überarbeitung\n\nDein erster Entwurf:\n${JSON.stringify(vorher)}\n\n` +
      `Die Faktenprüfung hat diese Fehler gefunden. Behebe jeden, ändere sonst nichts:\n` +
      korrekturen.map((k) => `- ${k.stelle}: ${k.problem} -> ${k.korrektur}`).join("\n");
  }
  const s = await frage({ system: KANAL, effort: "medium", maxTokens: 12000, werkzeug: SHORT, inhalt });
  const woerter = s.text.trim().split(/\s+/).length;
  if (woerter < 60 || woerter > 150) throw new Error(`Short-Text hat ${woerter} Wörter statt 90-115.`);
  if (s.kennzahlen.length !== 3) throw new Error(`Short hat ${s.kennzahlen.length} Kennzahlen statt 3.`);
  s.titel = s.titel.replace(/[<>#]/g, "").trim().slice(0, 90);
  s.hook = s.hook.replace(/[<>]/g, "").trim();
  return s;
}
