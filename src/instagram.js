import { IG } from "./config.js";

/**
 * Veroeffentlichung ueber die Instagram API mit Instagram Login
 * (graph.instagram.com). Ablauf laut Content-Publishing-Doku:
 *   1. Container anlegen   POST /{ig-id}/media
 *   2. Status pollen       GET  /{container-id}?fields=status_code
 *   3. Veroeffentlichen    POST /{ig-id}/media_publish
 */

const BASIS = `${IG.apiBase}/${IG.apiVersion}`;

function token() {
  const t = process.env.IG_ACCESS_TOKEN;
  if (!t) throw new Error("IG_ACCESS_TOKEN ist nicht gesetzt - siehe SETUP.md.");
  return t;
}

async function graph(pfad, { method = "GET", params = {} } = {}) {
  const url = new URL(`${BASIS}/${pfad}`);
  const body = new URLSearchParams({ ...params, access_token: token() });

  const res =
    method === "GET"
      ? await fetch(`${url}?${body}`)
      : await fetch(url, {
          method,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });

  const daten = await res.json().catch(() => ({}));
  if (!res.ok || daten.error) {
    const e = daten.error ?? {};
    throw new Error(
      `Instagram API ${res.status} bei ${method} ${pfad}: ${e.message ?? JSON.stringify(daten)}` +
        (e.code ? ` (code ${e.code}${e.error_subcode ? "/" + e.error_subcode : ""})` : ""),
    );
  }
  return daten;
}

/** Ermittelt die eigene Instagram-Konto-ID (oder nimmt IG_USER_ID aus der Umgebung). */
export async function kontoId() {
  if (process.env.IG_USER_ID) return process.env.IG_USER_ID;
  const me = await graph("me", { params: { fields: "user_id,username" } });
  const id = me.user_id ?? me.id;
  if (!id) throw new Error(`Konnte die Konto-ID nicht ermitteln: ${JSON.stringify(me)}`);
  console.log(`  Konto: ${me.username ?? "?"} (${id})`);
  return String(id);
}

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));

async function warteAufContainer(containerId) {
  for (let i = 1; i <= IG.pollMaxVersuche; i++) {
    const { status_code, status } = await graph(containerId, {
      params: { fields: "status_code,status" },
    });

    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new Error(`Instagram konnte das Video nicht verarbeiten (${status_code}): ${status ?? ""}`);
    }
    if (i % 5 === 0) {
      console.log(`  Container ${containerId}: ${status_code} (${i * IG.pollIntervalMs / 1000}s)`);
    }
    await schlafen(IG.pollIntervalMs);
  }
  throw new Error("Zeitueberschreitung: Instagram hat das Video nicht rechtzeitig verarbeitet.");
}

/**
 * Veroeffentlicht ein Reel.
 * @returns {Promise<{mediaId: string, permalink: string|null}>}
 */
export async function veroeffentlicheReel({ videoUrl, caption }) {
  const id = await kontoId();

  console.log("  Lege Medien-Container an ...");
  const container = await graph(`${id}/media`, {
    method: "POST",
    params: {
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      share_to_feed: String(IG.shareToFeed),
      // Ohne thumb_offset nimmt Instagram Frame 0 - dort steht noch fast nichts im Bild.
      thumb_offset: String(IG.thumbOffsetMs),
    },
  });

  console.log(`  Container ${container.id} - warte auf die Verarbeitung ...`);
  await warteAufContainer(container.id);

  console.log("  Veroeffentliche ...");
  const publiziert = await graph(`${id}/media_publish`, {
    method: "POST",
    params: { creation_id: container.id },
  });

  let permalink = null;
  try {
    ({ permalink } = await graph(publiziert.id, { params: { fields: "permalink" } }));
  } catch {
    // Der Permalink ist unmittelbar nach dem Publish manchmal noch nicht da - nicht kritisch.
  }

  return { mediaId: publiziert.id, permalink };
}

/** Wie viele Beitraege im laufenden 24-Stunden-Fenster noch moeglich sind. */
export async function verbleibendesKontingent() {
  const id = await kontoId();
  try {
    const { data } = await graph(`${id}/content_publishing_limit`, {
      params: { fields: "config,quota_usage" },
    });
    const eintrag = data?.[0];
    if (!eintrag) return null;
    const limit = eintrag.config?.quota_total ?? 50;
    return { genutzt: eintrag.quota_usage ?? 0, limit };
  } catch {
    return null;
  }
}
