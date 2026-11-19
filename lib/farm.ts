// Farm plans: how a reader positions in a protocol that records no token, before or after it issues one.
//
// A plan is built from the protocol's own row: its category picks the playbook, its chains pick where
// to act (the cheapest chain it runs on), its TVL sizes the position, its tracked age sets the holding
// window and its seven-day TVL change sets the risk rule. Every step states what it costs in dollars
// and how long it takes. Gas figures are typical costs of one transaction per chain, not quotes.

import type { Protocol, Valuation } from './model.ts';
import { familyOf } from './model.ts';

export interface Step {
  action: string;
  cost_usd: number;
  minutes: number;
}

export interface Plan {
  chain: string;
  capital_usd: number;
  hold_days: number;
  /** Gas, bridge, swap and pool fees summed over the steps. */
  steps_usd: number;
  /** The risk-free yield the capital gives up over the holding window. */
  carry_usd: number;
  cost_usd: number;
  hands_on_minutes: number;
  /** Pro-rata share of a community allocation if the token prices at the implied value. */
  payoff_usd: number;
  payoff_ratio: number;
  steps: Step[];
}

/** Typical dollars for one swap or deposit transaction. */
const GAS_USD: Record<string, number> = {
  Ethereum: 4, Bitcoin: 3, Tron: 1.2, Binance: 0.12, BSC: 0.12, Arbitrum: 0.08, Optimism: 0.06, Base: 0.04, Polygon: 0.02,
  Avalanche: 0.1, Linea: 0.06, Scroll: 0.06, Mantle: 0.04, Unichain: 0.03, Ink: 0.03, Sonic: 0.02, Berachain: 0.03, Katana: 0.03,
  Solana: 0.01, Sui: 0.02, Aptos: 0.01, Monad: 0.02, 'Hyperliquid L1': 0.01, Plasma: 0.01, Stellar: 0.01, Flare: 0.02,
  'Plume Mainnet': 0.02, Hemi: 0.05, TAC: 0.03, Starknet: 0.05, Morph: 0.03, Arc: 0.02, 'Robinhood Chain': 0.03, Ripple: 0.01,
  Near: 0.01, Ton: 0.03, Algorand: 0.01, Cardano: 0.2, Cosmos: 0.02, Noble: 0.02,
};
const DEFAULT_GAS = 0.25;
/** Chains a newcomer cannot reach with an ordinary wallet and a bridge. */
const HARD_CHAINS = new Set(['Bitcoin', 'Ripple', 'Off Chain', 'Lightning']);

/** Risk-free alternative the capital gives up while it sits in the protocol, per year. */
export const CARRY_RATE = 0.045;
/** Share of a token's supply assumed to reach users who farmed before launch. */
export const COMMUNITY_SHARE = 0.08;

export const gasFor = (chain: string): number => GAS_USD[chain] ?? DEFAULT_GAS;

/**
 * The chain to act on: the cheaper of the first two chains DefiLlama lists for the protocol (where its
 * deposits sit) that a wallet can reach, Ethereum when none. A cheap chain far down the list may hold
 * only a token bridge's dust, so it is not considered.
 */
export function planChain(p: Protocol): string {
  const reachable = p.chains.filter((c) => !HARD_CHAINS.has(c)).slice(0, 2);
  const pool = reachable.length > 0 ? reachable : p.chains;
  if (pool.length === 0) return 'Ethereum';
  return [...pool].sort((a, b) => gasFor(a) - gasFor(b) || a.localeCompare(b))[0]!;
}

/** Position size: small enough to stay a rounding error of the protocol's TVL, big enough to register. */
export function capitalFor(tvl: number): number {
  if (tvl < 20e6) return 1_000;
  if (tvl < 100e6) return 2_500;
  if (tvl < 500e6) return 5_000;
  return 10_000;
}

/** Holding window: a young protocol has a long runway to a launch, an old one either launches soon or never. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 90;
  if (age < 180) return 150;
  if (age < 540) return 120;
  if (age < 1080) return 90;
  return 60;
}

const usd = (n: number): string => (n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`);
const dur = (min: number): string => (min >= 1440 ? `${Math.round(min / 1440)} days` : min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`);

/** Render one step as the board's farm_steps text: the action, then its cost and time. */
export function stepText(s: Step): string {
  return `${s.action} Cost: ${usd(s.cost_usd)}. Time: ${dur(s.minutes)}.`;
}

