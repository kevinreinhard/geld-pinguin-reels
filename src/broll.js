// Echtes Filmmaterial von Pexels - optional.
//
// Ohne PEXELS_API_KEY passiert hier nichts und das Reel laeuft auf seinem
// gezeichneten Hintergrund. Der Schluessel ist kostenlos (pexels.com/api),
// die Lizenz erlaubt die kommerzielle Nutzung ohne Namensnennung.
//
// Das Material laeuft nie im Vordergrund: Es wird abgedunkelt und weichgezeichnet
// hinter die Karte gelegt. Ein Stockvideo soll Bewegung ins Bild bringen, nicht
// mit der Aussage konkurrieren.

import fs from "node:fs";
import path from "node:path";

const BASIS = "https://api.pexels.com/videos/search";
const ABLAGE = "build/broll";

export function verfuegbar() {
  return Boolean(process.env.PEXELS_API_KEY);
}

/** Waehlt die Datei, die 1080x1920 am naechsten kommt, ohne unnoetig gross zu sein. */
function besteDatei(video) {
  const passend = (video.video_files ?? [])
    .filter((f) => f.height >= 960 && f.width && f.link)
    .sort((a, b) => {
      const hoch = (f) => (f.height >= f.width ? 0 : 1); // Hochformat zuerst
      return hoch(a) - hoch(b) || Math.abs(a.height - 1920) - Math.abs(b.height - 1920);
    });
  return passend[0] ?? null;
}

async function hole(url, optionen = {}) {
  const steuerung = AbortSignal.timeout(45000);
  const antwort = await fetch(url, { ...optionen, signal: steuerung });
  if (!antwort.ok) throw new Error(`${antwort.status} ${antwort.statusText}`);
  return antwort;
}

/**
 * Sucht einen Clip und legt ihn lokal ab.
 * @returns {Promise<string|null>} Pfad zur Datei oder null
 */
export async function ladeClip(suchwort, nr = 0) {
  if (!verfuegbar() || !suchwort) return null;
  fs.mkdirSync(ABLAGE, { recursive: true });

  try {
    const url =
      `${BASIS}?query=${encodeURIComponent(suchwort)}` +
      `&orientation=portrait&size=medium&per_page=12`;
    const antwort = await hole(url, { headers: { Authorization: process.env.PEXELS_API_KEY } });
    const daten = await antwort.json();

    // Sehr kurze Clips laufen im Reel sichtbar in die Schleife.
    const kandidaten = (daten.videos ?? []).filter((v) => v.duration >= 6);
    for (const video of kandidaten.slice(0, 4)) {
      const datei = besteDatei(video);
      if (!datei) continue;
      const ziel = path.posix.join(ABLAGE, `clip${nr}.mp4`);
      const roh = await hole(datei.link);
      const puffer = Buffer.from(await roh.arrayBuffer());
      if (puffer.length < 50_000) continue;
      fs.writeFileSync(ziel, puffer);
      console.log(`  B-Roll "${suchwort}": ${datei.width}x${datei.height}, ${(puffer.length / 1e6).toFixed(1)} MB`);
      return ziel;
    }
    console.log(`  B-Roll "${suchwort}": nichts Brauchbares gefunden.`);
  } catch (e) {
    // Fehlendes Stockmaterial darf einen Lauf nie kosten.
    console.warn(`  B-Roll "${suchwort}" uebersprungen: ${e.message}`);
  }
  return null;
}

/**
 * Holt fuer die Szenen mit Suchwort je einen Clip. Hoechstens zwei pro Reel -
 * mehr Downloads kosten Laufzeit, und zu viel Stockmaterial verwaessert den Look.
 */
export async function holeClips(szenen, maximal = 2) {
  if (!verfuegbar()) return new Map();
  const treffer = new Map();
  let nr = 0;
  for (const [i, s] of szenen.entries()) {
    if (treffer.size >= maximal) break;
    if (!s.bildsuche || !["hook", "stichwort"].includes(s.typ)) continue;
    const pfad = await ladeClip(s.bildsuche, nr++);
    if (pfad) treffer.set(i, pfad);
  }
  return treffer;
}
