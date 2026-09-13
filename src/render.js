import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { baueAss } from "./ass.js";
import { CAPTIONS, CHANNEL, VIDEO, VOICE } from "./config.js";
import { LAYOUT, STIMMUNGEN, markenSpezifikation } from "./marke.js";
import { baueSpezifikation, satzZeiten } from "./regie.js";
import { holeClips } from "./broll.js";

const BUILD = "build";
const SZENEN = path.posix.join(BUILD, "szenen");

const pythonBin =
  process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

export function lauf(cmd, args, { still = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: still ? ["ignore", "pipe", "pipe"] : "inherit" });
    let out = "";
    if (still) {
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
    }
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${cmd} beendet mit Code ${code}\n${out.slice(-4000)}`)),
    );
  });
}

/** Laenge einer Audiodatei in Sekunden. */
async function audioDauer(datei) {
  const out = await lauf(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", datei],
    { still: true },
  );
  const d = parseFloat(out.trim());
  if (!Number.isFinite(d)) throw new Error(`ffprobe konnte ${datei} nicht lesen: ${out}`);
  return d;
}

/** Schriftfamilie fuer libass ermitteln. FONT_NAME schlaegt alles. */
function ermittleFont() {
  if (process.env.FONT_NAME) return process.env.FONT_NAME;
  const dir = "assets/fonts";
  const dateien = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const treffer = [
    [/anton/i, "Anton"],
    [/montserrat/i, "Montserrat"],
    [/bebas/i, "Bebas Neue"],
    [/oswald/i, "Oswald"],
  ];
  for (const d of dateien) {
    for (const [muster, name] of treffer) if (muster.test(d)) return name;
  }
  return "DejaVu Sans";
}

function zufall(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Optionale Hintergrundmusik aus assets/music. */
function musikSpur() {
  const dir = "assets/music";
  if (!fs.existsSync(dir)) return null;
  const tracks = fs
    .readdirSync(dir)
    .filter((f) => /\.(mp3|m4a|wav|aac)$/i.test(f))
    .map((f) => path.posix.join(dir, f));
  return tracks.length ? zufall(tracks) : null;
}

/** 0xRRGGBB fuer ffmpeg aus dem #RRGGBB des Designsystems. */
const ff = (hex) => "0x" + hex.replace("#", "");

/**
 * Der gezeichnete Hintergrund.
 *
 * Bewusst ruhig und dunkel: Die Stimmungsfarbe der laufenden Szene kommt aus
 * der Kartenebene (dort als weicher Schleier), hier entsteht nur die leichte
 * Bewegung, die ein Standbild von einem Video unterscheidet.
 */
function hintergrundQuelle(dauer, farben) {
  const seed = Math.floor(Math.random() * 1e6);
  return (
    `gradients=s=1220x2160:c0=${ff(farben.grundTief)}:c1=${ff(farben.grund)}` +
    `:c2=${ff(farben.flaeche)}:n=3:type=radial:speed=0.014` +
    `:d=${Math.ceil(dauer)}:r=${VIDEO.fps}:seed=${seed}`
  );
}

/**
 * Rendert das fertige Reel.
 *
 * @param szenen  Szenenplan der Bildregie, eine Szene je gesprochenem Satz
 * @param saetze  Die gesprochenen Saetze in derselben Reihenfolge
 * @returns {Promise<{pfad: string, dauer: number, groesse: number, szenen: object[]}>}
 */
export async function rendere({ skript, voicePfad, wordsPfad, text, szenen, saetze }) {
  const words = JSON.parse(fs.readFileSync(wordsPfad, "utf8"));
  const stimmDauer = await audioDauer(voicePfad);
  const dauer = +(VIDEO.leadIn + stimmDauer + VIDEO.tail).toFixed(2);

  if (dauer < VIDEO.minDauer || dauer > VIDEO.maxDauer) {
    throw new Error(
      `Videolaenge ${dauer}s liegt ausserhalb von ${VIDEO.minDauer}-${VIDEO.maxDauer}s.`,
    );
  }

  const farben = markenSpezifikation().farben;

  // --- 1. Bildebene: Szenenkarten als PNG-Folge ---
  const zeiten = satzZeiten(words, saetze, { offset: VIDEO.leadIn, dauer });
  const spez = baueSpezifikation({
    szenen,
    zeiten,
    handle: CHANNEL.handle,
    dauer,
    ausgabe: SZENEN,
    marke: markenSpezifikation(),
  });
  const spezPfad = path.posix.join(BUILD, "szenen.json");
  fs.writeFileSync(spezPfad, JSON.stringify(spez, null, 1), "utf8");
  const bericht = JSON.parse(await lauf(pythonBin, ["src/karten.py", spezPfad], { still: true }));
  console.log(`  Bildebene: ${bericht.bilder} Einzelbilder fuer ${spez.szenen.length} Szenen`);

  // --- 2. Untertitel ---
  const fontname = ermittleFont();
  const assPfad = path.posix.join(BUILD, "subs.ass");
  fs.writeFileSync(
    assPfad,
    baueAss({
      words,
      quelltext: text ?? "",
      offset: VIDEO.leadIn,
      dauer,
      titel: skript.title,
      handle: CHANNEL.handle,
      fontname,
    }),
    "utf8",
  );

  // --- 3. Optionales Filmmaterial ---
  const clips = await holeClips(spez.szenen);
  const musik = musikSpur();

  // --- 4. ffmpeg ---
  const args = ["-hide_banner", "-loglevel", "warning", "-y"];
  args.push("-i", voicePfad);                                        // 0 Stimme
  args.push("-f", "lavfi", "-t", String(dauer), "-i", hintergrundQuelle(dauer, farben)); // 1 Grund
  args.push("-f", "concat", "-safe", "0", "-i", bericht.liste);      // 2 Karten

  const clipIndex = [];
  for (const [i] of clips) clipIndex.push(i);
  for (const i of clipIndex) {
    args.push("-stream_loop", "-1", "-i", clips.get(i));
  }
  const musikEingang = 3 + clipIndex.length;
  if (musik) args.push("-stream_loop", "-1", "-i", musik);

  const filter = [];

  // Grundbild: leichter Drift ueber die groessere Flaeche, Koernung, Vignette.
  filter.push(
    `[1:v]crop=${VIDEO.breite}:${VIDEO.hoehe}:` +
      `x='(in_w-out_w)/2+58*sin(t/11)':y='(in_h-out_h)/2+70*sin(t/15+1)',` +
      `noise=alls=7:allf=t+u,vignette=PI/4.2,setsar=1,format=rgba[grund]`,
  );

  // Filmmaterial: abgedunkelt und weichgezeichnet, mit weichen Kanten eingeblendet.
  let letzte = "grund";
  clipIndex.forEach((szeneIdx, n) => {
    const s = spez.szenen[szeneIdx];
    const start = Math.max(0, s.start);
    const ende = Math.min(dauer, s.ende);
    const laenge = Math.max(0.5, ende - start);
    const blende = Math.min(0.35, laenge / 3);
    filter.push(
      `[${3 + n}:v]scale=${VIDEO.breite}:${VIDEO.hoehe}:force_original_aspect_ratio=increase,` +
        `crop=${VIDEO.breite}:${VIDEO.hoehe},fps=${VIDEO.fps},` +
        `eq=brightness=-0.34:saturation=0.68:contrast=1.05,gblur=sigma=5,` +
        `trim=duration=${laenge.toFixed(2)},setpts=PTS-STARTPTS+${start.toFixed(2)}/TB,` +
        `format=yuva420p,` +
        `fade=t=in:st=${start.toFixed(2)}:d=${blende.toFixed(2)}:alpha=1,` +
        `fade=t=out:st=${(ende - blende).toFixed(2)}:d=${blende.toFixed(2)}:alpha=1,` +
        `setsar=1[br${n}]`,
    );
    filter.push(
      `[${letzte}][br${n}]overlay=0:0:eof_action=pass:` +
        `enable='between(t,${start.toFixed(2)},${ende.toFixed(2)})'[bg${n}]`,
    );
    letzte = `bg${n}`;
  });

  // Kartenebene darueber
  filter.push(`[2:v]fps=${VIDEO.fps},scale=${VIDEO.breite}:${VIDEO.hoehe},format=rgba,setsar=1[karten]`);
  filter.push(`[${letzte}][karten]overlay=0:0:format=auto:shortest=0[mitKarten]`);

  // Fortschrittsbalken: zeigt, wie kurz das Reel ist, und haelt bis zum Ende.
  const balkenBreite = 560;
  const balkenX = Math.round((VIDEO.breite - balkenBreite) / 2);
  const balkenY = LAYOUT.fortschrittY;
  const fortschritt =
    `drawbox=x=${balkenX}:y=${balkenY}:w=${balkenBreite}:h=5:color=white@0.18:t=fill,` +
    `drawbox=x=${balkenX}:y=${balkenY}:w='${balkenBreite}*min(t/${dauer},1)':h=5` +
    `:color=${ff(farben.gold)}@0.95:t=fill`;

  filter.push(
    `[mitKarten]subtitles=${assPfad}:fontsdir=assets/fonts,${fortschritt},format=yuv420p[v]`,
  );

  filter.push(
    `[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,` +
      `adelay=${Math.round(VIDEO.leadIn * 1000)}|${Math.round(VIDEO.leadIn * 1000)},apad[a0]`,
  );
  if (musik) {
    filter.push(`[${musikEingang}:a]volume=${VOICE.musikLautstaerke},aresample=44100[a1]`);
    filter.push(`[a0][a1]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95[a]`);
  } else {
    filter.push(`[a0]anull[a]`);
  }

  const ausgabe = path.posix.join(BUILD, "reel.mp4");
  args.push(
    "-filter_complex", filter.join(";"),
    "-map", "[v]",
    "-map", "[a]",
    "-t", String(dauer),
    "-c:v", "libx264",
    "-profile:v", "high",
    "-preset", VIDEO.preset,
    "-crf", String(VIDEO.crf),
    "-pix_fmt", "yuv420p",
    "-r", String(VIDEO.fps),
    "-g", String(VIDEO.fps * 2),
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    "-movflags", "+faststart",
    ausgabe,
  );

  const typen = spez.szenen.map((s) => s.typ).join(" > ");
  console.log(`  Rendere ${dauer}s | Schnitt: ${typen}`);
  if (clips.size) console.log(`  Filmmaterial in ${clips.size} Szene(n)`);
  if (musik) console.log(`  Musik: ${musik}`);
  await lauf("ffmpeg", args, { still: true });

  const groesse = fs.statSync(ausgabe).size;
  console.log(`  Fertig: ${ausgabe} (${(groesse / 1024 / 1024).toFixed(1)} MB)`);
  return { pfad: ausgabe, dauer, groesse, szenen: spez.szenen };
}
