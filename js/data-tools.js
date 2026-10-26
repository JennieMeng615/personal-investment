/*
 * 导入与备份的界面：CSV 导入（字段匹配 + 预览）、导出持仓 CSV、备份 / 恢复、撤销。
 * 所有文件都在浏览器内读取和生成，不会上传。计算与解析逻辑在 csv.js 中。
 */
(function () {
  'use strict';

  var C = window.PortfolioCalc;
  var CSV = window.PortfolioCSV;
  var app = null;          // { getState, setState }，由 app.js 调用 init 时提供
  var undo = null;         // 导入 / 恢复之前的数据，用于「撤销」
  var openSheetId = null;
  var lastFocus = null;
  var importCtx = null;    // { fileName, rows, headerIndex, mapping, typeOverrides, preview }
  var exportCtx = null;    // { text, fileName, mime }
  var pendingRestore = null;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // ---------- 弹窗 ----------
  function openSheet(id) {
    if (openSheetId) $(openSheetId).hidden = true;
    lastFocus = lastFocus || document.activeElement;
    openSheetId = id;
    $('dt-backdrop').hidden = false;
    $(id).hidden = false;
    $(id).scrollTop = 0;
    document.body.style.overflow = 'hidden';
    var first = $(id).querySelector('.dt-close');
    if (first) setTimeout(function () { first.focus(); }, 50);
  }

  function closeSheet() {
    if (!openSheetId) return;
    $(openSheetId).hidden = true;
    $('dt-backdrop').hidden = true;
    document.body.style.overflow = '';
    openSheetId = null;
    importCtx = null;
    pendingRestore = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  function showMessage(text, isError) {
    var m = $('data-message');
    m.textContent = text;
    m.classList.toggle('is-error', !!isError);
    m.hidden = !text;
  }

  // ---------- 撤销 ----------
  function replaceWithUndo(next, message) {
    undo = JSON.parse(JSON.stringify(app.getState()));
    app.setState(next);
    $('undo-text').textContent = message;
    $('undo-bar').hidden = false;
  }

  function clearUndo() {
    undo = null;
    $('undo-bar').hidden = true;
  }

  function onUndo() {
    if (!undo) return;
    var prev = undo;
    clearUndo();
    app.setState(prev);
    showMessage('已撤销，数据回到了操作之前的状态。');
  }

  // ---------- 读取文件 ----------
  function readFile(input, callback) {
    var file = input.files && input.files[0];
    input.value = ''; // 允许再次选择同一个文件
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showMessage('文件太大（超过 5 MB），请确认选择的是持仓 CSV 或备份文件。', true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () { callback(String(reader.result || ''), file.name); };
    reader.onerror = function () { showMessage('无法读取这个文件，请重新选择。', true); };
    reader.readAsText(file);
  }

  // ---------- CSV 导入 ----------
  function onCsvChosen(text, fileName) {
    var rows = CSV.parseCSV(text);
    var headerIndex = CSV.findHeaderRow(rows);
    if (headerIndex < 0 || rows.length < headerIndex + 2) {
      showMessage('「' + fileName + '」里没有找到数据。请确认这是带表头的 CSV 文件。', true);
      return;
    }
    showMessage('');
    importCtx = {
      fileName: fileName,
      rows: rows,
      headerIndex: headerIndex,
      mapping: CSV.guessMapping(rows[headerIndex]),
      typeOverrides: {},
      preview: null
    };
    $('import-file').textContent = fileName + ' · 共 ' + (rows.length - headerIndex - 1) + ' 行';
    $('default-type').value = 'ETF';
    $('add-cash').checked = false;
    renderMapping();
    renderPreview();
    openSheet('import-sheet');
  }

  /** 某一列的说明文字：「C 列 · Symbol（如 VOO）」 */
  function columnLabel(idx) {
    var header = importCtx.rows[importCtx.headerIndex][idx] || '（无表头）';
    var example = '';
    for (var i = importCtx.headerIndex + 1; i < importCtx.rows.length && !example; i++) {
      example = importCtx.rows[i][idx] || '';
    }
    var letter = idx < 26 ? String.fromCharCode(65 + idx) : String(idx + 1);
    return letter + ' 列 · ' + header + (example ? '（如 ' + example.slice(0, 24) + '）' : '');
  }

  function renderMapping() {
    var grid = $('mapping-grid');
    grid.textContent = '';
    var headers = importCtx.rows[importCtx.headerIndex];
    CSV.FIELDS.forEach(function (f) {
      var label = el('label', 'field');
      label.appendChild(el('span', null, f.label + (f.required ? '（必填）' : '')));
      var select = el('select');
      select.id = 'map-' + f.key;
      var none = el('option', null, '（不使用）');
      none.value = '-1';
      select.appendChild(none);
      headers.forEach(function (h, idx) {
        var o = el('option', null, columnLabel(idx));
        o.value = String(idx);
        select.appendChild(o);
      });
      select.value = importCtx.mapping[f.key] !== undefined ? String(importCtx.mapping[f.key]) : '-1';
      select.addEventListener('change', function () {
        var v = Number(select.value);
        if (v < 0) delete importCtx.mapping[f.key];
        else importCtx.mapping[f.key] = v;
        renderPreview();
      });
      label.appendChild(select);
      grid.appendChild(label);
    });
  }

  var STATUS_TEXT = { 'new': '导入', duplicate: '跳过', cash: '现金', skipped: '忽略', invalid: '无法导入' };

  function renderPreview() {
    var state = app.getState();
    var preview = CSV.buildImportPreview(importCtx.rows, importCtx.headerIndex, importCtx.mapping, state.holdings, {
      defaultType: $('default-type').value,
      typeOverrides: importCtx.typeOverrides
    });
    importCtx.preview = preview;

    var missing = $('import-missing');
    missing.hidden = !preview.missingRequired.length;
    missing.textContent = preview.missingRequired.length ? '还需要匹配：' + preview.missingRequired.join('、') + '。请在上面的下拉框中选择对应的列。' : '';

    var counts = { 'new': 0, duplicate: 0, cash: 0, skipped: 0, invalid: 0 };
    preview.items.forEach(function (i) { counts[i.status]++; });
    var summary = $('import-summary');
    summary.textContent = '';
    [['new', '将导入'], ['duplicate', '已存在、跳过'], ['invalid', '无法导入'], ['cash', '现金行'], ['skipped', '忽略']].forEach(function (c) {
      if (!counts[c[0]] && c[0] !== 'new') return;
      summary.appendChild(el('span', 'chip chip-' + c[0], c[1] + ' ' + counts[c[0]]));
    });

    var body = $('import-rows');
    body.textContent = '';
    if (!preview.items.length && !preview.missingRequired.length) {
      var tr0 = el('tr', 'empty-row');
      var td0 = el('td', null, '没有可识别的持仓行。');
      td0.colSpan = 8;
      tr0.appendChild(td0);
      body.appendChild(tr0);
    }
    preview.items.forEach(function (item) {
      var tr = el('tr', 'status-' + item.status);
      tr.appendChild(cellWith(el('span', 'chip chip-' + item.status, STATUS_TEXT[item.status])));
      var sym = el('td', 'col-sym');
      sym.appendChild(el('span', 'sym', item.symbol));
      if (item.name) sym.appendChild(el('span', 'sym-name sym-name-always', item.name));
      tr.appendChild(sym);
      var v = item.value;
      if (item.status === 'cash') {
        tr.appendChild(el('td', 'r', ''));
        tr.appendChild(el('td', 'r', ''));
        tr.appendChild(el('td', 'r', ''));
        tr.appendChild(el('td', 'r', C.formatMoney(item.amount)));
      } else if (v) {
        tr.appendChild(el('td', 'r', C.formatShares(v.shares)));
        tr.appendChild(el('td', 'r', C.formatPrice(v.avgCost)));
        tr.appendChild(el('td', 'r', C.formatPrice(v.price)));
        tr.appendChild(el('td', 'r', C.formatMoney(v.shares * v.price)));
      } else {
        for (var k = 0; k < 4; k++) tr.appendChild(el('td', 'r', '—'));
      }
      var typeCell = el('td');
      if (item.status === 'new') {
        var sel = el('select', 'type-select');
        sel.setAttribute('aria-label', item.symbol + ' 的类型');
        C.TYPES.forEach(function (t) { var o = el('option', null, t); o.value = t; sel.appendChild(o); });
        sel.value = v.type;
        sel.addEventListener('change', function () {
          importCtx.typeOverrides[item.symbol] = sel.value;
          renderPreview();
        });
        typeCell.appendChild(sel);
      } else if (v) {
        typeCell.textContent = '';
      }
      tr.appendChild(typeCell);
      tr.appendChild(el('td', 'reason', item.reason));
      body.appendChild(tr);
    });

    var cashOption = $('cash-option');
    cashOption.hidden = !(preview.cashTotal > 0);
    $('cash-option-text').textContent = '把文件里的现金 / 货币基金 ' + C.formatMoney(preview.cashTotal) +
      ' 加到现有现金上（现在是 ' + C.formatMoney(state.cash) + '，加上后为 ' + C.formatMoney(state.cash + preview.cashTotal) + '）';

    updateConfirmButton();
  }

  function cellWith(node) {
    var td = el('td');
    td.appendChild(node);
    return td;
  }

  function updateConfirmButton() {
    var p = importCtx.preview;
    var addCash = $('add-cash').checked && p.cashTotal > 0;
    var btn = $('confirm-import-btn');
    btn.disabled = !(p.newCount > 0 || addCash);
    if (p.newCount > 0) btn.textContent = '导入 ' + p.newCount + ' 个持仓' + (addCash ? '和现金' : '');
    else if (addCash) btn.textContent = '只导入现金';
    else btn.textContent = '没有可导入的持仓';
  }

  function onConfirmImport() {
    if (!importCtx || !importCtx.preview) return;
    var addCash = $('add-cash').checked;
    var stamp = Date.now().toString(36);
    var result = CSV.applyImport(app.getState(), importCtx.preview, {
      addCash: addCash,
      makeId: function (i) { return 'csv-' + stamp + '-' + i; }
    });
    var cashAdded = addCash ? importCtx.preview.cashTotal : 0;
    closeSheet();
    var parts = [];
    if (result.addedCount) parts.push('已导入 ' + result.addedCount + ' 个持仓');
    if (cashAdded > 0) parts.push('现金增加 ' + C.formatMoney(cashAdded));
    replaceWithUndo(result.state, parts.join('，') + '。原有持仓没有改动。');
    showMessage('');
  }

  // ---------- 导出 / 备份 ----------
  function openExport(kind) {
    var state = app.getState();
    var stamp = CSV.fileStamp();
    if (kind === 'csv') {
      exportCtx = {
        text: CSV.exportHoldingsCSV(state),
        fileName: 'holdings-' + stamp + '.csv',
        mime: 'text/csv'
      };
      $('export-title').textContent = '导出持仓 CSV';
      $('export-desc').textContent = '包含 ' + state.holdings.length + ' 个持仓的代码、数量、成本、价格、市值和盈亏。不包含现金；需要完整保存请用「备份全部数据」。';
    } else {
      exportCtx = {
        text: CSV.createBackup(state),
        fileName: 'investment-backup-' + stamp + '.json',
        mime: 'application/json'
      };
      $('export-title').textContent = '备份全部数据';
      $('export-desc').textContent = '备份包含现金和全部 ' + state.holdings.length + ' 个持仓。请把文件存到「文件」App 的 iCloud 云盘，以后可用「从备份恢复」还原。';
    }
    $('export-text').value = exportCtx.text.replace(/^﻿/, '');
    $('export-status').hidden = true;
    openSheet('export-sheet');
  }

  function exportStatus(text) {
    $('export-status').textContent = text;
    $('export-status').hidden = false;
  }

  function onSaveFile() {
    if (!exportCtx) return;
    var ctx = exportCtx;
    var file = null;
    try { file = new File([ctx.text], ctx.fileName, { type: ctx.mime }); } catch (e) { file = null; }

    // iPhone：用系统分享面板，选择「存储到文件」。
    var touch = navigator.maxTouchPoints > 0;
    if (touch && file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: ctx.fileName }).then(function () {
        exportStatus('已打开分享面板。如果选择了「存储到文件」，文件名是 ' + ctx.fileName + '。');
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return; // 用户取消
        download(ctx);
      });
      return;
    }
    download(ctx);
  }

  function download(ctx) {
    try {
      var blob = new Blob([ctx.text], { type: ctx.mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = ctx.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      exportStatus('已开始下载 ' + ctx.fileName + '。iPhone 上可在「文件」App →「下载项」中找到。如果没有反应，请用「复制内容」。');
    } catch (e) {
      exportStatus('这个浏览器不允许保存文件，请用「复制内容」，再粘贴到备忘录或其他 App。');
    }
  }

  function onCopy() {
    if (!exportCtx) return;
    var area = $('export-text');
    function fallback() {
      area.focus();
      area.select();
      area.setSelectionRange(0, area.value.length);
      exportStatus('已选中全部内容，请长按选择「拷贝」。');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(area.value).then(function () {
        exportStatus('已复制到剪贴板。');
      }, fallback);
    } else {
      fallback();
    }
  }

  // ---------- 恢复 ----------
  function onBackupChosen(text, fileName) {
    var r = CSV.parseBackup(text);
    if (!r.ok) {
      showMessage('「' + fileName + '」：' + r.error, true);
      return;
    }
    showMessage('');
    pendingRestore = r.state;
    var cur = app.getState();
    var p = C.calcPortfolio(r.state);
    var info = $('restore-info');
    info.textContent = '';
    var when = r.exportedAt ? new Date(r.exportedAt).toLocaleString('zh-CN') : '未知时间';
    [
      ['备份文件', fileName],
      ['备份时间', when],
      ['备份内容', r.state.holdings.length + ' 个持仓，现金 ' + C.formatMoney(r.state.cash) + '，总资产 ' + C.formatMoney(p.totalAssets)],
      ['当前数据', cur.holdings.length + ' 个持仓，现金 ' + C.formatMoney(cur.cash)]
    ].forEach(function (pair) {
      var row = el('p');
      row.appendChild(el('span', 'muted', pair[0] + '：'));
      row.appendChild(document.createTextNode(pair[1]));
      info.appendChild(row);
    });
    openSheet('restore-sheet');
  }

  function onConfirmRestore() {
    if (!pendingRestore) return;
    var next = pendingRestore;
    closeSheet();
    replaceWithUndo(next, '已从备份恢复（' + next.holdings.length + ' 个持仓）。');
  }

  // ---------- 初始化 ----------
  function init(api) {
    app = api;
    $('import-csv-btn').addEventListener('click', function () { $('csv-file').click(); });
    $('restore-btn').addEventListener('click', function () { $('backup-file').click(); });
    $('csv-file').addEventListener('change', function () { readFile($('csv-file'), onCsvChosen); });
    $('backup-file').addEventListener('change', function () { readFile($('backup-file'), onBackupChosen); });
    $('export-csv-btn').addEventListener('click', function () { openExport('csv'); });
    $('backup-btn').addEventListener('click', function () { openExport('backup'); });
    $('default-type').addEventListener('change', renderPreview);
    $('add-cash').addEventListener('change', updateConfirmButton);
    $('confirm-import-btn').addEventListener('click', onConfirmImport);
    $('save-file-btn').addEventListener('click', onSaveFile);
    $('copy-btn').addEventListener('click', onCopy);
    $('confirm-restore-btn').addEventListener('click', onConfirmRestore);
    $('undo-btn').addEventListener('click', onUndo);
    $('dt-backdrop').addEventListener('click', closeSheet);
    Array.prototype.forEach.call(document.querySelectorAll('.dt-close'), function (b) {
      b.addEventListener('click', closeSheet);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openSheetId) closeSheet();
    });
  }

  window.PortfolioDataTools = {
    init: init,
    clearUndo: clearUndo,
    replaceWithUndo: replaceWithUndo
  };
})();
