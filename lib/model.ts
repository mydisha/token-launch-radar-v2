// The value model: what a protocol's token would be worth if its record stayed as it is.
//
// Every number here comes from the snapshot. Protocols whose token already trades are the comparables:
// each gives a market-cap-to-TVL multiple. Multiples are pooled in log space by DefiLlama category, then
// shrunk in two steps (category toward its family, family toward a cautious prior) so a category with
// one or two comparables cannot set a price on its own. The shrunk multiple times the protocol's TVL is
// the base value; three bounded factors then adjust it: seven-day TVL growth, how long DefiLlama has
// tracked it with no token, and how many chains it reaches. No protocol name is ever special-cased.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {}

/** Tunable constants of the model, all in one place so the dashboard can print them. */
export const MODEL = {
  version: 'comparables-shrink-2',
  /** Multiples are clipped to this band before pooling: a 400x prediction market is one outlier. */
  clip_min: 0.005,
  clip_max: 20,
  /** Pseudo-count: a category with k comparables sits halfway between its own median and its family's. */
  shrink_k: 3,
  /** The prior is the live market's median multiple times this haircut: an untraded token is worth less. */
  prior_haircut: 0.5,
  /** Growth: each +1% of 7-day TVL growth moves value by growth_slope %, bounded. */
  growth_slope: 0.6,
  growth_clip: 40,
  growth_min: 0.76,
  growth_max: 1.24,
  /** Time tracked with no token: young protocols are discounted, two years of record earns the full lift. */
  age_floor: 0.8,
  age_full_days: 730,
  age_max: 1.15,
  age_unknown: 0.9,
  /** Chain reach: log2 of the chain count, bounded. */
  reach_per_doubling: 0.06,
  reach_max: 1.25,
} as const;

/** Categories whose rows are a wrapped, staked or bridged product, or an exchange, not a launch of their own. */
export const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** DefiLlama categories grouped into families, so a thin category borrows from its neighbours. */
const FAMILY_OF: Record<string, string> = {
  Dexs: 'Trading', Derivatives: 'Trading', Options: 'Trading', 'Prediction Market': 'Trading', 'Interest Rate Derivatives': 'Trading',
  Synthetics: 'Trading', 'OTC Marketplace': 'Trading', 'NFT Marketplace': 'Trading', Launchpad: 'Trading',
  Lending: 'Credit', CDP: 'Credit', 'CDP Manager': 'Credit', 'Uncollateralized Lending': 'Credit', 'Collateral Markets': 'Credit',
  'Collateral Management': 'Credit', Insurance: 'Credit',
  Yield: 'Yield', 'Yield Aggregator': 'Yield', 'Risk Curators': 'Yield', 'Onchain Capital Allocator': 'Yield', 'Basis Trading': 'Yield',
  'Liquidity Manager': 'Yield', 'Leveraged Farming': 'Yield', Farm: 'Yield', Indexes: 'Yield', 'Options Vault': 'Yield',
  'Governance Incentives': 'Yield', 'Token Locker': 'Yield',
  'Liquid Staking': 'Staking', 'Liquid Restaking': 'Staking', Restaking: 'Staking', 'Staking Pool': 'Staking', 'Restaked BTC': 'Staking',
  'Anchor BTC': 'Staking', 'Decentralized BTC': 'Staking', Chain: 'Staking',
  RWA: 'Money', 'Stablecoin Issuer': 'Money', 'Stablecoin Wrapper': 'Money', 'Dual-Token Stablecoin': 'Money', 'Algo-Stables': 'Money',
  'Reserve Currency': 'Money', CeDeFi: 'Money', Payments: 'Money', 'Crypto Card Issuer': 'Money', DOR: 'Money',
  Bridge: 'Infra', 'Canonical Bridge': 'Infra', 'Cross Chain Bridge': 'Infra', CEX: 'Infra', Privacy: 'Infra', 'AI Agents': 'Infra',
  'Decentralized AI': 'Infra',
};

export function familyOf(category: string | null): string {
  return (category !== null && FAMILY_OF[category]) || 'Other';
}

