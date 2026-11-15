/**
 * Bewegte Einstellungen für die Shorts: Kling 3.0 Turbo (über die Higgsfield-CLI) macht aus einem
 * Commons-Foto eine Kamerafahrt von 5 Sekunden. Probe am 15.11.2026: Das Motorrad bleibt meist treu,
 * gegen Ende erfindet Kling aber manchmal die Seite, die auf dem Foto nicht zu sehen war. Darum
 * prüft Claude jeden Clip an fünf Standbildern gegen das Foto und gibt nur den treuen Anfang frei;
 * unter 2 Sekunden bleibt es beim Zoom auf das Foto.
 *
 * Kosten: 7,5 Credits je Clip (720p, 5 s). Geht irgendetwas schief (keine Anmeldung, zu wenig
 * Credits, Zeitüberschreitung), kommt das Short trotzdem, dann eben mit Zoom.
 *
 * Anmeldung in GitHub: HIGGSFIELD_CREDENTIALS (credentials.json ohne refresh_token, vom Geschäfts-PC
 * täglich frisch gesetzt) und HIGGSFIELD_WORKSPACE_ID. Ohne refresh_token kann die CLI hier nicht
 * erneuern – das ist Absicht, sonst würde die Anmeldung auf dem Geschäfts-PC ungültig.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { frage } from "./claude.js";

const ausfuehren = promisify(execFile);

const MODELL = "kling3_0_turbo";
export const KOSTEN_JE_CLIP = 7.5;
const RESERVE = 30; // so viel bleibt immer auf dem Konto
const PROMPT =
  "Slow cinematic camera move around the parked motorcycle, smooth dolly, natural daylight, " +
  "the motorcycle stays completely still and unchanged, keep all logos, shapes and details exactly " +
  "as in the photo, no people, no text";
const PRUEFZEITEN = [1, 2, 3, 4, 4.9];
const MIN_NUTZ = 2;

async function hf(...args) {
  const { stdout } = await ausfuehren("higgsfield", [...args, "--json"], {
    encoding: "utf8",
    timeout: 25 * 60 * 1000,
    maxBuffer: 1 << 24,
    env: { ...process.env, HIGGSFIELD_DISABLE_TELEMETRY: "1" },
  });
  return JSON.parse(stdout);
}

/** Credits auf dem Konto oder null, wenn die CLI fehlt oder nicht angemeldet ist. */
export async function guthaben() {
  try {
    return (await hf("account", "status")).credits ?? null;
  } catch (e) {
    console.log(`  Kling: keine Anmeldung (${String(e.stderr || e.message).trim().split("\n")[0]})`);
    return null;
  }
}

export async function genugGuthaben(clips) {
  const credits = await guthaben();
  if (credits === null) return false;
  const noetig = clips * KOSTEN_JE_CLIP + RESERVE;
  if (credits < noetig) console.log(`  Kling: nur ${credits} Credits, nötig ${noetig} – Zoom statt Clips`);
  return credits >= noetig;
}

const ffmpeg = (...a) => ausfuehren("ffmpeg", ["-y", "-v", "error", ...a]);

const KONTROLLE = {
  name: "clip_beurteilen",
  description: "Gibt an, bis zu welchem Standbild der Clip das Motorrad des Fotos treu zeigt.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      treu_bis: { type: "integer", description: "Letztes treue Standbild (0-4), -1 wenn schon das erste nicht stimmt" },
      begruendung: { type: "string" },
    },
    required: ["treu_bis", "begruendung"],
    additionalProperties: false,
  },
};

