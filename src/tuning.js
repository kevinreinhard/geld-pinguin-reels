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
  version: 2,
  aktualisiert: null,
  begruendung: "Standardwerte",
  saeulenGewichte: {},
  zielWoerter: 65,
  hookHinweise: [],
  // Menge und Zeitfenster sind zwei verschiedene Dinge und stehen deshalb
  // getrennt. In Fassung 1 steckte beides in einer Stundenliste - bei einem
  // Beitrag pro Tag schrumpfte das Fenster dadurch auf eine Stunde, die
  // GitHub bei seiner Drosselung fast sicher verpasst hätte.
  postsProTag: 1,
  fenster: [11, 20], // UTC, entspricht 13-22 Uhr deutscher Sommerzeit
};

// Harte Grenzen. Der Agent kann innerhalb dieser Leitplanken nachjustieren,
// aber den Kanal nicht in einen unbrauchbaren Zustand fahren.
export const GRENZEN = {
  gewicht: { min: 0.25, max: 5 },
  zielWoerter: { min: 45, max: 90 },
  hookHinweise: { anzahl: 5, laenge: 200 },
  postsProTag: { min: 1, max: 8 },
  fensterMindestbreite: 3, // Stunden - schmaler wird bei verzögerten Läufen unzuverlässig
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

function pruefeFenster(roh) {
  if (!Array.isArray(roh) || roh.length !== 2) return STANDARD.fenster;
  let [von, bis] = roh.map(Number);
  if (![von, bis].every((n) => Number.isInteger(n) && n >= 0 && n <= 23)) {
    warne("fenster enthält keine gültigen Stunden. Standard wird verwendet.");
    return STANDARD.fenster;
  }
  if (bis - von < GRENZEN.fensterMindestbreite) {
    warne(
      `fenster ${von}-${bis} ist schmaler als ${GRENZEN.fensterMindestbreite} Stunden. ` +
        "Bei verzögerten Läufen fiele der Beitrag oft ganz aus. Standard wird verwendet.",
    );
    return STANDARD.fenster;
  }
  return [von, bis];
}

/**
 * Fassung 1 hatte eine Stundenliste postSlots, aus der sich Anzahl und
 * Fenster gemeinsam ergaben. Alte Dateien werden hier übersetzt.
 */
function migriere(roh) {
  if (roh.postsProTag !== undefined || !Array.isArray(roh.postSlots)) return roh;
  const stunden = roh.postSlots.map(Number).filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
  if (!stunden.length) return roh;
  warne("Fassung 1 erkannt: postSlots wurde in postsProTag und fenster übersetzt.");
  return {
    ...roh,
    postsProTag: stunden.length,
    fenster: [stunden[0], Math.max(stunden[stunden.length - 1], stunden[0] + GRENZEN.fensterMindestbreite)],
  };
}

/** Liest und validiert data/tuning.json. Wirft nie. */
export function ladeTuning({ still = false } = {}) {
  warnungen.length = 0;
  let roh;
  try {
    roh = migriere(JSON.parse(fs.readFileSync(PFAD, "utf8")));
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
    postsProTag: Math.round(zahl(roh.postsProTag, GRENZEN.postsProTag, STANDARD.postsProTag)),
    fenster: pruefeFenster(roh.fenster),
  };

  if (!still && warnungen.length) {
    for (const w of warnungen) console.warn("  tuning.json: " + w);
  }
  return { ...wert, warnungen: [...warnungen] };
}

/** Schreibt geprüfte Werte zurück. Gibt die tatsächlich gespeicherte Fassung zurück. */
export function speichereTuning(neu, begruendung) {
  const geprueft = {
    version: 2,
    aktualisiert: new Date().toISOString(),
    begruendung: String(begruendung ?? "").slice(0, 1000),
    saeulenGewichte: pruefeGewichte(neu.saeulenGewichte),
    zielWoerter: Math.round(zahl(neu.zielWoerter, GRENZEN.zielWoerter, STANDARD.zielWoerter)),
    hookHinweise: pruefeHinweise(neu.hookHinweise),
    postsProTag: Math.round(zahl(neu.postsProTag, GRENZEN.postsProTag, STANDARD.postsProTag)),
    fenster: pruefeFenster(neu.fenster),
  };
  fs.writeFileSync(PFAD, JSON.stringify(geprueft, null, 2) + "\n", "utf8");
  return geprueft;
}
