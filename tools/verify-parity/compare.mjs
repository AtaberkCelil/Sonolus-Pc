/**
 * Compares Sonopc's combo event breakdown against the reference converter's.
 *
 *   node tools/verify-parity/compare.mjs ours.json reference.json
 *
 * Exits non-zero on any mismatch (total, per-kind, critical split, duration) or
 * if the two lists cover different charts.
 */
import { readFileSync } from "node:fs";

const ours = JSON.parse(readFileSync(process.argv[2], "utf-8"));
const reference = JSON.parse(readFileSync(process.argv[3], "utf-8"));

const byId = (rows) => new Map(rows.map((row) => [row.id, row]));
const oursById = byId(ours);
const referenceById = byId(reference);

const KINDS = ["single", "start", "relay", "continuation", "end"];
const name = (id) =>
  id.replace(/^The intense voice of hatsune miku\//, "TIVoHM ");

let failures = 0;
const report = [];

const ids = [...new Set([...oursById.keys(), ...referenceById.keys()])].sort();
for (const id of ids) {
  const mine = oursById.get(id);
  const theirs = referenceById.get(id);

  if (!mine || !theirs) {
    failures++;
    report.push(
      `  ${name(id).padEnd(16)} MISSING (${mine ? "absent from reference" : "absent from Sonopc"})`,
    );
    continue;
  }

  const problems = [];
  if (mine.total !== theirs.total) {
    problems.push(`total ${mine.total} != ${theirs.total}`);
  }
  for (const kind of KINDS) {
    if (mine.byKind[kind] !== theirs.byKind[kind]) {
      problems.push(`${kind} ${mine.byKind[kind]} != ${theirs.byKind[kind]}`);
    }
    if (mine.byKindCritical[kind] !== theirs.byKindCritical[kind]) {
      problems.push(
        `${kind}(crit) ${mine.byKindCritical[kind]} != ${theirs.byKindCritical[kind]}`,
      );
    }
  }
  if (Math.abs(mine.duration - theirs.duration) > 0.01) {
    problems.push(`duration ${mine.duration}s != ${theirs.duration}s`);
  }
  // Playable note counts: `Single` covers taps/criticals/traces/flicks on the
  // reference side, everything that is not a slide on ours.
  if (mine.singles !== theirs.singles) {
    problems.push(`singles ${mine.singles} != ${theirs.singles}`);
  }
  if (mine.slides !== theirs.slides) {
    problems.push(`slides ${mine.slides} != ${theirs.slides}`);
  }
  // Channel-9 guides: never scored, but their count/shape must match so the
  // rendered guide paths are the same ones the reference converter produces.
  if (mine.guides !== theirs.guides) {
    problems.push(`guides ${mine.guides} != ${theirs.guides}`);
  }
  if (mine.guidesCritical !== theirs.guidesCritical) {
    problems.push(
      `guides(crit) ${mine.guidesCritical} != ${theirs.guidesCritical}`,
    );
  }
  if (mine.guidePoints !== theirs.guidePoints) {
    problems.push(`guidePoints ${mine.guidePoints} != ${theirs.guidePoints}`);
  }

  if (problems.length) {
    failures++;
    report.push(
      `  ${name(id).padEnd(16)} ${String(mine.total).padStart(5)}  MISMATCH: ${problems.join(", ")}`,
    );
  } else {
    const breakdown = KINDS.map(
      (kind) => `${kind[0]}${mine.byKind[kind]}`,
    ).join(" ");
    report.push(
      `  ${name(id).padEnd(16)} ${String(mine.total).padStart(5)}  ok   ` +
        `[${breakdown}]  ${mine.singles} singles, ${mine.slides} slides, ` +
        `${mine.guides} guides (${mine.guidePoints} pts)`,
    );
  }
}

console.log("Chart parity vs UntitledCharts/sonolus-level-converters");
console.log(report.join("\n"));
console.log(
  failures === 0
    ? `\nAll ${ids.length} charts match the reference exactly (total, per-kind, critical split, notes, guides, duration).`
    : `\n${failures} of ${ids.length} charts differ from the reference.`,
);

process.exit(failures === 0 ? 0 : 1);
