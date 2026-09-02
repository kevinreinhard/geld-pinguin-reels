import fs from "node:fs";
import path from "node:path";
import { CHANNEL, VOICE } from "./config.js";
import { waehleSaeule } from "./pillar.js";
import { baueCaption, generiereSkript, sprechtext } from "./script.js";
import { lauf, rendere } from "./render.js";
import { ladeHoch } from "./upload.js";
import { veroeffentlicheReel, verbleibendesKontingent } from "./instagram.js";
import { speicherePost } from "./history.js";

const BUILD = "build";
const flags = new Set(process.argv.slice(2));
const nurSkript = flags.has("--script-only");
const ohneVeroeffentlichung = flags.has("--no-publish") || flags.has("--dry-run") || nurSkript;

const pythonBin =
  process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

function schritt(nr, text) {
  console.log(`\n[${nr}] ${text}`);
}

/** Fehlende Zugangsdaten sofort melden statt mitten im Lauf. */
function preflight() {
  const fehlt = [];
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    fehlt.push("ANTHROPIC_API_KEY");
  }
  if (!ohneVeroeffentlichung) {
    if (!process.env.IG_ACCESS_TOKEN) fehlt.push("IG_ACCESS_TOKEN");
    const hatR2 = process.env.R2_BUCKET && process.env.R2_ACCOUNT_ID && process.env.R2_PUBLIC_BASE;
    if (!hatR2 && !(process.env.GITHUB_REPOSITORY && process.env.GITHUB_TOKEN)) {
      fehlt.push("GITHUB_REPOSITORY + GITHUB_TOKEN (oder die R2_*-Variablen)");
    }
  }
  if (fehlt.length) {
    throw new Error(`Es fehlen: ${fehlt.join(", ")}. Siehe SETUP.md.`);
  }
}

async function main() {
  preflight();
  fs.mkdirSync(BUILD, { recursive: true });
  const start = Date.now();

  // 1 ------------------------------------------------------------- Thema
  schritt(1, "Thema waehlen");
  const saeule = waehleSaeule();
  console.log(`  Saeule: ${saeule.key} - ${saeule.beschreibung}`);

  // 2 ------------------------------------------------------------- Skript
  schritt(2, "Skript von Claude generieren");
  const skript = await generiereSkript(saeule);
  const text = sprechtext(skript);
  const caption = baueCaption(skript);

  console.log(`  Thema:  ${skript.topic}`);
  console.log(`  Titel:  ${skript.title}`);
  console.log(`  Hook:   ${skript.hook}`);
  console.log(`  Woerter: ${text.split(/\s+/).length}`);
  fs.writeFileSync(path.join(BUILD, "script.json"), JSON.stringify({ ...skript, caption }, null, 2));

  if (nurSkript) {
    console.log("\n--- Sprechtext ---\n" + text);
    console.log("\n--- Caption ---\n" + caption);
    return;
  }

  // 3 ------------------------------------------------------------- Stimme
  schritt(3, "Sprachaufnahme erzeugen (Edge TTS)");
  const stimme = VOICE.stimmen[Math.floor(Math.random() * VOICE.stimmen.length)];
  const ttsInput = path.posix.join(BUILD, "tts-input.json");
  const voicePfad = path.posix.join(BUILD, "voice.mp3");
  const wordsPfad = path.posix.join(BUILD, "words.json");

  fs.writeFileSync(
    ttsInput,
    JSON.stringify({ text, voice: stimme, rate: VOICE.rate, pitch: VOICE.pitch, audio: voicePfad, words: wordsPfad }),
  );
  await lauf(pythonBin, ["src/tts.py", ttsInput]);
  console.log(`  Stimme: ${stimme}`);

  // 4 ------------------------------------------------------------- Video
  schritt(4, "Video rendern");
  const video = await rendere({ skript, voicePfad, wordsPfad, text });

  if (ohneVeroeffentlichung) {
    console.log(`\nFertig ohne Veroeffentlichung. Datei: ${video.pfad}`);
    console.log("\n--- Caption ---\n" + caption);
    return;
  }

  // 5 ------------------------------------------------------------- Upload
  schritt(5, "Video oeffentlich bereitstellen");
  const videoUrl = await ladeHoch(video.pfad);

  // 6 ------------------------------------------------------------- Instagram
  schritt(6, `Auf ${CHANNEL.handle} veroeffentlichen`);
  const kontingent = await verbleibendesKontingent();
  if (kontingent) {
    console.log(`  Kontingent: ${kontingent.genutzt}/${kontingent.limit} Beitraege in 24h`);
    if (kontingent.genutzt >= kontingent.limit) {
      throw new Error("Tageskontingent von Instagram ausgeschoepft - dieser Lauf wird uebersprungen.");
    }
  }

  const { mediaId, permalink } = await veroeffentlicheReel({ videoUrl, caption });
  console.log(`  Veroeffentlicht: ${permalink ?? "Media-ID " + mediaId}`);

  // 7 ------------------------------------------------------------- Historie
  speicherePost({
    topic: skript.topic,
    pillar: saeule.key,
    title: skript.title,
    hook: skript.hook,
    stimme,
    dauer: video.dauer,
    mediaId,
    permalink,
  });

  console.log(`\nErledigt in ${((Date.now() - start) / 1000).toFixed(0)}s.`);
}

main().catch((e) => {
  console.error("\nFEHLER: " + e.message);
  process.exit(1);
});
