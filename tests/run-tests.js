// 在电脑上运行：npm test   （或 node tests/run-tests.js）
'use strict';
var calc = require('../js/calc.js');
var runCases = require('./calc-cases.js');

var results = runCases(calc);
var failed = results.filter(function (r) { return !r.ok; });

results.forEach(function (r) {
  console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '' : '\n      ' + r.error));
});
console.log('\n' + (results.length - failed.length) + ' 通过，' + failed.length + ' 失败，共 ' + results.length + ' 项');
process.exit(failed.length ? 1 : 0);
