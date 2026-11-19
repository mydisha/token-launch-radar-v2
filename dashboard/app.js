// Launch Radar page: reads window.RADAR (written by main.ts into ../data.js) and renders the board,
// a detail view per protocol, the value model and the live-token comparables. No framework, no network.
// State lives in the URL hash (view, filters, sort, selected protocol) so every view can be linked.
(function () {
  'use strict';
  var D = window.RADAR;
  var main = document.getElementById('main');
  if (!D || !D.rows) {
    main.innerHTML = '<p class="empty">No board data: run <code>node main.ts</code> to write data.js beside this page.</p>';
    return;
  }

  // ---------- formatting ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
    return '$' + n.toFixed(n >= 100 ? 0 : 2);
  }
  function pct(n) {
    if (n == null) return '<span class="faint">n/a</span>';
    var cls = n > 0.5 ? 'up' : n < -0.5 ? 'down' : 'muted';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function x(n) { return n.toFixed(n < 0.1 ? 3 : 2) + '×'; }
  function age(d) { return d == null ? '<span class="faint">unknown</span>' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function mins(m) { return m >= 1440 ? Math.round(m / 1440) + ' d' : m >= 60 ? (m / 60).toFixed(m >= 600 ? 0 : 1) + ' h' : m + ' min'; }

  // ---------- derived ----------
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { r.age = r.val.age_days; r.x = r.val.multiple; r.cost = r.plan.cost_usd; r.pay = r.plan.payoff_ratio; bySlug[r.s] = r; });
  var families = uniq(rows.map(function (r) { return r.f; }));
  var categories = uniq(rows.map(function (r) { return r.c || 'Uncategorised'; }));
  var chainCount = {};
  rows.forEach(function (r) { r.ch.forEach(function (c) { chainCount[c] = (chainCount[c] || 0) + 1; }); });
  var chains = Object.keys(chainCount).sort(function (a, b) { return chainCount[b] - chainCount[a] || (a < b ? -1 : 1); }).slice(0, 24);
  var maxLogV = Math.log(rows[0].hi), minLogV = Math.log(Math.max(1, Math.min.apply(null, rows.map(function (r) { return r.lo; }))));
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }).sort(); }

  // ---------- state in the hash ----------
  var DEFAULTS = { view: 'board', q: '', fam: '', cat: '', chain: '', min: '0', watch: '', grow: '', conf: '', sort: 'v', dir: 'desc', p: '' };
  var S = {};
  function readHash() {
    S = Object.assign({}, DEFAULTS);
    location.hash.replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) { var k = kv.slice(0, i); if (k in DEFAULTS) S[k] = decodeURIComponent(kv.slice(i + 1)); }
    });
    if (!bySlug[S.p]) S.p = '';
  }
  function writeHash(replace) {
    var parts = [];
    Object.keys(DEFAULTS).forEach(function (k) { if (S[k] !== DEFAULTS[k]) parts.push(k + '=' + encodeURIComponent(S[k])); });
    var h = '#' + parts.join('&');
    if (replace) history.replaceState(null, '', h); else if (location.hash !== h) location.hash = h;
    render();
  }

  // ---------- filtering and sorting ----------
  function filtered() {
    var q = S.q.trim().toLowerCase();
    var min = +S.min * 1e6;
    var out = rows.filter(function (r) {
      if (q && (r.n + ' ' + r.s + ' ' + (r.c || '')).toLowerCase().indexOf(q) < 0) return false;
      if (S.fam && r.f !== S.fam) return false;
      if (S.cat && (r.c || 'Uncategorised') !== S.cat) return false;
      if (S.chain && r.ch.indexOf(S.chain) < 0) return false;
      if (r.t < min) return false;
      if (S.watch && !r.w) return false;
      if (S.grow && !(r.d > 0)) return false;
      if (S.conf && r.val.confidence !== S.conf) return false;
      return true;
    });
    var k = S.sort, dir = S.dir === 'asc' ? 1 : -1;
    out.sort(function (a, b) {
      var va = k === 'n' ? a.n.toLowerCase() : a[k], vb = k === 'n' ? b.n.toLowerCase() : b[k];
      if (va == null && vb == null) return a.r - b.r;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va < vb ? -dir : va > vb ? dir : a.r - b.r;
    });
    return out;
  }

  // ---------- header ----------
  function renderChrome() {
    document.getElementById('sub').textContent = 'Snapshot ' + D.as_of + ' · ' + D.counts.protocols + ' protocols, ' + D.counts.pre_token + ' record no token · model ' + D.model.version;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs a'), function (a) {
      var on = a.getAttribute('data-view') === (S.view === 'detail' ? 'board' : S.view);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var total = rows.reduce(function (s, r) { return s + r.v; }, 0);
    var watchV = rows.filter(function (r) { return r.w; });
    var med = rows.map(function (r) { return r.x; }).sort(function (a, b) { return a - b; })[rows.length >> 1];
    var k = [
      ['Pre-token ranked', rows.length, 'every candidate ≥ $5M TVL'],
      ['Watchlist covered', watchV.length + ' / ' + D.counts.watchlist, 'floor ' + money(D.floor_usd)],
      ['Live comparables', D.counts.live, 'tokens that trade, set aside'],
      ['Implied value, all rows', money(total), 'if every record holds'],
      ['Median multiple', x(med), 'implied value / TVL'],
      ['Market prior', x(D.prior.used), 'live median ' + x(D.prior.market) + ' × ' + D.model.prior_haircut],
    ];
    document.getElementById('kpis').innerHTML = k.map(function (c) {
      return '<div class="kpi"><span>' + esc(c[0]) + '</span><b>' + esc(c[1]) + '</b><small>' + esc(c[2]) + '</small></div>';
    }).join('');
    document.getElementById('foot').innerHTML = 'Source: ' + esc(D.source) + '. Implied value is this board’s own estimate of what a token would be worth if the protocol’s record stayed as it is; it predicts neither whether nor when a token launches. A protocol listed here records no token on DefiLlama, which is not proof it has none. Farm costs are typical gas and fee estimates, not quotes.';
  }

  // ---------- board ----------
  var COLS = [
    ['r', '#'], ['n', 'Protocol'], ['t', 'TVL'], ['d', '7d'], ['age', 'Tracked'], ['x', 'Mult.'], ['v', 'Implied value'], ['cost', 'Farm cost'], ['pay', 'Payoff'],
  ];
  function rangeBar(r) {
    var span = maxLogV - minLogV || 1;
    var a = (Math.log(r.lo) - minLogV) / span * 100, b = (Math.log(r.hi) - minLogV) / span * 100, m = (Math.log(r.v) - minLogV) / span * 100;
    return '<span class="range" title="low ' + money(r.lo) + ' to high ' + money(r.hi) + '"><i style="left:' + a.toFixed(1) + '%;width:' + Math.max(2, b - a).toFixed(1) + '%"></i><em style="left:' + m.toFixed(1) + '%"></em></span>';
  }
  function select(name, label, opts, val) {
    return '<label class="sr">' + '<select data-k="' + name + '" aria-label="' + esc(label) + '"><option value="">' + esc(label) + '</option>' +
      opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (v === val ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label>';
  }
  function chip(k, label) { return '<button class="chip" data-toggle="' + k + '" aria-pressed="' + (S[k] ? 'true' : 'false') + '">' + esc(label) + '</button>'; }

  function renderBoard() {
    var list = filtered();
    if (!S.p || (list.length && !list.some(function (r) { return r.s === S.p; }))) S.p = list.length ? list[0].s : '';
    var head = COLS.map(function (c) {
      var sort = S.sort === c[0] ? (S.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      return '<th scope="col" aria-sort="' + sort + '"><button data-sort="' + c[0] + '">' + c[1] + '</button></th>';
    }).join('');
    var body = list.map(function (r) {
      return '<tr data-slug="' + esc(r.s) + '" aria-selected="' + (r.s === S.p) + '" tabindex="0">' +
        '<td class="rank">' + r.r + '</td>' +
        '<td><span class="pname">' + esc(r.n) + '</span>' + (r.w ? '<span class="tag w" title="On the snapshot watchlist">WATCH</span>' : '') + '<span class="pcat">' + esc(r.c || 'Uncategorised') + ' · ' + r.ch.length + ' chain' + (r.ch.length === 1 ? '' : 's') + '</span></td>' +
        '<td>' + money(r.t) + '</td><td>' + pct(r.d) + '</td><td>' + age(r.age) + '</td><td>' + x(r.x) + '</td>' +
        '<td><span class="val">' + money(r.v) + '</span>' + rangeBar(r) + '</td>' +
        '<td>' + money(r.cost) + '</td><td>' + r.pay.toFixed(1) + '×</td></tr>';
    }).join('');
    var filters = '<div class="filters" role="search">' +
      '<input type="search" data-k="q" placeholder="Search protocol or category" aria-label="Search protocols" value="' + esc(S.q) + '">' +
      select('fam', 'All families', families, S.fam) +
      select('cat', 'All categories', categories, S.cat) +
      select('chain', 'All chains', chains, S.chain) +
      select('min', 'Any TVL', [['50', 'TVL ≥ $50M'], ['100', 'TVL ≥ $100M'], ['250', 'TVL ≥ $250M'], ['1000', 'TVL ≥ $1B']], S.min === '0' ? '' : S.min) +
      select('conf', 'Any confidence', [['high', 'High confidence'], ['medium', 'Medium confidence'], ['low', 'Low confidence']], S.conf) +
      chip('watch', 'Watchlist only') + chip('grow', 'Growing 7d') +
      '<span class="count">' + list.length + ' of ' + rows.length + ' protocols</span></div>';
    var table = list.length
      ? '<div class="tablewrap"><table aria-label="Pre-token protocols ranked by implied value"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>'
      : '<p class="empty">No protocol matches these filters. <button class="back" data-reset="1">Clear filters</button></p>';
    var sel = bySlug[S.p];
    main.innerHTML = '<div class="layout"><section class="card" aria-label="Board">' + filters + table + '</section>' +
      '<aside class="card detail" aria-label="Protocol detail">' + (sel ? detail(sel, false) : '<p class="empty">Select a protocol.</p>') + '</aside></div>';
  }

  // ---------- detail ----------
  function comparablesFor(r) {
    var same = D.live.filter(function (c) { return c.c === r.c; });
    var label = r.c || 'Uncategorised';
    if (same.length === 0) {
      same = D.live.filter(function (c) { return familyOfCat(c.c) === r.f; });
      label = r.f + ' family';
    }
    return { label: label, all: same, list: same.slice(0, 6) };
  }
  var famByCat = {};
  D.pools.forEach(function (p) { famByCat[p.category] = p.family; });
  function familyOfCat(c) { return famByCat[c == null ? '' : c] || 'Other'; }

  function detail(r, full) {
    var v = r.val, p = r.plan;
    var pool = D.pools.filter(function (q) { return q.category === (r.c || ''); })[0];
    var fam = D.families.filter(function (q) { return q.family === r.f; })[0];
    var baseWhy = v.basis === 'category'
      ? esc(r.c) + ': ' + pool.n + ' live token' + (pool.n === 1 ? '' : 's') + ', median ' + x(pool.raw) + ', shrunk toward ' + esc(r.f) + (fam ? ' ' + x(fam.used) : '')
      : v.basis === 'family' ? 'no live ' + esc(r.c || 'uncategorised') + ' token: ' + esc(r.f) + ' family, ' + (fam ? fam.n : 0) + ' tokens'
      : 'no comparables: market prior';
    var chainRows = [
      ['TVL', money(r.t), D.as_of],
      ['× base multiple', x(v.base_multiple), baseWhy],
      ['× 7-day growth', v.growth_factor.toFixed(3), r.d == null ? 'not reported: neutral' : (r.d > 0 ? '+' : '') + r.d.toFixed(1) + '% in 7 days'],
      ['× time tracked', v.age_factor.toFixed(3), v.age_days == null ? 'no listing date' : v.age_days + ' days with no token'],
      ['× chain reach', v.reach_factor.toFixed(3), r.ch.length + ' chain' + (r.ch.length === 1 ? '' : 's')],
      ['= implied value', money(r.v), x(v.multiple) + ' TVL'],
    ];
    var comps = comparablesFor(r);
    var steps = p.steps.map(function (s) {
      return '<li><span>' + esc(s.action) + '</span><span class="cost"><b>' + money(s.cost_usd) + '</b>' + mins(s.minutes) + '</span></li>';
    }).join('');
    return '<div class="dhead"><h2>' + esc(r.n) + '</h2>' + (full ? '<button class="back" data-view="board">Back to board</button>' : '<a class="back" href="#view=detail&p=' + encodeURIComponent(r.s) + '">Open full view</a>') + '</div>' +
      '<p class="dmeta">Rank ' + r.r + ' of ' + rows.length + ' · ' + esc(r.c || 'Uncategorised') + ' · ' + esc(r.ch.slice(0, 4).join(', ')) + (r.ch.length > 4 ? ' +' + (r.ch.length - 4) : '') +
      (r.w ? ' <span class="tag w">WATCH</span>' : '') + ' <span class="tag c-' + v.confidence + '">' + v.confidence.toUpperCase() + ' CONFIDENCE</span></p>' +
      '<div class="bigrow"><span class="big">' + money(r.v) + '</span><span class="muted">implied token value · range ' + money(r.lo) + ' to ' + money(r.hi) + '</span></div>' +
      (full ? '<div class="wide"><div>' : '') +
      '<h3>How the value is built</h3><div class="chain">' + chainRows.map(function (c) {
        return '<div><span>' + c[0] + '</span><b>' + c[1] + '</b><span class="why">' + c[2] + '</span></div>';
      }).join('') + '</div>' +
      '<h3>Comparables: ' + esc(comps.label) + '</h3>' + (comps.list.length ? '<table class="comps"><thead><tr><th class="l">Live token</th><th>TVL</th><th>Mcap</th><th>Mcap / TVL</th></tr></thead><tbody>' +
        comps.list.map(function (c) { return '<tr><td class="l">' + esc(c.n) + ' <span class="faint">' + esc(c.y || '') + '</span></td><td>' + money(c.t) + '</td><td>' + money(c.m) + '</td><td>' + x(c.x) + '</td></tr>'; }).join('') + '</tbody></table>'
        : '<p class="note">No live token in this group; the market prior prices it.</p>') +
      (full ? peers(r) + '</div><div>' : '') +
      '<h3>Farm plan on ' + esc(p.chain) + ': ' + money(p.capital_usd) + ' for ' + p.hold_days + ' days</h3><ol class="steps">' + steps + '</ol>' +
      '<div class="totals"><div><span>All-in cost</span><b>' + money(p.cost_usd) + '</b></div><div><span>Hands-on</span><b>' + mins(p.hands_on_minutes) + '</b></div>' +
      '<div><span>Payoff if it holds</span><b>' + money(p.payoff_usd) + '</b></div><div><span>Payoff / cost</span><b>' + p.payoff_ratio.toFixed(1) + '×</b></div></div>' +
      '<p class="note">Payoff: the position’s pro-rata share of a ' + (D.farm.community_share * 100) + '% community allocation at the implied value, weighted by time held. Cost: gas and fees per step plus the ' + money(p.carry_usd) + ' the capital would earn at ' + (D.farm.carry_rate * 100).toFixed(1) + '% risk-free.</p>' +
      (full && comps.all.length ? strip(r, comps) : '') +
      (full ? '</div></div>' : '');
  }

  // A log-scale strip: each comparable's multiple applied to this protocol's TVL and factors, against
  // the implied value and its low-high band.
  function strip(r, comps) {
    var adj = r.val.growth_factor * r.val.age_factor * r.val.reach_factor;
    var pts = comps.all.map(function (c) { return { n: c.n, v: r.t * Math.min(Math.max(c.x, D.model.clip_min), D.model.clip_max) * adj }; });
    var vals = pts.map(function (p) { return p.v; }).concat([r.lo, r.hi]);
    var lo = Math.log10(Math.min.apply(null, vals)) - 0.15, hi = Math.log10(Math.max.apply(null, vals)) + 0.15;
    var W = 640, H = 150, L = 16, R = 16;
    function X(v) { return L + (Math.log10(v) - lo) / (hi - lo) * (W - L - R); }
    var ticks = '';
    for (var e = Math.ceil(lo); e <= Math.floor(hi); e++) {
      var tx = X(Math.pow(10, e));
      ticks += '<line x1="' + tx.toFixed(1) + '" x2="' + tx.toFixed(1) + '" y1="24" y2="112" class="tk"/><text x="' + tx.toFixed(1) + '" y="130" class="tl">' + money(Math.pow(10, e)) + '</text>';
    }
    var dots = pts.map(function (p, i) {
      var y = 44 + (i % 4) * 16;
      return '<circle cx="' + X(p.v).toFixed(1) + '" cy="' + y + '" r="5" class="dot"><title>' + esc(p.n) + ': ' + money(p.v) + '</title></circle>';
    }).join('');
    return '<h3>What each comparable would price it at</h3><svg class="strip" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Comparable-implied values on a log scale">' +
      '<rect x="' + X(r.lo).toFixed(1) + '" y="30" width="' + (X(r.hi) - X(r.lo)).toFixed(1) + '" height="76" class="band"/>' + ticks + dots +
      '<line x1="' + X(r.v).toFixed(1) + '" x2="' + X(r.v).toFixed(1) + '" y1="20" y2="112" class="imp"/><text x="' + X(r.v).toFixed(1) + '" y="14" class="il">implied ' + money(r.v) + '</text>' +
      '<text x="' + L + '" y="146" class="tl s">' + pts.length + ' live ' + esc(comps.label) + ' tokens: their mcap/TVL \u00d7 this TVL \u00d7 its growth, age and reach factors. Shaded: low to high case.</text></svg>';
  }

  // The whole board on log-log axes, TVL against implied value, the selected protocol ringed: where it
  // sits against every other launch candidate, coloured by family.
  var FAM_COLORS = { Trading: '#7aa7ff', Credit: '#4cc9a0', Yield: '#e9b44c', Money: '#c792ea', Staking: '#f07a64', Infra: '#5fd4e8', Other: '#95a1b8' };
  function scatter(sel) {
    var W = 1340, H = 230, L = 56, R = 16, T = 12, B = 34;
    var tx = rows.map(function (r) { return Math.log10(r.t); }), vy = rows.map(function (r) { return Math.log10(r.v); });
    var x0 = Math.floor(Math.min.apply(null, tx) * 2) / 2, x1 = Math.ceil(Math.max.apply(null, tx) * 2) / 2;
    var y0 = Math.floor(Math.min.apply(null, vy) * 2) / 2, y1 = Math.ceil(Math.max.apply(null, vy) * 2) / 2;
    function X(v) { return L + (Math.log10(v) - x0) / (x1 - x0) * (W - L - R); }
    function Y(v) { return T + (1 - (Math.log10(v) - y0) / (y1 - y0)) * (H - T - B); }
    var g = '';
    for (var e = Math.ceil(x0); e <= x1; e++) g += '<line x1="' + X(Math.pow(10, e)) + '" x2="' + X(Math.pow(10, e)) + '" y1="' + T + '" y2="' + (H - B) + '" class="tk"/><text x="' + X(Math.pow(10, e)) + '" y="' + (H - B + 16) + '" class="tl">' + money(Math.pow(10, e)) + ' TVL</text>';
    for (e = Math.ceil(y0); e <= y1; e++) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(Math.pow(10, e)) + '" y2="' + Y(Math.pow(10, e)) + '" class="tk"/><text x="' + (L - 6) + '" y="' + (Y(Math.pow(10, e)) + 4) + '" class="tl e">' + money(Math.pow(10, e)) + '</text>';
    var dots = rows.map(function (r) {
      return '<circle cx="' + X(r.t).toFixed(1) + '" cy="' + Y(r.v).toFixed(1) + '" r="' + (r.w ? 4.5 : 3) + '" fill="' + FAM_COLORS[r.f] + '" opacity="' + (r.s === sel.s ? 1 : 0.6) + '"><title>' + esc(r.n) + ': ' + money(r.v) + '</title></circle>';
    }).join('');
    var legend = Object.keys(FAM_COLORS).map(function (k, i) { return '<circle cx="' + (L + 12 + i * 92) + '" cy="' + (H - 6) + '" r="4" fill="' + FAM_COLORS[k] + '"/><text x="' + (L + 20 + i * 92) + '" y="' + (H - 2) + '" class="tl s">' + k + '</text>'; }).join('');
    return '<h3>The board: TVL against implied value, ' + esc(sel.n) + ' ringed (watchlist dots larger)</h3><svg class="strip" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="All rows, TVL against implied value">' + g + dots +
      '<circle cx="' + X(sel.t).toFixed(1) + '" cy="' + Y(sel.v).toFixed(1) + '" r="10" class="ring"/>' + legend + '</svg>';
  }

  function peers(r) {
    var list = rows.filter(function (q) { return q.c === r.c && q.s !== r.s; }).slice(0, 6);
    if (!list.length) return '';
    return '<h3>Peers on the board: ' + esc(r.c || 'Uncategorised') + '</h3><table class="comps"><thead><tr><th>#</th><th class="l">Protocol</th><th>TVL</th><th>7d</th><th>Implied</th></tr></thead><tbody>' +
      list.map(function (q) { return '<tr data-slug="' + esc(q.s) + '"><td class="faint">' + q.r + '</td><td class="l"><a href="#view=detail&p=' + encodeURIComponent(q.s) + '">' + esc(q.n) + '</a></td><td>' + money(q.t) + '</td><td>' + pct(q.d) + '</td><td class="val">' + money(q.v) + '</td></tr>'; }).join('') + '</tbody></table>';
  }

  function renderDetailPage() {
    var r = bySlug[S.p] || rows[0];
    main.innerHTML = '<section class="card">' + detail(r, true) + scatter(r) + '</section>';
  }

  // ---------- model ----------
  function renderModel() {
    var M = D.model;
    var maxUsed = Math.max.apply(null, D.pools.map(function (p) { return p.used; }));
    var poolRows = D.pools.filter(function (p) { return p.category; }).map(function (p) {
      var ranked = rows.filter(function (r) { return r.c === p.category; }).length;
      return '<tr><td class="l">' + esc(p.category) + '</td><td class="l faint">' + esc(p.family) + '</td><td>' + p.n + '</td><td>' + x(p.raw) + '</td><td>' + x(p.used) + '</td><td class="l"><div class="bar" style="width:' + (p.used / maxUsed * 120).toFixed(0) + 'px"></div></td><td>' + ranked + '</td></tr>';
    }).join('');
    var famRows = D.families.map(function (f) { return '<tr><td class="l">' + esc(f.family) + '</td><td>' + f.n + '</td><td>' + x(f.raw) + '</td><td>' + x(f.used) + '</td></tr>'; }).join('');
    main.innerHTML = '<div class="wide"><section class="card"><h2>The value model</h2>' +
      '<p class="muted">A pre-token protocol is priced like the protocols whose token already trades. Every figure comes from the snapshot; no protocol is named in the code.</p>' +
      '<div class="formula">implied = TVL × base × growth × age × reach\n\n' +
      'base   = exp(shrunk median log(mcap/TVL)) of live tokens\n' +
      '         category → family → prior, weight n/(n+' + M.shrink_k + ')\n' +
      '         multiples clipped to ' + M.clip_min + '–' + M.clip_max + '× before pooling\n' +
      'prior  = live market median ' + x(D.prior.market) + ' × ' + M.prior_haircut + ' = ' + x(D.prior.used) + '\n' +
      'growth = 1 + ' + M.growth_slope + ' × 7d%  (bounded ' + M.growth_min + '–' + M.growth_max + ')\n' +
      'age    = ' + M.age_floor + ' → ' + M.age_max + ' over ' + M.age_full_days + ' days tracked  (' + M.age_unknown + ' if unknown)\n' +
      'reach  = 1 + ' + M.reach_per_doubling + ' × log2(chains)  (max ' + M.reach_max + ')\n' +
      'range  = implied ÷/× exp(shrunk half-IQR of the pool)</div>' +
      '<h3>Families</h3><table class="comps"><thead><tr><th class="l">Family</th><th>Live tokens</th><th>Median</th><th>Used</th></tr></thead><tbody>' + famRows + '</tbody></table>' +
      '<p class="note">Rows ranked: every protocol ≥ $5M TVL that records no token and is not a bridge, liquid-staking, restaked-BTC, CEX, versioned or wrapped/staked product, plus every watchlist slug. Confidence: high with 6+ category comparables, medium with 2–5, low otherwise.</p></section>' +
      '<section class="card"><h2>Category multiples</h2><div class="tablewrap"><table class="comps"><thead><tr><th class="l">Category</th><th class="l">Family</th><th>Live</th><th>Median</th><th>Used</th><th class="l"></th><th>Ranked</th></tr></thead><tbody>' + poolRows + '</tbody></table></div></section></div>';
  }

  // ---------- live tokens ----------
  function renderLive() {
    var list = D.live;
    main.innerHTML = '<section class="card"><h2>Live tokens: the comparables, set aside from the board</h2>' +
      '<p class="muted">' + list.length + ' protocols whose token already trades. They are not ranked as launches; their market cap to TVL multiples price the board.</p>' +
      '<div class="tablewrap"><table class="comps"><thead><tr><th>#</th><th class="l">Protocol</th><th class="l">Category</th><th class="l">Symbol</th><th>TVL</th><th>Market cap</th><th>Mcap / TVL</th></tr></thead><tbody>' +
      list.map(function (c, i) { return '<tr><td class="faint">' + (i + 1) + '</td><td class="l">' + esc(c.n) + '</td><td class="l faint">' + esc(c.c || '') + '</td><td class="l">' + esc(c.y || '') + '</td><td>' + money(c.t) + '</td><td>' + money(c.m) + '</td><td>' + x(c.x) + '</td></tr>'; }).join('') +
      '</tbody></table></div></section>';
  }

  // ---------- render and events ----------
  function render() {
    renderChrome();
    if (S.view === 'model') renderModel();
    else if (S.view === 'live') renderLive();
    else if (S.view === 'detail') renderDetailPage();
    else renderBoard();
  }

  main.addEventListener('click', function (e) {
    var t = e.target.closest('[data-sort],[data-toggle],[data-reset],[data-view],tr[data-slug]');
    if (!t) return;
    if (t.hasAttribute('data-sort')) {
      var k = t.getAttribute('data-sort');
      if (S.sort === k) S.dir = S.dir === 'asc' ? 'desc' : 'asc'; else { S.sort = k; S.dir = k === 'n' || k === 'r' ? 'asc' : 'desc'; }
      writeHash(true);
    } else if (t.hasAttribute('data-toggle')) {
      var tk = t.getAttribute('data-toggle'); S[tk] = S[tk] ? '' : '1'; writeHash(true);
    } else if (t.hasAttribute('data-reset')) {
      Object.assign(S, { q: '', fam: '', cat: '', chain: '', min: '0', watch: '', grow: '', conf: '' }); writeHash(true);
    } else if (t.hasAttribute('data-view')) {
      S.view = t.getAttribute('data-view'); writeHash(false);
    } else {
      S.p = t.getAttribute('data-slug'); writeHash(true);
    }
  });
  main.addEventListener('keydown', function (e) {
    var tr = e.target.closest && e.target.closest('tr[data-slug]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); S.p = tr.getAttribute('data-slug'); writeHash(true); }
  });
  main.addEventListener('change', function (e) {
    var k = e.target.getAttribute('data-k');
    if (k && k !== 'q') { S[k] = e.target.value || DEFAULTS[k]; writeHash(true); }
  });
  var typing;
  main.addEventListener('input', function (e) {
    if (e.target.getAttribute('data-k') !== 'q') return;
    clearTimeout(typing);
    var el = e.target;
    typing = setTimeout(function () {
      S.q = el.value; writeHash(true);
      var again = main.querySelector('input[data-k="q"]');
      if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }, 180);
  });
  window.addEventListener('hashchange', function () { readHash(); render(); });
  readHash();
  render();
})();
