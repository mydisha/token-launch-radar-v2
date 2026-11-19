// The ranked board, the gate's own checks on it, and the data the dashboard reads.

import { CARRY_RATE, COMMUNITY_SHARE, farmPlan, stepText, type Plan } from './farm.ts';
import {
  MODEL, buildComparables, familyOf, isCandidate, isPreToken, valueOf,
  type Comparables, type Protocol, type Snapshot, type Valuation,
} from './model.ts';

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  low_usd: number;
  high_usd: number;
  category: string | null;
  family: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  watchlist: boolean;
  status: 'pre-token';
  valuation: Valuation;
  plan: Plan;
  farm_steps: string[];
}

/** Every protocol the board ranks: each candidate, and every watchlist slug whatever the filter says. */
export function boardProtocols(s: Snapshot): Protocol[] {
  const watch = new Set(s.watchlist);
  return s.protocols.filter((p) => watch.has(p.slug) || isCandidate(p));
}

export function buildBoard(s: Snapshot, comps: Comparables = buildComparables(s.protocols)): BoardRow[] {
  const watch = new Set(s.watchlist);
  const rows = boardProtocols(s).map((p): BoardRow => {
    const valuation = valueOf(p, s.as_of, comps);
    const plan = farmPlan(p, valuation);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      implied_value_usd: valuation.implied_value_usd,
      low_usd: valuation.low_usd,
      high_usd: valuation.high_usd,
      category: p.category,
      family: familyOf(p.category),
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      watchlist: watch.has(p.slug),
      status: 'pre-token',
      valuation,
      plan,
      farm_steps: plan.steps.map(stepText),
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/** The scorer's checks on board.json, run before writing: the first problem, or null. */
export function boardIssue(rows: BoardRow[], s: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, not 100 to 4,000`;
  const known = new Set(s.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    if (!/^\S{1,128}$/.test(r.slug) || !known.has(r.slug)) return `row ${i}: slug ${r.slug} is not a snapshot protocol`;
    if (seen.has(r.slug)) return `row ${i}: slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.name.trim() === '') return `row ${i}: empty name`;
    if (r.rank !== i + 1) return `row ${i}: rank ${r.rank} is not ${i + 1}`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) return `row ${i}: implied value ${r.implied_value_usd} out of range`;
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i}: implied value rises as rank ascends`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${i}: ${r.farm_steps.length} farm steps`;
    for (const t of r.farm_steps) {
      const n = t.trim().length;
      if (n < 20 || n > 600) return `row ${i}: a farm step of ${n} characters`;
    }
  }
  if (rows.every((r) => r.implied_value_usd === rows[0]!.implied_value_usd)) return 'every implied value is the same';
  for (const w of s.watchlist) if (!seen.has(w)) return `watchlist slug ${w} is missing`;
  return null;
}

/** The board as board.json carries it: the gate's five fields plus the model's own columns. */
export function boardJson(rows: BoardRow[], s: Snapshot): string {
  const out = rows.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    implied_value_usd: r.implied_value_usd,
    low_usd: r.low_usd,
    high_usd: r.high_usd,
    category: r.category,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    age_days: r.valuation.age_days,
    multiple: r.valuation.multiple,
    basis: r.valuation.basis,
    watchlist: r.watchlist,
    farm_cost_usd: r.plan.cost_usd,
    farm_steps: r.farm_steps,
  }));
  return `${JSON.stringify({ as_of: s.as_of, model: MODEL.version, rows: out })}\n`;
}

/** The dashboard's data, as a script that sets window.RADAR. Compact keys keep it small. */
export function dataScript(rows: BoardRow[], s: Snapshot, comps: Comparables): string {
  const pools = [...comps.category.entries()]
    .map(([category, p]) => ({ category, family: familyOf(category === '' ? null : category), n: p.n, raw: +Math.exp(p.raw_log).toFixed(4), used: +Math.exp(p.log).toFixed(4) }))
    .sort((a, b) => b.n - a.n || a.category.localeCompare(b.category));
  const families = [...comps.family.entries()]
    .map(([family, p]) => ({ family, n: p.n, raw: +Math.exp(p.raw_log).toFixed(4), used: +Math.exp(p.log).toFixed(4) }))
    .sort((a, b) => a.family.localeCompare(b.family));
  const data = {
    as_of: s.as_of,
    source: s.source,
    floor_usd: s.floor_usd,
    counts: {
      protocols: s.protocols.length,
      pre_token: s.protocols.filter(isPreToken).length,
      live: comps.live.length,
      watchlist: s.watchlist.length,
      rows: rows.length,
    },
    model: MODEL,
    farm: { carry_rate: CARRY_RATE, community_share: COMMUNITY_SHARE },
    prior: { market: +Math.exp(comps.prior.raw_log).toFixed(4), used: +Math.exp(comps.prior.log).toFixed(4), n: comps.prior.n },
    families,
    pools,
    live: comps.live.map((c) => ({ s: c.slug, n: c.name, c: c.category, y: c.symbol, t: c.tvl_usd, m: c.mcap_usd, x: +c.multiple.toFixed(4) })),
    rows: rows.map((r) => ({
      r: r.rank,
      s: r.slug,
      n: r.name,
      c: r.category,
      f: r.family,
      ch: r.chains,
      t: r.tvl_usd,
      d: r.change_7d,
      l: r.listed_at,
      w: r.watchlist ? 1 : 0,
      v: r.implied_value_usd,
      lo: r.low_usd,
      hi: r.high_usd,
      val: r.valuation,
      plan: r.plan,
    })),
  };
  return `window.RADAR=${JSON.stringify(data)};\n`;
}
