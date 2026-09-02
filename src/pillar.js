import { PILLARS } from "./config.js";
import { saeulenZaehler } from "./history.js";

/**
 * Zieht eine Themensaeule: Gewicht aus der Config, abgewertet um das,
 * was in den letzten 30 Posts schon oft dran war.
 */
export function waehleSaeule() {
  const zaehler = saeulenZaehler();
  const kandidaten = PILLARS.map((p) => {
    const genutzt = zaehler[p.key] || 0;
    return { ...p, score: Math.max(0.15, p.gewicht / (1 + genutzt * 0.8)) };
  });

  const summe = kandidaten.reduce((a, k) => a + k.score, 0);
  let wurf = Math.random() * summe;
  for (const k of kandidaten) {
    wurf -= k.score;
    if (wurf <= 0) return k;
  }
  return kandidaten[kandidaten.length - 1];
}
