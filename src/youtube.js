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

/**
 * Zwei Berechtigungen, nicht eine.
 *
 * youtube.upload allein erlaubt kein Auslesen des Kanals. Genau daran fiel am
 * 10.09. nicht auf, dass der Token am falschen Kanal hing: Der Testupload
 * landete in "Moto Reinhard AG" statt bei geld.pinguin, und gemerkt hat man es
 * erst an der Antwort - also nach dem Hochladen.
 *
 * Mit youtube.readonly lässt sich der Zielkanal vorher prüfen und der Upload
 * abbrechen, bevor etwas im falschen Kanal steht.
 */
export const SCOPE = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

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

/**
 * YouTube weist Titel und Beschreibungen mit spitzen Klammern ab.
 *
 * Am 10.09. haengte das Modell ein "</caption>" an die Caption. Der Upload
 * scheiterte mit "invalidDescription", waehrend der Instagram-Beitrag mit dem
 * sichtbaren Tag bereits draussen war. Bereinigt wird das inzwischen schon in
 * script.js - hier bleibt es als letzte Instanz stehen, weil ein einzelnes
 * Zeichen sonst den ganzen Zweitkanal kostet.
 */
const ohneKlammern = (t) =>
  String(t)
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/[<>]/g, "");

/** YouTube-Titel: max 100 Zeichen, keine spitzen Klammern. */
function baueTitel(skript) {
  const roh = ohneKlammern(skript.hook).trim();
  const kurz = roh.length > 88 ? roh.slice(0, 85).replace(/\s+\S*$/, "") + "…" : roh;
  return `${kurz} #Shorts`;
}

function baueBeschreibung(skript, caption) {
  const gesprochen = [skript.hook, ...skript.body, skript.cta].join(" ");
  return ohneKlammern(
    [
      caption.split("\n")[0],
      "",
      gesprochen,
      "",
      "Keine Anlageberatung, nur Finanzbildung.",
      "",
      skript.hashtags.slice(0, 12).map((h) => "#" + h).join(" ") + " #Shorts",
    ].join("\n"),
  ).slice(0, 4900);
}

/**
 * Lädt das Video hoch. Zweistufig (resumable): erst die Metadaten, dann die Bytes.
 * @returns {Promise<{videoId: string, url: string}>}
 */
/** Welcher Kanal hängt an diesem Token? */
export async function kanalInfo(token) {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const d = await res.json().catch(() => ({}));
  if (d.error) throw new Error(`Kanalabfrage fehlgeschlagen: ${d.error.message}`);
  const kanal = d.items?.[0];
  if (!kanal) throw new Error("Kein YouTube-Kanal für dieses Konto gefunden.");
  return { id: kanal.id, titel: kanal.snippet.title };
}

async function ytGet(pfad, params, token) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${pfad}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await res.json().catch(() => ({}));
  if (d.error) throw new Error(`${pfad}: ${d.error.message}`);
  return d;
}

/**
 * Kennzahlen des Kanals und aller Videos.
 *
 * Aufrufe und Abonnenten liefert die Data API mit dem vorhandenen
 * readonly-Bereich. Die eigentlich interessante Zahl - wie weit Zuschauer
 * kommen, bevor sie wegwischen - liefert erst die Analytics API. Die ist ein
 * eigener Dienst mit eigenem Bereich und wird hier nur versucht.
 */
export async function kennzahlen({ seit } = {}) {
  const token = await zugriffstoken();

  const ch = await ytGet(
    "channels",
    { part: "snippet,statistics,contentDetails", mine: "true" },
    token,
  );
  const k = ch.items?.[0];
  if (!k) throw new Error("Kein Kanal gefunden.");

  const playlist = k.contentDetails.relatedPlaylists.uploads;
  const eintraege = await ytGet(
    "playlistItems",
    { part: "contentDetails", maxResults: "50", playlistId: playlist },
    token,
  );
  const ids = (eintraege.items ?? []).map((i) => i.contentDetails.videoId);

  let videos = [];
  if (ids.length) {
    const v = await ytGet(
      "videos",
      { part: "snippet,statistics,contentDetails", id: ids.join(",") },
      token,
    );
    videos = (v.items ?? []).map((x) => ({
      id: x.id,
      titel: x.snippet.title,
      veroeffentlicht: x.snippet.publishedAt,
      alterTage: +((Date.now() - new Date(x.snippet.publishedAt)) / 864e5).toFixed(1),
      views: Number(x.statistics?.viewCount ?? 0),
      likes: Number(x.statistics?.likeCount ?? 0),
      kommentare: Number(x.statistics?.commentCount ?? 0),
      laenge: x.contentDetails?.duration ?? null,
    }));
  }

  // Wiedergabedaten je Video an die Videoliste heften. Erst damit laesst sich
  // sagen, welches Thema wirklich gehalten hat - die Kanalsumme mischt alte
  // und neue Inhalte und taugt dafuer nicht.
  const proVideo = await wiedergabeProVideo(token, seit);
  if (proVideo) {
    for (const v of videos) {
      const w = proVideo.get(v.id);
      if (w) Object.assign(v, w);
    }
  }

  return {
    kanal: {
      titel: k.snippet.title,
      abonnenten: Number(k.statistics?.subscriberCount ?? 0),
      videos: Number(k.statistics?.videoCount ?? 0),
      aufrufeGesamt: Number(k.statistics?.viewCount ?? 0),
    },
    videos,
    wiedergabe: await wiedergabedauer(token, seit),
  };
}

