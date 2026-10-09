/*
 * 图表：资产配置环形图（SVG）+ 投资表现条形图（HTML）。
 * 不依赖任何外部图表库。所有文字都用 textContent 写入，避免注入问题。
 */
(function (root) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function colorFor(item, index) {
    return item.key === 'cash' ? 'var(--c-cash)' : PALETTE[index % PALETTE.length];
  }

  /** 环形图上一段圆弧的路径（从 12 点钟方向顺时针）。 */
  function arcPath(cx, cy, rOuter, rInner, start, end) {
    function pt(r, a) {
      return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    }
    var large = end - start > Math.PI ? 1 : 0;
    var p1 = pt(rOuter, start), p2 = pt(rOuter, end), p3 = pt(rInner, end), p4 = pt(rInner, start);
    return [
      'M', p1[0], p1[1],
      'A', rOuter, rOuter, 0, large, 1, p2[0], p2[1],
      'L', p3[0], p3[1],
      'A', rInner, rInner, 0, large, 0, p4[0], p4[1],
      'Z'
    ].join(' ');
  }

  function renderAllocation(container, portfolio, C) {
    container.textContent = '';
    var items = portfolio.allocation;
    var total = portfolio.totalAssets;

    var size = 180, cx = 90, cy = 90, rO = 84, rI = 58;
    var chart = svg('svg', { viewBox: '0 0 ' + size + ' ' + size, class: 'donut', role: 'img' });
    var desc = items.map(function (it) { return it.label + ' ' + C.formatPct(it.pct, false); }).join('，');
    chart.setAttribute('aria-label', '资产配置：' + (desc || '暂无数据'));

    if (total <= 0) {
      chart.appendChild(svg('circle', { cx: cx, cy: cy, r: (rO + rI) / 2, fill: 'none', stroke: 'var(--line)', 'stroke-width': rO - rI }));
    } else {
      var angle = 0;
      var nonZero = items.filter(function (it) { return it.value > 0; });
      items.forEach(function (it, i) {
        if (it.value <= 0) return;
        var color = colorFor(it, i);
        if (nonZero.length === 1) {
          chart.appendChild(svg('circle', { cx: cx, cy: cy, r: (rO + rI) / 2, fill: 'none', stroke: color, 'stroke-width': rO - rI }));
          return;
        }
        var sweep = it.pct * Math.PI * 2;
        var path = svg('path', { d: arcPath(cx, cy, rO, rI, angle, angle + sweep), fill: color, stroke: 'var(--surface)', 'stroke-width': 1.5 });
        chart.appendChild(path);
        angle += sweep;
      });
    }

    var label = svg('text', { x: cx, y: cy - 6, 'text-anchor': 'middle', class: 'donut-label' });
    label.textContent = '总资产';
    var value = svg('text', { x: cx, y: cy + 14, 'text-anchor': 'middle', class: 'donut-value' });
    value.textContent = compactMoney(total);
    chart.appendChild(label);
    chart.appendChild(value);
    container.appendChild(chart);

    var legend = el('ul', 'legend');
    items.forEach(function (it, i) {
      var li = el('li');
      var sw = el('span', 'swatch');
      sw.style.background = colorFor(it, i);
      li.appendChild(sw);
      li.appendChild(el('span', 'lg-name', it.label));
      li.appendChild(el('span', 'lg-pct', C.formatPct(it.pct, false)));
      li.appendChild(el('span', 'lg-val', C.formatMoney(it.value)));
      legend.appendChild(li);
    });
    container.appendChild(legend);
  }

  /** 环形图中心用的简写金额：$20.1K、$1.25M。 */
  function compactMoney(x) {
    var abs = Math.abs(x);
    if (abs >= 1e6) return '$' + (x / 1e6).toFixed(2) + 'M';
    if (abs >= 1e4) return '$' + (x / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(x).toLocaleString('en-US');
  }

  function renderPerformance(container, portfolio, C) {
    container.textContent = '';
    var rows = portfolio.holdings;
    if (!rows.length) {
      container.appendChild(el('p', 'chart-empty', '还没有持仓。添加持仓后，这里会显示每个持仓的成本和市值对比。'));
      return;
    }

    var total = el('p', 'perf-total');
    total.appendChild(document.createTextNode('持仓成本 '));
    total.appendChild(el('b', null, C.formatMoney(portfolio.totalCost)));
    total.appendChild(document.createTextNode(' → 当前市值 '));
    total.appendChild(el('b', null, C.formatMoney(portfolio.securitiesValue)));
    container.appendChild(total);

    var legend = el('div', 'perf-legend');
    [['var(--bar-cost)', '买入成本'], ['var(--up)', '市值（盈利）'], ['var(--down)', '市值（亏损）']].forEach(function (l) {
      var s = el('span');
      var i = el('i');
      i.style.background = l[0];
      s.appendChild(i);
      s.appendChild(document.createTextNode(l[1]));
      legend.appendChild(s);
    });
    container.appendChild(legend);

    // 所有条形使用同一个比例尺：最长的条 = 所有成本和市值中的最大值。
    var max = rows.reduce(function (m, h) { return Math.max(m, h.costBasis, h.marketValue); }, 0);

    rows.forEach(function (h) {
      var row = el('div', 'perf-row');
      var head = el('div', 'perf-head');
      head.appendChild(el('span', 'sym', h.symbol));
      var dir = h.pnl > 0 ? 'up' : h.pnl < 0 ? 'down' : '';
      head.appendChild(el('span', 'num ' + dir, C.formatMoney(h.pnl, true) + '（' + C.formatPct(h.pnlPct) + '）'));
      row.appendChild(head);

      row.appendChild(barLine('成本', h.costBasis, max, 'bar bar-cost', C));
      row.appendChild(barLine('市值', h.marketValue, max, 'bar bar-value ' + (h.pnl < 0 ? 'down' : 'up'), C));
      container.appendChild(row);
    });
  }

  function barLine(label, value, max, barClass, C) {
    var line = el('div', 'bar-line');
    line.appendChild(el('span', null, label));
    var track = el('div', 'bar-track');
    var bar = el('div', barClass);
    bar.style.width = (max > 0 ? (value / max) * 100 : 0) + '%';
    track.appendChild(bar);
    line.appendChild(track);
    line.appendChild(el('span', 'bar-figure', C.formatMoney(value)));
    return line;
  }

  root.PortfolioCharts = {
    renderAllocation: renderAllocation,
    renderPerformance: renderPerformance,
    colorFor: colorFor
  };
})(window);