interface Ctx {
  p: Protocol;
  chain: string;
  gas: number;
  cap: number;
  hold: number;
  weeks: number;
  cat: string;
}

/** The category's own actions: what using this kind of protocol looks like, in 2 to 3 steps. */
function playbook(c: Ctx): Step[] {
  const { p, chain, gas, cap, cat } = c;
  const fam = familyOf(p.category);
  const half = Math.round(cap / 2);
  if (cat === 'Lending' || cat === 'Uncollateralized Lending' || cat === 'Collateral Markets') {
    return [
      { action: `Supply ${usd(cap)} of USDC (or the market's main stablecoin) to ${p.name} on ${chain}; approve and deposit are two transactions.`, cost_usd: gas * 2, minutes: 10 },
      { action: `Borrow ${usd(Math.round(cap * 0.3))} against it (30% loan-to-value, health factor above 2) so the account shows both sides of the market; park the loan in a stable pool.`, cost_usd: gas * 2, minutes: 10 },
    ];
  }
  if (cat === 'CDP' || cat === 'CDP Manager') {
    return [
      { action: `Deposit ${usd(cap)} of the accepted collateral into a ${p.name} vault on ${chain} and mint its stablecoin at a 250%+ collateral ratio (${usd(Math.round(cap / 2.5))} minted).`, cost_usd: gas * 3, minutes: 15 },
      { action: `Put the minted stablecoin into ${p.name}'s own stability or savings pool rather than selling it, so both minting and holding count.`, cost_usd: gas * 2, minutes: 10 },
    ];
  }
  if (fam === 'Trading') {
    return [
      { action: `Provide ${usd(half)} of liquidity on ${p.name} on ${chain} in its deepest stable or major pair, a wide range so it needs no rebalancing.`, cost_usd: gas * 3 + half * 0.001, minutes: 15 },
      { action: `Trade ${usd(half)} through ${p.name} once a week (round trip in a major pair); budget 0.1% fees and slippage per trade over the window.`, cost_usd: (gas * 2 + half * 0.002) * c.weeks, minutes: 10 * c.weeks },
    ];
  }
  if (cat === 'Basis Trading' || cat === 'Stablecoin Wrapper' || cat === 'Dual-Token Stablecoin' || cat === 'Algo-Stables') {
    return [
      { action: `Mint ${usd(cap)} of ${p.name}'s dollar token on ${chain} from USDC (check the mint fee and any minimum first), then stake it into the yield-bearing version.`, cost_usd: gas * 3 + cap * 0.001, minutes: 15 },
      { action: `Put a quarter of the staked token into a pool or money market that lists it, which most points programs weight above idle holding.`, cost_usd: gas * 2, minutes: 10 },
    ];
  }
  if (cat === 'RWA' || cat === 'CeDeFi') {
    return [
      { action: `Complete ${p.name}'s onboarding (KYC or accredited check where it asks; some products bar US persons) before moving money.`, cost_usd: 0, minutes: 2880 },
      { action: `Subscribe ${usd(cap)} to its most liquid product on ${chain}; note the redemption delay, often 1 to 5 days, before sizing.`, cost_usd: gas * 2, minutes: 20 },
    ];
  }
  if (fam === 'Yield') {
    return [
      { action: `Deposit ${usd(cap)} of USDC into ${p.name}'s largest vault on ${chain} (approve, deposit); pick a stablecoin vault over a volatile one.`, cost_usd: gas * 2, minutes: 10 },
      { action: `Read the vault's allocation page and withdrawal queue; vaults that lend to one market can lock exits for hours when it is fully used.`, cost_usd: 0, minutes: 20 },
    ];
  }
  if (cat === 'Chain' || fam === 'Staking') {
    return [
      { action: `Bridge ${usd(cap)} to ${chain} and stake or delegate through ${p.name}'s own staking or restaking flow; note the unbonding period.`, cost_usd: gas * 3 + cap * 0.0005, minutes: 30 },
      { action: `Use three other apps on the same network once each (a swap, a lend, a mint): ecosystem activity is what network launches tend to count.`, cost_usd: gas * 6, minutes: 30 },
    ];
  }
  if (cat === 'Payments') {
    return [
      { action: `Set up a non-custodial ${p.name} wallet and route ${usd(Math.min(cap, 500))} of payments through it over the window, paying real merchants or friends.`, cost_usd: gas * 4, minutes: 60 },
      { action: `Keep a small balance live in the network (an open channel or funded account) rather than moving in and out in one day.`, cost_usd: gas, minutes: 15 },
    ];
  }
  if (cat === 'Insurance') {
    return [
      { action: `Underwrite ${usd(half)} in ${p.name}'s cover pool on ${chain}, or buy cover on a position you already hold; both sides are users.`, cost_usd: gas * 2 + half * 0.02 * (c.hold / 365), minutes: 20 },
      { action: `Check the pool's claim history and lockup before depositing: underwriting capital can be cut by a paid claim.`, cost_usd: 0, minutes: 20 },
    ];
  }
  return [
    { action: `Use ${p.name}'s core product on ${chain} with ${usd(cap)}: deposit into its main pool or make its main kind of transaction, two transactions in all.`, cost_usd: gas * 2, minutes: 15 },
    { action: `Repeat a small action every week over the window so the account shows a steady history, not a one-day visit.`, cost_usd: gas * c.weeks, minutes: 5 * c.weeks },
  ];
}

