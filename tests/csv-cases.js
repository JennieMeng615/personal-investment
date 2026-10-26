/*
 * CSV 导入 / 导出 / 备份的测试用例。
 * 与 calc-cases.js 一样，电脑（npm test）和浏览器（tests.html）共用。
 * fixtureText：可选，Fidelity 格式示例文件的内容（电脑上运行时由 run-tests.js 传入）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory;
  } else {
    root.PortfolioCSVCases = factory;
  }
})(typeof self !== 'undefined' ? self : this, function (C, CSV, fixtureText) {
  'use strict';

  var cases = [];
  function test(name, fn) { cases.push({ name: name, fn: fn }); }
  function fail(msg) { throw new Error(msg); }
  function equal(actual, expected, label) {
    if (actual !== expected) fail((label || '值') + '：期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }
  function close(actual, expected, label) {
    if (typeof actual !== 'number' || Math.abs(actual - expected) > 1e-6) fail((label || '值') + '：期望 ' + expected + '，实际 ' + actual);
  }
  function find(preview, symbol) {
    return preview.items.filter(function (i) { return i.symbol === symbol; })[0];
  }

  // 虚构的 Fidelity 格式样本（结构与 tests/fixtures/fidelity-positions-sample.csv 相同，内容更短）
  var MINI = '﻿Account Number,Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,Current Value,Total Gain/Loss Dollar,Cost Basis Total,Average Cost Basis,Type\r\n' +
    'X1,Individual,SPAXX**,HELD IN MONEY MARKET,,,,$1000.50,,,,Cash,\r\n' +
    'X1,Individual,VOO,"VANGUARD S&P 500 ETF, USD",3,$480.00,+$1.00,"$1,440.00",+$180.00,"$1,260.00",$420.00,Cash,\r\n' +
    'X1,Individual,QQQ,INVESCO QQQ,4,$410.00,-$2.50,$1640.00,+$240.00,$1400.00,$350.00,Cash,\r\n' +
    'X2,Roth IRA,QQQ,INVESCO QQQ,6,$410.00,-$2.50,$2460.00,+$360.00,$2100.00,$350.00,Cash,\r\n' +
    'X2,Roth IRA,XYZW,DEMO,10,$55.00,,$550.00,--,--,--,Cash,\r\n' +
    'X2,Roth IRA,Pending Activity,,,,,-$120.00,,,,,\r\n' +
    '\r\n' +
    '"The data and information in this spreadsheet is provided to you solely for your use."\r\n' +
    '"Date downloaded 10/09/2026 4:00 PM ET"\r\n';

  function miniPreview(existing, options) {
    var rows = CSV.parseCSV(MINI);
    var h = CSV.findHeaderRow(rows);
    return CSV.buildImportPreview(rows, h, CSV.guessMapping(rows[h]), existing || [], options);
  }

  // ---------- 解析 ----------
  test('CSV 解析：引号内逗号、"" 转义、换行、CRLF', function () {
    var rows = CSV.parseCSV('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n');
    equal(rows.length, 2, '行数');
    equal(rows[1][0], 'x, y', '引号内逗号');
    equal(rows[1][1], 'say "hi"', '转义引号');
    equal(rows[1][2], 'line1\nline2', '引号内换行');
  });

  test('CSV 解析：去掉 BOM，支持分号分隔', function () {
    equal(CSV.parseCSV('﻿Symbol,Quantity\nVOO,1')[0][0], 'Symbol', 'BOM');
    equal(CSV.parseCSV('Symbol;Quantity\nVOO;1,5')[1][1], '1,5', '分号');
  });

  test('数字解析：$、千分位、正负号、括号、百分号、"--"', function () {
    close(CSV.parseCellNumber('$1,234.56'), 1234.56, '$1,234.56');
    close(CSV.parseCellNumber('+$12.00'), 12, '+$12.00');
    close(CSV.parseCellNumber('-$5.10'), -5.1, '-$5.10');
    close(CSV.parseCellNumber('($5.00)'), -5, '($5.00)');
    close(CSV.parseCellNumber('12.5%'), 12.5, '12.5%');
    equal(isNaN(CSV.parseCellNumber('--')), true, '--');
    equal(isNaN(CSV.parseCellNumber('n/a')), true, 'n/a');
    equal(isNaN(CSV.parseCellNumber('')), true, '空');
  });

  // ---------- 字段匹配 ----------
  test('自动识别 Fidelity 表头', function () {
    var rows = CSV.parseCSV(MINI);
    var h = CSV.findHeaderRow(rows);
    equal(h, 0, '表头行');
    var m = CSV.guessMapping(rows[h]);
    equal(m.symbol, 2, 'Symbol');
    equal(m.name, 3, 'Description');
    equal(m.shares, 4, 'Quantity');
    equal(m.price, 5, 'Last Price');
    equal(m.value, 7, 'Current Value');
    equal(m.totalCost, 9, 'Cost Basis Total');
    equal(m.avgCost, 10, 'Average Cost Basis');
  });

  test('表头前有说明文字时也能找到表头', function () {
    var rows = CSV.parseCSV('My export\n\nTicker,Shares,Price,Avg Cost\nVTI,2,250,200\n');
    equal(CSV.findHeaderRow(rows), 2, '表头行');
  });

  test('自动识别本工具导出的中文表头', function () {
    var m = CSV.guessMapping(['代码', '名称', '类型', '持有数量', '平均买入价', '当前价格', '市值', '成本']);
    equal(m.symbol, 0, '代码'); equal(m.shares, 3, '持有数量'); equal(m.avgCost, 4, '平均买入价');
    equal(m.price, 5, '当前价格'); equal(m.value, 6, '市值'); equal(m.totalCost, 7, '成本');
  });

  test('缺少必填字段时提示，不生成导入项', function () {
    var p = CSV.buildImportPreview([['Symbol', 'Price'], ['VOO', '1']], 0, { symbol: 0, price: 1 }, [], {});
    equal(p.newCount, 0, '导入数');
    equal(p.missingRequired.indexOf('持有数量') >= 0, true, '提示缺少数量');
  });

  // ---------- 导入预览 ----------
  test('预览：现金行、待结算、免责声明被正确处理', function () {
    var p = miniPreview();
    close(p.cashTotal, 1000.5, '现金合计');
    equal(find(p, 'SPAXX**').status, 'cash', 'SPAXX**');
    equal(find(p, 'Pending Activity').status, 'skipped', 'Pending');
    equal(p.items.some(function (i) { return /data and information|Date downloaded/.test(i.symbol); }), false, '免责声明不会出现');
  });

  test('预览：同一代码多行合并，数量相加、成本加权', function () {
    var q = find(miniPreview(), 'QQQ');
    equal(q.status, 'new', '状态');
    close(q.value.shares, 10, '数量');
    close(q.value.avgCost, 350, '平均买入价');
    close(q.value.price, 410, '价格');
  });

  test('预览：成本为 "--" 的行标为无法导入', function () {
    var x = find(miniPreview(), 'XYZW');
    equal(x.status, 'invalid', '状态');
    equal(/成本/.test(x.reason), true, '原因提到成本');
  });

  test('预览：已有代码跳过，绝不覆盖', function () {
    var p = miniPreview(C.createSampleState().holdings);
    equal(find(p, 'VOO').status, 'duplicate', 'VOO');
    equal(p.newCount, 1, '只导入 QQQ');
  });

  test('预览：只有总成本、没有平均价时自动换算；没有价格时用市值 ÷ 数量', function () {
    var rows = [['Symbol', 'Quantity', 'Cost Basis Total', 'Current Value'], ['ABC', '4', '$400', '$480']];
    var p = CSV.buildImportPreview(rows, 0, CSV.guessMapping(rows[0]), [], { defaultType: '股票' });
    var a = find(p, 'ABC');
    close(a.value.avgCost, 100, '平均买入价');
    close(a.value.price, 120, '价格');
    equal(a.value.type, '股票', '默认类型');
  });

  test('预览：可为单个代码指定类型', function () {
    var p = miniPreview([], { defaultType: 'ETF', typeOverrides: { QQQ: '股票' } });
    equal(find(p, 'QQQ').value.type, '股票', 'QQQ 类型');
  });

  // ---------- 确认导入 ----------
  test('确认导入：只追加新持仓，原有持仓保持不变', function () {
    var state = C.createSampleState();
    var before = JSON.stringify(state);
    var p = miniPreview(state.holdings);
    var r = CSV.applyImport(state, p, { importedAt: '2026-10-09', makeId: function (i) { return 'id' + i; } });
    equal(JSON.stringify(state), before, '原数据对象未被修改');
    equal(r.addedCount, 1, '新增数');
    equal(r.state.holdings.length, 3, '持仓数');
    equal(JSON.stringify(r.state.holdings.slice(0, 2)), JSON.stringify(state.holdings), '原有两条完全相同');
    var q = r.state.holdings[2];
    equal(q.symbol, 'QQQ', '新增代码'); equal(q.source, 'csv', '来源'); equal(q.priceAsOf, '2026-10-09', '日期');
    close(r.state.cash, 8000, '未勾选时现金不变');
  });

  test('确认导入：勾选后现金行金额加到现有现金（不是替换）', function () {
    var state = C.createSampleState();
    var r = CSV.applyImport(state, miniPreview(state.holdings), { addCash: true });
    close(r.state.cash, 9000.5, '现金');
  });

  test('确认导入后指标自动重新计算', function () {
    var state = C.createSampleState();
    var r = CSV.applyImport(state, miniPreview(state.holdings), {});
    var p = C.calcPortfolio(r.state);
    close(p.securitiesValue, 5760 + 6375 + 4100, '市值');
    close(p.totalCost, 5040 + 5750 + 3500, '成本');
    close(p.totalPnl, 720 + 625 + 600, '盈亏');
    close(p.totalAssets, 8000 + 16235, '总资产');
  });

  test('重复导入同一文件不会产生重复持仓', function () {
    var s1 = CSV.applyImport(C.createSampleState(), miniPreview(C.createSampleState().holdings), {}).state;
    var p2 = miniPreview(s1.holdings);
    equal(p2.newCount, 0, '第二次可导入数');
    equal(CSV.applyImport(s1, p2, {}).state.holdings.length, s1.holdings.length, '持仓数不变');
  });

  // ---------- 导出与备份 ----------
  test('导出 CSV：带 BOM、表头和计算结果，可以重新导入', function () {
    var csv = CSV.exportHoldingsCSV(C.createSampleState());
    equal(csv.charAt(0), '﻿', 'BOM');
    var rows = CSV.parseCSV(csv);
    equal(rows.length, 3, '行数');
    equal(rows[1][0], 'VOO', '代码');
    equal(rows[1][6], '5760', '市值');
    var p = CSV.buildImportPreview(rows, CSV.findHeaderRow(rows), CSV.guessMapping(rows[0]), [], {});
    equal(p.newCount, 2, '重新导入数');
    close(find(p, 'VTI').value.avgCost, 230, 'VTI 买入价');
  });

  test('导出 CSV：防止 Excel 公式注入', function () {
    equal(CSV.toCSV([['=SUM(A1)', 'a,b']]), "'=SUM(A1),\"a,b\"\r\n", '转义');
  });

  test('备份与恢复：数据完整还原', function () {
    var s = CSV.applyImport(C.createSampleState(), miniPreview(), { addCash: true, importedAt: '2026-10-09' }).state;
    var r = CSV.parseBackup(CSV.createBackup(s, new Date('2026-10-09T12:00:00Z')));
    equal(r.ok, true, 'ok');
    equal(JSON.stringify(r.state), JSON.stringify(C.normalizeState(s)), '内容一致');
    equal(r.state.holdings[2].source, 'csv', '来源标记保留');
    equal(r.exportedAt, '2026-10-09T12:00:00.000Z', '备份时间');
  });

  test('恢复：拒绝无效或不相关的文件', function () {
    equal(CSV.parseBackup('not json').ok, false, '非 JSON');
    equal(CSV.parseBackup('{"foo":1}').ok, false, '其他 JSON');
    equal(CSV.parseBackup('{"app":"personal-investment-dashboard","backupVersion":1,"data":{"cash":-1,"holdings":[]}}').ok, false, '损坏数据');
  });

  // ---------- 完整示例文件（仅电脑上运行） ----------
  if (fixtureText) {
    test('完整 Fidelity 示例文件 tests/fixtures/fidelity-positions-sample.csv', function () {
      var rows = CSV.parseCSV(fixtureText);
      var h = CSV.findHeaderRow(rows);
      var p = CSV.buildImportPreview(rows, h, CSV.guessMapping(rows[h]), C.createSampleState().holdings, {});
      equal(p.newCount, 3, '可导入数（QQQ、AAPL、SCHD）');
      close(p.cashTotal, 2020.33, '现金合计');
      equal(find(p, 'VOO').status, 'duplicate', 'VOO 跳过');
      equal(find(p, 'XYZW').status, 'invalid', 'XYZW 无成本');
      close(find(p, 'QQQ').value.shares, 10, 'QQQ 合并');
      equal(find(p, 'SCHD').name, 'SCHWAB STRATEGIC TR US DIVIDEND EQUITY ETF', 'SCHD 名称');
      var s = CSV.applyImport(C.createSampleState(), p, { addCash: true }).state;
      var pf = C.calcPortfolio(s);
      close(pf.securitiesValue, 21685, '总市值');
      close(pf.totalPnl, 1895, '总盈亏');
      close(pf.totalAssets, 21685 + 10020.33, '总资产');
    });
  }

  return cases.map(function (c) {
    try { c.fn(); return { name: c.name, ok: true }; }
    catch (e) { return { name: c.name, ok: false, error: e.message }; }
  });
});
