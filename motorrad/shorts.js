/**
 * Motorrad Kompass: die Shorts des Tages, je ein Modell in rund 40 Sekunden.
 *
 *   node motorrad/shorts.js              drei Shorts mit Recherche, Skript und Faktenprüfung
 *   node motorrad/shorts.js --anzahl 2   andere Anzahl
 *   node motorrad/shorts.js --muster     festes Musterskript, kein Modellaufruf (Schnittprobe)
 *
 * Ergebnis in build/motorrad-shorts/<n>/: video.mp4, meta.json, skript.json, kontrolle/.
 * Scheitert ein Modell (zu wenig Fotos, Faktenprüfung), kommt das nächste dran;
 * recherchiert werden deshalb doppelt so viele, wie gebraucht werden.
 * Hochgeladen wird hier nichts, das macht der Workflow motorrad-shorts.yml.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const B = "build/motorrad-shorts";
const HISTORIE = "data/motorrad-shorts.json";
const MIN_BILDER = 3;
const STIMME = { voice: "de-DE-FlorianMultilingualNeural", rate: "+6%" };

const args = process.argv.slice(2);
const muster = args.includes("--muster");
const ANZAHL = args.includes("--anzahl") ? Number(args[args.indexOf("--anzahl") + 1]) : 3;

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

function beschreibung(skript, modell, bilder) {
  const nachweise = [...new Map(bilder.map((b) => [b.titel, b])).values()].map(
    (b) => `${b.titel} – ${b.autor} – ${b.lizenz}`,
  );
  const quellen = (modell.quellen ?? []).slice(0, 6);
  return [
    skript.beschreibung,
    "Preise sind ungefähre Spannen vom deutschen Gebrauchtmarkt und ändern sich. Die Sprecherstimme ist computergeneriert.",
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

/** Ein Short vom Modell bis zur fertigen Datei. Wirft, wenn Fotos fehlen oder die Faktenprüfung nicht durchgeht. */
async function baue(modell, nr, fertigesSkript) {
  const ordner = `${B}/${nr}`;
  fs.mkdirSync(ordner, { recursive: true });

  modell.bilder = await holeBilder(modell, !muster);
  if (modell.bilder.length < MIN_BILDER) throw new Error(`nur ${modell.bilder.length} brauchbare Fotos`);

  let skript = fertigesSkript;
  if (!skript) {
    const { schreibeShort, pruefe } = await import("./skript.js");
    skript = await schreibeShort(modell);
    // Wie beim langen Video: Nur schwere Befunde halten auf, nach drei Überarbeitungen ist Schluss.
    for (let runde = 1; ; runde++) {
      const befunde = await pruefe(skript, [modell]);
      schreib(`${ordner}/pruefung-${runde}.json`, befunde);
      const fehler = befunde.filter((b) => b.schwere === "schwer");
      console.log(`  Faktenprüfung Runde ${runde}: ${fehler.length} schwer, ${befunde.length - fehler.length} leicht`);
      if (!fehler.length) break;
      if (runde > 3) throw new Error(`Faktenprüfung nach 3 Überarbeitungen noch ${fehler.length} schwere Befunde`);
      skript = await schreibeShort(modell, fehler, skript);
    }
  }
  schreib(`${ordner}/skript.json`, skript);

  const audio = `${ordner}/ton.mp3`;
  const woerter = `${ordner}/woerter.json`;
  schreib(`${ordner}/tts.json`, { text: skript.text, ...STIMME, audio, words: woerter });
  const ton = execFileSync("python", ["src/tts.py", `${ordner}/tts.json`], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  console.log(`  Ton: ${ton.trim()}`);

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
    beschreibung: beschreibung(skript, modell, modell.bilder),
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
    kandidaten = await rechercheShorts(ANZAHL * 2, erledigt);
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
