/*
 * Personal Investment Dashboard — 计算逻辑（纯函数，无界面代码）
 *
 * 浏览器中通过 window.PortfolioCalc 使用；
 * Node.js 中通过 require('./js/calc.js') 使用（用于自动测试）。
 *
 * 口径说明：
 *   成本        = 持有数量 × 平均买入价
 *   市值        = 持有数量 × 当前价格
 *   盈亏金额    = 市值 − 成本
 *   收益率      = 盈亏金额 ÷ 成本（成本为 0 时无法计算，返回 null）
 *   总资产      = 现金 + 所有持仓市值
 *   总盈亏      = 所有持仓盈亏之和（现金不产生盈亏）
 *   总收益率    = 总盈亏 ÷ 所有持仓总成本
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PortfolioCalc = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TYPES = ['ETF', '股票'];
  var SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.\-]{0,9}$/;

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /** 把输入框里的文字转成数字；允许千分位逗号和前缀 $。无法识别时返回 NaN。 */
  function parseNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return NaN;
    var cleaned = value.replace(/[,\s$]/g, '');
    if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
    return Number(cleaned);
  }

  /** 四舍五入到 2 位小数（用于金额显示和比较）。 */
  function round2(x) {
    return Math.round((x + (x >= 0 ? Number.EPSILON : -Number.EPSILON)) * 100) / 100;
  }

  function calcHolding(h) {
    var costBasis = h.shares * h.avgCost;
    var marketValue = h.shares * h.price;
    var pnl = marketValue - costBasis;
    return {
      id: h.id,
      symbol: h.symbol,
      name: h.name,
      type: h.type,
      shares: h.shares,
      avgCost: h.avgCost,
      price: h.price,
      sample: !!h.sample,
      costBasis: costBasis,
      marketValue: marketValue,
      pnl: pnl,
      pnlPct: costBasis > 0 ? pnl / costBasis : null
    };
  }

  function calcPortfolio(state) {
    var cash = state.cash;
    var holdings = state.holdings.map(calcHolding);

    var securitiesValue = 0;
    var etfValue = 0;
    var stockValue = 0;
    var totalCost = 0;
    holdings.forEach(function (h) {
      securitiesValue += h.marketValue;
      totalCost += h.costBasis;
      if (h.type === 'ETF') etfValue += h.marketValue;
      else stockValue += h.marketValue;
    });

    var totalAssets = cash + securitiesValue;
    var totalPnl = securitiesValue - totalCost;

    holdings.forEach(function (h) {
      h.weight = totalAssets > 0 ? h.marketValue / totalAssets : 0;
    });

    var allocation = holdings.map(function (h) {
      return { key: h.id, label: h.symbol, value: h.marketValue, pct: h.weight };
    });
    allocation.push({
      key: 'cash',
      label: '现金',
      value: cash,
      pct: totalAssets > 0 ? cash / totalAssets : 0
    });

    return {
      cash: cash,
      holdings: holdings,
      securitiesValue: securitiesValue,
      etfValue: etfValue,
      stockValue: stockValue,
      totalAssets: totalAssets,
      totalCost: totalCost,
      totalPnl: totalPnl,
      totalPnlPct: totalCost > 0 ? totalPnl / totalCost : null,
      allocation: allocation
    };
  }

  /**
   * 检查用户在表单里填写的持仓。
   * existing：当前所有持仓（用于检查代码重复）；editingId：正在编辑的持仓 id（新增时为 null）。
   * 返回 { ok, errors: {字段: 提示}, value: 规范化后的持仓 }。
   */
  function validateHolding(input, existing, editingId) {
    var errors = {};
    var symbol = String(input.symbol || '').trim().toUpperCase();
    var name = String(input.name || '').trim();
    var type = TYPES.indexOf(input.type) >= 0 ? input.type : null;
    var shares = parseNumber(input.shares);
    var avgCost = parseNumber(input.avgCost);
    var price = parseNumber(input.price);

    if (!symbol) errors.symbol = '请填写股票代码，例如 VOO';
    else if (!SYMBOL_PATTERN.test(symbol)) errors.symbol = '代码只能包含字母、数字、点或横线，最多 10 位';
    else if ((existing || []).some(function (h) { return h.symbol === symbol && h.id !== editingId; })) {
      errors.symbol = symbol + ' 已在持仓中，请直接编辑原有记录';
    }

    if (name.length > 60) errors.name = '名称最多 60 个字';
    if (!type) errors.type = '请选择 ETF 或 股票';

    if (!isFiniteNumber(shares) || shares <= 0) errors.shares = '持有数量必须大于 0';
    if (!isFiniteNumber(avgCost) || avgCost < 0) errors.avgCost = '平均买入价必须是 0 或正数';
    if (!isFiniteNumber(price) || price < 0) errors.price = '当前价格必须是 0 或正数';

    var ok = Object.keys(errors).length === 0;
    return {
      ok: ok,
      errors: errors,
      value: ok ? {
        symbol: symbol,
        name: name || symbol,
        type: type,
        shares: shares,
        avgCost: avgCost,
        price: price
      } : null
    };
  }

  function validateCash(input) {
    var cash = parseNumber(input);
    if (!isFiniteNumber(cash) || cash < 0) {
      return { ok: false, error: '现金必须是 0 或正数', value: null };
    }
    return { ok: true, error: null, value: cash };
  }

  /** 虚构示例数据：价格是编造的，不代表任何真实行情。 */
  function createSampleState() {
    return {
      version: 1,
      cash: 8000,
      cashSample: true,
      holdings: [
        { id: 'sample-voo', symbol: 'VOO', name: 'Vanguard S&P 500 ETF', type: 'ETF', shares: 12, avgCost: 420, price: 480, sample: true },
        { id: 'sample-vti', symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'ETF', shares: 25, avgCost: 230, price: 255, sample: true }
      ]
    };
  }

  /** 读取浏览器里保存的数据时使用：丢弃损坏的记录。数据整体无效时返回 null。 */
  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.holdings)) return null;
    var cash = validateCash(raw.cash);
    if (!cash.ok) return null;
    var seen = {};
    var holdings = [];
    raw.holdings.forEach(function (h) {
      if (!h || typeof h !== 'object' || typeof h.id !== 'string' || seen[h.id]) return;
      var check = validateHolding(h, holdings, null);
      if (!check.ok) return;
      seen[h.id] = true;
      var v = check.value;
      v.id = h.id;
      v.sample = h.sample === true;
      holdings.push(v);
    });
    return { version: 1, cash: cash.value, cashSample: raw.cashSample === true, holdings: holdings };
  }

  function hasSampleData(state) {
    return state.cashSample || state.holdings.some(function (h) { return h.sample; });
  }

  var moneyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var priceFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  var sharesFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

  /** $1,234.56；signed=true 时带 +/− 号。 */
  function formatMoney(x, signed) {
    var r = round2(x);
    if (r === 0) r = 0; // 去掉 -0
    var text = moneyFormatter.format(Math.abs(r));
    if (r < 0) return '−' + text;
    if (signed && r > 0) return '+' + text;
    return text;
  }

  function formatPrice(x) {
    return priceFormatter.format(x);
  }

  function formatShares(x) {
    return sharesFormatter.format(x);
  }

  /** 0.12345 → "+12.35%"；null → "—"。 */
  function formatPct(ratio, signed) {
    if (ratio === null || !isFiniteNumber(ratio)) return '—';
    var r = round2(ratio * 100);
    if (r === 0) r = 0;
    var text = Math.abs(r).toFixed(2) + '%';
    if (r < 0) return '−' + text;
    if (signed !== false && r > 0) return '+' + text;
    return text;
  }

  return {
    TYPES: TYPES,
    parseNumber: parseNumber,
    round2: round2,
    calcHolding: calcHolding,
    calcPortfolio: calcPortfolio,
    validateHolding: validateHolding,
    validateCash: validateCash,
    createSampleState: createSampleState,
    normalizeState: normalizeState,
    hasSampleData: hasSampleData,
    formatMoney: formatMoney,
    formatPrice: formatPrice,
    formatShares: formatShares,
    formatPct: formatPct
  };
});