/** The whole costed plan for one protocol. */
export function farmPlan(p: Protocol, v: Valuation): Plan {
  const chain = planChain(p);
  const gas = gasFor(chain);
  const cap = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(v.age_days);
  const weeks = Math.max(1, Math.round(hold / 7));
  const ctx: Ctx = { p, chain, gas, cap, hold, weeks, cat: p.category ?? '' };
  const falling = p.change_7d !== null && p.change_7d <= -10;
  const rising = p.change_7d !== null && p.change_7d >= 10;
  const multiChain = p.chains.length > 1 ? `; it runs on ${p.chains.length} chains and ${chain} is the cheapest of its leading ones` : '';
  const carry = cap * CARRY_RATE * (hold / 365);

  const steps: Step[] = [
    {
      action: `Verify ${p.name} through its DefiLlama listing and docs (contract addresses, audits, any points or rewards page) and bookmark the official app${multiChain}.`,
      cost_usd: 0,
      minutes: 30,
    },
    {
      action: `Fund a fresh wallet on ${chain} with ${usd(cap)} of USDC plus gas; bridging from a CEX or another chain costs about 0.05% and one transaction.`,
      cost_usd: gas + cap * 0.0005,
      minutes: 20,
    },
    ...playbook(ctx),
  ];
  if (falling) {
    steps.push({
      action: `TVL fell ${Math.abs(p.change_7d!).toFixed(1)}% in 7 days: enter with half the size first, and exit if it falls another 20% or withdrawals start queueing.`,
      cost_usd: gas * 2,
      minutes: 15,
    });
  } else if (rising) {
    steps.push({
      action: `TVL grew ${p.change_7d!.toFixed(1)}% in 7 days, so points per dollar are diluting: enter in the first week rather than averaging in.`,
      cost_usd: 0,
      minutes: 5,
    });
  }
  steps.push(
    {
      action: `Hold for ${hold} days and check the position weekly (${weeks} checks): balance, any points total and announcements of a snapshot date. The cost is the ${(CARRY_RATE * 100).toFixed(1)}% risk-free yield the capital gives up.`,
      cost_usd: carry,
      minutes: 5 * weeks,
    },
    {
      action: `If a token launches, claim on day one, sell enough to cover the plan's cost and decide on the rest against the implied value on this board; if none by day ${hold}, withdraw.`,
      cost_usd: gas * 3,
      minutes: 30,
    },
  );

  const cost = steps.reduce((s, x) => s + x.cost_usd, 0);
  const txGas = cost - carry;
  const timeWeight = Math.min(1, hold / 365);
  const payoff = (cap / Math.max(1, p.tvl_usd)) * COMMUNITY_SHARE * v.implied_value_usd * (0.5 + timeWeight);
  const r2 = (n: number): number => Math.round(n * 100) / 100;
  return {
    chain,
    capital_usd: cap,
    hold_days: hold,
    steps_usd: r2(txGas),
    carry_usd: r2(carry),
    cost_usd: r2(cost),
    hands_on_minutes: steps.reduce((s, x) => s + x.minutes, 0),
    payoff_usd: r2(payoff),
    payoff_ratio: r2(payoff / Math.max(cost, 0.01)),
    steps: steps.map((s) => ({ action: s.action, cost_usd: r2(s.cost_usd), minutes: s.minutes })),
  };
}