/**
 * Wiedergabedaten je Video. Gibt null zurueck, solange YouTube noch nichts
 * verarbeitet hat - die Auswertung braucht typischerweise ein bis zwei Tage.
 */
async function wiedergabeProVideo(token, seit) {
  const bis = new Date().toISOString().slice(0, 10);
  const von = seit ?? new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  for (const [k, v] of Object.entries({
    ids: "channel==MINE",
    startDate: von,
    endDate: bis,
    metrics: "views,averageViewPercentage,averageViewDuration",
    dimensions: "video",
    sort: "-views",
    maxResults: "50",
  })) {
    url.searchParams.set(k, v);
  }

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json().catch(() => ({}));
    if (d.error || !d.rows?.length) return null;
    return new Map(
      d.rows.map((r) => [
        r[0],
        { viewsAnalytics: r[1], anteilGesehenProzent: r[2], dauerSekunden: r[3] },
      ]),
    );
  } catch {
    return null;
  }
}

/**
 * Durchschnittliche Wiedergabedauer über die Analytics API.
 * Gibt null zurück, wenn der Dienst nicht aktiviert oder nicht freigegeben ist -
 * das darf die Messung nie zum Scheitern bringen.
 */
async function wiedergabedauer(token, seit) {
  const bis = new Date().toISOString().slice(0, 10);
  const von = seit ?? new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", von);
  url.searchParams.set("endDate", bis);
  url.searchParams.set(
    "metrics",
    "views,averageViewPercentage,averageViewDuration,subscribersGained",
  );

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const d = await res.json().catch(() => ({}));
    if (d.error) return { verfuegbar: false, grund: d.error.message.split(".")[0] };
    const zeile = d.rows?.[0];
    if (!zeile) return { verfuegbar: true, hinweis: "keine Daten im Zeitraum" };
    return {
      verfuegbar: true,
      zeitraum: `${von} bis ${bis}`,
      views: zeile[0],
      anteilGesehenProzent: zeile[1],
      dauerSekunden: zeile[2],
      neueAbonnenten: zeile[3],
    };
  } catch (e) {
    return { verfuegbar: false, grund: e.message.slice(0, 120) };
  }
}

/**
 * Bricht ab, wenn der Token nicht am erwarteten Kanal hängt.
 * Ohne gesetzte YT_CHANNEL_ID wird nur protokolliert - so bleibt die
 * Einrichtung möglich, ohne dass man die ID vorher kennen muss.
 */
async function pruefeZielkanal(token) {
  const kanal = await kanalInfo(token);
  const erwartet = process.env.YT_CHANNEL_ID;

  if (!erwartet) {
    console.log(`  Zielkanal: ${kanal.titel} (${kanal.id}) - ungeprüft, YT_CHANNEL_ID ist nicht gesetzt`);
    return kanal;
  }
  if (kanal.id !== erwartet) {
    throw new Error(
      `Falscher Zielkanal: Der Token gehört zu "${kanal.titel}" (${kanal.id}), ` +
        `erwartet war ${erwartet}. Es wurde nichts hochgeladen. ` +
        `Zugriff unter myaccount.google.com/permissions entziehen und neu anmelden, ` +
        `dabei den richtigen Kanal wählen.`,
    );
  }
  console.log(`  Zielkanal bestätigt: ${kanal.titel}`);
  return kanal;
}

export async function ladeShortHoch({ videoPfad, skript, caption }) {
  const token = await zugriffstoken();
  await pruefeZielkanal(token); // vor dem Upload, nicht danach
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
