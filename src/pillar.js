import { PILLARS } from "./config.js";
import { saeulenZaehler } from "./history.js";
import { ladeTuning } from "./tuning.js";

/**
 * Zieht eine Themensaeule: Gewicht aus der Config, abgewertet um das,
 * was in den letzten 30 Posts schon oft dran war.
 */
export function waehleSaeule() {
  const zaehler = saeulenZaehler();
  const { saeulenGewichte } = ladeTuning({ still: true });

  const kandidaten = PILLARS.map((p) => {
    const genutzt = zaehler[p.key] || 0;
    // Der Analyse-Agent darf das Standardgewicht ueberschreiben.
    const gewicht = saeulenGewichte[p.key] ?? p.gewicht;
    return { ...p, gewicht, score: Math.max(0.15, gewicht / (1 + genutzt * 0.8)) };
  });

  const summe = kandidaten.reduce((a, k) => a + k.score, 0);
  let wurf = Math.random() * summe;
  for (const k of kandidaten) {
    wurf -= k.score;
    if (wurf <= 0) return k;
  }
  return kandidaten[kandidaten.length - 1];
}
