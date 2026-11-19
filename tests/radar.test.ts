// Tests for the value model, the farm plans and the board. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ageDays, ageFactor, buildComparables, growthFactor, isCandidate, parseSnapshot, reachFactor, valueOf,
  SnapshotError, MODEL, type Protocol, type Snapshot,
} from '../lib/model.ts';
import { capitalFor, farmPlan, holdDaysFor, planChain, stepText } from '../lib/farm.ts';
import { boardIssue, boardJson, buildBoard } from '../lib/board.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

function proto(over: Partial<Protocol> & { slug: string }): Protocol {
  return {
    name: over.slug.replace(/-/g, ' '), category: 'Lending', chains: ['Ethereum'], tvl_usd: 60_000_000, change_7d: 0,
    mcap_usd: null, listed_at: '2025-01-01', gecko_id: null, symbol: null, ...over,
  };
}

/** A synthetic snapshot: 40 live comparables across categories and 140 pre-token protocols. */
function fixture(): Snapshot {
  const cats = ['Lending', 'Dexs', 'Yield', 'RWA', 'Derivatives'];
  const protocols: Protocol[] = [];
  for (let i = 0; i < 40; i++) {
    const tvl = 50e6 + i * 7e6;
    protocols.push(proto({ slug: `live-${i}`, category: cats[i % 5]!, tvl_usd: tvl, mcap_usd: Math.round(tvl * (0.05 + (i % 7) * 0.1)), gecko_id: `g${i}`, symbol: `L${i}` }));
  }
  for (let i = 0; i < 140; i++) {
    protocols.push(proto({
      slug: `pre-${String(i).padStart(3, '0')}`, category: i % 9 === 0 ? 'Risk Curators' : cats[i % 5]!,
      tvl_usd: 5e6 + i * 3e6, change_7d: (i % 11) - 5, chains: i % 4 === 0 ? ['Ethereum', 'Base', 'Arbitrum'] : ['Solana'],
      listed_at: i % 13 === 0 ? null : `2025-0${1 + (i % 9)}-15`,
    }));
  }
  protocols.sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const watchlist = protocols.filter((p) => isCandidate(p) && p.tvl_usd >= 50e6).map((p) => p.slug);
  return { as_of: '2026-11-14', source: 'test', floor_usd: 50e6, protocols, watchlist };
}

test('ageDays counts whole days and handles a missing date', () => {
  assert.equal(ageDays('2026-11-14', '2026-11-04'), 10);
  assert.equal(ageDays('2026-11-14', null), null);
  assert.equal(ageDays('2026-11-14', '2027-01-01'), 0, 'a future listing date is clamped to 0');
});

test('factors are bounded at both ends', () => {
  assert.equal(growthFactor(null), 1);
  assert.equal(growthFactor(0), 1);
  assert.equal(growthFactor(1e6), MODEL.growth_max);
  assert.equal(growthFactor(-99), MODEL.growth_min);
  assert.equal(ageFactor(null), MODEL.age_unknown);
  assert.equal(ageFactor(0), MODEL.age_floor);
  assert.equal(ageFactor(10_000), MODEL.age_max);
  assert.equal(reachFactor(0), 1);
  assert.equal(reachFactor(1), 1);
  assert.equal(reachFactor(10_000), MODEL.reach_max);
  assert.ok(reachFactor(8) > reachFactor(2));
});

test('candidates exclude tokens, products, versions and exchanges', () => {
  assert.ok(isCandidate(proto({ slug: 'a' })));
  assert.ok(!isCandidate(proto({ slug: 'b', gecko_id: 'x' })));
  assert.ok(!isCandidate(proto({ slug: 'c', category: 'Liquid Staking' })));
  assert.ok(!isCandidate(proto({ slug: 'd', name: 'Foo V2' })));
  assert.ok(!isCandidate(proto({ slug: 'e', name: 'Wrapped Ünicode Coin' })));
  assert.ok(!isCandidate(proto({ slug: 'f', name: 'Binance Earn' })));
  assert.ok(!isCandidate(proto({ slug: 'g', tvl_usd: 0 })));
  assert.ok(isCandidate(proto({ slug: 'h', name: 'Stakehouse' })), 'a whole word only: Stakehouse is not "staked"');
});

