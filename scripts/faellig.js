/**
 * Entscheidet, ob jetzt gepostet werden soll.
 *
 * Warum nicht einfach ein Cron auf vier Uhrzeiten?
 * Weil GitHub geplante Workflows mit der niedrigsten Priorität ausführt. Gemessen
 * am 06.09.: angefordert war halbstündlich, tatsächlich liefen sechs Jobs über den
 * Tag verteilt (09:12, 13:03, 16:23, 18:32, 21:08, 23:00). Feste Uhrzeiten trifft
 * man damit nicht, und ein enges Nachholfenster lässt Slots einfach leer.
 *
 * Deshalb wird nicht auf Uhrzeiten geregelt, sondern auf das, was unter diesen
 * Bedingungen steuerbar ist:
 *   - wie viele Beiträge pro Tag
 *   - wie viel Abstand mindestens dazwischen
 *   - in welchem Tagesfenster überhaupt
 *
 * Ergebnis: verlässlich vier gut verteilte Posts, auch wenn die Läufe zu
 * unvorhersehbaren Zeiten kommen. Der Preis: die exakte Uhrzeit ist nicht mehr
 * garantiert. Diese Garantie gab es auf dieser Infrastruktur aber ohnehin nie.
 *
 * Ausgabe auf stdout: "ja" oder "nein", Begründung auf stderr.
 */
import { fileURLToPath } from "node:url";
import { ladeHistorie } from "../src/history.js";
import { ladeTuning } from "../src/tuning.js";

function begruendung(text) {
  process.stderr.write("  " + text + "\n");
}

/**
 * postSlots wird jetzt als Rahmen gelesen, nicht als exakte Termine:
 * die Anzahl ergibt das Tagesziel, der Bereich das erlaubte Zeitfenster.
 */
export function regeln(postSlots) {
  const stunden = [...postSlots].sort((a, b) => a - b);
  const zielProTag = stunden.length;
  const von = stunden[0];
  const bis = stunden[stunden.length - 1];

  // Abstand etwas unter der rechnerisch gleichmäßigen Verteilung, damit ein
  // verspäteter Lauf den Rhythmus nicht für den Rest des Tages blockiert.
  const spanneMin = (bis - von) * 60;
  const gleichmaessig = zielProTag > 1 ? spanneMin / (zielProTag - 1) : spanneMin;
  const mindestabstandMin = Math.max(90, Math.round(gleichmaessig * 0.7));

  return { zielProTag, von, bis, mindestabstandMin };
}

function main() {
  const { postSlots } = ladeTuning({ still: true });
  const { zielProTag, von, bis, mindestabstandMin } = regeln(postSlots);

  const jetzt = new Date();
  const stunde = jetzt.getUTCHours();

  // Eine Stunde Kulanz am Ende, damit ein verspäteter letzter Lauf noch zählt.
  if (stunde < von || stunde > bis + 1) {
    console.log("nein");
    begruendung(`${stunde}:00 UTC liegt ausserhalb des Fensters ${von}-${bis + 1} Uhr UTC.`);
    return;
  }

  const posts = ladeHistorie();
  const tagesbeginn = new Date(jetzt);
  tagesbeginn.setUTCHours(0, 0, 0, 0);

  const heute = posts.filter((p) => new Date(p.zeit) >= tagesbeginn);
  if (heute.length >= zielProTag) {
    console.log("nein");
    begruendung(`Tagesziel erreicht: ${heute.length} von ${zielProTag} Beiträgen.`);
    return;
  }

  const letzter = posts[posts.length - 1];
  if (letzter) {
    const abstandMin = Math.round((jetzt - new Date(letzter.zeit)) / 60000);
    if (abstandMin < mindestabstandMin) {
      console.log("nein");
      begruendung(
        `Letzter Post liegt ${abstandMin} Minuten zurück, Mindestabstand ist ${mindestabstandMin}.`,
      );
      return;
    }
  }

  console.log("ja");
  begruendung(
    `Heute ${heute.length} von ${zielProTag} Beiträgen, Fenster offen, Abstand eingehalten.`,
  );
}

// Nur beim direkten Aufruf entscheiden - sonst loest schon ein Import
// von regeln() eine Ausgabe aus.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
