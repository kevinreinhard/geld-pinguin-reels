/**
 * Einmalige Anmeldung bei Google, um den dauerhaften Refresh-Token zu erhalten.
 *
 *   YT_CLIENT_ID=... YT_CLIENT_SECRET=... node scripts/youtube-auth.js
 *
 * Öffnet die Zustimmungsseite, fängt die Rückleitung auf localhost ab und gibt
 * den Refresh-Token aus. Der Token wird hier bewusst NICHT gespeichert - er
 * gehört in ein GitHub-Secret, nicht in eine Datei im Repository.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { SCOPE } from "../src/youtube.js";

const PORT = 8765;
const REDIRECT = `http://localhost:${PORT}`;

const CLIENT_ID = process.env.YT_CLIENT_ID;
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "FEHLER: YT_CLIENT_ID und YT_CLIENT_SECRET müssen gesetzt sein.\n\n" +
      "PowerShell:\n" +
      '  $env:YT_CLIENT_ID="..."; $env:YT_CLIENT_SECRET="..."; node scripts/youtube-auth.js',
  );
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    // Beides ist nötig, damit Google überhaupt einen Refresh-Token herausgibt:
    // offline für die Dauerhaftigkeit, consent damit er auch beim zweiten
    // Anlauf neu ausgestellt wird statt stillschweigend zu fehlen.
    access_type: "offline",
    prompt: "consent",
  });

const seite = (titel, text) =>
  `<!doctype html><meta charset="utf-8"><title>${titel}</title>` +
  `<body style="font-family:system-ui;padding:3rem;max-width:34rem;line-height:1.6">` +
  `<h1 style="font-size:1.4rem">${titel}</h1><p>${text}</p></body>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  const fehler = url.searchParams.get("error");

  if (fehler) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(seite("Abgebrochen", `Google meldet: ${fehler}`));
    console.error(`\nFEHLER: Zustimmung verweigert (${fehler})`);
    server.close();
    process.exitCode = 1;
    return;
  }
  if (!code) {
    res.writeHead(404).end();
    return;
  }

  try {
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

    if (!d.refresh_token) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(seite("Kein Refresh-Token", "Details stehen im Terminal."));
      console.error(
        "\nFEHLER: Google hat keinen Refresh-Token geliefert.\n" +
          "Das passiert, wenn der Zugriff schon einmal erteilt wurde. Entziehe ihn unter\n" +
          "https://myaccount.google.com/permissions und starte das Skript erneut.\n\n" +
          JSON.stringify(d, null, 2),
      );
      server.close();
      process.exitCode = 1;
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(seite("Geschafft", "Der Refresh-Token steht im Terminal. Dieses Fenster kannst du schliessen."));

    console.log("\n" + "=".repeat(64));
    console.log("YT_REFRESH_TOKEN:\n");
    console.log(d.refresh_token);
    console.log("\n" + "=".repeat(64));
    console.log("\nAls GitHub-Secret hinterlegen:");
    console.log("  gh secret set YT_REFRESH_TOKEN --repo kevinreinhard/geld-pinguin-reels");
    server.close();
  } catch (e) {
    console.error("\nFEHLER beim Tausch des Codes: " + e.message);
    server.close();
    process.exitCode = 1;
  }
});

server.listen(PORT, () => {
  console.log("Öffne die Zustimmungsseite im Browser ...\n");
  console.log("Falls sie sich nicht öffnet, diese Adresse aufrufen:\n");
  console.log(authUrl + "\n");
  const cmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [authUrl], { shell: true, stdio: "ignore", detached: true }).unref();
});
