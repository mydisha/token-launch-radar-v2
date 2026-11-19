# token-launch-radar-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mydisha/token-launch-radar-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mydisha/token-launch-radar-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar. It ranks every protocol in the snapshot that records no token (198 rows, every watchlist slug included) by what its token would be worth if the protocol's record stayed as it is, and gives each one a farm plan whose every step states its cost and time.

**Value model** (`lib/model.ts`). The 128 protocols whose token already trades are the comparables: each gives a market-cap-to-TVL multiple. Multiples are clipped, pooled in log space by DefiLlama category and shrunk in two steps, category toward its family and family toward a cautious prior (half the live median), with weight n/(n+3), so a category with one comparable cannot price itself. Wrapped, staked, bridged and exchange categories keep their own pool for reference but never feed a family or the prior. The shrunk multiple times TVL is then adjusted by three bounded factors: seven-day TVL growth, days tracked with no token, and chain reach. Each row carries a low and high case from the pool's spread and a confidence from its comparable count. No protocol is named in the code.

**Farm plans** (`lib/farm.ts`). The category picks the playbook (supply and borrow, mint and stake, LP and trade, vault deposit, onboarding, staking), the cheaper of the protocol's two leading chains picks where to act, TVL sizes the position, tracked age sets the holding window and a falling or rising TVL adds a risk rule. Costs are gas and fees per step plus the risk-free yield the capital gives up; the payoff is the position's pro-rata share of an 8% community allocation at the implied value.

**Dashboard** (`dashboard/`). A static page with no network: sortable board, search and filters (family, category, chain, TVL, confidence, watchlist, growing), a detail panel and full detail view (value build-up, comparables, peers, a strip of what each comparable would price it at, the board's TVL-to-value scatter), the value model's tables and the live tokens set aside.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
node --test tests/radar.test.ts
```

`main.ts` writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output folder; open `out/dashboard/index.html` to read the board. Output is deterministic and needs only Node 22.18 or later. Implied values are this board's own estimate, not a prediction that any token will launch.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
