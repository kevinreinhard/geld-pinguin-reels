import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { baueAss } from "./ass.js";
import { CAPTIONS, CHANNEL, PALETTEN, VIDEO, VOICE } from "./config.js";

const BUILD = "build";

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
    [/inter/i, "Inter"],
    [/oswald/i, "Oswald"],
  ];
  for (const d of dateien) {
    for (const [muster, name] of treffer) if (muster.test(d)) return name;
  }
  return "DejaVu Sans"; // ueberall verfuegbar, sieht mit dickem Outline gut aus
}

function zufall(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Eigener Clip aus assets/backgrounds, sonst null. */
function eigenerHintergrund() {
  const dir = "assets/backgrounds";
  if (!fs.existsSync(dir)) return null;
  const clips = fs
    .readdirSync(dir)
    .filter((f) => /\.(mp4|mov|webm|mkv)$/i.test(f))
    .map((f) => path.posix.join(dir, f));
  return clips.length ? zufall(clips) : null;
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

/**
 * Rendert das fertige Reel.
 * @returns {Promise<{pfad: string, dauer: number}>}
 */
export async function rendere({ skript, voicePfad, wordsPfad, text }) {
  const words = JSON.parse(fs.readFileSync(wordsPfad, "utf8"));
  const stimmDauer = await audioDauer(voicePfad);
  const dauer = +(VIDEO.leadIn + stimmDauer + VIDEO.tail).toFixed(2);

  if (dauer < VIDEO.minDauer || dauer > VIDEO.maxDauer) {
    throw new Error(
      `Videolaenge ${dauer}s liegt ausserhalb von ${VIDEO.minDauer}-${VIDEO.maxDauer}s.`,
    );
  }

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

  const clip = eigenerHintergrund();
  const musik = musikSpur();

  // --- Inputs ---
  const args = ["-hide_banner", "-loglevel", "warning", "-y"];
  args.push("-i", voicePfad); // 0 = Stimme

  if (clip) {
    args.push("-stream_loop", "-1", "-i", clip); // 1 = eigener Hintergrund
  } else {
    const p = zufall(PALETTEN);
    // Groesser rendern als das Ziel, damit unten ein driftender Ausschnitt moeglich ist.
    const gradient =
      `gradients=s=1350x2400:c0=${p.c0}:c1=${p.c1}:c2=${p.c2}` +
      `:n=3:type=${p.type}:speed=0.02:d=30:r=${VIDEO.fps}:seed=${Math.floor(Math.random() * 1e6)}`;
    args.push("-f", "lavfi", "-t", String(dauer), "-i", gradient); // 1 = Verlauf
  }

  if (musik) args.push("-stream_loop", "-1", "-i", musik); // 2 = Musik

  // --- Filter ---
  // Ein voellig statisches Bild laesst Zuschauer frueh wegwischen. Der Ausschnitt
  // driftet darum langsam ueber den groesseren Verlauf - unaufdringlich, aber es bewegt sich.
  const bgFilter = clip
    ? `[1:v]scale=${VIDEO.breite}:${VIDEO.hoehe}:force_original_aspect_ratio=increase,` +
      `crop=${VIDEO.breite}:${VIDEO.hoehe},fps=${VIDEO.fps},eq=brightness=-0.12:saturation=1.05,setsar=1[bgv]`
    : `[1:v]crop=${VIDEO.breite}:${VIDEO.hoehe}:` +
      `x='(in_w-out_w)/2+95*sin(t/9)':y='(in_h-out_h)/2+115*sin(t/13+1)',` +
      `format=yuv420p,eq=brightness=-0.04:saturation=1.25,vignette=PI/4,setsar=1[bgv]`;

  // Fortschrittsbalken: zeigt, wie kurz das Reel ist, und haelt Zuschauer bis zum Ende.
  const balkenBreite = 620;
  const balkenX = Math.round((VIDEO.breite - balkenBreite) / 2);
  const balkenY = CAPTIONS.fortschrittY;
  const fortschritt =
    `drawbox=x=${balkenX}:y=${balkenY}:w=${balkenBreite}:h=6:color=white@0.22:t=fill,` +
    `drawbox=x=${balkenX}:y=${balkenY}:w='${balkenBreite}*min(t/${dauer},1)':h=6:color=0xFFE733@0.95:t=fill`;

  const filter = [
    bgFilter,
    `[bgv]subtitles=${assPfad}:fontsdir=assets/fonts,${fortschritt}[v]`,
    `[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100,` +
      `adelay=${Math.round(VIDEO.leadIn * 1000)}|${Math.round(VIDEO.leadIn * 1000)},apad[a0]`,
  ];

  if (musik) {
    filter.push(`[2:a]volume=${VOICE.musikLautstaerke},aresample=44100[a1]`);
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

  console.log(
    `  Rendere ${dauer}s | Font: ${fontname} | Hintergrund: ${clip ?? "Verlauf (prozedural)"}` +
      `${musik ? " | Musik: " + musik : ""}`,
  );
  await lauf("ffmpeg", args, { still: true });

  const groesse = fs.statSync(ausgabe).size;
  console.log(`  Fertig: ${ausgabe} (${(groesse / 1024 / 1024).toFixed(1)} MB)`);
  return { pfad: ausgabe, dauer, groesse };
}