export const isPreToken = (p: Protocol): boolean => p.gecko_id === null && p.symbol === null;
export const isLive = (p: Protocol): boolean => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;

/** A pre-token protocol that is a launch of its own: not a product, version or exchange wrapper. */
export function isCandidate(p: Protocol): boolean {
  if (!isPreToken(p) || p.tvl_usd <= 0) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  return !VERSIONED.test(p.name) && !PRODUCT_WORD.test(p.name) && !EXCHANGE_PREFIX.test(p.name);
}

const DAY_MS = 86_400_000;
/** Whole days DefiLlama has tracked the protocol as of the snapshot, or null when it reports no date. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`)) / DAY_MS);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round = (x: number, places: number): number => Math.round(x * 10 ** places) / 10 ** places;

/** One pooled group of comparables, in log space. */
export interface Pool {
  n: number;
  /** Median log multiple of the group itself (NaN when empty). */
  raw_log: number;
  /** Half the interquartile range in log space, after shrinkage: the spread of the low and high case. */
  spread_log: number;
  /** The shrunk log multiple the model uses. */
  log: number;
}

export interface Comparable {
  slug: string;
  name: string;
  category: string | null;
  family: string;
  symbol: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

export interface Comparables {
  live: Comparable[];
  prior: Pool;
  family: Map<string, Pool>;
  category: Map<string, Pool>;
}

/** Shrink a group's median toward a parent: weight n / (n + k). */
function shrink(logs: number[], parent: Pool, k: number): Pool {
  const sorted = [...logs].sort((a, b) => a - b);
  const n = sorted.length;
  const w = n / (n + k);
  const raw = median(sorted);
  const ownSpread = n >= 2 ? (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / 2 : parent.spread_log;
  return {
    n,
    raw_log: raw,
    log: n === 0 ? parent.log : w * raw + (1 - w) * parent.log,
    spread_log: n === 0 ? parent.spread_log : w * ownSpread + (1 - w) * parent.spread_log,
  };
}

/** Build the comparables table from every protocol whose token trades. */
export function buildComparables(protocols: Protocol[]): Comparables {
  const live: Comparable[] = protocols.filter(isLive).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    family: familyOf(p.category),
    symbol: p.symbol,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd!,
    multiple: p.mcap_usd! / p.tvl_usd,
  }));
  const logOf = (c: Comparable): number => Math.log(clamp(c.multiple, MODEL.clip_min, MODEL.clip_max));
  // A wrapper's TVL is mostly another protocol's token (staked ETH, bridged BTC, exchange deposits), so its
  // multiple says little about a launch: product categories keep a pool of their own for reference but
  // never feed a family or the prior.
  const pooled = live.filter((c) => c.category === null || !PRODUCT_CATEGORIES.has(c.category));
  const all = pooled.map(logOf).sort((a, b) => a - b);
  const marketMedian = all.length > 0 ? median(all) : Math.log(0.2);
  const prior: Pool = {
    n: all.length,
    raw_log: marketMedian,
    log: marketMedian + Math.log(MODEL.prior_haircut),
    spread_log: all.length >= 4 ? (quantile(all, 0.75) - quantile(all, 0.25)) / 2 : 1,
  };
  const group = (from: Comparable[], key: (c: Comparable) => string): Map<string, number[]> => {
    const out = new Map<string, number[]>();
    for (const c of from) {
      const k = key(c);
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(logOf(c));
    }
    return out;
  };
  const family = new Map<string, Pool>();
  for (const [k, logs] of group(pooled, (c) => c.family)) family.set(k, shrink(logs, prior, MODEL.shrink_k));
  const category = new Map<string, Pool>();
  for (const [k, logs] of group(live, (c) => c.category ?? '')) {
    const parent = family.get(familyOf(k === '' ? null : k)) ?? prior;
    category.set(k, shrink(logs, parent, MODEL.shrink_k));
  }
  live.sort((a, b) => b.mcap_usd - a.mcap_usd || a.slug.localeCompare(b.slug));
  return { live, prior, family, category };
}