test('a thin category is shrunk toward its family, a thick one keeps close to its own median', () => {
  const live = [
    ...Array.from({ length: 12 }, (_, i) => proto({ slug: `l${i}`, category: 'Lending', mcap_usd: 60e6 * 0.1, gecko_id: 'x', symbol: 'X' })),
    proto({ slug: 'cdp', category: 'CDP', mcap_usd: 60e6 * 10, gecko_id: 'y', symbol: 'Y' }),
  ];
  const comps = buildComparables(live);
  const lending = comps.category.get('Lending')!;
  const cdp = comps.category.get('CDP')!;
  assert.ok(Math.abs(Math.exp(lending.log) - 0.1) < 0.03, 'twelve comparables keep their own median');
  assert.ok(Math.exp(cdp.log) < 2, 'one 10x comparable is pulled far toward the family');
});

test('product categories never feed the prior', () => {
  const live = [
    proto({ slug: 'lst', category: 'Liquid Staking', mcap_usd: 60e3, gecko_id: 'a', symbol: 'A' }),
    proto({ slug: 'dex', category: 'Dexs', mcap_usd: 60e6, gecko_id: 'b', symbol: 'B' }),
  ];
  const comps = buildComparables(live);
  assert.equal(comps.prior.n, 1);
  assert.ok(comps.category.has('Liquid Staking'), 'still shown as its own pool');
});

test('valuation: no comparables at all falls back to the prior and stays positive', () => {
  const comps = buildComparables([]);
  const v = valueOf(proto({ slug: 'x', category: null }), '2026-11-14', comps);
  assert.equal(v.basis, 'prior');
  assert.ok(v.implied_value_usd >= 1 && Number.isInteger(v.implied_value_usd));
  assert.ok(v.low_usd <= v.implied_value_usd && v.implied_value_usd <= v.high_usd);
  assert.equal(v.confidence, 'low');
});

test('valuation: growth, age and reach move the value the right way', () => {
  const s = fixture();
  const comps = buildComparables(s.protocols);
  const base = proto({ slug: 'base', change_7d: 0, listed_at: '2026-10-01', chains: ['Ethereum'] });
  const v0 = valueOf(base, s.as_of, comps).implied_value_usd;
  assert.ok(valueOf({ ...base, change_7d: 20 }, s.as_of, comps).implied_value_usd > v0);
  assert.ok(valueOf({ ...base, change_7d: -20 }, s.as_of, comps).implied_value_usd < v0);
  assert.ok(valueOf({ ...base, listed_at: '2024-01-01' }, s.as_of, comps).implied_value_usd > v0);
  assert.ok(valueOf({ ...base, chains: ['A', 'B', 'C', 'D'] }, s.as_of, comps).implied_value_usd > v0);
});

test('farm plan: chain, size, window and every step costed', () => {
  assert.equal(planChain(proto({ slug: 'a', chains: ['Ethereum', 'Base', 'Solana'] })), 'Base', 'cheaper of the two leading chains');
  assert.equal(planChain(proto({ slug: 'b', chains: [] })), 'Ethereum');
  assert.equal(planChain(proto({ slug: 'c', chains: ['Bitcoin'] })), 'Bitcoin', 'falls back to an unreachable chain when it is the only one');
  assert.equal(capitalFor(10e6), 1_000);
  assert.equal(capitalFor(2e9), 10_000);
  assert.equal(holdDaysFor(null), 90);
  assert.ok(holdDaysFor(30) > holdDaysFor(2000));
  const s = fixture();
  const comps = buildComparables(s.protocols);
  for (const cat of ['Lending', 'CDP', 'Dexs', 'Basis Trading', 'RWA', 'Risk Curators', 'Chain', 'Payments', 'Insurance', null]) {
    const p = proto({ slug: 'p', category: cat, change_7d: -15 });
    const plan = farmPlan(p, valueOf(p, s.as_of, comps));
    assert.ok(plan.steps.length >= 3 && plan.steps.length <= 12, `${cat}: ${plan.steps.length} steps`);
    for (const st of plan.steps) {
      const t = stepText(st).trim();
      assert.ok(t.length >= 20 && t.length <= 600, `${cat}: step of ${t.length} chars`);
      assert.match(t, /Cost: \$[\d,.]+\. Time: /);
    }
    assert.ok(plan.steps.some((st) => /fell 15\.0%/.test(st.action)), 'a falling TVL adds the risk rule');
    assert.ok(Math.abs(plan.cost_usd - plan.steps.reduce((a, b) => a + b.cost_usd, 0)) < 0.05, 'total equals the steps');
  }
});

