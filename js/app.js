/*
 * 页面交互：读取/保存数据、渲染界面、添加/编辑/删除持仓、编辑现金。
 * 数据只保存在浏览器 localStorage 中，不会发送到任何服务器。
 */
(function () {
  'use strict';

  var C = window.PortfolioCalc;
  var Charts = window.PortfolioCharts;
  var STORAGE_KEY = 'pid-portfolio-v1';

  var state = loadState();
  var editing = null; // { mode: 'holding', id: string|null } 或 { mode: 'cash' }
  var lastFocus = null;

  function $(id) { return document.getElementById(id); }

  // ---------- 保存 / 读取 ----------
  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = C.normalizeState(JSON.parse(raw));
        if (parsed) return parsed;
      }
    } catch (e) { /* 无法读取时使用示例数据 */ }
    return C.createSampleState();
  }

  function saveState() {
    var status = $('save-status');
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      status.textContent = '已保存到本机浏览器（' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '）。';
    } catch (e) {
      status.textContent = '注意：浏览器不允许保存（可能是无痕模式），关闭页面后修改会丢失。';
    }
  }

  function newId() {
    return 'h-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  // ---------- 渲染 ----------
  function setSigned(node, text, value) {
    node.textContent = text;
    node.classList.remove('up', 'down');
    if (value > 0) node.classList.add('up');
    else if (value < 0) node.classList.add('down');
  }

  function render() {
    var p = C.calcPortfolio(state);

    $('sample-pill').hidden = !C.hasSampleData(state);
    $('total-assets').textContent = C.formatMoney(p.totalAssets);
    $('hero-pnl').textContent = C.formatMoney(p.totalPnl, true) + '（' + C.formatPct(p.totalPnlPct) + '）';

    $('kpi-cash').textContent = C.formatMoney(p.cash);
    $('kpi-cash-sub').textContent = '占总资产 ' + C.formatPct(p.totalAssets > 0 ? p.cash / p.totalAssets : 0, false) + (state.cashSample ? ' · 示例' : '');
    $('kpi-securities').textContent = C.formatMoney(p.securitiesValue);
    $('kpi-securities-sub').textContent = 'ETF ' + C.formatMoney(p.etfValue) + ' · 股票 ' + C.formatMoney(p.stockValue);
    setSigned($('kpi-pnl'), C.formatMoney(p.totalPnl, true), p.totalPnl);
    $('kpi-cost').textContent = '持仓总成本 ' + C.formatMoney(p.totalCost);
    setSigned($('kpi-pnl-pct'), C.formatPct(p.totalPnlPct), p.totalPnl);

    renderTable(p);
    Charts.renderAllocation($('allocation-chart'), p, C);
    Charts.renderPerformance($('performance-chart'), p, C);
  }

  function td(text, cls) {
    var cell = document.createElement('td');
    if (cls) cell.className = cls;
    if (text !== undefined) cell.textContent = text;
    return cell;
  }

  function renderTable(p) {
    var body = $('holdings-body');
    var foot = $('holdings-foot');
    body.textContent = '';
    foot.textContent = '';

    if (!p.holdings.length) {
      var tr = document.createElement('tr');
      tr.className = 'empty-row';
      var cell = td('还没有持仓。点右上角「＋ 添加持仓」录入第一笔。');
      cell.colSpan = 9;
      tr.appendChild(cell);
      body.appendChild(tr);
      return;
    }

    p.holdings.forEach(function (h) {
      var tr = document.createElement('tr');

      var symCell = td(undefined, 'col-sym');
      var sym = document.createElement('span');
      sym.className = 'sym';
      sym.textContent = h.symbol;
      symCell.appendChild(sym);
      if (h.sample) {
        var tag = document.createElement('span');
        tag.className = 'tag-sample';
        tag.textContent = '示例';
        symCell.appendChild(tag);
      }
      var typeTag = document.createElement('span');
      typeTag.className = 'sym-tag';
      typeTag.textContent = h.type;
      symCell.appendChild(typeTag);
      var nameTag = document.createElement('span');
      nameTag.className = 'sym-name';
      nameTag.textContent = h.name;
      symCell.appendChild(nameTag);
      tr.appendChild(symCell);

      var nameCell = td(h.name, 'name-cell col-name');
      nameCell.title = h.name;
      tr.appendChild(nameCell);
      tr.appendChild(td(C.formatShares(h.shares), 'r'));
      tr.appendChild(td(C.formatPrice(h.avgCost), 'r'));
      tr.appendChild(td(C.formatPrice(h.price), 'r'));
      tr.appendChild(td(C.formatMoney(h.marketValue), 'r'));
      var pnlCell = td(undefined, 'r');
      setSigned(pnlCell, C.formatMoney(h.pnl, true), h.pnl);
      tr.appendChild(pnlCell);
      var pctCell = td(undefined, 'r');
      setSigned(pctCell, C.formatPct(h.pnlPct), h.pnl);
      tr.appendChild(pctCell);

      var actionCell = td(undefined, 'r');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-link';
      btn.textContent = '编辑';
      btn.setAttribute('aria-label', '编辑 ' + h.symbol);
      btn.addEventListener('click', function () { openHoldingSheet(h.id); });
      actionCell.appendChild(btn);
      tr.appendChild(actionCell);

      body.appendChild(tr);
    });

    var ft = document.createElement('tr');
    ft.appendChild(td('合计', 'col-sym'));
    ft.appendChild(td(p.holdings.length + ' 个持仓', 'name-cell col-name'));
    ft.appendChild(td(''));
    ft.appendChild(td('成本 ' + C.formatMoney(p.totalCost), 'r'));
    ft.appendChild(td(''));
    ft.appendChild(td(C.formatMoney(p.securitiesValue), 'r'));
    var tp = td(undefined, 'r');
    setSigned(tp, C.formatMoney(p.totalPnl, true), p.totalPnl);
    ft.appendChild(tp);
    var tpp = td(undefined, 'r');
    setSigned(tpp, C.formatPct(p.totalPnlPct), p.totalPnl);
    ft.appendChild(tpp);
    ft.appendChild(td(''));
    foot.appendChild(ft);
  }

  // ---------- 弹窗 ----------
  var HOLDING_FIELDS = ['symbol', 'name', 'type', 'shares', 'avgCost', 'price'];

  function clearErrors() {
    HOLDING_FIELDS.concat(['cash']).forEach(function (f) {
      $('e-' + f).textContent = '';
      $('f-' + f).removeAttribute('aria-invalid');
    });
  }

  function showError(field, msg) {
    $('e-' + field).textContent = msg;
    $('f-' + field).setAttribute('aria-invalid', 'true');
  }

  function openSheet(firstField) {
    lastFocus = document.activeElement;
    resetDeleteButton();
    $('sheet-backdrop').hidden = false;
    $('sheet').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () { $(firstField).focus(); }, 50);
  }

  function closeSheet() {
    editing = null;
    $('sheet-backdrop').hidden = true;
    $('sheet').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function openHoldingSheet(id) {
    var h = id ? state.holdings.filter(function (x) { return x.id === id; })[0] : null;
    editing = { mode: 'holding', id: h ? h.id : null };
    clearErrors();
    $('sheet-title').textContent = h ? '编辑 ' + h.symbol : '添加持仓';
    $('holding-fields').hidden = false;
    $('cash-fields').hidden = true;
    $('delete-btn').hidden = !h;
    $('f-symbol').value = h ? h.symbol : '';
    $('f-name').value = h ? h.name : '';
    $('f-type').value = h ? h.type : 'ETF';
    $('f-shares').value = h ? String(h.shares) : '';
    $('f-avgCost').value = h ? String(h.avgCost) : '';
    $('f-price').value = h ? String(h.price) : '';
    updatePreview();
    openSheet(h ? 'f-shares' : 'f-symbol');
  }

  function openCashSheet() {
    editing = { mode: 'cash' };
    clearErrors();
    $('sheet-title').textContent = '编辑现金';
    $('holding-fields').hidden = true;
    $('cash-fields').hidden = false;
    $('delete-btn').hidden = true;
    $('f-cash').value = String(state.cash);
    openSheet('f-cash');
  }

  function readHoldingForm() {
    var input = {};
    HOLDING_FIELDS.forEach(function (f) { input[f] = $('f-' + f).value; });
    return input;
  }

  /** 填写时实时预览这笔持仓的市值和盈亏。 */
  function updatePreview() {
    var out = $('form-preview');
    var shares = C.parseNumber($('f-shares').value);
    var cost = C.parseNumber($('f-avgCost').value);
    var price = C.parseNumber($('f-price').value);
    if (!(shares > 0) || !(cost >= 0) || !(price >= 0)) {
      out.textContent = '';
      return;
    }
    var h = C.calcHolding({ shares: shares, avgCost: cost, price: price });
    out.textContent = '预计市值 ' + C.formatMoney(h.marketValue) + ' · 盈亏 ' + C.formatMoney(h.pnl, true) + '（' + C.formatPct(h.pnlPct) + '）';
  }

  function onSubmit(event) {
    event.preventDefault();
    if (!editing) return;
    clearErrors();

    if (editing.mode === 'cash') {
      var cash = C.validateCash($('f-cash').value);
      if (!cash.ok) { showError('cash', cash.error); $('f-cash').focus(); return; }
      state.cash = cash.value;
      state.cashSample = false;
    } else {
      var result = C.validateHolding(readHoldingForm(), state.holdings, editing.id);
      if (!result.ok) {
        var first = null;
        HOLDING_FIELDS.forEach(function (f) {
          if (result.errors[f]) { showError(f, result.errors[f]); if (!first) first = f; }
        });
        $('f-' + first).focus();
        return;
      }
      var v = result.value;
      v.sample = false;
      if (editing.id) {
        v.id = editing.id;
        state.holdings = state.holdings.map(function (h) { return h.id === editing.id ? v : h; });
      } else {
        v.id = newId();
        state.holdings.push(v);
      }
    }
    saveState();
    render();
    closeSheet();
  }

  // 删除需要点两次：第一次变成「确认删除」，第二次才真正删除。
  function resetDeleteButton() {
    var btn = $('delete-btn');
    btn.classList.remove('confirming');
    btn.textContent = '删除此持仓';
  }

  function onDelete() {
    if (!editing || editing.mode !== 'holding' || !editing.id) return;
    var btn = $('delete-btn');
    if (!btn.classList.contains('confirming')) {
      var h = state.holdings.filter(function (x) { return x.id === editing.id; })[0];
      btn.classList.add('confirming');
      btn.textContent = '确认删除 ' + (h ? h.symbol : '') + '？';
      return;
    }
    var id = editing.id;
    state.holdings = state.holdings.filter(function (h) { return h.id !== id; });
    saveState();
    render();
    closeSheet();
  }

  var resetTimer = null;
  function onReset() {
    var btn = $('reset-btn');
    if (!btn.classList.contains('confirming')) {
      btn.classList.add('confirming');
      btn.textContent = '再点一次：清除我的数据并恢复示例';
      clearTimeout(resetTimer);
      resetTimer = setTimeout(function () {
        btn.classList.remove('confirming');
        btn.textContent = '恢复示例数据';
      }, 5000);
      return;
    }
    clearTimeout(resetTimer);
    btn.classList.remove('confirming');
    btn.textContent = '恢复示例数据';
    state = C.createSampleState();
    saveState();
    render();
  }

  // ---------- 事件绑定 ----------
  $('add-holding-btn').addEventListener('click', function () { openHoldingSheet(null); });
  $('edit-cash-btn').addEventListener('click', openCashSheet);
  $('holding-form').addEventListener('submit', onSubmit);
  $('sheet-close').addEventListener('click', closeSheet);
  $('cancel-btn').addEventListener('click', closeSheet);
  $('sheet-backdrop').addEventListener('click', closeSheet);
  $('delete-btn').addEventListener('click', onDelete);
  $('reset-btn').addEventListener('click', onReset);
  ['f-shares', 'f-avgCost', 'f-price'].forEach(function (id) { $(id).addEventListener('input', updatePreview); });
  // 用户修改某个输入框时，清除该字段的错误提示
  HOLDING_FIELDS.concat(['cash']).forEach(function (f) {
    $('f-' + f).addEventListener('input', function () {
      $('e-' + f).textContent = '';
      $('f-' + f).removeAttribute('aria-invalid');
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && editing) closeSheet();
  });

  render();
})();
