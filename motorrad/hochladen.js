/**
 * Lädt ein fertiges Video auf den Kanal Motorrad Kompass.
 *
 *   node motorrad/hochladen.js <Ordner mit video.mp4, thumbnail.jpg, meta.json> [private|unlisted|public] [Zeitpunkt]
 *
 * Mit Zeitpunkt (ISO, z. B. 2026-11-14T11:00:00Z) bleibt das Video bis dahin privat und wird dann
 * von YouTube selbst veroeffentlicht. Ohne thumbnail.jpg (Shorts) bleibt das Vorschaubild weg.
 *
 * Braucht YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN und YT_CHANNEL_ID
 * (im Workflow aus den *_MOTORRAD-Secrets). Vor dem Upload wird der Zielkanal
 * geprüft: Am 10.09. landete ein Testupload im Firmenkanal, weil niemand
 * nachgesehen hatte, an welchem Kanal das Token hing.
 */
import fs from "node:fs";
import path from "node:path";

const ordner = process.argv[2];
const sichtbarkeit = process.argv[3] || "private";
const geplant = process.argv[4] || "";
if (!ordner || !["private", "unlisted", "public"].includes(sichtbarkeit)) {
  console.error("Aufruf: node motorrad/hochladen.js <Ordner> [private|unlisted|public]");
  process.exit(1);
}
for (const n of ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN", "YT_CHANNEL_ID"]) {
  if (!process.env[n]) {
    console.error(`FEHLER: ${n} fehlt.`);
    process.exit(1);
  }
}

async function json(res, was) {
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${was} (${res.status}): ${d.error?.message ?? d.error_description ?? d.error ?? "unbekannt"}`);
  return d;
}

async function main() {
  const meta = JSON.parse(fs.readFileSync(path.join(ordner, "meta.json"), "utf8"));
  const video = fs.readFileSync(path.join(ordner, "video.mp4"));

  const { access_token: token } = await json(
    await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.YT_CLIENT_ID,
        client_secret: process.env.YT_CLIENT_SECRET,
        refresh_token: process.env.YT_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    }),
    "Google-Token abgelehnt",
  );
  const auth = { Authorization: `Bearer ${token}` };

  const kanal = await json(
    await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: auth }),
    "Kanalabfrage",
  );
  const ziel = kanal.items?.[0];
  if (ziel?.id !== process.env.YT_CHANNEL_ID) {
    throw new Error(`Token hängt an Kanal «${ziel?.snippet?.title}» (${ziel?.id}), erwartet ${process.env.YT_CHANNEL_ID}. Kein Upload.`);
  }
  console.log(`Zielkanal: ${ziel.snippet.title} – ${(video.length / 1e6).toFixed(0)} MB, Sichtbarkeit ${geplant ? "geplant auf " + geplant : sichtbarkeit}`);

  // Zweistufig (resumable): erst die Angaben, dann die Datei an die zurückgegebene Adresse.
  const start = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(video.length),
      },
      body: JSON.stringify({
        snippet: {
          title: meta.titel.slice(0, 100),
          description: meta.beschreibung.slice(0, 4950),
          tags: meta.tags,
          categoryId: "2", // Autos & Fahrzeuge
          defaultLanguage: "de",
          defaultAudioLanguage: "de",
        },
        status: {
          ...(geplant ? { privacyStatus: "private", publishAt: geplant } : { privacyStatus: sichtbarkeit }),
          selfDeclaredMadeForKids: false,
          embeddable: true,
        },
      }),
    },
  );
  if (!start.ok) await json(start, "Upload-Anmeldung");
  const adresse = start.headers.get("location");
  if (!adresse) throw new Error("YouTube hat keine Upload-Adresse geliefert.");

  const fertig = await json(
    await fetch(adresse, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: video }),
    "Video-Upload",
  );
  console.log(`Hochgeladen: https://www.youtube.com/watch?v=${fertig.id} (Status laut YouTube: ${fertig.status?.privacyStatus})`);

  // Das Vorschaubild braucht einen per Telefon bestätigten Kanal. Fehlt das, bleibt das Video trotzdem oben.
  let vorschaubild = "gesetzt";
  try {
    await json(
      await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${fertig.id}&uploadType=media`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "image/jpeg" },
        body: fs.readFileSync(path.join(ordner, "thumbnail.jpg")),
      }),
      "Vorschaubild",
    );
  } catch (e) {
    vorschaubild = `nicht gesetzt – ${e.message}`;
  }
  console.log(`Vorschaubild: ${vorschaubild}`);

  fs.writeFileSync(
    path.join(ordner, "upload.json"),
    JSON.stringify(
      { thema: meta.thema, titel: meta.titel, youtubeId: fertig.id, sichtbarkeit: fertig.status?.privacyStatus, geplant: fertig.status?.publishAt, vorschaubild, zeit: new Date().toISOString() },
      null,
      1,
    ),
  );
}

main().catch((e) => {
  console.error("FEHLER:", e.message);
  process.exit(1);
});
