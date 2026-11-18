/* Kansas City jobs by industry: QCEW explorer.
   Vanilla JS + SVG. Reads explorer_data.json (made by build_explorer_data.py) or window.QCEW_DATA. */
(function () {
  'use strict';

  var MAXD = 4;            // deepest column index shown (so 5 columns)
  var VW = 1060;           // svg viewBox width
  var BAR = 14, GAP = 6, BLOCK_MIN = 20, HMAX = 640, LASTW = 340, TOPM = 16;
  var MAXKIDS = 8, MINSHARE = 0.015;
  var RANKNAME = ['', 'Ownership', 'Sector', 'Subsector', 'Industry group', 'Industry'];
  var NOUN = { 2: 'sectors', 3: 'subsectors', 4: 'industry groups', 5: 'industries' };
  var MEASURES = {
    emp: { label: 'Jobs', title: 'Jobs by industry', noun: 'jobs', note: 'quarterly average' },
    estabs: { label: 'Establishments', title: 'Establishments by industry', noun: 'establishments', note: 'quarterly count' },
    wages: { label: 'Total wages', title: 'Annualized wages by industry', noun: 'wages', note: 'annualized' }
  };
  var USE_HASH = window.QCEW_HASH !== false;

  var D = null, cache = {}, state = null, disp = null, narrow = false, view = 'chart';
  var $ = function (id) { return document.getElementById(id); };
  var ctx = document.createElement('canvas').getContext('2d');

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { return Math.round(v).toLocaleString('en-US'); }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3).toLocaleString('en-US') + 'K';
    return '$' + Math.round(v);
  }
  function fmt(v, m) { return m === 'wages' ? money(v) : num(v); }
  function pct(x) {
    if (!isFinite(x)) return '–';
    var p = x * 100;
    if (p > 0 && p < 1) return '<1%';
    return (p < 10 ? p.toFixed(1) : Math.round(p)) + '%';
  }
  function trunc(text, maxW, font) {
    ctx.font = font || '13.5px Inter, system-ui, sans-serif';
    if (ctx.measureText(text).width <= maxW) return text;
    var lo = 0, hi = text.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, Math.max(1, lo)).replace(/[\s,]+$/, '') + '…';
  }

  /* ---------- data ---------- */
  function areaData(id) {
    if (cache[id]) return cache[id];
    var cols = D.meta.cols, byId = new Map(), kids = new Map();
    D.tree[id].forEach(function (r) {
      var o = {};
      cols.forEach(function (c, i) { o[c] = r[i]; });
      if (o.wages != null) o.wages *= 4;   // annualized: quarterly wages x 4
      byId.set(o.id, o);
    });
    byId.forEach(function (o) {
      if (o.parent != null) {
        if (!kids.has(o.parent)) kids.set(o.parent, []);
        kids.get(o.parent).push(o);
      }
    });
    return (cache[id] = { byId: byId, kids: kids });
  }
  function isND(n) { return n.lvl === 99; }
  function rankOf(n) {
    if (n.other || isND(n)) return null;
    return { 0: 0, 71: 1, 74: 2, 75: 3, 76: 4, 77: 4, 78: 5 }[n.lvl];
  }
  function nameOf(n) {
    if (n.other) return n.name;
    if (isND(n)) return 'Not disclosed';
    if (n.id === 'all') return 'All employers';
    if (n.id === 'G') return 'Government';
    if (n.lvl === 71) return D.meta.ownerLabels[n.own] || n.id;
    var t = D.titles[n.code];
    return t ? t.t : 'NAICS ' + n.code;
  }
  function colorKey(n) {
    if (n.other || isND(n)) return 'other';
    if (n.id === 'all') return 'slate';
    return n.own === '5' ? 'private' : 'gov';
  }
  function val(n) { var v = n[state.measure]; return v == null || v < 0 ? 0 : v; }

  /* children of a node as shown: single-child chains skipped, small items grouped into "Other" */
  function realKids(n) {
    if (n.other) return n.members;
    var A = areaData(state.area), list = A.kids.get(n.id) || [], out = [];
    var nonND = list.filter(function (c) { return !isND(c); });
    list.forEach(function (c) {
      if (isND(c)) { out.push(c); return; }
      var cur = c, guard = 0;
      while (guard++ < 6) {
        var ks = A.kids.get(cur.id) || [], real = ks.filter(function (k) { return !isND(k); });
        var ndSum = ks.filter(isND).reduce(function (s, k) { return s + val(k); }, 0);
        if (real.length === 1 && ndSum <= 0.005 * val(cur) && val(real[0]) >= 0.99 * val(cur)) cur = real[0]; else break;
      }
      out.push(cur);
    });
    return out;
  }
  function kidsOf(n, depth) {
    var maxKids = depth === 1 ? 10 : ((depth || 0) < 2 ? MAXKIDS : 5);
    var list = realKids(n).filter(function (c) { return val(c) > 0; });
    var nds = list.filter(isND), main = list.filter(function (c) { return !isND(c); });
    main.sort(function (a, b) { return val(b) - val(a); });
    var pv = val(n) || 1, keep = [], rest = [];
    main.forEach(function (c, i) {
      if (keep.length < maxKids && (val(c) / pv >= MINSHARE || keep.length < 3)) keep.push(c); else rest.push(c);
    });
    if (rest.length === 1) { keep.push(rest[0]); rest = []; }
    var out = keep.slice();
    if (rest.length) {
      var o = { id: 'oth:' + n.id, other: true, members: rest, own: rest[0].own, lvl: -1, flags: 0, parent: n.id };
      ['emp', 'estabs', 'wages'].forEach(function (m) { o[m] = rest.reduce(function (s, c) { return s + (c[m] || 0); }, 0); });
      rest.forEach(function (c) { o.flags |= (c.flags & 1) | ((c.flags & 2) ? 1 : 0); });
      var rk = rankOf(rest[0]);
      o.name = 'Other (' + rest.length + ' ' + (NOUN[rk] || 'items') + ')';
      out.push(o);
    }
    return out.concat(nds.filter(function (c) { return val(c) >= 0.02 * pv; }));
  }
  function hasKids(n) {
    if (n.other) return true;
    if (isND(n)) return false;
    return (areaData(state.area).kids.get(n.id) || []).some(function (c) { return val(c) > 0; });
  }

  /* ---------- display tree + layout ---------- */
  function buildDisplay() {
    var A = areaData(state.area);
    if (!A.byId.has(state.root)) state.root = 'all';
    var map = new Map(), flat = [];
    function make(n, depth, parent) {
      var d = { n: n, id: n.id, depth: depth, parent: parent, v: val(n), kids: [] };
      d.has = hasKids(n);
      d.open = depth === 0 || (state.expanded.has(n.id) && depth < MAXD);
      map.set(n.id, d); flat.push(d);
      if (d.open && d.has) d.kids = kidsOf(n, depth).map(function (c) { return make(c, depth + 1, d); });
      return d;
    }
    var root = make(A.byId.get(state.root), 0, null);
    return { root: root, map: map, flat: flat, total: val(A.byId.get('all')) };
  }
  function measureBlocks(d, k) {
    var bar = Math.max(3, d.v * k), kh = 0;
    d.kids.forEach(function (c, i) { kh += measureBlocks(c, k) + (i ? GAP : 0); });
    d.bar = bar; d.kh = kh; d.bh = Math.max(BLOCK_MIN, bar, kh);
    return d.bh;
  }
  function place(d, top) {
    d.top = top; d.cy = top + d.bh / 2; d.y = d.cy - d.bar / 2;
    var t = top + (d.bh - d.kh) / 2;
    d.kids.forEach(function (c) { place(c, t); t += c.bh + GAP; });
  }
  function layout(g) {
    var root = g.root, hi = HMAX / (root.v || 1), lo = 0, k;
    if (measureBlocks(root, hi) <= HMAX) k = hi;
    else {
      for (var i = 0; i < 40; i++) { var mid = (lo + hi) / 2; if (measureBlocks(root, mid) <= HMAX) lo = mid; else hi = mid; }
      k = lo;
    }
    measureBlocks(root, k);
    place(root, TOPM);
    g.k = k;
    g.maxDepth = Math.max.apply(null, g.flat.map(function (d) { return d.depth; }));
    var n = g.maxDepth + 1, compact = state.root === 'all' && n >= 3, span = VW - LASTW - 16, xs = [8], i;
    if (compact) {
      xs.push(8 + 130, 8 + 280);
      var more = n - 3, st = more > 0 ? (span - 280) / more : 0;
      for (i = 0; i < more; i++) xs.push(xs[xs.length - 1] + st);
    } else {
      var st2 = n > 1 ? Math.min(300, span / (n - 1)) : 0;
      for (i = 1; i < n; i++) xs.push(8 + i * st2);
    }
    g.height = root.bh + TOPM * 2;
    g.flat.forEach(function (d) {
      d.x = xs[d.depth];
      d.bw = compact && d.depth <= 1 ? 8 : BAR;
      d.lw = d.depth < n - 1 ? xs[d.depth + 1] - d.x - d.bw - 16 : Math.min(460, VW - d.x - d.bw - 14);
    });
  }

  /* ---------- chart ---------- */
  function labelText(d, g) {
    var n = d.n, parentV = d.parent ? d.parent.v : g.total, lb = n.flags ? '≥ ' : '';
    var vs = lb + fmt(d.v, state.measure) + ' · ' + pct(d.v / (parentV || 1));
    var last = d.depth === g.maxDepth;
    var w = Math.max(60, d.lw);
    var glyph = d.has && d.depth > 0 ? (d.open ? '▾ ' : '▸ ') : '';
    var nm = glyph + nameOf(n);
    return { name: nm, vs: vs, w: w, two: d.bh >= 34 };
  }
  function drawChart() {
    var g = disp, parts = [], rib = [], nodes = [];
    var svg = $('chart');
    svg.setAttribute('viewBox', '0 0 ' + VW + ' ' + Math.ceil(g.height));
    function ribbons(d) {
      if (!d.kids.length) return;
      var sum = 0, segs = d.kids.map(function (c) { var s = Math.max(1, c.v * g.k); sum += s; return s; });
      var scale = sum > d.bar ? d.bar / sum : 1, sy = d.y;
      d.kids.forEach(function (c, i) {
        var h0 = segs[i] * scale, h1 = c.bar;
        var x0 = d.x + d.bw, x1 = c.x, xm = (x0 + x1) / 2, y0 = sy, y1 = c.y;
        rib.push('<path class="ribbon" style="fill:var(--rib-' + (colorKey(c.n) === 'slate' ? 'root' : colorKey(c.n)) + ');fill-opacity:.55" d="M' + x0 + ',' + y0 + 'C' + xm + ',' + y0 + ' ' + xm + ',' + y1 + ' ' + x1 + ',' + y1 +
          'L' + x1 + ',' + (y1 + h1) + 'C' + xm + ',' + (y1 + h1) + ' ' + xm + ',' + (y0 + h0) + ' ' + x0 + ',' + (y0 + h0) + 'Z"/>');
        sy += h0;
        ribbons(c);
      });
    }
    ribbons(g.root);
    g.flat.forEach(function (d) {
      var n = d.n, L = labelText(d, g), key = colorKey(n), x = d.x, sel = state.sel === d.id;
      var fill = isND(n) ? 'url(#hatch)' : 'var(--' + key + ')';
      var tx = x + d.bw + 8, ty = d.cy;
      var t = '';
      if (L.two) {
        t += '<text class="lbl bold" x="' + tx + '" y="' + (ty - 2) + '">' + esc(trunc(L.name, L.w, '700 13.5px Inter, system-ui, sans-serif')) + '</text>';
        t += '<text class="lbl num" x="' + tx + '" y="' + (ty + 14) + '">' + esc(L.vs) + '</text>';
      } else {
        var vsW = (ctx.font = '13px Inter, system-ui, sans-serif', ctx.measureText(L.vs).width);
        var nmW = Math.max(40, L.w - vsW - 8);
        var nm = trunc(L.name, nmW);
        t += '<text class="lbl small" x="' + tx + '" y="' + (ty + 4.5) + '"><tspan>' + esc(nm) + '</tspan><tspan class="num" dx="8" style="fill:var(--muted)">' + esc(L.vs) + '</tspan></text>';
      }
      var bw = Math.min(L.w + d.bw + 8, 440);
      nodes.push('<g class="node' + (sel ? ' sel' : '') + '" data-id="' + esc(d.id) + '" tabindex="0" role="button" aria-label="' +
        esc(nameOf(n) + ', ' + L.vs + (d.has ? (d.open ? ', open' : ', closed') : '')) + '"><title>' + esc(nameOf(n) + ': ' + fmt(d.v, state.measure) + (n.flags ? ' (at least)' : '')) + '</title>' +
        '<rect class="band" x="' + (x - 4) + '" y="' + d.top + '" width="' + bw + '" height="' + d.bh + '" rx="6"/>' +
        '<rect class="bar" x="' + x + '" y="' + d.y + '" width="' + d.bw + '" height="' + d.bar + '" rx="2" style="fill:' + fill + '"' + (sel ? ' stroke="var(--text)" stroke-width="2"' : '') + '/>' + t + '</g>');
    });
    svg.innerHTML = '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="6" height="6" style="fill:var(--surface)"/><rect width="2.5" height="6" style="fill:var(--other)"/></pattern></defs>' +
      '<g>' + rib.join('') + '</g><g>' + nodes.join('') + '</g>';
  }

  /* ---------- table ---------- */
  function avgWage(n) { return n.wages > 0 && n.emp > 0 ? n.wages / (n.emp * 52) : null; }
  function drawTable() {
    var g = disp, rows = g.flat.map(function (d) {
      var n = d.n, pv = d.parent ? d.parent.v : g.total, lb = n.flags ? '≥ ' : '';
      var aw = avgWage(n), ind = Math.min(d.depth, 5) * 16;
      var tw = d.has && d.depth > 0 ? (d.open ? '▾' : '▸') : '';
      return '<tr class="' + (state.sel === d.id ? 'sel ' : '') + (colorKey(n) === 'gov' ? 'gov ' : '') + (isND(n) ? 'nd' : '') + '">' +
        '<td><div class="name" style="padding-left:' + ind + 'px"><span class="tw">' + tw + '</span><button type="button" data-id="' + esc(d.id) + '">' + esc(nameOf(n)) + '</button></div></td>' +
        '<td>' + (n.emp != null ? lb + num(n.emp) : '–') + '</td><td>' + (n.estabs != null ? num(n.estabs) : '–') + '</td>' +
        '<td>' + (n.wages != null ? lb + money(n.wages) : '–') + '</td><td>' + (aw ? '$' + num(aw) : '–') + '</td>' +
        '<td>' + pct(d.v / (pv || 1)) + '</td></tr>';
    }).join('');
    $('tablewrap').innerHTML = '<table class="outline"><caption class="status">Industries shown in the chart, with all measures</caption><thead><tr><th scope="col">Industry</th><th scope="col">Jobs</th><th scope="col">Establishments</th><th scope="col">Total wages (annualized)</th><th scope="col">Avg weekly wage</th><th scope="col">% of parent (' + esc(MEASURES[state.measure].label.toLowerCase()) + ')</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ---------- details panel ---------- */
  function sentences(text, max) {
    if (!text) return '';
    var out = '', parts = text.split(/(?<=\.)\s+/);
    for (var i = 0; i < parts.length; i++) { if (out && (out + ' ' + parts[i]).length > max) break; out += (out ? ' ' : '') + parts[i]; }
    return out;
  }
  function drawPanel() {
    var g = disp, d = g.map.get(state.sel) || g.root, n = d.n, a = areaName(), m = state.measure;
    var chips = [];
    if (n.code && !isND(n) && !n.other && n.lvl >= 74) chips.push('NAICS ' + n.code);
    chips.push(n.id === 'all' ? 'Private + government' : (n.own === '5' ? 'Private' : (D.meta.ownerLabels[n.own] || 'Government')));
    var desc = '';
    if (n.other) desc = 'These ' + n.members.length + ' smaller categories are grouped so the larger ones stay readable. Open the group to see each one.';
    else if (isND(n)) desc = 'BLS withholds some figures to protect the confidentiality of individual employers. This is the part of the parent total that is not shown in the categories beside it.';
    else if (n.id === 'all') desc = 'Every private and government employer covered by unemployment insurance in ' + a + '.';
    else if (n.id === 'G') desc = 'Federal, state and local government employers.';
    else if (n.lvl === 71) desc = n.own === '5' ? 'All privately owned employers.' : 'Employers owned by this level of government, including schools, hospitals and agencies.';
    else desc = sentences((D.titles[n.code] || {}).d, 340);
    var aw = avgWage(n), lb = n.flags ? '≥ ' : '';
    var pv = d.parent ? d.parent.v : null, pn = d.parent ? nameOf(d.parent.n) : null;
    var share = '';
    if (pv) share = '<strong>' + pct(d.v / pv) + '</strong> of ' + esc(pn) + ' ' + MEASURES[m].noun + ' · <strong>' + pct(d.v / (g.total || 1)) + '</strong> of all ' + esc(a) + ' ' + MEASURES[m].noun + '.';
    else share = '';
    var warn = '';
    if (n.flags & 1) warn = 'At least this much. A county figure was withheld, so the true value is higher.';
    else if (n.flags & 2) warn = 'Built from the parts BLS did publish, because this total was withheld. The true value is at least this large.';
    var mk = function (k, label, v) { return '<div class="' + (m === k ? 'on' : '') + '"><dt>' + label + '</dt><dd>' + v + '</dd></div>'; };
    var btns = '';
    if (d.has && d.id !== g.root.id && !n.other) btns += '<button type="button" class="btn primary" data-act="zoom">Zoom into this</button>';
    if (state.zoom.length) btns += '<button type="button" class="btn primary" data-act="zoomout">Zoom back out</button>';
    $('panel').innerHTML = '<div><div class="kicker">Selected</div><h2>' + esc(nameOf(n)) + '</h2><div class="chips">' +
      chips.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') + '</div></div>' +
      '<p>' + esc(desc) + '</p>' +
      '<dl class="metrics">' + mk('emp', 'Jobs<br>(quarterly average)', n.emp != null ? lb + num(n.emp) : '–') + mk('estabs', 'Establishments', n.estabs != null ? num(n.estabs) : '–') +
      mk('wages', 'Total wages (annualized)', n.wages != null ? lb + money(n.wages) : '–') + '<div><dt>Avg weekly wage</dt><dd>' + (aw ? '$' + num(aw) : '–') + '</dd></div></dl>' +
      (share ? '<div class="share">' + share + '</div>' : '') + (warn ? '<div class="warn">' + esc(warn) + '</div>' : '') +
      '<div class="btns">' + btns + '</div>';
  }

  /* ---------- controls ---------- */
  function areaName() { return D.areas.filter(function (a) { return a.id === state.area; })[0].name; }
  function drawCrumbs() {
    var A = areaData(state.area), path = [], n = A.byId.get(state.root), h = '';
    if (state.root !== 'all') {
      while (n) { path.unshift(n); n = n.parent != null ? A.byId.get(n.parent) : null; }
      h = path.map(function (p, i) {
        return i === path.length - 1 ? '<span class="here">' + esc(nameOf(p)) + '</span>' : '<button type="button" data-root="' + esc(p.id) + '">' + esc(nameOf(p)) + '</button><span aria-hidden="true">\u203a</span>';
      }).join(' ');
    }
    $('crumbs').innerHTML = h;
  }
  function render() {
    narrow = window.matchMedia('(max-width: 719px)').matches;
    disp = buildDisplay();
    if (!disp.map.has(state.sel)) state.sel = disp.root.id;
    layout(disp);
    var A = areaName(), m = MEASURES[state.measure];
    var where = state.area === 'metro' ? 'the ' + A : A;
    $('ctitle').textContent = m.title + ' in ' + where + ', Q' + D.meta.qtr + ' ' + D.meta.year;
    var showTable = view === 'table' || narrow;
    $('chartwrap').hidden = showTable; $('tablewrap').hidden = !showTable;
    if (showTable) drawTable(); else drawChart();
    drawCrumbs(); drawPanel();
    document.querySelectorAll('#measure button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.m === state.measure)); });
    $('area').value = state.area;
    $('toggleView').textContent = showTable ? 'View as chart' : 'View as table';
    writeHash();
  }
  function pick(id) {
    var d = disp.map.get(id); if (!d) return;
    var was = state.sel === id; state.sel = id;
    if (d.has && d.depth > 0) {
      if (state.expanded.has(id) && d.open) { if (was) state.expanded.delete(id); }
      else {
        if (d.depth >= MAXD) { var up = d.depth - 2, a = d; while (up-- > 0) a = a.parent; state.zoom.push(state.root); state.root = a.id; }
        state.expanded.add(id);
      }
    }
    render();
    var nd = disp.map.get(id);
    if (nd) $('status').textContent = nameOf(nd.n) + ': ' + fmt(nd.v, state.measure);
  }
  function defaults() { return { expanded: new Set(['all', 'G', '5']), root: 'all', sel: 'all' }; }
  function resetView() { var d = defaults(); state.expanded = d.expanded; state.root = d.root; state.sel = d.sel; state.zoom = []; render(); }

  /* ---------- copy image ---------- */
  var COPY_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linejoin', 'paint-order', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-variant-numeric', 'letter-spacing'];
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function imageBlob() {
    var svg = $('chart'), rect = svg.getBoundingClientRect(), W = Math.round(rect.width), H = Math.round(rect.height);
    var clone = svg.cloneNode(true), src = svg.querySelectorAll('*'), dst = clone.querySelectorAll('*');
    for (var i = 0; i < src.length; i++) {
      var cs = getComputedStyle(src[i]);
      COPY_PROPS.forEach(function (p) { dst[i].style.setProperty(p, cs.getPropertyValue(p)); });
    }
    clone.querySelectorAll('.band').forEach(function (b) { b.remove(); });
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', W); clone.setAttribute('height', H);
    var xml = new XMLSerializer().serializeToString(clone);
    var img = new Image();
    return new Promise(function (resolve, reject) {
      img.onload = function () {
        var sc = 2, pad = 24, titleH = 44, legH = 44, cw = W + pad * 2, ch = titleH + H + legH + pad + 44;
        var cv = document.createElement('canvas'); cv.width = cw * sc; cv.height = ch * sc;
        var c = cv.getContext('2d'); c.scale(sc, sc);
        c.fillStyle = cssVar('--surface'); c.fillRect(0, 0, cw, ch);
        c.fillStyle = cssVar('--text'); c.textBaseline = 'alphabetic';
        c.font = "600 20px 'Space Grotesk', Inter, system-ui, sans-serif";
        c.fillText($('ctitle').textContent, pad, pad + 14);
        c.drawImage(img, pad, titleH, W, H);
        var x = pad, y = titleH + H + 28;
        c.font = "13px Inter, system-ui, sans-serif";
        [['Private', '--private'], ['Government', '--gov'], ['Grouped smaller items', '--other'], ['Not disclosed', null]].forEach(function (it) {
          if (it[1]) { c.fillStyle = cssVar(it[1]); c.fillRect(x, y - 11, 14, 14); }
          else {
            c.save(); c.beginPath(); c.rect(x, y - 11, 14, 14); c.clip();
            c.fillStyle = cssVar('--surface'); c.fillRect(x, y - 11, 14, 14);
            c.strokeStyle = cssVar('--other'); c.lineWidth = 2;
            for (var k = -14; k < 28; k += 5) { c.beginPath(); c.moveTo(x + k, y + 3); c.lineTo(x + k + 14, y - 11); c.stroke(); }
            c.restore();
          }
          c.fillStyle = cssVar('--muted'); c.fillText(it[0], x + 22, y);
          x += 22 + c.measureText(it[0]).width + 24;
        });
        c.font = "12px Inter, system-ui, sans-serif"; c.fillStyle = cssVar('--muted');
        c.fillText('Source: U.S. Bureau of Labor Statistics, QCEW', pad, y + 34);
        c.fillText('Calculations and graphics by Brian Werner, https://thekceconomy.substack.com/', pad, y + 54);
        cv.toBlob(function (b) { b ? resolve(b) : reject(new Error('no image')); }, 'image/png');
      };
      img.onerror = function () { reject(new Error('render failed')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    });
  }
  function copyImage() {
    var btn = $('copyImg'), p = imageBlob();
    var done = function (t) { btn.textContent = t; $('status').textContent = t; setTimeout(function () { btn.textContent = 'Copy image'; }, 2500); };
    var saveFile = function () {
      p.then(function (b) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'kc-qcew-chart.png';
        document.body.appendChild(a); a.click(); a.remove(); done('Saved image');
      }).catch(function () { done('Image not available'); });
    };
    try {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': p })]).then(function () { done('Copied!'); }, saveFile);
    } catch (e) { saveFile(); }
  }

  /* ---------- csv ---------- */
  function downloadCsv() {
    var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
    var rows = [['Area', 'Quarter', 'Level', 'Ownership', 'NAICS', 'Industry', 'Jobs', 'Establishments', 'Total wages (annualized)', 'Avg weekly wage', 'Note']];
    disp.flat.forEach(function (d) {
      var n = d.n, aw = avgWage(n);
      rows.push([areaName(), 'Q' + D.meta.qtr + ' ' + D.meta.year, RANKNAME[rankOf(n)] || (n.other ? 'Grouped' : 'Not disclosed'),
        n.id === 'all' ? 'All' : (n.own === '5' ? 'Private' : (D.meta.ownerLabels[n.own] || 'Government')),
        n.code || '', nameOf(n), n.emp == null ? '' : Math.round(n.emp * 10) / 10, n.estabs == null ? '' : n.estabs,
        n.wages == null ? '' : Math.round(n.wages), aw ? Math.round(aw) : '', n.flags ? 'at least (some data withheld)' : '']);
    });
    var csv = rows.map(function (r) { return r.map(q).join(','); }).join('\r\n');
    try {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'kc-qcew-' + state.area + '-q' + D.meta.qtr + '-' + D.meta.year + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { $('status').textContent = 'Download is not available here.'; }
  }

  /* ---------- hash ---------- */
  var lastHash = '';
  function writeHash() {
    if (!USE_HASH) return;
    try {
      var h = 'a=' + state.area + '&m=' + state.measure + '&r=' + encodeURIComponent(state.root) + '&s=' + encodeURIComponent(state.sel) + '&x=' + Array.from(state.expanded).map(encodeURIComponent).join(',');
      lastHash = '#' + h;
      if (location.hash !== lastHash) history.replaceState(null, '', lastHash);
    } catch (e) { /* ignore */ }
  }
  function readHash() {
    try {
      if (!location.hash || location.hash.length < 3) return false;
      var p = {}; location.hash.slice(1).split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) p[kv.slice(0, i)] = kv.slice(i + 1); });
      if (!p.a || !D.tree[p.a]) return false;
      state.area = p.a;
      if (MEASURES[p.m]) state.measure = p.m;
      var dec = decodeURIComponent, A = areaData(state.area);
      if (p.r && A.byId.has(dec(p.r))) state.root = dec(p.r);
      if (p.x) state.expanded = new Set(p.x.split(',').map(dec).filter(Boolean));
      if (p.s) state.sel = dec(p.s);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- start ---------- */
  function init() {
    var metro = D.areas.filter(function (a) { return a.kind === 'metro'; })[0];
    var ks = D.areas.filter(function (a) { return a.kind === 'county' && /, KS$/.test(a.name); });
    var mo = D.areas.filter(function (a) { return a.kind === 'county' && /, MO$/.test(a.name); });
    var opt = function (a) { return '<option value="' + a.id + '">' + esc(a.name) + '</option>'; };
    $('area').innerHTML = opt(metro) + '<optgroup label="Kansas">' + ks.map(opt).join('') + '</optgroup><optgroup label="Missouri">' + mo.map(opt).join('') + '</optgroup>';
    var d = defaults();
    state = { area: metro.id, measure: 'emp', root: d.root, expanded: d.expanded, sel: d.sel, zoom: [] };
    readHash();
    $('foot-built').textContent = 'Data processed ' + new Date(D.meta.generated).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) + '.';

    $('area').addEventListener('change', function (e) {
      state.area = e.target.value; var A = areaData(state.area);
      state.expanded = new Set(Array.from(state.expanded).filter(function (i) { return A.byId.has(i) || i.indexOf('oth:') === 0; }));
      if (!A.byId.has(state.root)) state.root = 'all';
      if (!state.expanded.size) state.expanded = defaults().expanded;
      render();
    });
    $('measure').addEventListener('click', function (e) { var b = e.target.closest('button[data-m]'); if (b) { state.measure = b.dataset.m; render(); } });
    $('reset').addEventListener('click', resetView);
    $('toggleView').addEventListener('click', function () { view = view === 'table' ? 'chart' : 'table'; render(); });
    $('csv').addEventListener('click', downloadCsv);
    $('copyImg').addEventListener('click', copyImage);
    document.addEventListener('click', function (e) {
      var n = e.target.closest('[data-id]'); if (n && (n.closest('#chart') || n.closest('#tablewrap'))) { pick(n.dataset.id); return; }
      var r = e.target.closest('[data-root]'); if (r) { state.zoom = []; state.root = r.dataset.root; state.sel = r.dataset.root; state.expanded.add(r.dataset.root); render(); return; }
      var a = e.target.closest('[data-act]');
      if (a && a.dataset.act === 'zoom') { var id = state.sel; state.zoom.push(state.root); state.root = id; state.expanded.add(id); render(); }
      if (a && a.dataset.act === 'zoomout') { state.root = state.zoom.pop() || 'all'; state.sel = state.root; render(); }
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('g.node')) { e.preventDefault(); pick(e.target.dataset.id); }
    });
    window.addEventListener('hashchange', function () { if (location.hash !== lastHash && readHash()) render(); });
    window.matchMedia('(max-width: 719px)').addEventListener('change', render);
    render();
  }

  function start() {
    var p = window.QCEW_DATA ? Promise.resolve(window.QCEW_DATA) : fetch('explorer_data.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
    p.then(function (data) { D = data; init(); }).catch(function (err) {
      $('app').innerHTML = '<div class="err"><strong>The data file could not be loaded.</strong> If you opened this page straight from a folder, serve it from a web server instead (for example: python3 -m http.server). ' + esc(err.message || err) + '</div>';
    });
  }
  start();
})();
