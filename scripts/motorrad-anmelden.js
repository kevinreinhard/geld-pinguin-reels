/**
 * Upload-Zugang für den Kanal Motorrad Kompass: fängt Googles Rückleitung ab.
 *
 *   node scripts/motorrad-anmelden.js <Client-ID>
 *
 * Gibt die Adresse der Zustimmungsseite aus und wartet auf localhost:8765 auf
 * die Rückleitung. Den einmaligen Code reicht es an den Workflow
 * «motorrad-token.yml» weiter; dort liegt das Client-Geheimnis, dort wird
 * getauscht und das Refresh-Token als Secret gespeichert. Auf diesem Rechner
 * entsteht weder Geheimnis noch Token.
 */
import http from "node:http";
import { execFileSync } from "node:child_process";

const PORT = 8765;
const REDIRECT = `http://localhost:${PORT}`;
const CLIENT_ID = process.argv[2];
// upload = Videos hochladen, readonly = Zielkanal vor dem Upload prüfen,
// force-ssl braucht das Setzen des Vorschaubilds.
const SCOPE = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
].join(" ");

if (!CLIENT_ID) {
  console.error("Aufruf: node scripts/motorrad-anmelden.js <Client-ID>");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline", // sonst gibt Google kein Refresh-Token heraus
    prompt: "consent",
  });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  const fehler = url.searchParams.get("error");
  if (!code && !fehler) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (fehler) {
    res.end(`<h2>Abgebrochen: ${fehler.replace(/[<>&]/g, "")}</h2>`);
    console.log(`ABGEBROCHEN: ${fehler}`);
    server.close();
    process.exitCode = 1;
    return;
  }
  res.end("<h2>Zulassung erhalten.</h2><p>Dieses Fenster kann geschlossen werden.</p>");
  try {
    execFileSync("gh", ["workflow", "run", "motorrad-token.yml", "-f", `code=${code}`], { stdio: "inherit" });
    console.log("CODE WEITERGEGEBEN: Workflow motorrad-token.yml gestartet.");
  } catch (e) {
    console.log(`WORKFLOW-START FEHLGESCHLAGEN: ${e.message}`);
    process.exitCode = 1;
  }
  server.close();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`ZUSTIMMUNGSSEITE: ${authUrl}`);
  console.log(`Warte auf die Rückleitung an ${REDIRECT} ...`);
});
