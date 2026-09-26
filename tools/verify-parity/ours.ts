/**
 * Sonopc's own parser -> combo event breakdown for every bundled chart.
 *
 *   npx tsx tools/verify-parity/ours.ts > ours.json
 *
 * Chart text is handed to `parseSUS` byte-identically to the way the app loads
 * it (`fetch(...).then(r => r.text())` in `PlayScreen.tsx`), so the numbers
 * here are the numbers the game actually plays.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSUS, type ComboEventKind } from "../../src/game/susParser";

const DIFFICULTIES = ["easy", "normal", "hard", "expert", "master"];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const levelsDir = join(repoRoot, "public/levelinfo");

const rows = [];
for (const song of readdirSync(levelsDir)) {
  const songDir = join(levelsDir, song);
  // `info.txt` marks a real level folder (the rest are the audio/jacket files).
  if (!existsSync(join(songDir, "info.txt"))) continue;

  for (const difficulty of DIFFICULTIES) {
    const file = join(songDir, difficulty, `${difficulty}.txt`);
    if (!existsSync(file)) continue;

    const chart = parseSUS(readFileSync(file, "utf-8"));

    const byKind: Record<ComboEventKind, number> = {
      single: 0,
      start: 0,
      relay: 0,
      continuation: 0,
      end: 0,
    };
    const byKindCritical: Record<ComboEventKind, number> = {
      single: 0,
      start: 0,
      relay: 0,
      continuation: 0,
      end: 0,
    };
    for (const event of chart.comboEvents) {
      byKind[event.kind]++;
      if (event.critical) byKindCritical[event.kind]++;
    }

    rows.push({
      id: `${song}/${difficulty}`,
      file: relative(repoRoot, file),
      total: chart.comboEvents.length,
      byKind,
      byKindCritical,
      notes: chart.notes.length,
      singles: chart.notes.filter((note) => note.type !== "slide").length,
      slides: chart.notes.filter((note) => note.type === "slide").length,
      guides: chart.guides.length,
      guidesCritical: chart.guides.filter((guide) => guide.critical).length,
      guidePoints: chart.guides.reduce(
        (sum, guide) => sum + guide.points.length,
        0,
      ),
      duration: Math.round(chart.duration * 1000) / 1000,
    });
  }
}

rows.sort((a, b) => a.id.localeCompare(b.id));
console.log(JSON.stringify(rows, null, 2));
