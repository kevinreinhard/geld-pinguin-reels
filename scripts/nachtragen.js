/**
 * Traegt bereits veroeffentlichte Reels nachtraeglich als YouTube Shorts nach.
 *
 *   node scripts/nachtragen.js [anzahl]
 *
 * Warum ueberhaupt: Auf Instagram liegen Dutzende fertige Reels, die dort
 * niemand gesehen hat, weil dem Konto das Publikum fehlt. YouTube spielt auch
 * neue Kanaele an Fremde aus - dieselben Videos bekommen dort eine Chance.
 *
 * Der urspruengliche Rueckstand von 19 Reels ist am 10.09. abgearbeitet worden,
 * alle in einem Durchgang. Der dafuer gebaute taegliche Workflow wurde danach
 * entfernt - er haette nur noch leer gedreht.
 *
 * Das Skript bleibt als Werkzeug fuer den Wiederholungsfall: Faellt der
 * YouTube-Upload ueber mehrere Tage aus, etwa wegen eines abgelaufenen Tokens,
 * holt "npm run nachtragen" die entstandene Luecke nach. Es nimmt sich nur, was
 * in der Historie kein youtubeId hat.
 *
 * Das Skript ist wiederholbar: Bereits nachgetragene Reels traegt es nicht
 * erneut nach, erkennbar an youtubeId in der Historie.
 */
import fs from "node:fs";
import path from "node:path";
import { IG } from "../src/config.js";
import { ladeHistorie } from "../src/history.js";
import { istEingerichtet as youtubeBereit, ladeShortHoch } from "../src/youtube.js";

const HISTORIE = path.resolve("data/history.json");
const TMP = "build/nachtrag";
const STANDARD_ANZAHL = 5;
const PAUSE_MS = 20000; // Abstand zwischen Uploads

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

/** Alle Videodateien des Releases, samt Zeitstempel aus dem Dateinamen. */
async function releaseDateien() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo) throw new Error("GITHUB_REPOSITORY ist nicht gesetzt.");

  const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/reel-media`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "geld-pinguin-reels",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`Release nicht lesbar (${res.status})`);
  const release = await res.json();

  return (release.assets ?? [])
    .filter((a) => a.name.endsWith(".mp4"))
    .map((a) => {
      // reel-2026-09-10T17-36-27-abcde.mp4
      const m = a.name.match(/reel-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
      const zeit = m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : null;
      return { name: a.name, url: a.browser_download_url, zeit };
    })
    .filter((a) => a.zeit);
}

/** Die Datei, die zeitlich am besten zu einem Beitrag passt. */
function passendeDatei(dateien, post) {
  const ziel = new Date(post.zeit).getTime();
  let beste = null;
  let abstand = Infinity;
  for (const d of dateien) {
    const diff = Math.abs(d.zeit.getTime() - ziel);
    if (diff < abstand) {
      abstand = diff;
      beste = d;
    }
  }
  // Die Datei entsteht unmittelbar vor dem Posten. Mehr als 15 Minuten
  // Unterschied heisst: Das ist ein anderes Video.
  return abstand <= 15 * 60000 ? beste : null;
}

/** Die veroeffentlichte Instagram-Caption - fuer die alten Reels die einzige Quelle. */
async function captionVonInstagram(mediaId) {
  const url = new URL(`${IG.apiBase}/${IG.apiVersion}/${mediaId}`);
  url.searchParams.set("fields", "caption");
  url.searchParams.set("access_token", process.env.IG_ACCESS_TOKEN);
  const res = await fetch(url);
  const d = await res.json().catch(() => ({}));
  return d.caption ?? "";
}

async function ladeDatei(url, ziel) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  fs.writeFileSync(ziel, Buffer.from(await res.arrayBuffer()));
  return ziel;
}

function speichereHistorie(posts) {
  fs.writeFileSync(HISTORIE, JSON.stringify({ posts }, null, 2) + "\n", "utf8");
}

async function main() {
  if (!youtubeBereit()) throw new Error("YouTube ist nicht eingerichtet.");
  const anzahl = Number(process.argv[2]) || STANDARD_ANZAHL;

  const posts = ladeHistorie();
  const offen = posts.filter((p) => !p.youtubeId && p.mediaId);

  console.log(`  ${posts.length} Reels in der Historie, ${offen.length} ohne YouTube-Fassung`);
  if (!offen.length) {
    console.log("  Rückstand abgearbeitet - nichts zu tun.");
    return;
  }

  const dateien = await releaseDateien();
  console.log(`  ${dateien.length} Videodateien im Release`);
  fs.mkdirSync(TMP, { recursive: true });

  let erledigt = 0;
  let uebersprungen = 0;

  for (const post of offen) {
    if (erledigt >= anzahl) break;

    const datei = passendeDatei(dateien, post);
    if (!datei) {
      console.log(`  ${post.title}: keine Videodatei mehr vorhanden, übersprungen`);
      uebersprungen++;
      continue;
    }

    try {
      const pfad = await ladeDatei(datei.url, path.posix.join(TMP, datei.name));
      const caption = await captionVonInstagram(post.mediaId);

      // Fuer alte Beitraege gibt es nur Titel und Hook in der Historie.
      // Die Instagram-Caption liefert den Rest.
      const skript = {
        hook: post.hook ?? post.title,
        body: [],
        cta: "",
        hashtags: (caption.match(/#[\wäöüÄÖÜß]+/g) ?? [])
          .map((h) => h.slice(1))
          .slice(0, 12),
      };

      const r = await ladeShortHoch({ videoPfad: pfad, skript, caption });
      post.youtubeId = r.videoId;
      post.youtubeUrl = r.url;
      post.nachgetragen = new Date().toISOString();
      speichereHistorie(posts); // nach jedem Upload, nicht erst am Ende
      erledigt++;
      console.log(`  ${erledigt}/${anzahl}  ${post.title} -> ${r.url}`);

      fs.rmSync(pfad, { force: true });
      if (erledigt < anzahl) await schlafen(PAUSE_MS);
    } catch (e) {
      console.warn(`  ${post.title}: ${e.message.slice(0, 160)}`);
      // Kontingent erschoepft - weitere Versuche waeren sinnlos.
      if (/quota/i.test(e.message)) {
        console.warn("  Tageskontingent erreicht, Abbruch.");
        break;
      }
      uebersprungen++;
    }
  }

  const rest = posts.filter((p) => !p.youtubeId && p.mediaId).length;
  console.log(`\n  Nachgetragen: ${erledigt} | Übersprungen: ${uebersprungen} | Rest: ${rest}`);
}

main().catch((e) => {
  console.error("FEHLER: " + e.message);
  process.exitCode = 1;
});
