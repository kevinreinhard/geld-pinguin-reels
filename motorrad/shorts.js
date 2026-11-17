/**
 * Motorrad Kompass: das Short des Tages, ein Modell in 25 bis 35 Sekunden.
 *
 *   node motorrad/shorts.js              ein Short mit Recherche, Skript und Faktenprüfung
 *   node motorrad/shorts.js --anzahl 2   andere Anzahl
 *   node motorrad/shorts.js --muster     festes Musterskript, kein Modellaufruf (Schnittprobe)
 *
 * Mit KLING_JE_TAG=n bekommen die ersten n Shorts bewegte Einstellungen aus Kling (motorrad/kling.js,
 * 7,5 Credits je Clip, drei Clips je Short). Ohne Anmeldung oder Guthaben bleibt es beim Zoom.
 *
 * Ergebnis in build/motorrad-shorts/<n>/: video.mp4, meta.json, skript.json, kontrolle/.
 * Scheitert ein Modell (zu wenig Fotos, Faktenprüfung, Länge), kommt das nächste dran;
 * recherchiert werden deshalb doppelt so viele, wie gebraucht werden, mindestens drei.
 * Hochgeladen wird hier nichts, das macht der Workflow motorrad-shorts.yml.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const B = "build/motorrad-shorts";
const HISTORIE = "data/motorrad-shorts.json";
const MIN_BILDER = 3;
const STIMME = { voice: "de-DE-FlorianMultilingualNeural", rate: "+6%" };
// Länge des fertigen Videos; short-render.py hängt NACHLAUF_S an den Ton an.
const MIN_S = 25;
const MAX_S = 35;
const NACHLAUF_S = 0.7;

const args = process.argv.slice(2);
const muster = args.includes("--muster");
const ANZAHL = args.includes("--anzahl") ? Number(args[args.indexOf("--anzahl") + 1]) : muster ? 2 : 1;
const KLING_JE_TAG = muster ? 0 : Number(process.env.KLING_JE_TAG || 0);

const lies = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const schreib = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 1));
const kuerzel = (name) =>
  name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Fotos von Commons holen; mit `pruefen` wählt Claude die brauchbaren aus. */
async function holeBilder(modell, pruefen) {
  const roh = execFileSync(
    "python",
    ["motorrad/commons.py", JSON.stringify(modell.suchbegriffe), `${B}/bilder`, kuerzel(modell.name), "10"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 24 },
  );
  const kandidaten = JSON.parse(roh);
  if (!kandidaten.length) return [];
  let gut = kandidaten.map((_, i) => i);
  if (pruefen) {
    const { waehleBilder } = await import("./skript.js");
    gut = await waehleBilder(
      modell.name,
      kandidaten.map((k) => fs.readFileSync(k.vorschau).toString("base64")),
    );
  }
  return [...new Set(gut)].slice(0, 5).map((i) => ({
    ...kandidaten[i],
    credit: `Foto: ${kandidaten[i].autor} · ${kandidaten[i].lizenz} · Wikimedia Commons`,
  }));
}

function beschreibung(skript, modell, bilder, ki) {
  const nachweise = [...new Map(bilder.map((b) => [b.titel, b])).values()].map(
    (b) => `${b.titel} – ${b.autor} – ${b.lizenz}`,
  );
  const quellen = (modell.quellen ?? []).slice(0, 6);
  return [
    skript.beschreibung,
    "Preise sind ungefähre Spannen vom deutschen Gebrauchtmarkt und ändern sich. Die Sprecherstimme ist computergeneriert." +
      (ki ? " Einzelne Einstellungen sind mit KI aus den Fotos animiert (Kamerafahrt), das Motorrad selbst ist unverändert." : ""),
    quellen.length ? "Quellen:\n" + quellen.join("\n") : "",
    "Bildnachweise (Dateien auf commons.wikimedia.org unter dem genannten Namen, Bilder zugeschnitten):\n" +
      nachweise.join("\n"),
    "#shorts #motorrad #gebrauchtkauf",
  ]
    .filter(Boolean)
    .join("\n\n")
    .replace(/[<>]/g, "")
    .slice(0, 4900);
}

/** Schreibt das Skript und lässt es prüfen; `korrekturen` und `vorher` für eine gezielte Überarbeitung. */
async function schreibeGeprueft(modell, ordner, korrekturen = null, vorher = null) {
  const { schreibeShort, pruefe } = await import("./skript.js");
  let skript = await schreibeShort(modell, korrekturen, vorher);
  // Wie beim langen Video: Nur schwere Befunde halten auf, nach drei Überarbeitungen ist Schluss.
  for (let runde = 1; ; runde++) {
    const befunde = await pruefe(skript, [modell]);
    schreib(`${ordner}/pruefung-${korrekturen ? "laenge-" : ""}${runde}.json`, befunde);
    const fehler = befunde.filter((b) => b.schwere === "schwer");
    console.log(`  Faktenprüfung Runde ${runde}: ${fehler.length} schwer, ${befunde.length - fehler.length} leicht`);
    if (!fehler.length) return skript;
    if (runde > 3) throw new Error(`Faktenprüfung nach 3 Überarbeitungen noch ${fehler.length} schwere Befunde`);
    skript = await schreibeShort(modell, fehler, skript);
  }
}

