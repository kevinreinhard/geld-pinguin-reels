/**
 * Holt die Kennzahlen aller Beiträge von Instagram und schreibt sie als
 * Zeitreihe nach data/performance.json.
 *
 * Zeitreihe, nicht Momentaufnahme: Ein Reel sammelt über Tage weiter Views.
 * Nur wenn man denselben Beitrag mehrfach misst, lässt sich später sagen, ob
 * ein Thema wirklich besser lief oder nur länger Zeit hatte.
 */
import fs from "node:fs";
import path from "node:path";
import { IG } from "../src/config.js";

const BASIS = `${IG.apiBase}/${IG.apiVersion}`;
const PFAD = path.resolve("data/performance.json");
const METRIKEN = ["views", "reach", "total_interactions", "likes", "comments", "saved", "shares"];

function token() {
  const t = process.env.IG_ACCESS_TOKEN;
  if (!t) throw new Error("IG_ACCESS_TOKEN ist nicht gesetzt.");
  return t;
}

async function graph(pfad, params = {}) {
  const url = new URL(`${BASIS}/${pfad}`);
  for (const [k, v] of Object.entries({ ...params, access_token: token() })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  const daten = await res.json().catch(() => ({}));
  if (daten.error) {
    const e = daten.error;
    throw new Error(`Instagram ${res.status} bei ${pfad}: ${e.message} (code ${e.code})`);
  }
  return daten;
}

/** Alle Beiträge, über Seiten hinweg. */
async function alleBeitraege(limit = 100) {
  const felder = "id,media_type,media_product_type,timestamp,permalink,caption,like_count,comments_count";
  let seite = await graph("me/media", { fields: felder, limit: 50 });
  const alle = [...(seite.data ?? [])];

  while (seite.paging?.next && alle.length < limit) {
    const res = await fetch(seite.paging.next);
    seite = await res.json();
    if (seite.error) break;
    alle.push(...(seite.data ?? []));
  }
  return alle.slice(0, limit);
}

/** Kennzahlen eines Beitrags. Fehlt eine Metrik, wird sie weggelassen statt zu scheitern. */
async function kennzahlen(mediaId) {
  try {
    const { data } = await graph(`${mediaId}/insights`, { metric: METRIKEN.join(",") });
    return Object.fromEntries((data ?? []).map((m) => [m.name, m.values?.[0]?.value ?? 0]));
  } catch {
    // Sehr frische oder sehr alte Beiträge liefern gelegentlich keine Insights.
    return {};
  }
}

function ladeVerlauf() {
  try {
    const d = JSON.parse(fs.readFileSync(PFAD, "utf8"));
    return Array.isArray(d.messungen) ? d.messungen : [];
  } catch {
    return [];
  }
}

async function main() {
  const konto = await graph("me", {
    fields: "username,followers_count,follows_count,media_count",
  });

  const beitraege = await alleBeitraege();
  console.log(`  ${beitraege.length} Beiträge gefunden, hole Kennzahlen ...`);

  const gemessen = [];
  for (const b of beitraege) {
    const k = await kennzahlen(b.id);
    gemessen.push({
      id: b.id,
      typ: b.media_product_type ?? b.media_type,
      veroeffentlicht: b.timestamp,
      permalink: b.permalink,
      caption: (b.caption ?? "").split("\n")[0].slice(0, 120),
      likes: b.like_count ?? 0,
      kommentare: b.comments_count ?? 0,
      ...k,
    });
  }

  const messung = {
    zeitpunkt: new Date().toISOString(),
    konto: {
      follower: konto.followers_count ?? null,
      folgt: konto.follows_count ?? null,
      beitraege: konto.media_count ?? null,
    },
    beitraege: gemessen,
  };

  const verlauf = ladeVerlauf();
  verlauf.push(messung);

  // Ein Jahr wöchentlicher Messungen reicht; danach fällt die älteste raus.
  const gekuerzt = verlauf.slice(-60);

  fs.mkdirSync(path.dirname(PFAD), { recursive: true });
  fs.writeFileSync(PFAD, JSON.stringify({ messungen: gekuerzt }, null, 1) + "\n", "utf8");

  const views = gemessen.reduce((a, b) => a + (b.views ?? 0), 0);
  const reels = gemessen.filter((b) => b.typ === "REELS");
  console.log(
    `  Gespeichert: ${gemessen.length} Beiträge (${reels.length} Reels), ` +
      `${views} Views gesamt, ${konto.followers_count} Follower. ` +
      `${gekuerzt.length}. Messung im Verlauf.`,
  );
}

main().catch((e) => {
  console.error("FEHLER: " + e.message);
  process.exit(1);
});