test('board passes the gate checks, covers the watchlist and is deterministic', () => {
  const s = fixture();
  const rows = buildBoard(s);
  assert.equal(boardIssue(rows, s), null);
  for (const w of s.watchlist) assert.ok(rows.some((r) => r.slug === w));
  assert.ok(rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1]!.implied_value_usd));
  assert.equal(boardJson(rows, s), boardJson(buildBoard(s), s));
  assert.ok(rows.every((r) => !r.slug.startsWith('live-')), 'a traded token is never ranked as a launch');
});

test('boardIssue catches what the gate refuses', () => {
  const s = fixture();
  const rows = buildBoard(s);
  assert.match(boardIssue(rows.slice(0, 50), s)!, /not 100 to 4,000/);
  const swapped = rows.map((r) => ({ ...r }));
  swapped[0]!.implied_value_usd = 1;
  assert.match(boardIssue(swapped, s)!, /rises/);
  const dup = rows.map((r) => ({ ...r }));
  dup[5]!.slug = dup[4]!.slug;
  assert.match(boardIssue(dup, s)!, /twice/);
  const missing = { ...s, watchlist: [...s.watchlist, 'live-0'] };
  assert.match(boardIssue(rows, missing)!, /watchlist slug live-0/);
  const flat = rows.map((r) => ({ ...r, implied_value_usd: 5 }));
  assert.match(boardIssue(flat, s)!, /same/);
  const shortStep = rows.map((r) => ({ ...r }));
  shortStep[2]!.farm_steps = ['too short', 'x'.repeat(30), 'y'.repeat(30)];
  assert.match(boardIssue(shortStep, s)!, /farm step of 9/);
});

test('parseSnapshot refuses bad input and normalises placeholders', () => {
  assert.throws(() => parseSnapshot('{'), SnapshotError);
  assert.throws(() => parseSnapshot('[]'), SnapshotError);
  assert.throws(() => parseSnapshot(JSON.stringify({ as_of: 'today', protocols: [], watchlist: [] })), SnapshotError);
  assert.throws(() => parseSnapshot(JSON.stringify({ as_of: '2026-11-14', protocols: [{ slug: 'a' }, { slug: 'a' }], watchlist: [] })), /duplicate/);
  assert.throws(() => parseSnapshot(JSON.stringify({ as_of: '2026-11-14', protocols: [], watchlist: ['ghost'] })), /ghost/);
  const s = parseSnapshot(JSON.stringify({ as_of: '2026-11-14', protocols: [{ slug: 'a', name: 'A', symbol: '-', tvl_usd: 'x', chains: null }], watchlist: [] }));
  assert.equal(s.protocols[0]!.symbol, null);
  assert.equal(s.protocols[0]!.tvl_usd, 0);
  assert.deepEqual(s.protocols[0]!.chains, []);
});

test('main.ts writes the same bytes twice and a dossier the vendor library agrees with', { skip: !existsSync(join(root, 'screenshots', '1-board.png')) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-'));
  const input = join(dir, 'snapshot.json');
  writeFileSync(input, JSON.stringify(fixture()));
  const run = (o: string): void => { execFileSync(process.execPath, [join(root, 'main.ts'), '--input', input, '--output', o], { stdio: 'pipe' }); };
  run(join(dir, 'a'));
  run(join(dir, 'b'));
  for (const f of ['board.json', 'data.js', 'dossier.json']) {
    assert.ok(readFileSync(join(dir, 'a', f)).equals(readFileSync(join(dir, 'b', f))), `${f} differs between runs`);
  }
  const board = JSON.parse(readFileSync(join(dir, 'a', 'board.json'), 'utf8'));
  assert.ok(board.rows.length >= 100);
});
