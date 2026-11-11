/**
 * Motorrad Kompass: ein Ranglisten-Video von der Recherche bis zur fertigen Datei.
 *
 *   node motorrad/index.js                 nächstes Thema aus themen.json
 *   node motorrad/index.js --thema "..."   bestimmtes Thema
 *   node motorrad/index.js --muster        festes Musterskript, kein Modellaufruf (Schnittprobe)
 *
 * Ergebnis in build/motorrad: video.mp4, thumbnail.jpg, meta.json, kontrolle/.
 * Hochgeladen wird hier nichts - das macht ein eigener Schritt, sobald der
 * Kanal ein Zugriffstoken hat.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const B = "build/motorrad";
const ANZAHL = 7; // Modelle im Video
const KANDIDATEN = 12; // recherchiert werden mehr, weil nicht jedes genug Fotos hat
const MIN_BILDER = 3;
const STIMME = { voice: "de-DE-FlorianMultilingualNeural", rate: "+3%" };

const args = process.argv.slice(2);
const muster = args.includes("--muster");
// Recherche eines frueheren Laufs wiederverwenden (spart Websuche und Zeit, wenn nur ein spaeterer Schritt scheiterte)
const blattArg = args.includes("--faktenblatt") ? args[args.indexOf("--faktenblatt") + 1] : "";
const nurMeta = args.includes("--nur-meta"); // meta.json aus vorhandenem Skript und Plan neu schreiben
const themaArg = args.includes("--thema") ? args[args.indexOf("--thema") + 1] : "";

const lies = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const schreib = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 1));
const kuerzel = (name) =>
  name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function naechstesThema() {
  if (themaArg) return themaArg;
  const erledigt = fs.existsSync("data/motorrad-historie.json")
    ? lies("data/motorrad-historie.json").map((e) => e.thema)
    : [];
  const frei = lies("motorrad/themen.json").filter((t) => !erledigt.includes(t));
  if (!frei.length) throw new Error("themen.json ist aufgebraucht.");
  return frei[0];
}

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
  return [...new Set(gut)].slice(0, 6).map((i) => ({
    ...kandidaten[i],
    credit: `Foto: ${kandidaten[i].autor} · ${kandidaten[i].lizenz} · Wikimedia Commons`,
  }));
}

function sprich(text, name) {
  const cfg = `${B}/ton/${name}.json`;
  const audio = `${B}/ton/${name}.mp3`;
  schreib(cfg, { text, ...STIMME, audio, words: `${B}/ton/${name}-woerter.json` });
  const aus = execFileSync("python", ["src/tts.py", cfg], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  console.log(`  Ton ${name}: ${aus.trim()}`);
  return audio;
}

function beschreibung(skript, modelle, bilder) {
  const quellen = [...new Set(modelle.flatMap((m) => m.quellen ?? []))].slice(0, 12);
  const nachweise = [...new Map(bilder.map((b) => [b.titel, b])).values()].map(
    (b) => `${b.titel} – ${b.autor} – ${b.lizenz}`,
  );
  const teile = [
    skript.beschreibung,
    "Preise sind ungefähre Spannen vom deutschen Gebrauchtmarkt und ändern sich. Zustand und Wartungshistorie zählen mehr als das Modell.",
    "Die Sprecherstimme ist computergeneriert.",
    quellen.length ? "Quellen:\n" + quellen.join("\n") : "",
    "Bildnachweise (Dateien auf commons.wikimedia.org unter dem genannten Namen, Bilder zugeschnitten):\n" +
      nachweise.join("\n"),
  ].filter(Boolean);
  let text = teile.join("\n\n").replace(/[<>]/g, "");
  // YouTube nimmt höchstens 5000 Zeichen. Die Bildnachweise sind Lizenzpflicht und bleiben; gekürzt werden die Quellen.
  if (text.length > 4900) {
    teile.splice(3, 1);
    text = teile.join("\n\n").replace(/[<>]/g, "");
  }
  if (text.length > 4900) throw new Error("Beschreibung mit Bildnachweisen länger als 4900 Zeichen.");
  return text;
}

function schreibMeta(thema, skript, modelle, segmente) {
  schreib(`${B}/meta.json`, {
    thema,
    titel: skript.titel,
    beschreibung: beschreibung(skript, modelle, segmente.flatMap((s) => s.bilder)),
    tags: (skript.tags ?? []).slice(0, 15),
    erzeugt: new Date().toISOString(),
  });
}

async function main() {
  if (nurMeta) {
    schreibMeta(themaArg, lies(`${B}/skript.json`), lies(`${B}/faktenblatt.json`), lies(`${B}/plan.json`).segmente);
    console.log("meta.json neu geschrieben.");
    return;
  }
  for (const d of ["bilder", "ton"]) fs.mkdirSync(path.join(B, d), { recursive: true });

  let thema, modelle, skript;

  if (muster) {
    const m = lies("motorrad/muster.json");
    ({ thema, skript } = m);
    modelle = m.modelle;
    for (const modell of modelle) modell.bilder = await holeBilder(modell, false);
  } else {
    const { recherche, schreibe, pruefe } = await import("./skript.js");
    thema = naechstesThema();
    console.log(`Thema: ${thema}\n1/5 Recherche ...`);
    const kandidaten = blattArg ? lies(blattArg) : await recherche(thema, KANDIDATEN);
    for (const k of kandidaten) delete k.bilder;
    schreib(`${B}/faktenblatt.json`, kandidaten);

    console.log("2/5 Bilder ...");
    modelle = [];
    for (const kandidat of kandidaten) {
      if (modelle.length === ANZAHL) break;
      kandidat.bilder = await holeBilder(kandidat, true);
      console.log(`  ${kandidat.name}: ${kandidat.bilder.length} brauchbare Fotos`);
      if (kandidat.bilder.length >= MIN_BILDER) modelle.push(kandidat);
    }
    if (modelle.length < 5) throw new Error(`Nur ${modelle.length} Modelle mit genug Fotos - Abbruch.`);

    console.log(`3/5 Skript für ${modelle.length} Modelle ...`);
    skript = await schreibe(thema, modelle);
    // Bis zu drei Überarbeitungen. Bleibt danach ein Befund, gibt es kein Video:
    // Der Kanal verspricht geprüfte Fakten, also geht ungeprüft nichts raus.
    for (let runde = 1; ; runde++) {
      schreib(`${B}/skript.json`, skript);
      const befunde = await pruefe(skript, modelle);
      schreib(`${B}/pruefung-${runde}.json`, befunde);
      // Nur schwere Befunde (falsche Zahl, falsche Sachaussage) halten das Video auf; Stilfragen nicht.
      const fehler = befunde.filter((b) => b.schwere === "schwer");
      console.log(`  Faktenprüfung Runde ${runde}: ${fehler.length} schwer, ${befunde.length - fehler.length} leicht`);
      if (!fehler.length) break;
      if (runde > 3) throw new Error(`Faktenprüfung nach 3 Überarbeitungen noch ${fehler.length} schwere Befunde - kein Video.`);
      skript = await schreibe(thema, modelle, fehler, skript);
    }
  }
  schreib(`${B}/skript.json`, skript);

  // Modelle des Skripts den Fotos zuordnen (Name aus dem Faktenblatt).
  const fotosVon = (m) => {
    const bilder = modelle[m.nr - 1]?.bilder;
    if (!bilder?.length) throw new Error(`Keine Fotos für «${m.name}» (nr ${m.nr}).`);
    return bilder;
  };

  console.log("4/5 Ton ...");
  const segmente = [];
  const titelbilder = skript.modelle.map((m) => fotosVon(m)[0]);
  segmente.push({ typ: "intro", titelzeile: skript.titel, audio: sprich(skript.intro, "00-intro"), bilder: titelbilder });
  skript.modelle.forEach((m, i) => {
    segmente.push({
      typ: "modell",
      rang: m.rang,
      name: m.name,
      kennzahlen: m.kennzahlen,
      audio: sprich(m.text, `${String(i + 1).padStart(2, "0")}-${kuerzel(m.name)}`),
      bilder: fotosVon(m),
    });
  });
  const sieger = skript.modelle.at(-1);
  segmente.push({ typ: "outro", audio: sprich(skript.outro, "99-outro"), bilder: [...titelbilder].reverse() });

  schreib(`${B}/plan.json`, { segmente, thumbnail: { bild: fotosVon(sieger)[0].datei, text: skript.thumbnailText } });

  // Vor dem Schnitt: Scheitert die Beschreibung, soll das nicht erst nach zehn Minuten Rechnen auffallen.
  schreibMeta(thema, skript, modelle, segmente);

  console.log("5/5 Schnitt ...");
  execFileSync("python", ["motorrad/render.py", `${B}/plan.json`], { stdio: "inherit" });
  console.log(`Fertig: ${B}/video.mp4 – «${skript.titel}»`);
}

main().catch((e) => {
  console.error("FEHLER:", e.message);
  process.exit(1);
});
