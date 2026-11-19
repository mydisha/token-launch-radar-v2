// token-launch-radar-v2: a token launch radar for make.fun's token-radar-01 bounty (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), prices every pre-token protocol
// from the market-cap-to-TVL multiples of protocols whose token trades (lib/model.ts), gives each a costed
// farm plan (lib/farm.ts), and writes to /output (or MAKEFUN_OUTPUT_DIR / --output):
//   board.json    the ranked rows the gate reads
//   data.js       the same board plus the model's comparables, for the dashboard
//   dashboard/    the static page, copied from this repository
//   screenshots/  the three screenshots, copied from this repository
//   dossier.json  written last with vendor/makefun-board.ts, as the scorer rebuilds it
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, boardJson, buildBoard, dataScript } from './lib/board.ts';
import { SnapshotError, buildComparables, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** Copy one directory's regular files (no dot-names) into `to`, in name order. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory>`, 2);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (e) {
  if (e instanceof SnapshotError) fail(`bad snapshot: ${e.message}`, 2);
  throw e;
}

const comps = buildComparables(snapshot.protocols);
const rows = buildBoard(snapshot, comps);
const issue = boardIssue(rows, snapshot);
if (issue !== null) fail(`the board would fail the gate: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), boardJson(rows, snapshot));
writeFileSync(join(out, 'data.js'), dataScript(rows, snapshot, comps));

const pages = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (!pages.includes('index.html')) fail('dashboard/ has no index.html');
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4`);
for (const n of shots) if (!IMAGE_NAME.test(n)) fail(`screenshots/${n}: names are letters, digits and . _ -`);

// Written last: the scorer rebuilds the dossier from this directory and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

const watch = rows.filter((r) => r.watchlist).length;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${comps.live.length} live comparables, ${rows.length} pre-token rows ranked (${watch}/${snapshot.watchlist.length} watchlist)\n` +
    `token radar: top ${rows[0]!.name} at $${rows[0]!.implied_value_usd.toLocaleString('en-US')}; wrote ${out}\n`,
);
