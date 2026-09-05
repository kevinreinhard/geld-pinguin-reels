/**
 * Entscheidet, ob jetzt gepostet werden soll.
 *
 * Hintergrund: GitHub führt geplante Workflows mit der niedrigsten Priorität aus.
 * Gemessen wurden Verspätungen von zwei bis vier Stunden, einzelne Läufe fielen
 * ganz aus. Ein Cron auf exakt vier Uhrzeiten liefert deshalb keine vier Posts
 * zu diesen Zeiten.
 *
 * Deshalb: Der Workflow läuft halbstündlich und fragt hier nach. Gepostet wird
 * nur, wenn ein Slot fällig ist und für diesen Slot noch nichts veröffentlicht
 * wurde. Verpasste Läufe holt der nächste Versuch nach, solange das Zeitfenster
 * offen ist.
 *
 * Ausgabe auf stdout: "ja" oder "nein" plus eine Begründung auf stderr.
 */
import { ladeHistorie } from "../src/history.js";
import { ladeTuning } from "../src/tuning.js";

// Wie lange nach einem Slot darf ein verspäteter Lauf ihn noch nachholen.
const NACHLAUF_MINUTEN = 150;

function begruendung(text) {
  process.stderr.write("  " + text + "\n");
}

function main() {
  const { postSlots } = ladeTuning({ still: true });
  const jetzt = new Date();

  // Kandidaten: alle Slots von heute und gestern, die bereits vergangen sind.
  const kandidaten = [];
  for (const tagVersatz of [0, -1]) {
    for (const stunde of postSlots) {
      const slot = new Date(jetzt);
      slot.setUTCDate(slot.getUTCDate() + tagVersatz);
      slot.setUTCHours(stunde, 0, 0, 0);
      if (slot <= jetzt) kandidaten.push(slot);
    }
  }

  if (!kandidaten.length) {
    console.log("nein");
    begruendung("Heute ist noch kein Slot vergangen.");
    return;
  }

  const letzterSlot = new Date(Math.max(...kandidaten.map((d) => d.getTime())));
  const verspaetungMin = Math.round((jetzt - letzterSlot) / 60000);

  if (verspaetungMin > NACHLAUF_MINUTEN) {
    console.log("nein");
    begruendung(
      `Letzter Slot ${letzterSlot.toISOString().slice(11, 16)} UTC liegt ` +
        `${verspaetungMin} Minuten zurück, das Fenster von ${NACHLAUF_MINUTEN} Minuten ist zu.`,
    );
    return;
  }

  // Wurde seit diesem Slot schon etwas veröffentlicht?
  const posts = ladeHistorie();
  const seitSlot = posts.filter((p) => new Date(p.zeit) >= letzterSlot);

  if (seitSlot.length) {
    console.log("nein");
    begruendung(
      `Slot ${letzterSlot.toISOString().slice(11, 16)} UTC ist bereits bedient ` +
        `(${seitSlot[seitSlot.length - 1].title}).`,
    );
    return;
  }

  console.log("ja");
  begruendung(
    `Slot ${letzterSlot.toISOString().slice(11, 16)} UTC ist fällig ` +
      `(${verspaetungMin} Minuten Verzug) und noch nicht bedient.`,
  );
}

main();
