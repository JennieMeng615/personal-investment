/*
 * CSV 导入 / 导出 / 备份 —— 纯函数，无界面代码。
 *
 * 浏览器中通过 window.PortfolioCSV 使用；Node.js 中通过 require('./js/csv.js') 使用（测试）。
 * 依赖 calc.js 的校验函数（浏览器中为 window.PortfolioCalc）。
 *
 * 支持 Fidelity「Positions」页面导出的 CSV（Portfolio_Positions_*.csv），
 * 也支持其他券商或手工整理的 CSV：只要有表头，用户可以手动匹配字段。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./calc.js'));
  } else {
    root.PortfolioCSV = factory(root.PortfolioCalc);
  }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var BACKUP_APP = 'personal-investment-dashboard';
  var BACKUP_VERSION = 1;

  // ---------- CSV 文本 → 二维数组 ----------

  /** 解析 CSV 文本（支持引号、引号内逗号和换行、"" 转义、BOM、CRLF、分号分隔）。 */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    var delimiter = detectDelimiter(text);
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map(function (r) { return r.map(function (c) { return c.trim(); }); });
  }

  function detectDelimiter(text) {
    var firstLine = text.split(/\r?\n/).filter(function (l) { return l.trim(); })[0] || '';
    var commas = (firstLine.match(/,/g) || []).length;
    var semis = (firstLine.match(/;/g) || []).length;
    return semis > commas ? ';' : ',';
  }

  function isBlankRow(r) {
    return !r || r.every(function (c) { return c === ''; });
  }

  // ---------- 字段匹配 ----------

  /** 可匹配的字段。required 表示必须匹配到某一列。 */
  var FIELDS = [
    { key: 'symbol', label: '股票代码', required: true },
    { key: 'name', label: '名称', required: false },
    { key: 'shares', label: '持有数量', required: true },
    { key: 'avgCost', label: '平均买入价（每股成本）', required: false },
    { key: 'totalCost', label: '总成本', required: false },
    { key: 'price', label: '当前价格', required: false },
    { key: 'value', label: '当前市值', required: false }
  ];

  // 表头名称 → 字段（全部转为小写、去掉空格和符号后比较）。
  var SYNONYMS = {
    symbol: ['symbol', 'ticker', 'code', '代码', '股票代码', '证券代码'],
    name: ['description', 'name', 'securitydescription', 'security', '名称', '证券名称'],
    shares: ['quantity', 'shares', 'qty', 'units', '持有数量', '数量', '持仓数量', '股数'],
    avgCost: ['averagecostbasis', 'averagecost', 'avgcost', 'costpershare', 'unitcost', '平均买入价', '平均成本', '成本价'],
    totalCost: ['costbasistotal', 'costbasis', 'totalcost', 'cost', '成本', '总成本'],
    price: ['lastprice', 'price', 'currentprice', 'marketprice', '当前价格', '现价', '价格'],
    value: ['currentvalue', 'marketvalue', 'value', '市值', '当前市值']
  };

  function normHeader(h) {
    return String(h || '').toLowerCase().replace(/[\s_\-/().$%*#:：（）]/g, '');
  }

  /** 找到表头所在行：前 20 行中，能识别出最多字段名的那一行。找不到时返回第一个非空行。 */
  function findHeaderRow(rows) {
    var best = -1, bestScore = 0;
    for (var i = 0; i < Math.min(rows.length, 20); i++) {
      var score = Object.keys(guessMapping(rows[i])).length;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best >= 0 && bestScore >= 2) return best;
    for (var j = 0; j < rows.length; j++) if (!isBlankRow(rows[j])) return j;
    return -1;
  }

  /** 根据表头猜测字段对应的列号。返回 { symbol: 2, shares: 4, ... }，猜不到的字段不出现。 */
  function guessMapping(headers) {
    var mapping = {};
    var used = {};
    var normalized = (headers || []).map(normHeader);
    FIELDS.forEach(function (f) {
      var syns = SYNONYMS[f.key];
      for (var s = 0; s < syns.length; s++) {
        var idx = normalized.indexOf(syns[s]);
        if (idx >= 0 && !used[idx]) { mapping[f.key] = idx; used[idx] = true; return; }
      }
    });
    return mapping;
  }

  // ---------- 单元格数字 ----------

  /** 宽松解析券商导出的数字：$1,234.56、+$12.00、-$5、(5.00)、12.5%。无法识别（如 "--"、"n/a"）返回 NaN。 */
  function parseCellNumber(value) {
    var s = String(value === undefined || value === null ? '' : value).trim();
    if (!s) return NaN;
    var negative = false;
    if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
    s = s.replace(/[$,\s%]/g, '').replace(/^\+/, '').replace(/^−/, '-');
    if (s.charAt(0) === '-') { negative = !negative; s = s.slice(1); }
    if (!/^\d*\.?\d+$/.test(s)) return NaN;
    var n = Number(s);
    return negative ? -n : n;
  }

  /** Fidelity 的现金 / 货币基金行：代码以 ** 结尾（如 SPAXX**）、Pending Activity、或描述含 MONEY MARKET。 */
  function isCashLike(symbol, name) {
    var s = String(symbol || '').toUpperCase();
    var n = String(name || '').toUpperCase();
    return /\*\*$/.test(s) || s === 'CASH' || s === '现金' || s === 'CORE' ||
      /MONEY MARKET|CASH SWEEP|CORE POSITION|HELD IN MONEY MARKET/.test(n);
  }

  function cell(row, idx) {
    return idx === undefined || idx === null || idx < 0 ? '' : (row[idx] || '');
  }

  function round(x, digits) {
    var f = Math.pow(10, digits);
    return Math.round(x * f) / f;
  }

  /**
   * 根据字段匹配生成导入预览。不会修改任何数据。
   *
   * rows：parseCSV 的结果；headerIndex：表头行号；mapping：字段 → 列号；
   * existing：当前已有持仓（同代码的会被跳过，绝不覆盖）；
   * typeOverrides：{ 代码: 'ETF' | '股票' }，用户在预览里为每行选择的类型；defaultType 为未选择时的类型。
   *
   * 返回 {
   *   items: [{ status: 'new'|'duplicate'|'cash'|'skipped'|'invalid', symbol, reason, value, sourceRows }],
   *   newCount, cashTotal, missingRequired: [未匹配的必填字段名]
   * }
   * 同一文件中重复出现的代码（如多个账户都持有 VOO）会合并：数量相加，按成本加权计算平均买入价。
   */
  function buildImportPreview(rows, headerIndex, mapping, existing, options) {
    options = options || {};
    var defaultType = options.defaultType || 'ETF';
    var typeOverrides = options.typeOverrides || {};
    var missing = FIELDS.filter(function (f) {
      return f.required && (mapping[f.key] === undefined || mapping[f.key] < 0);
    }).map(function (f) { return f.label; });
    var hasCost = mapping.avgCost >= 0 || mapping.totalCost >= 0;
    var hasPrice = mapping.price >= 0 || mapping.value >= 0;
    if (!hasCost) missing.push('平均买入价 或 总成本');
    if (!hasPrice) missing.push('当前价格 或 当前市值');
    if (missing.length) return { items: [], newCount: 0, cashTotal: 0, missingRequired: missing };

    var groups = {};   // 代码 → 合并后的数据
    var order = [];
    var items = [];
    var cashTotal = 0;

    for (var i = headerIndex + 1; i < rows.length; i++) {
      var row = rows[i];
      if (isBlankRow(row)) continue;
      var rawSymbol = cell(row, mapping.symbol);
      var name = cell(row, mapping.name);
      var lineNo = i + 1;

      // Fidelity 文件末尾的免责声明、下载日期等只有一列文字，没有数量，直接忽略。
      var shares = parseCellNumber(cell(row, mapping.shares));
      var value = parseCellNumber(cell(row, mapping.value));
      if (!rawSymbol && isNaN(shares)) continue;
      if (row.filter(function (c) { return c !== ''; }).length < 2) continue;

      if (/PENDING/i.test(rawSymbol)) {
        items.push({ status: 'skipped', symbol: rawSymbol, name: name, reason: '待结算资金，不导入', sourceRows: [lineNo] });
        continue;
      }
      if (isCashLike(rawSymbol, name)) {
        var cashValue = !isNaN(value) ? value : shares; // 货币基金通常 1 份 = $1
        if (!isNaN(cashValue) && cashValue > 0) cashTotal += cashValue;
        items.push({ status: 'cash', symbol: rawSymbol || '现金', name: name, reason: '现金 / 货币基金', amount: isNaN(cashValue) ? 0 : cashValue, sourceRows: [lineNo] });
        continue;
      }

      var symbol = rawSymbol.replace(/\*+$/, '').trim().toUpperCase();
      var avgCost = parseCellNumber(cell(row, mapping.avgCost));
      var totalCost = parseCellNumber(cell(row, mapping.totalCost));
      var price = parseCellNumber(cell(row, mapping.price));

      var problem = null;
      if (!symbol) problem = '缺少股票代码';
      else if (isNaN(shares) || shares <= 0) problem = '持有数量无效';
      if (!problem) {
        if (isNaN(totalCost) && !isNaN(avgCost)) totalCost = avgCost * shares;
        if (isNaN(price) && !isNaN(value)) price = value / shares;
        if (isNaN(totalCost) || totalCost < 0) problem = '缺少成本（文件中为空或 "--"）';
        else if (isNaN(price) || price < 0) problem = '缺少当前价格';
      }
      if (problem) {
        items.push({ status: 'invalid', symbol: symbol || rawSymbol || '（空）', name: name, reason: problem + '，第 ' + lineNo + ' 行', sourceRows: [lineNo] });
        continue;
      }

      if (!groups[symbol]) {
        groups[symbol] = { symbol: symbol, name: name, shares: 0, totalCost: 0, price: price, sourceRows: [] };
        order.push(symbol);
      }
      var g = groups[symbol];
      g.shares += shares;
      g.totalCost += totalCost;
      g.price = price;
      if (!g.name && name) g.name = name;
      g.sourceRows.push(lineNo);
    }

    var newCount = 0;
    var taken = (existing || []).map(function (h) { return h.symbol; });
    order.forEach(function (symbol) {
      var g = groups[symbol];
      var input = {
        symbol: symbol,
        name: g.name.slice(0, 60),
        type: typeOverrides[symbol] || defaultType,
        shares: round(g.shares, 6),
        avgCost: round(g.totalCost / g.shares, 4),
        price: round(g.price, 4)
      };
      var merged = g.sourceRows.length > 1 ? '（合并了 ' + g.sourceRows.length + ' 行）' : '';
      if (taken.indexOf(symbol) >= 0) {
        items.push({ status: 'duplicate', symbol: symbol, name: g.name, reason: '已在持仓中，跳过（不会覆盖）', value: input, sourceRows: g.sourceRows });
        return;
      }
      var check = C.validateHolding(input, [], null);
      if (!check.ok) {
        var firstError = check.errors[Object.keys(check.errors)[0]];
        items.push({ status: 'invalid', symbol: symbol, name: g.name, reason: firstError, value: input, sourceRows: g.sourceRows });
        return;
      }
      items.push({ status: 'new', symbol: symbol, name: g.name, reason: '将导入' + merged, value: check.value, sourceRows: g.sourceRows });
      newCount++;
    });

    // 排序：将导入的排最前，其次是跳过、无法导入、现金、忽略；同类保持文件中的顺序。
    var rank = { 'new': 0, duplicate: 1, invalid: 2, cash: 3, skipped: 4 };
    items = items.map(function (item, i) { return { item: item, i: i }; })
      .sort(function (a, b) { return rank[a.item.status] - rank[b.item.status] || a.i - b.i; })
      .map(function (x) { return x.item; });

    return { items: items, newCount: newCount, cashTotal: round(cashTotal, 2), missingRequired: [] };
  }

  /**
   * 把预览中 status 为 new 的持仓追加到当前数据，返回新的数据对象（不修改原对象）。
   * 已有持仓保持原样，绝不覆盖或删除。addCash 为 true 时，把现金行金额加到现有现金上。
   */
  function applyImport(state, preview, options) {
    options = options || {};
    var importedAt = options.importedAt || new Date().toISOString().slice(0, 10);
    var makeId = options.makeId || function (i) { return 'csv-' + Date.now().toString(36) + '-' + i; };
    var taken = state.holdings.map(function (h) { return h.symbol; });
    var added = [];
    preview.items.forEach(function (item, i) {
      if (item.status !== 'new' || taken.indexOf(item.symbol) >= 0) return;
      var h = {};
      Object.keys(item.value).forEach(function (k) { h[k] = item.value[k]; });
      h.id = makeId(i);
      h.sample = false;
      h.source = 'csv';
      h.priceAsOf = importedAt;
      added.push(h);
      taken.push(item.symbol);
    });
    var next = {
      version: state.version || 1,
      cash: state.cash,
      cashSample: state.cashSample,
      holdings: state.holdings.slice().concat(added)
    };
    if (options.addCash && preview.cashTotal > 0) {
      next.cash = round(state.cash + preview.cashTotal, 2);
      next.cashSample = false;
    }
    return { state: next, addedCount: added.length };
  }

  // ---------- 导出 ----------

  /** 把一个单元格转成 CSV 文本：必要时加引号；以 = + - @ 开头的文字前加 ' 防止被 Excel 当作公式。 */
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  var EXPORT_HEADERS = ['代码', '名称', '类型', '持有数量', '平均买入价', '当前价格', '市值', '成本', '盈亏金额', '收益率%', '数据来源'];

  /** 导出持仓 CSV（开头带 BOM，方便 Excel / Numbers 正确显示中文）。可以再次导入本工具。 */
  function exportHoldingsCSV(state) {
    var p = C.calcPortfolio(state);
    var rows = [EXPORT_HEADERS];
    p.holdings.forEach(function (h, i) {
      var src = state.holdings[i];
      rows.push([
        h.symbol, h.name, h.type, h.shares, h.avgCost, h.price,
        C.round2(h.marketValue), C.round2(h.costBasis), C.round2(h.pnl),
        h.pnlPct === null ? '' : C.round2(h.pnlPct * 100),
        src.sample ? '示例（虚构）' : src.source === 'csv' ? 'CSV 导入 ' + (src.priceAsOf || '') : '手动输入'
      ]);
    });
    return '﻿' + toCSV(rows);
  }

  // ---------- 备份 ----------

  function createBackup(state, now) {
    return JSON.stringify({
      app: BACKUP_APP,
      backupVersion: BACKUP_VERSION,
      exportedAt: (now || new Date()).toISOString(),
      data: state
    }, null, 2);
  }

  /** 读取备份文件。成功返回 { ok: true, state, exportedAt }，失败返回 { ok: false, error }。 */
  function parseBackup(text) {
    var obj;
    try {
      obj = JSON.parse(String(text || '').replace(/^﻿/, ''));
    } catch (e) {
      return { ok: false, error: '文件不是有效的备份（无法读取 JSON）。请选择本工具导出的 .json 备份文件。' };
    }
    if (!obj || obj.app !== BACKUP_APP || !obj.data) {
      return { ok: false, error: '这不是本工具生成的备份文件。' };
    }
    if (obj.backupVersion > BACKUP_VERSION) {
      return { ok: false, error: '备份来自更新版本的工具，当前版本无法读取。' };
    }
    var state = C.normalizeState(obj.data);
    if (!state) return { ok: false, error: '备份文件内容已损坏，无法恢复。' };
    return { ok: true, state: state, exportedAt: obj.exportedAt || null };
  }

  function fileStamp(now) {
    var d = now || new Date();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  return {
    FIELDS: FIELDS,
    parseCSV: parseCSV,
    findHeaderRow: findHeaderRow,
    guessMapping: guessMapping,
    parseCellNumber: parseCellNumber,
    isCashLike: isCashLike,
    buildImportPreview: buildImportPreview,
    applyImport: applyImport,
    toCSV: toCSV,
    exportHoldingsCSV: exportHoldingsCSV,
    createBackup: createBackup,
    parseBackup: parseBackup,
    fileStamp: fileStamp
  };
});
