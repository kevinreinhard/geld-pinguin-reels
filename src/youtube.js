/**
 * Zweitverwertung derselben Produktion als YouTube Short.
 *
 * Warum überhaupt: Instagram spielt ein Reel zuerst den eigenen Followern aus und
 * an Fremde erst, wenn diese erste Gruppe positiv reagiert. Bei fünf Followern
 * entsteht diese Gruppe nie. YouTube Shorts verteilt neue Kanäle dagegen von
 * Beginn an auch an Fremde. Das Video ist ohnehin fertig gerendert - es kostet
 * nichts, es dort ebenfalls anzubieten.
 *
 * Grundsatz: Ein Fehler hier darf den Instagram-Beitrag nie gefährden. Alles in
 * diesem Modul ist bestenfalls-Logik.
 */
import fs from "node:fs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

export const SCOPE = "https://www.googleapis.com/auth/youtube.upload";

/** Sind die Zugangsdaten hinterlegt? */
export function istEingerichtet() {
  return Boolean(
    process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN,
  );
}

/** Kurzlebiges Zugriffstoken aus dem dauerhaften Refresh-Token holen. */
async function zugriffstoken() {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.YT_CLIENT_ID,
      client_secret: process.env.YT_CLIENT_SECRET,
      refresh_token: process.env.YT_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) {
    throw new Error(
      `Google-Token abgelehnt (${res.status}): ${d.error_description ?? d.error ?? "unbekannt"}`,
    );
  }
  return d.access_token;
}

/** YouTube-Titel: max 100 Zeichen, keine spitzen Klammern. */
function baueTitel(skript) {
  const roh = skript.hook.replace(/[<>]/g, "").trim();
  const kurz = roh.length > 88 ? roh.slice(0, 85).replace(/\s+\S*$/, "") + "…" : roh;
  return `${kurz} #Shorts`;
}

function baueBeschreibung(skript, caption) {
  const gesprochen = [skript.hook, ...skript.body, skript.cta].join(" ");
  return [
    caption.split("\n")[0],
    "",
    gesprochen,
    "",
    "Keine Anlageberatung, nur Finanzbildung.",
    "",
    skript.hashtags.slice(0, 12).map((h) => "#" + h).join(" ") + " #Shorts",
  ]
    .join("\n")
    .slice(0, 4900);
}

/**
 * Lädt das Video hoch. Zweistufig (resumable): erst die Metadaten, dann die Bytes.
 * @returns {Promise<{videoId: string, url: string}>}
 */
export async function ladeShortHoch({ videoPfad, skript, caption }) {
  const token = await zugriffstoken();
  const daten = fs.readFileSync(videoPfad);

  const metadaten = {
    snippet: {
      title: baueTitel(skript),
      description: baueBeschreibung(skript, caption),
      // YouTube deckelt die Summe aller Tags bei 500 Zeichen.
      tags: skript.hashtags.slice(0, 15),
      categoryId: "27", // Bildung
      defaultLanguage: "de",
      defaultAudioLanguage: "de",
    },
    status: {
      privacyStatus: "public",
      selfDeclaredMadeForKids: false,
    },
  };

  const start = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(daten.length),
    },
    body: JSON.stringify(metadaten),
  });

  if (!start.ok) {
    throw new Error(`Upload-Start abgelehnt (${start.status}): ${(await start.text()).slice(0, 400)}`);
  }
  const ziel = start.headers.get("location");
  if (!ziel) throw new Error("YouTube hat keine Upload-Adresse zurückgegeben.");

  const hoch = await fetch(ziel, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(daten.length) },
    body: daten,
  });

  const antwort = await hoch.json().catch(() => ({}));
  if (!hoch.ok || !antwort.id) {
    throw new Error(
      `Upload fehlgeschlagen (${hoch.status}): ${antwort.error?.message ?? JSON.stringify(antwort).slice(0, 300)}`,
    );
  }

  return { videoId: antwort.id, url: `https://www.youtube.com/shorts/${antwort.id}` };
}
