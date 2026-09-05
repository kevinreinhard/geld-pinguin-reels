import fs from "node:fs";
import path from "node:path";
import { PILLARS } from "./config.js";

/**
 * Die Stellschrauben, die der Analyse-Agent verändern darf.
 *
 * Bewusst eine eigene kleine JSON-Datei statt Änderungen am Quellcode: Der Agent
 * bekommt eine eng begrenzte Fläche, jeder Wert wird hier gegen harte Grenzen
 * geprüft, und alles ist über die Git-Historie nachvollziehbar und umkehrbar.
 *
 * Grundsatz: Diese Datei darf die Reel-Produktion niemals zum Absturz bringen.
 * Ist etwas ungültig, gilt der Standardwert und es gibt eine Warnung.
 */

const PFAD = path.resolve("data/tuning.json");

export const STANDARD = {
  version: 1,
  aktualisiert: null,
  begruendung: "Standardwerte",
  saeulenGewichte: {},
  zielWoerter: 65,
  hookHinweise: [],
  postSlots: [6, 10, 16, 19],
};

// Harte Grenzen. Der Agent kann innerhalb dieser Leitplanken nachjustieren,
// aber den Kanal nicht in einen unbrauchbaren Zustand fahren.
export const GRENZEN = {
  gewicht: { min: 0.25, max: 5 },
  zielWoerter: { min: 45, max: 90 },
  hookHinweise: { anzahl: 5, laenge: 200 },
  postSlots: { min: 2, max: 8 },
};

const warnungen = [];
const warne = (t) => warnungen.push(t);

function zahl(wert, { min, max }, standard) {
  const n = Number(wert);
  if (!Number.isFinite(n)) return standard;
  return Math.min(max, Math.max(min, n));
}

function pruefeGewichte(roh) {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) return {};
  const bekannt = new Set(PILLARS.map((p) => p.key));
  const sauber = {};
  for (const [key, wert] of Object.entries(roh)) {
    if (!bekannt.has(key)) {
      warne(`Unbekannte Themensäule "${key}" ignoriert.`);
      continue;
    }
    const n = Number(wert);
    if (!Number.isFinite(n)) {
      warne(`Gewicht für "${key}" ist keine Zahl, ignoriert.`);
      continue;
    }
    sauber[key] = Math.min(GRENZEN.gewicht.max, Math.max(GRENZEN.gewicht.min, n));
  }
  return sauber;
}

function pruefeHinweise(roh) {
  if (!Array.isArray(roh)) return [];
  return roh
    .filter((h) => typeof h === "string" && h.trim())
    .map((h) => h.replace(/\s+/g, " ").trim().slice(0, GRENZEN.hookHinweise.laenge))
    .slice(0, GRENZEN.hookHinweise.anzahl);
}

function pruefeSlots(roh) {
  if (!Array.isArray(roh)) return STANDARD.postSlots;
  const stunden = [...new Set(roh.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 23))]
    .sort((a, b) => a - b);
  if (stunden.length < GRENZEN.postSlots.min || stunden.length > GRENZEN.postSlots.max) {
    warne(
      `postSlots hat ${stunden.length} gültige Einträge, erlaubt sind ` +
        `${GRENZEN.postSlots.min}-${GRENZEN.postSlots.max}. Standard wird verwendet.`,
    );
    return STANDARD.postSlots;
  }
  return stunden;
}

/** Liest und validiert data/tuning.json. Wirft nie. */
export function ladeTuning({ still = false } = {}) {
  warnungen.length = 0;
  let roh;
  try {
    roh = JSON.parse(fs.readFileSync(PFAD, "utf8"));
  } catch (e) {
    if (!still) console.warn(`  tuning.json nicht lesbar (${e.message}) - Standardwerte.`);
    return { ...STANDARD, warnungen: ["Datei fehlt oder ist kein gültiges JSON."] };
  }

  const wert = {
    ...STANDARD,
    aktualisiert: typeof roh.aktualisiert === "string" ? roh.aktualisiert : null,
    begruendung: typeof roh.begruendung === "string" ? roh.begruendung : STANDARD.begruendung,
    saeulenGewichte: pruefeGewichte(roh.saeulenGewichte),
    zielWoerter: Math.round(zahl(roh.zielWoerter, GRENZEN.zielWoerter, STANDARD.zielWoerter)),
    hookHinweise: pruefeHinweise(roh.hookHinweise),
    postSlots: pruefeSlots(roh.postSlots),
  };

  if (!still && warnungen.length) {
    for (const w of warnungen) console.warn("  tuning.json: " + w);
  }
  return { ...wert, warnungen: [...warnungen] };
}

/** Schreibt geprüfte Werte zurück. Gibt die tatsächlich gespeicherte Fassung zurück. */
export function speichereTuning(neu, begruendung) {
  const geprueft = {
    version: 1,
    aktualisiert: new Date().toISOString(),
    begruendung: String(begruendung ?? "").slice(0, 1000),
    saeulenGewichte: pruefeGewichte(neu.saeulenGewichte),
    zielWoerter: Math.round(zahl(neu.zielWoerter, GRENZEN.zielWoerter, STANDARD.zielWoerter)),
    hookHinweise: pruefeHinweise(neu.hookHinweise),
    postSlots: pruefeSlots(neu.postSlots),
  };
  fs.writeFileSync(PFAD, JSON.stringify(geprueft, null, 2) + "\n", "utf8");
  return geprueft;
}