/** Claude vergleicht Standbilder mit dem Foto; Ergebnis: nutzbare Sekunden ab Clipbeginn (0 = unbrauchbar). */
async function beurteile(name, foto, standbilder) {
  const bild = (p) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: fs.readFileSync(p).toString("base64") } });
  const inhalt = [{ type: "text", text: "Originalfoto:" }, bild(foto)];
  standbilder.forEach((p, i) => inhalt.push({ type: "text", text: `Standbild ${i} (Sekunde ${PRUEFZEITEN[i]}):` }, bild(p)));
  inhalt.push({
    type: "text",
    text:
      `Der Clip ist eine KI-Kamerafahrt, erzeugt aus dem Originalfoto der «${name}». Prüfe jedes Standbild: ` +
      `Ist es noch genau dasselbe Motorrad wie auf dem Foto – gleiche Form von Tank, Verkleidung, Auspuff, ` +
      `Rahmen, Rädern, gleiche Farben und Schriftzüge, keine dazuerfundenen oder verbogenen Teile, keine ` +
      `verschmolzenen Formen, keine Menschen und kein Text, die nicht auf dem Foto sind? Eine andere ` +
      `Blickrichtung ist erlaubt, solange das Gezeigte glaubwürdig zu diesem Motorrad passt. ` +
      `Sei streng: Im Zweifel gilt ein Standbild als nicht treu. Gib über clip_beurteilen das letzte ` +
      `Standbild an, bis zu dem alle treu sind.`,
  });
  const urteil = await frage({ system: "Du bist Bildredaktor eines Motorradkanals.", effort: "low", maxTokens: 8000, werkzeug: KONTROLLE, inhalt });
  const bis = Number.isInteger(urteil.treu_bis) ? Math.min(4, urteil.treu_bis) : -1;
  return { nutz: bis < 0 ? 0 : bis === 4 ? 5 : PRUEFZEITEN[bis], begruendung: urteil.begruendung };
}

/**
 * Erzeugt für die ersten `anzahl` Fotos je einen Clip, prüft ihn und trägt bei brauchbaren Clips
 * `video` und `max` (Sekunden) am Bild ein. Wirft nie; Rückgabe: Liste der Befunde für das Protokoll.
 */
export async function belebe(name, bilder, ordner, anzahl = 3) {
  const ziel = path.join(ordner, "kling");
  fs.mkdirSync(ziel, { recursive: true });
  const auswahl = bilder.slice(0, anzahl);

  const ergebnisse = await Promise.all(
    auswahl.map(async (b, i) => {
      try {
        const [id] = await hf("generate", "create", MODELL, "--prompt", PROMPT, "--start-image", b.datei,
          "--duration", "5", "--resolution", "720p", "--aspect_ratio", "16:9");
        const job = await hf("generate", "wait", id, "--timeout", "20m", "--interval", "10s");
        if (job.status !== "completed" || !job.result_url) throw new Error(`Status ${job.status}`);
        const res = await fetch(job.result_url);
        if (!res.ok) throw new Error(`Download ${res.status}`);
        const video = path.join(ziel, `clip-${i}.mp4`);
        fs.writeFileSync(video, Buffer.from(await res.arrayBuffer()));

        const standbilder = [];
        for (const [k, t] of PRUEFZEITEN.entries()) {
          const p = path.join(ziel, `clip-${i}-${k}.jpg`);
          await ffmpeg("-ss", String(t), "-i", video, "-frames:v", "1", "-vf", "scale=640:-1", p);
          standbilder.push(p);
        }
        const vorschau = path.join(ziel, `foto-${i}.jpg`);
        await ffmpeg("-i", b.datei, "-vf", "scale=640:-1", vorschau);
        const { nutz, begruendung } = await beurteile(name, vorschau, standbilder);
        if (nutz >= MIN_NUTZ) {
          b.video = video;
          b.max = nutz;
          b.credit = `${b.credit} · animiert mit KI`;
        }
        return { bild: i, job: id, nutz, begruendung };
      } catch (e) {
        return { bild: i, fehler: String(e.stderr || e.message).trim().split("\n")[0] };
      }
    }),
  );
  fs.writeFileSync(path.join(ziel, "befund.json"), JSON.stringify(ergebnisse, null, 1));
  for (const e of ergebnisse) {
    console.log(`  Kling Bild ${e.bild}: ${e.fehler ? "Fehler – " + e.fehler : e.nutz >= MIN_NUTZ ? `${e.nutz} s genutzt` : "verworfen"}${e.begruendung ? " (" + e.begruendung.slice(0, 120) + ")" : ""}`);
  }
  return ergebnisse;
}
