import fs from "node:fs";
import path from "node:path";

const PFAD = path.resolve("data/history.json");

export function ladeHistorie() {
  try {
    const raw = JSON.parse(fs.readFileSync(PFAD, "utf8"));
    return Array.isArray(raw.posts) ? raw.posts : [];
  } catch {
    return [];
  }
}

/** Die letzten N Themen - dienen dem Modell als Negativliste. */
export function letzteThemen(anzahl = 40) {
  return ladeHistorie().slice(-anzahl).map((p) => p.topic);
}

/** Saeule, die zuletzt am wenigsten dran war, damit der Kanal nicht einseitig wird. */
export function saeulenZaehler() {
  const zaehler = {};
  for (const p of ladeHistorie().slice(-30)) {
    zaehler[p.pillar] = (zaehler[p.pillar] || 0) + 1;
  }
  return zaehler;
}

export function speicherePost(eintrag) {
  const posts = ladeHistorie();
  posts.push({ ...eintrag, zeit: new Date().toISOString() });
  // Historie deckeln, sonst waechst die Datei endlos
  const gekuerzt = posts.slice(-500);
  fs.mkdirSync(path.dirname(PFAD), { recursive: true });
  fs.writeFileSync(PFAD, JSON.stringify({ posts: gekuerzt }, null, 2) + "\n");
}
