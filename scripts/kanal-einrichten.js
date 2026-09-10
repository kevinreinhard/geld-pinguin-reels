/**
 * Einmalige Kanaleinrichtung: Banner hochladen und Beschreibung setzen.
 *
 *   YT_CLIENT_ID=... YT_CLIENT_SECRET=... node scripts/kanal-einrichten.js
 *
 * Warum ein eigenes Skript statt eines Schritts in der Automatisierung:
 * channels.update verlangt den Bereich "youtube" - Vollzugriff auf den Kanal,
 * inklusive Videos löschen. Der Tagesbetrieb braucht das nie; er kommt mit
 * upload und readonly aus, und genau dieser enge Zuschnitt hat verhindert,
 * dass der falsche Kanal unbemerkt bespielt wurde.
 *
 * Deshalb holt dieses Skript eine eigene, breitere Zustimmung, benutzt sie
 * einmal und wirft den Token weg. Gespeichert wird nichts. Danach den Zugriff
 * unter myaccount.google.com/permissions wieder entziehen und - falls nötig -
 * die Automatisierung neu anmelden.
 */
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";

const PORT = 8766; // nicht 8765, damit sich beide Skripte nie in die Quere kommen
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/youtube";

const CLIENT_ID = process.env.YT_CLIENT_ID;
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET;
const ERWARTETER_KANAL = process.env.YT_CHANNEL_ID || null;

const BANNER = "assets/youtube-banner.png";
const BESCHREIBUNG = "assets/youtube-beschreibung.txt";
const KEYWORDS = "assets/youtube-keywords.txt";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("FEHLER: YT_CLIENT_ID und YT_CLIENT_SECRET müssen gesetzt sein.");
  process.exit(1);
}
for (const p of [BANNER, BESCHREIBUNG, KEYWORDS]) {
  if (!fs.existsSync(p)) {
    console.error(`FEHLER: ${p} fehlt.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- OAuth

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "online", // kein Refresh-Token: der Zugriff soll nicht bleiben
    prompt: "consent",
  });

function oeffneImBrowser(url) {
  // URL in Anführungszeichen, sonst trennt cmd.exe unter Windows an jedem "&".
  const befehl =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  try {
    spawn(befehl, { shell: true, stdio: "ignore", detached: true }).unref();
  } catch {
    /* egal - die Adresse steht im Terminal */
  }
}

function holeZustimmung() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, REDIRECT);
      const code = url.searchParams.get("code");
      const fehler = url.searchParams.get("error");
      if (!code && !fehler) return res.writeHead(404).end();

      res.writeHead(fehler ? 400 : 200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<meta charset="utf-8"><body style="font-family:system-ui;padding:3rem">` +
          `<h1 style="font-size:1.3rem">${fehler ? "Abgebrochen" : "Geschafft"}</h1>` +
          `<p>${fehler ? "Google meldet: " + fehler : "Weiter im Terminal. Dieses Fenster kannst du schliessen."}</p>`,
      );
      server.close();
      if (fehler) return reject(new Error(`Zustimmung verweigert: ${fehler}`));

      const antwort = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT,
          grant_type: "authorization_code",
        }),
      });
      const d = await antwort.json();
      if (!d.access_token) return reject(new Error(`Kein Token: ${JSON.stringify(d)}`));
      resolve(d.access_token);
    });

    server.listen(PORT, () => {
      console.log("Öffne die Zustimmungsseite ...\n");
      console.log("Falls sie sich nicht öffnet, diese Adresse vollständig aufrufen:\n");
      console.log(authUrl + "\n");
      oeffneImBrowser(authUrl);
    });
  });
}

// ---------------------------------------------------------------- YouTube

async function api(pfad, { method = "GET", token, body, params = {} } = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${pfad}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (d.error) throw new Error(`${pfad}: ${d.error.message}`);
  return d;
}

async function ladeBannerHoch(token) {
  const daten = fs.readFileSync(BANNER);
  const res = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/channelBanners/insert?uploadType=media",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
      body: daten,
    },
  );
  const d = await res.json().catch(() => ({}));
  if (d.error) throw new Error(`Banner-Upload: ${d.error.message}`);
  if (!d.url) throw new Error(`Banner-Upload lieferte keine Adresse: ${JSON.stringify(d).slice(0, 200)}`);
  console.log(`  Banner hochgeladen (${Math.round(daten.length / 1024)} KB)`);
  return d.url;
}

async function main() {
  const token = await holeZustimmung();
  console.log("\nZustimmung erhalten.\n");

  // Immer zuerst prüfen, welcher Kanal am Token hängt.
  const eigene = await api("channels", {
    token,
    params: { part: "snippet,brandingSettings", mine: "true" },
  });
  const kanal = eigene.items?.[0];
  if (!kanal) throw new Error("Kein Kanal für dieses Konto gefunden.");

  console.log(`  Kanal: ${kanal.snippet.title} (${kanal.id})`);
  if (ERWARTETER_KANAL && kanal.id !== ERWARTETER_KANAL) {
    throw new Error(
      `Falscher Kanal. Erwartet war ${ERWARTETER_KANAL}. Es wurde nichts geändert.`,
    );
  }

  const bannerUrl = await ladeBannerHoch(token);

  const beschreibung = fs.readFileSync(BESCHREIBUNG, "utf8").trim();
  const keywords = fs.readFileSync(KEYWORDS, "utf8").trim();

  await api("channels", {
    method: "PUT",
    token,
    params: { part: "brandingSettings" },
    body: {
      id: kanal.id,
      brandingSettings: {
        channel: {
          ...kanal.brandingSettings?.channel,
          description: beschreibung,
          keywords,
        },
        image: { bannerExternalUrl: bannerUrl },
      },
    },
  });

  console.log(`  Beschreibung gesetzt (${beschreibung.length} Zeichen)`);
  console.log(`  Keywords gesetzt (${keywords.split(/\s+/).length} Einträge)`);
  console.log(`\nFertig: https://www.youtube.com/channel/${kanal.id}`);
  console.log(
    "\nDer erweiterte Zugriff wird nicht gespeichert. Entziehe ihn zur Sicherheit unter",
  );
  console.log("https://myaccount.google.com/permissions und melde die Automatisierung neu an.");
}

main().catch((e) => {
  console.error("\nFEHLER: " + e.message);
  process.exitCode = 1;
});
