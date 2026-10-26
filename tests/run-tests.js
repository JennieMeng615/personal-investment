// 在电脑上运行：npm test   （或 node tests/run-tests.js）
'use strict';
var fs = require('fs');
var path = require('path');
var calc = require('../js/calc.js');
var csv = require('../js/csv.js');
var fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'fidelity-positions-sample.csv'), 'utf8');

var groups = [
  ['计算逻辑', require('./calc-cases.js')(calc)],
  ['CSV 导入 / 导出 / 备份', require('./csv-cases.js')(calc, csv, fixture)]
];

var total = 0, failed = 0;
groups.forEach(function (g) {
  console.log('\n' + g[0]);
  g[1].forEach(function (r) {
    total++;
    if (!r.ok) failed++;
    console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '' : '\n      ' + r.error));
  });
});
console.log('\n' + (total - failed) + ' 通过，' + failed + ' 失败，共 ' + total + ' 项');
process.exit(failed ? 1 : 0);