/**
 * Ein Short vom Modell bis zur fertigen Datei. Wirft, wenn Fotos fehlen, die Faktenprüfung nicht
 * durchgeht oder das Video auch nach einer Überarbeitung nicht 25 bis 35 Sekunden lang ist.
 */
async function baue(modell, nr, fertigesSkript) {
  const ordner = `${B}/${nr}`;
  fs.mkdirSync(ordner, { recursive: true });

  modell.bilder = await holeBilder(modell, !muster);
  if (modell.bilder.length < MIN_BILDER) throw new Error(`nur ${modell.bilder.length} brauchbare Fotos`);

  const audio = `${ordner}/ton.mp3`;
  const woerter = `${ordner}/woerter.json`;
  /** Spricht den Text ein; Rückgabe: Länge des fertigen Videos in Sekunden. */
  const sprich = (s) => {
    schreib(`${ordner}/tts.json`, { text: s.text, ...STIMME, audio, words: woerter });
    const ton = execFileSync("python", ["src/tts.py", `${ordner}/tts.json`], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
    console.log(`  Ton: ${ton.trim()}`);
    return JSON.parse(ton.trim().split("\n").pop()).dauer + NACHLAUF_S;
  };

  let skript = fertigesSkript;
  if (skript) {
    sprich(skript);
  } else {
    skript = await schreibeGeprueft(modell, ordner);
    let dauer = sprich(skript);
    if (dauer < MIN_S || dauer > MAX_S) {
      // Einmal mit der gemessenen Sprechgeschwindigkeit auf die Mitte des Fensters nachschreiben.
      const anzahl = skript.text.trim().split(/\s+/).length;
      const ziel = Math.round((anzahl * ((MIN_S + MAX_S) / 2 - NACHLAUF_S)) / (dauer - NACHLAUF_S));
      console.log(`  Länge ${dauer.toFixed(1)} s ausserhalb ${MIN_S}-${MAX_S} s – neu mit rund ${ziel} Wörtern`);
      skript = await schreibeGeprueft(modell, ordner, [{
        stelle: "text",
        problem: `Gesprochen dauert der Text ${dauer.toFixed(1)} Sekunden, erlaubt sind ${MIN_S} bis ${MAX_S}.`,
        korrektur: `Schreibe den Text mit rund ${ziel} Wörtern (${anzahl} sind es jetzt), ohne neue Fakten.`,
      }], skript);
      dauer = sprich(skript);
      if (dauer < MIN_S || dauer > MAX_S) throw new Error(`Länge ${dauer.toFixed(1)} s statt ${MIN_S}-${MAX_S} s`);
    }
  }
  schreib(`${ordner}/skript.json`, skript);

  if (nr <= KLING_JE_TAG) {
    const { belebe, genugGuthaben } = await import("./kling.js");
    const clips = Math.min(3, modell.bilder.length);
    if (await genugGuthaben(clips)) await belebe(modell.name, modell.bilder, ordner, clips);
  }
  const ki = modell.bilder.some((b) => b.video);

  schreib(`${ordner}/plan.json`, {
    name: modell.name,
    hook: skript.hook,
    kennzahlen: skript.kennzahlen,
    audio,
    woerter,
    bilder: modell.bilder,
  });
  schreib(`${ordner}/meta.json`, {
    thema: `${modell.name} – ${modell.winkel}`,
    modell: modell.name,
    winkel: modell.winkel,
    titel: skript.titel,
    beschreibung: beschreibung(skript, modell, modell.bilder, ki),
    ki,
    tags: (skript.tags ?? []).slice(0, 12),
    erzeugt: new Date().toISOString(),
  });

  const schnitt = execFileSync("python", ["motorrad/short-render.py", `${ordner}/plan.json`], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  console.log(`  Schnitt: ${schnitt.trim()}`);
}

async function main() {
  fs.mkdirSync(`${B}/bilder`, { recursive: true });

  let kandidaten;
  let skripte = [];
  if (muster) {
    const m = lies("motorrad/shorts-muster.json");
    kandidaten = m.map((e) => e.modell);
    skripte = m.map((e) => e.skript);
  } else {
    const { rechercheShorts } = await import("./skript.js");
    const erledigt = fs.existsSync(HISTORIE) ? lies(HISTORIE).map((e) => e.thema).slice(-400) : [];
    console.log(`Recherche für ${ANZAHL} Shorts (${erledigt.length} bisherige) ...`);
    kandidaten = await rechercheShorts(Math.max(3, ANZAHL * 2), erledigt);
  }
  schreib(`${B}/faktenblatt.json`, kandidaten);

  let fertig = 0;
  for (const [i, modell] of kandidaten.entries()) {
    if (fertig === ANZAHL) break;
    console.log(`Short ${fertig + 1}: ${modell.name} – ${modell.winkel}`);
    try {
      await baue(modell, fertig + 1, skripte[i]);
      fertig++;
    } catch (e) {
      console.log(`  übersprungen: ${e.message}`);
      fs.rmSync(`${B}/${fertig + 1}`, { recursive: true, force: true });
    }
  }

  if (!muster) {
    const { verbrauch } = await import("./claude.js");
    console.log(`Modellverbrauch: ${JSON.stringify(verbrauch)}`);
  }
  console.log(`Fertig: ${fertig} von ${ANZAHL} Shorts.`);
  if (!fertig) throw new Error("Kein einziges Short ist fertig geworden.");
}

main().catch((e) => {
  console.error("FEHLER:", e.message);
  process.exit(1);
});