/** The pool a protocol is priced from: its category, else its family, else the prior. */
export function poolFor(p: Protocol, comps: Comparables): { pool: Pool; basis: 'category' | 'family' | 'prior' } {
  const cat = comps.category.get(p.category ?? '');
  if (cat !== undefined) return { pool: cat, basis: 'category' };
  const fam = comps.family.get(familyOf(p.category));
  if (fam !== undefined) return { pool: fam, basis: 'family' };
  return { pool: comps.prior, basis: 'prior' };
}

export function growthFactor(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  const g = clamp(change7d, -MODEL.growth_clip, MODEL.growth_clip);
  return clamp(1 + (MODEL.growth_slope * g) / 100, MODEL.growth_min, MODEL.growth_max);
}

export function ageFactor(days: number | null): number {
  if (days === null) return MODEL.age_unknown;
  const t = Math.min(days, MODEL.age_full_days) / MODEL.age_full_days;
  return MODEL.age_floor + (MODEL.age_max - MODEL.age_floor) * t;
}

export function reachFactor(chainCount: number): number {
  const n = Math.max(1, chainCount);
  return Math.min(MODEL.reach_max, 1 + MODEL.reach_per_doubling * Math.log2(n));
}

export interface Valuation {
  basis: 'category' | 'family' | 'prior';
  comparables: number;
  base_multiple: number;
  growth_factor: number;
  age_factor: number;
  reach_factor: number;
  age_days: number | null;
  multiple: number;
  implied_value_usd: number;
  low_usd: number;
  high_usd: number;
  confidence: 'high' | 'medium' | 'low';
}

/** The implied value of one protocol's token, with its low and high case. */
export function valueOf(p: Protocol, asOf: string, comps: Comparables): Valuation {
  const { pool, basis } = poolFor(p, comps);
  const base = Math.exp(pool.log);
  const age = ageDays(asOf, p.listed_at);
  const g = growthFactor(p.change_7d);
  const a = ageFactor(age);
  const r = reachFactor(p.chains.length);
  const multiple = base * g * a * r;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
  const spread = Math.exp(pool.spread_log);
  const n = basis === 'category' ? pool.n : 0;
  return {
    basis,
    comparables: n,
    base_multiple: round(base, 4),
    growth_factor: round(g, 4),
    age_factor: round(a, 4),
    reach_factor: round(r, 4),
    age_days: age,
    multiple: round(multiple, 4),
    implied_value_usd: implied,
    low_usd: Math.max(1, Math.round(implied / spread)),
    high_usd: Math.max(1, Math.round(implied * spread)),
    confidence: n >= 6 ? 'high' : n >= 2 ? 'medium' : 'low',
  };
}

/** Parse and check the snapshot's shape; throws SnapshotError on anything the model cannot read. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new SnapshotError(`snapshot is not JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('as_of is not a YYYY-MM-DD date');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('protocols is not an array');
  if (!Array.isArray(o.watchlist)) throw new SnapshotError('watchlist is not an array');
  const seen = new Set<string>();
  const protocols: Protocol[] = o.protocols.map((x, i) => {
    const p = x as Record<string, unknown>;
    if (typeof p.slug !== 'string' || p.slug === '') throw new SnapshotError(`protocols[${i}] has no slug`);
    if (seen.has(p.slug)) throw new SnapshotError(`protocols[${i}]: duplicate slug ${p.slug}`);
    seen.add(p.slug);
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' && v !== '-' ? v : null);
    return {
      slug: p.slug,
      name: str(p.name) ?? p.slug,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: Math.max(0, num(p.tvl_usd) ?? 0),
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: typeof p.listed_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.listed_at) ? p.listed_at : null,
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  const watchlist = o.watchlist.filter((s): s is string => typeof s === 'string');
  for (const s of watchlist) if (!seen.has(s)) throw new SnapshotError(`watchlist names ${s}, which protocols does not list`);
  return {
    as_of: o.as_of,
    source: typeof o.source === 'string' ? o.source : '',
    floor_usd: num0(o.floor_usd),
    protocols,
    watchlist,
  };
}
function num0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
