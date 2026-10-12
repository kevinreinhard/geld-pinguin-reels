import fs from "node:fs";
import path from "node:path";
import { CHANNEL, VOICE } from "./config.js";
import { waehleSaeule } from "./pillar.js";
import { baueCaption, generiereSkript, saetzeVon, sprechtext } from "./script.js";
import { planeBilder } from "./regie.js";
import { lauf, rendere } from "./render.js";
import { ladeHoch } from "./upload.js";
import { veroeffentlicheReel, verbleibendesKontingent } from "./instagram.js";
import { istEingerichtet as youtubeBereit, ladeShortHoch } from "./youtube.js";
import { speicherePost } from "./history.js";
import { pruefe, speichere as speichereQualitaet } from "../scripts/qa.js";

const BUILD = "build";
const flags = new Set(process.argv.slice(2));
const nurSkript = flags.has("--script-only");
// Ein fertiges Skript erneut veroeffentlichen, statt ein neues schreiben zu
// lassen. Gebaut fuer den Fall, dass am Renderer etwas kaputt war: Der Text
// ist in Ordnung, nur das Bild war es nicht - dann soll genau dieser Beitrag
// noch einmal raus, nicht irgendein anderer.
const argumente = process.argv.slice(2);
// indexOf liefert -1, wenn der Schalter fehlt - ohne diese Pruefung zeigte
// "+ 1" auf das erste Argument und machte aus --no-publish einen Dateinamen.
const skriptPos = argumente.indexOf("--skript");
const vorlage = skriptPos >= 0 ? argumente[skriptPos + 1] : null;
const ohneVeroeffentlichung = flags.has("--no-publish") || flags.has("--dry-run") || nurSkript;

const pythonBin =
  process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

function schritt(nr, text) {
  console.log(`\n[${nr}] ${text}`);
}

/**
 * Lädt ein zuvor erzeugtes Skript von der Platte.
 *
 * Die Datei ist dieselbe, die jeder Lauf als `build/script.json` ablegt und
 * als Artefakt am Workflow hängt — ein misslungener Beitrag lässt sich damit
 * ohne Abtippen wiederholen.
 */
function ladeSkript(pfad) {
  let s;
  try {
    s = JSON.parse(fs.readFileSync(pfad, "utf8"));
  } catch (e) {
    throw new Error(`${pfad} laesst sich nicht lesen: ${e.message}`);
  }
  const fehlt = ["topic", "title", "hook", "cta", "hashtags"].filter((k) => !s[k]);
  if (!Array.isArray(s.body) || !s.body.length) fehlt.push("body");
  if (fehlt.length) {
    throw new Error(`${pfad} ist kein vollstaendiges Skript. Es fehlt: ${fehlt.join(", ")}.`);
  }
  return s;
}

/**
 * Die Caption, die unter den Beitrag kommt.
 *
 * `build/script.json` enthält bereits die fertige Caption samt Hinweis und
 * Hashtags — `baueCaption` ein zweites Mal darauf loszulassen würde beides
 * verdoppeln. Der Rechtshinweis ist das verlässliche Erkennungszeichen.
 */
function vollstaendigeCaption(skript) {
  return String(skript.caption ?? "").includes("Keine Anlageberatung")
    ? skript.caption
    : baueCaption(skript);
}

/**
 * Warnt, bevor der Instagram-Token abläuft.
 *
 * Er ist 60 Tage gültig. Läuft er ab, hört die Instagram-Hälfte auf zu
 * arbeiten - ohne Fehler, der ins Auge fällt, denn der Lauf scheitert erst
 * beim Posten. Solange die automatische Erneuerung nicht greift, ist diese
 * Warnung die einzige Vorankündigung.
 */
function tokenWarnung() {
  let stand;
  try {
    stand = JSON.parse(fs.readFileSync("data/token-stand.json", "utf8"));
  } catch {
    return;
  }
  if (!stand.igTokenGesetzt) return;

  const alterTage = Math.floor((Date.now() - new Date(stand.igTokenGesetzt)) / 864e5);
  const rest = (stand.gueltigkeitTage ?? 60) - alterTage;

  if (rest <= 0) {
    console.warn(`\n  ACHTUNG: Der Instagram-Token ist seit ${-rest} Tagen abgelaufen.`);
  } else if (rest <= 14) {
    console.warn(`\n  ACHTUNG: Der Instagram-Token laeuft in ${rest} Tagen ab.`);
    console.warn("  Erneuern: Schritt 3 der Anleitung, dann IG_ACCESS_TOKEN und");
    console.warn("  data/token-stand.json aktualisieren.");
  }
}

