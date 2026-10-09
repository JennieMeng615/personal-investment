/*
 * 计算逻辑测试用例。
 * 同一份用例有两种运行方式：
 *   1. 电脑上：npm test（或 node tests/run-tests.js）
 *   2. 浏览器里：打开 tests.html
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory;
  } else {
    root.PortfolioCalcCases = factory;
  }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var cases = [];
  function test(name, fn) { cases.push({ name: name, fn: fn }); }

  function fail(msg) { throw new Error(msg); }
  function equal(actual, expected, label) {
    if (actual !== expected) fail((label || '值') + '：期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
  function close(actual, expected, label) {
    if (typeof actual !== 'number' || Math.abs(actual - expected) > 1e-9) {
      fail((label || '值') + '：期望 ' + expected + '，实际 ' + actual);
    }
  }
  function truthy(v, label) { if (!v) fail(label || '期望为真'); }

  // ---------- 单个持仓 ----------
  test('单个持仓：成本、市值、盈亏、收益率', function () {
    var h = C.calcHolding({ id: 'a', symbol: 'VOO', name: 'x', type: 'ETF', shares: 12, avgCost: 420, price: 480 });
    close(h.costBasis, 5040, '成本');
    close(h.marketValue, 5760, '市值');
    close(h.pnl, 720, '盈亏');
    close(h.pnlPct, 720 / 5040, '收益率');
  });

  test('单个持仓：亏损时盈亏和收益率为负', function () {
    var h = C.calcHolding({ id: 'a', symbol: 'ABC', name: 'x', type: '股票', shares: 10, avgCost: 50, price: 40 });
    close(h.pnl, -100, '盈亏');
    close(h.pnlPct, -0.2, '收益率');
  });

  test('单个持仓：成本为 0 时收益率为 null（不除以 0）', function () {
    var h = C.calcHolding({ id: 'a', symbol: 'GIFT', name: 'x', type: '股票', shares: 5, avgCost: 0, price: 10 });
    close(h.pnl, 50, '盈亏');
    equal(h.pnlPct, null, '收益率');
  });

  test('单个持仓：小数股（碎股）', function () {
    var h = C.calcHolding({ id: 'a', symbol: 'VTI', name: 'x', type: 'ETF', shares: 0.5, avgCost: 200, price: 210 });
    close(h.marketValue, 105, '市值');
    close(h.pnl, 5, '盈亏');
  });

  // ---------- 整个组合（示例数据） ----------
  test('示例组合：总资产、现金、ETF 市值、总盈亏、总收益率', function () {
    var p = C.calcPortfolio(C.createSampleState());
    close(p.cash, 8000, '现金');
    close(p.securitiesValue, 5760 + 6375, '股票和 ETF 市值');
    close(p.etfValue, 12135, 'ETF 市值');
    close(p.stockValue, 0, '股票市值');
    close(p.totalAssets, 20135, '总资产');
    close(p.totalCost, 5040 + 5750, '总成本');
    close(p.totalPnl, 1345, '总盈亏');
    close(p.totalPnlPct, 1345 / 10790, '总收益率');
    equal(C.formatPct(p.totalPnlPct), '+12.47%', '总收益率显示');
  });

  test('资产配置：各部分占比相加等于 100%', function () {
    var p = C.calcPortfolio(C.createSampleState());
    var sum = p.allocation.reduce(function (s, a) { return s + a.pct; }, 0);
    close(sum, 1, '占比之和');
    var sumValue = p.allocation.reduce(function (s, a) { return s + a.value; }, 0);
    close(sumValue, p.totalAssets, '各部分金额之和');
    equal(p.allocation[p.allocation.length - 1].label, '现金', '最后一项');
  });

  test('只有现金、没有持仓', function () {
    var p = C.calcPortfolio({ cash: 1000, holdings: [] });
    close(p.totalAssets, 1000, '总资产');
    close(p.totalPnl, 0, '总盈亏');
    equal(p.totalPnlPct, null, '总收益率');
    close(p.allocation[0].pct, 1, '现金占比');
  });

  test('全部为 0 时不会出现 NaN', function () {
    var p = C.calcPortfolio({ cash: 0, holdings: [] });
    close(p.totalAssets, 0, '总资产');
    close(p.allocation[0].pct, 0, '现金占比');
  });

  test('股票和 ETF 分开汇总', function () {
    var p = C.calcPortfolio({
      cash: 0,
      holdings: [
        { id: '1', symbol: 'VOO', name: 'x', type: 'ETF', shares: 1, avgCost: 100, price: 110 },
        { id: '2', symbol: 'ABC', name: 'y', type: '股票', shares: 2, avgCost: 50, price: 40 }
      ]
    });
    close(p.etfValue, 110, 'ETF 市值');
    close(p.stockValue, 80, '股票市值');
    close(p.totalPnl, 10 - 20, '总盈亏');
    close(p.totalPnlPct, -10 / 200, '总收益率');
  });

  test('删除持仓后指标重新计算', function () {
    var s = C.createSampleState();
    s.holdings = s.holdings.filter(function (h) { return h.symbol !== 'VOO'; });
    var p = C.calcPortfolio(s);
    close(p.totalAssets, 8000 + 6375, '总资产');
    close(p.totalPnl, 625, '总盈亏');
  });

  // ---------- 表单校验 ----------
  test('校验：正常输入会被规范化（代码转大写、去掉逗号）', function () {
    var r = C.validateHolding({ symbol: ' voo ', name: '', type: 'ETF', shares: '1,000', avgCost: '$400.5', price: '410' }, [], null);
    truthy(r.ok, '应通过校验');
    equal(r.value.symbol, 'VOO', '代码');
    equal(r.value.name, 'VOO', '名称为空时用代码代替');
    close(r.value.shares, 1000, '数量');
    close(r.value.avgCost, 400.5, '买入价');
  });

  test('校验：数量为 0、负价格、非数字都会被拒绝', function () {
    var r = C.validateHolding({ symbol: 'ABC', type: 'ETF', shares: '0', avgCost: '-1', price: 'abc' }, [], null);
    equal(r.ok, false, 'ok');
    truthy(r.errors.shares, '应提示数量错误');
    truthy(r.errors.avgCost, '应提示买入价错误');
    truthy(r.errors.price, '应提示价格错误');
  });

  test('校验：代码不能为空、不能含特殊字符', function () {
    equal(C.validateHolding({ symbol: '', type: 'ETF', shares: 1, avgCost: 1, price: 1 }, [], null).ok, false, '空代码');
    equal(C.validateHolding({ symbol: '<b>', type: 'ETF', shares: 1, avgCost: 1, price: 1 }, [], null).ok, false, '特殊字符');
    equal(C.validateHolding({ symbol: 'BRK.B', type: '股票', shares: 1, avgCost: 1, price: 1 }, [], null).ok, true, 'BRK.B 合法');
  });

  test('校验：新增重复代码被拒绝，编辑自身不算重复', function () {
    var existing = C.createSampleState().holdings;
    var dup = C.validateHolding({ symbol: 'voo', type: 'ETF', shares: 1, avgCost: 1, price: 1 }, existing, null);
    equal(dup.ok, false, '新增重复');
    var self = C.validateHolding({ symbol: 'VOO', type: 'ETF', shares: 1, avgCost: 1, price: 1 }, existing, 'sample-voo');
    equal(self.ok, true, '编辑自身');
  });

  test('校验：现金', function () {
    equal(C.validateCash('5,000').value, 5000, '5,000');
    equal(C.validateCash('0').ok, true, '0');
    equal(C.validateCash('-1').ok, false, '-1');
    equal(C.validateCash('').ok, false, '空');
  });

  // ---------- 读取保存的数据 ----------
  test('读取保存数据：损坏的记录被丢弃，正常记录保留', function () {
    var s = C.normalizeState({
      cash: 100,
      holdings: [
        { id: 'a', symbol: 'VOO', name: 'n', type: 'ETF', shares: 1, avgCost: 1, price: 1 },
        { id: 'b', symbol: 'BAD', name: 'n', type: 'ETF', shares: -5, avgCost: 1, price: 1 },
        null,
        { id: 'a', symbol: 'DUP', name: 'n', type: 'ETF', shares: 1, avgCost: 1, price: 1 }
      ]
    });
    equal(s.holdings.length, 1, '保留条数');
    equal(s.holdings[0].symbol, 'VOO', '保留的代码');
  });

  test('读取保存数据：整体格式错误时返回 null', function () {
    equal(C.normalizeState(null), null, 'null');
    equal(C.normalizeState({ cash: 'x', holdings: [] }), null, '现金错误');
    equal(C.normalizeState({ cash: 1 }), null, '缺少持仓');
  });

  test('示例数据标记：编辑后可识别是否仍含示例数据', function () {
    var s = C.createSampleState();
    equal(C.hasSampleData(s), true, '初始');
    s.cashSample = false;
    s.holdings.forEach(function (h) { h.sample = false; });
    equal(C.hasSampleData(s), false, '全部编辑后');
  });

  // ---------- 显示格式 ----------
  test('金额与百分比格式', function () {
    equal(C.formatMoney(1234.5), '$1,234.50', '金额');
    equal(C.formatMoney(-20, true), '−$20.00', '负数');
    equal(C.formatMoney(20, true), '+$20.00', '正数带号');
    equal(C.formatMoney(-0.001, true), '$0.00', '接近 0');
    equal(C.formatPct(-0.05), '−5.00%', '负百分比');
    equal(C.formatPct(null), '—', '无法计算');
    close(C.round2(1.005), 1.01, '四舍五入');
  });

  // ---------- 运行 ----------
  return cases.map(function (c) {
    try {
      c.fn();
      return { name: c.name, ok: true };
    } catch (e) {
      return { name: c.name, ok: false, error: e.message };
    }
  });
});
