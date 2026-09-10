/**
 * Erzeugt das YouTube-Kanalbanner nach assets/youtube-banner.png.
 *
 *   node scripts/banner.js
 *
 * Bewusst dieselbe Bildsprache wie die Reels - Anton, dieselbe Palette, dasselbe
 * Gelb -, damit Kanalkopf und Videos als eine Sache erkennbar sind.
 *
 * Zu den Massen: YouTube verlangt 2560 x 1440, schneidet aber je nach Gerät
 * unterschiedlich zu. Garantiert sichtbar ist nur ein Bereich von 1546 x 423
 * Pixeln in der Mitte. Alles Wichtige liegt darin, die Raender bleiben leer.
 */
import fs from "node:fs";
import path from "node:path";
import { lauf } from "../src/render.js";

const BREITE = 2560;
const HOEHE = 1440;
const KERN = { breite: 1546, hoehe: 423 };

// ---------------------------------------------------------------- Inhalt
const TITEL = "GELD.PINGUIN";
const UNTERZEILE = "FINANZWISSEN FÜR DEUTSCHLAND — JEDEN TAG IN 25 SEKUNDEN";

const FARBEN = {
  c0: "0x060C14",
  c1: "0x0E3358",
  c2: "0x10707A",
  c3: "0x060C14",
  akzent: "0xFFE733",
};

const ZIEL = path.posix.join("assets", "youtube-banner.png");
const TMP = "build";

async function main() {
  fs.mkdirSync(TMP, { recursive: true });

  // Text ueber Dateien statt ueber die Kommandozeile: sonst zerlegt die Shell
  // je nach Plattform die Umlaute.
  const titelDatei = path.posix.join(TMP, "banner-titel.txt");
  const subDatei = path.posix.join(TMP, "banner-sub.txt");
  fs.writeFileSync(titelDatei, TITEL + "\n", "utf8");
  fs.writeFileSync(subDatei, UNTERZEILE + "\n", "utf8");

  const font = "assets/fonts/Anton-Regular.ttf";
  if (!fs.existsSync(font)) {
    throw new Error(`${font} fehlt. Einmal herunterladen: siehe .github/workflows/reel.yml`);
  }

  const verlauf =
    `gradients=s=${BREITE}x${HOEHE}:c0=${FARBEN.c0}:c1=${FARBEN.c1}:c2=${FARBEN.c2}` +
    `:c3=${FARBEN.c3}:n=4:type=linear:x0=0:y0=${HOEHE}:x1=${BREITE}:y1=0:speed=0:d=1,format=rgb24`;

  const filter = [
    "eq=brightness=-0.09:saturation=1.15",
    "vignette=PI/5",
    `drawtext=fontfile=${font}:textfile=${titelDatei}:fontsize=172:fontcolor=white` +
      `:x=(w-text_w)/2:y=566:shadowcolor=black@0.55:shadowx=0:shadowy=7`,
    `drawbox=x=(iw-620)/2:y=784:w=620:h=8:color=${FARBEN.akzent}@0.95:t=fill`,
    `drawtext=fontfile=${font}:textfile=${subDatei}:fontsize=54:fontcolor=0xFFFFFF@0.92` +
      `:x=(w-text_w)/2:y=828:shadowcolor=black@0.45:shadowx=0:shadowy=3`,
  ].join(",");

  await lauf(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y",
     "-f", "lavfi", "-i", verlauf, "-frames:v", "1", "-vf", filter, ZIEL],
    { still: true },
  );

  // Kontrollbild: markiert den auf allen Geraeten sichtbaren Bereich.
  const x = Math.round((BREITE - KERN.breite) / 2);
  const y = Math.round((HOEHE - KERN.hoehe) / 2);
  await lauf(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-i", ZIEL,
     "-vf", `drawbox=x=${x}:y=${y}:w=${KERN.breite}:h=${KERN.hoehe}:color=0xFF0000@0.8:t=4,scale=1280:-1`,
     path.posix.join(TMP, "banner-kontrolle.png")],
    { still: true },
  );

  const kb = Math.round(fs.statSync(ZIEL).size / 1024);
  console.log(`  ${ZIEL} - ${BREITE}x${HOEHE}, ${kb} KB (YouTube-Grenze: 6 MB)`);
  console.log(`  ${TMP}/banner-kontrolle.png - sichtbarer Bereich rot markiert`);
}

main().catch((e) => {
  console.error("FEHLER: " + e.message);
  process.exitCode = 1;
});