/** Fehlende Zugangsdaten sofort melden statt mitten im Lauf. */
function preflight() {
  const fehlt = [];
  // Ohne Modellaufruf braucht es keinen Schluessel: Ein vorhandenes Skript
  // nur anzeigen kommt ganz ohne aus. Gerendert wird dagegen nie ohne - die
  // Bildregie laeuft auch bei einer Wiederholung.
  const brauchtModell = !(vorlage && nurSkript);
  if (brauchtModell && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
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

// Bildtor: Die Bildkontrolle schaut sich das fertige Video vor dem Hochladen an.
// Faellt es klar durch, wird die Bildregie einmal mit den Befunden neu geplant
// und neu gerendert. Danach geht das bessere der beiden Videos raus - das Tor
// haelt nie einen Beitrag zurueck, denn ein Modellurteil ueber Geschmack
// (siehe Lehren aus fuenf Messrunden) darf den Tagesbeitrag nicht kosten.
const TOR_MINDESTWERT = Number(process.env.QA_TOR_MINDESTWERT ?? 50);
// Nur Bereiche, in denen die Beobachtungen des Kritikers verlaesslich waren.
// Seine Pixelangaben zu Sicherheitsraendern waren es nicht.
const TOR_BEREICHE = new Set(["lesbarkeit", "information"]);

function torGruende(e) {
  const gruende = [];
  if (e.gesamt < TOR_MINDESTWERT) gruende.push(`Gesamtnote ${e.gesamt} unter ${TOR_MINDESTWERT}`);
  const schwer = e.maengel.filter((m) => m.schwere === "schwer" && TOR_BEREICHE.has(m.bereich));
  if (schwer.length) gruende.push(`${schwer.length} schwerer Mangel bei Lesbarkeit oder Information`);
  return gruende;
}

function merkeTorErgebnis(daten) {
  fs.writeFileSync(path.join(BUILD, "qa-tor.json"), JSON.stringify(daten, null, 2));
}

async function bildtor({ skript, saetze, video, renderEingabe }) {
  const hatSchluessel = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (process.env.QA_TOR === "aus" || !hatSchluessel) {
    console.log("  Bildtor aus - weiter ohne Kontrolle.");
    return video;
  }

  let erste;
  try {
    erste = await pruefe(video.pfad);
  } catch (e) {
    console.warn(`  Bildkontrolle fehlgeschlagen (${e.message.slice(0, 120)}) - weiter ohne Tor.`);
    return video;
  }
  console.log(`  Erster Entwurf: ${erste.gesamt}/100, ${erste.maengel.length} Maengel`);
  const gruende = torGruende(erste);
  if (!gruende.length) {
    console.log("  Tor offen.");
    speichereQualitaet(erste);
    merkeTorErgebnis({ nachbesserung: false, gesamt: erste.gesamt });
    return video;
  }

  console.log(`  Tor zu: ${gruende.join("; ")}. Bildregie wird einmal neu geplant.`);
  const hinweise = erste.maengel
    .filter((m) => m.schwere !== "klein")
    .slice(0, 5)
    .map((m) => `${m.befund} [${m.bereich}${m.bild ? ", " + m.bild : ""}] - ${m.vorschlag}`);

  const sicherung = video.pfad.replace(/\.mp4$/, "-erster-entwurf.mp4");
  fs.copyFileSync(video.pfad, sicherung);
  const zurueck = () => fs.copyFileSync(sicherung, video.pfad);

  try {
    const szenen2 = await planeBilder(skript, saetze, hinweise);
    fs.writeFileSync(path.join(BUILD, "szenenplan.json"), JSON.stringify(szenen2, null, 2));
    const video2 = await rendere({ ...renderEingabe, szenen: szenen2 });
    const zweite = await pruefe(video2.pfad);
    console.log(`  Zweiter Entwurf: ${zweite.gesamt}/100 (erster: ${erste.gesamt}/100)`);
    if (zweite.gesamt >= erste.gesamt) {
      speichereQualitaet(zweite);
      merkeTorErgebnis({ nachbesserung: true, gewaehlt: "zweiter", erste: erste.gesamt, zweite: zweite.gesamt });
      return video2;
    }
    console.log("  Der erste Entwurf war besser - er geht raus.");
  } catch (e) {
    console.warn(`  Zweiter Anlauf gescheitert (${e.message.slice(0, 120)}) - erster Entwurf geht raus.`);
  }
  zurueck();
  speichereQualitaet(erste);
  merkeTorErgebnis({ nachbesserung: true, gewaehlt: "erster", erste: erste.gesamt });
  return video;
}

async function main() {
  preflight();
  tokenWarnung();
  fs.mkdirSync(BUILD, { recursive: true });
  const start = Date.now();

  // 1 ------------------------------------------------------------- Thema
  schritt(1, "Thema waehlen");
  const saeule = vorlage ? { key: "wiederholung", beschreibung: vorlage } : waehleSaeule();
  console.log(`  Saeule: ${saeule.key} - ${saeule.beschreibung}`);

  // 2 ------------------------------------------------------------- Skript
  schritt(2, vorlage ? `Skript aus ${vorlage} laden` : "Skript von Claude generieren");
  const skript = vorlage ? ladeSkript(vorlage) : await generiereSkript(saeule);
  const text = sprechtext(skript);
  const caption = vollstaendigeCaption(skript);

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

  // 4 ------------------------------------------------------------- Bildregie
  // Erst hier steht fest, was waehrend jedes Satzes zu sehen ist. Vorher lief
  // 25 Sekunden lang derselbe Farbverlauf - der Grund, warum die Reels nichts
  // gehalten haben.
  schritt(4, "Bildregie: Szenen planen");
  const saetze = saetzeVon(skript);
  const szenen = await planeBilder(skript, saetze);
  szenen.forEach((sz, i) => console.log(`  ${i + 1}. ${sz.typ} (${sz.stimmung})`));
  fs.writeFileSync(path.join(BUILD, "szenenplan.json"), JSON.stringify(szenen, null, 2));

  // 5 ------------------------------------------------------------- Video
  schritt(5, "Video rendern");
  let video = await rendere({ skript, voicePfad, wordsPfad, text, szenen, saetze });

  // 5b ------------------------------------------------------------- Bildtor
  schritt("5b", "Bildkontrolle als Tor");
  video = await bildtor({ skript, saetze, video, renderEingabe: { skript, voicePfad, wordsPfad, text, saetze } });

  if (ohneVeroeffentlichung) {
    console.log(`\nFertig ohne Veroeffentlichung. Datei: ${video.pfad}`);
    console.log("\n--- Caption ---\n" + caption);
    return;
  }

  // 6 ------------------------------------------------------------- Upload
  schritt(6, "Video oeffentlich bereitstellen");
  const videoUrl = await ladeHoch(video.pfad);

  // 7 ------------------------------------------------------------- Instagram
  // Faellt Instagram aus - abgelaufener Token, ausgeschoepftes Kontingent -,
  // darf das die Zweitverwertung nicht mitreissen. Genau das ist am 14.09.
  // passiert: Fehler 190, und der YouTube-Short blieb deshalb auch liegen,
  // obwohl an YouTube nichts kaputt war.
  schritt(7, `Auf ${CHANNEL.handle} veroeffentlichen`);
  let instagram = null;
  try {
    const kontingent = await verbleibendesKontingent();
    if (kontingent) {
      console.log(`  Kontingent: ${kontingent.genutzt}/${kontingent.limit} Beitraege in 24h`);
      if (kontingent.genutzt >= kontingent.limit) {
        throw new Error("Tageskontingent von Instagram ausgeschoepft.");
      }
    }
    instagram = await veroeffentlicheReel({ videoUrl, caption });
    console.log(`  Veroeffentlicht: ${instagram.permalink ?? "Media-ID " + instagram.mediaId}`);
  } catch (e) {
    console.warn(`  Instagram uebersprungen: ${e.message}`);
  }

  // 8 ------------------------------------------------------------- YouTube
  // Zweitverwertung, und nach dem Follower-Einbruch der Kanal, der ueberhaupt
  // noch kalt verteilt. Wie Instagram faengt sie ihren Fehler selbst ab - der
  // Lauf scheitert erst, wenn keiner der beiden den Beitrag genommen hat.
  let youtube = null;
  if (youtubeBereit()) {
    schritt(8, "Als YouTube Short hochladen");
    try {
      youtube = await ladeShortHoch({ videoPfad: video.pfad, skript, caption });
      console.log(`  Hochgeladen: ${youtube.url}`);
    } catch (e) {
      console.warn(`  YouTube uebersprungen: ${e.message}`);
    }
  }

  // Hat kein Kanal den Beitrag genommen, war der Lauf vergeblich und soll auch
  // so enden. Sonst stuende ein Beitrag in der Historie, den niemand sehen
  // kann - und wuerde ueber Tagesziel und Mindestabstand den naechsten
  // Versuch blockieren.
  if (!instagram && !youtube) {
    throw new Error(
      "Weder Instagram noch YouTube hat den Beitrag angenommen - Ursachen siehe oben.",
    );
  }

  // 9 ------------------------------------------------------------- Historie
  speicherePost({
    topic: skript.topic,
    pillar: saeule.key,
    title: skript.title,
    hook: skript.hook,
    stimme,
    dauer: video.dauer,
    mediaId: instagram?.mediaId ?? null,
    permalink: instagram?.permalink ?? null,
    youtubeId: youtube?.videoId ?? null,
    youtubeUrl: youtube?.url ?? null,
  });

  const kanaele = [instagram && CHANNEL.handle, youtube && "YouTube"].filter(Boolean);
  console.log(
    `\nErledigt in ${((Date.now() - start) / 1000).toFixed(0)}s. Draussen auf: ${kanaele.join(", ")}.`,
  );
}

main().catch((e) => {
  console.error("\nFEHLER: " + e.message);
  process.exit(1);
});
