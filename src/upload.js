import fs from "node:fs";
import path from "node:path";

/**
 * Instagram holt das Video selbst per HTTPS ab - es braucht also eine oeffentlich
 * erreichbare URL. Zwei Backends:
 *   1. GitHub Release  (Standard, gratis, Repo muss oeffentlich sein)
 *   2. Cloudflare R2   (wenn R2_* gesetzt ist, funktioniert auch mit privatem Repo)
 */

const RELEASE_TAG = "reel-media";
const MAX_ASSETS = 24; // aeltere Videos werden aufgeraeumt

// ---------------------------------------------------------------- GitHub

function ghHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "geld-pinguin-reels",
    ...extra,
  };
}

async function ghJson(url, token, init = {}) {
  const res = await fetch(url, { ...init, headers: ghHeaders(token, init.headers) });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${res.status} ${url}\n${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : null;
}

async function holeOderErstelleRelease(repo, token) {
  const basis = `https://api.github.com/repos/${repo}`;
  const res = await fetch(`${basis}/releases/tags/${RELEASE_TAG}`, { headers: ghHeaders(token) });
  if (res.ok) return res.json();
  if (res.status !== 404) {
    throw new Error(`GitHub ${res.status} beim Lesen des Release: ${await res.text()}`);
  }
  return ghJson(`${basis}/releases`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: RELEASE_TAG,
      name: "Reel-Medien",
      body: "Automatisch erzeugte Reel-Dateien. Dient nur als oeffentlicher Ablageort fuer die Instagram-API.",
      prerelease: true,
    }),
  });
}

async function raeumeAuf(repo, token, release) {
  const alt = (release.assets ?? [])
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(0, Math.max(0, (release.assets?.length ?? 0) - MAX_ASSETS + 1));

  for (const asset of alt) {
    try {
      await ghJson(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, token, {
        method: "DELETE",
      });
      console.log(`  Alte Datei entfernt: ${asset.name}`);
    } catch (e) {
      console.warn(`  Konnte ${asset.name} nicht loeschen: ${e.message}`);
    }
  }
}

async function ladeZuGithub(datei, name) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    throw new Error(
      "GITHUB_REPOSITORY und GITHUB_TOKEN werden gebraucht (im Workflow automatisch gesetzt). " +
        "Lokal: setze die beiden Variablen oder konfiguriere stattdessen R2.",
    );
  }

  const release = await holeOderErstelleRelease(repo, token);
  await raeumeAuf(repo, token, release);

  // Gleichnamiges Asset zuerst entfernen, sonst lehnt GitHub den Upload ab
  const kollision = (release.assets ?? []).find((a) => a.name === name);
  if (kollision) {
    await ghJson(`https://api.github.com/repos/${repo}/releases/assets/${kollision.id}`, token, {
      method: "DELETE",
    });
  }

  const daten = fs.readFileSync(datei);
  const url = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: ghHeaders(token, {
      "Content-Type": "video/mp4",
      "Content-Length": String(daten.length),
    }),
    body: daten,
  });
  if (!res.ok) throw new Error(`Upload fehlgeschlagen (${res.status}): ${await res.text()}`);

  const asset = await res.json();
  return asset.browser_download_url;
}

// ---------------------------------------------------------------- Cloudflare R2

async function ladeZuR2(datei, name) {
  let S3;
  try {
    ({ S3Client: S3 } = await import("@aws-sdk/client-s3"));
  } catch {
    throw new Error("R2 konfiguriert, aber @aws-sdk/client-s3 fehlt. Installiere es mit: npm i @aws-sdk/client-s3");
  }
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");

  const client = new S3({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: name,
      Body: fs.readFileSync(datei),
      ContentType: "video/mp4",
    }),
  );

  return `${process.env.R2_PUBLIC_BASE.replace(/\/$/, "")}/${name}`;
}

// ---------------------------------------------------------------- oeffentlich

/** Prueft, dass Instagram die URL wirklich ohne Login erreichen kann. */
async function pruefeErreichbar(url) {
  const res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-1023" } });
  if (!res.ok) {
    throw new Error(
      `Die Video-URL ist nicht oeffentlich abrufbar (HTTP ${res.status}): ${url}\n` +
        "Bei GitHub Releases muss das Repository oeffentlich sein - sonst nutze das R2-Backend.",
    );
  }
  const typ = res.headers.get("content-type") ?? "";
  if (!/video|octet-stream/i.test(typ)) {
    console.warn(`  Warnung: unerwarteter Content-Type "${typ}" - Instagram akzeptiert das evtl. nicht.`);
  }
}

/**
 * Laedt das Video hoch und liefert die oeffentliche URL zurueck.
 */
export async function ladeHoch(datei) {
  const stempel = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `reel-${stempel}-${Math.random().toString(36).slice(2, 7)}${path.extname(datei)}`;

  const nutzeR2 = Boolean(process.env.R2_BUCKET && process.env.R2_ACCOUNT_ID && process.env.R2_PUBLIC_BASE);
  const url = nutzeR2 ? await ladeZuR2(datei, name) : await ladeZuGithub(datei, name);

  console.log(`  Oeffentliche URL: ${url}`);
  await pruefeErreichbar(url);
  return url;
}
