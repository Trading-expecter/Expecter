(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const state = {
    symbol: 'XAUUSD',
    mode: 'day',
    barsEntry: [],
    barsContext: [],
    tick: null,
    signal: null,
    feedMode: 'off',
    lastRegistered: null,
    loadToken: 0
  };

  let chart = null;
  let feed = null;
  let lastRender = 0;

  function entryTf() { return CONFIG.modes[state.mode].entryTf; }
  function contextTf() { return CONFIG.modes[state.mode].contextTf; }
  function modeCfg() { return CONFIG.modes[state.mode]; }
  function digits() { return CONFIG.symbols[state.symbol].digits; }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  function renderStatus() {
    const conn = $('conn-status');
    const market = $('market-status');
    const m = state.feedMode;
    conn.className = 'conn-status ' + m;
    conn.textContent = m === 'live' ? 'En vivo' : m === 'polling' ? 'Sondeo' : m === 'error' ? 'Error' : 'Conectando';
    if (state.tick) {
      market.textContent = state.tick.state === 'closed' ? 'Mercado cerrado' : 'Mercado abierto';
    } else {
      market.textContent = 'Cargando…';
    }
  }

  function renderHeader() {
    const header = $('signal-header');
    const icon = $('signal-icon');
    const label = $('signal-label');
    const symLabel = $('signal-symbol');
    const levels = $('signal-levels');
    const copyBtn = $('copy-levels');
    const s = state.signal;

    symLabel.textContent = state.symbol + ' · ' + entryTf();

    if (s && s.active) {
      header.className = 'signal-header is-' + s.direction;
      icon.textContent = s.direction === 'buy' ? '▲' : '▼';
      label.textContent = s.direction === 'buy' ? 'COMPRA' : 'VENTA';
      levels.hidden = false;
      copyBtn.hidden = false;
      const d = digits();
      $('level-entry').textContent = s.entry.toFixed(d);
      $('level-sl').textContent = s.stop.toFixed(d);
      $('level-tp').textContent = s.target.toFixed(d);
      $('level-rr').textContent = '1 : ' + s.riskReward.toFixed(1);
    } else {
      header.className = 'signal-header is-waiting';
      icon.textContent = '◷';
      label.textContent = 'ESPERANDO SETUP';
      levels.hidden = true;
      copyBtn.hidden = true;
    }
  }

  function renderConfluence() {
    const s = state.signal;
    const labels = {
      trend: 'Sesgo de Tendencia',
      structure: 'Estructura (BOS/CHoCH)',
      zone: 'Zona Institucional (OB/FVG)',
      momentum: 'Momentum (RSI)'
    };
    const list = $('confluence-checklist');
    list.innerHTML = Object.keys(labels).map(key => {
      const c = s && s.checklist ? s.checklist[key] : null;
      const cls = c ? (c.valid ? 'valid' : 'invalid') : 'pending';
      const text = c ? c.reason : labels[key];
      return '<li data-factor="' + key + '" class="' + cls + '">' + text + '</li>';
    }).join('');

    const fill = $('confidence-fill');
    const text = $('confidence-text');
    if (s && s.active) {
      const pct = s.confidence === 'alta' ? 100 : s.confidence === 'media' ? 66 : 33;
      fill.style.width = pct + '%';
      fill.className = 'confidence-fill ' + s.confidence;
      text.textContent = s.confidence.toUpperCase() + ' · ' + s.reasons.length + '/4';
    } else {
      fill.style.width = '0%';
      fill.className = 'confidence-fill';
      text.textContent = s ? 'Sin señal' : 'Analizando…';
    }

    const reason = $('smc-reason');
    if (s && s.active) {
      reason.textContent = s.reasons[0] || 'Confluencia detectada';
    } else if (s) {
      const missing = Object.values(s.checklist).filter(c => !c.valid).map(c => c.reason);
      reason.textContent = missing[0] || 'Sin confluencia';
    } else {
      reason.textContent = 'Analizando mercado…';
    }
  }

  function renderChart() {
    if (!chart || !state.barsEntry.length) return;
    const closes = state.barsEntry.map(b => b.c);
    const e50 = Indicators.ema(closes, modeCfg().emaFast);
    const e200 = Indicators.ema(closes, modeCfg().emaSlow);
    chart.setData(state.barsEntry, e50, e200);
    const zones = state.signal && state.signal.zones ? state.signal.zones : { ob: null, fvg: null };
    chart.setZones(zones);
    chart.setSignal(state.signal);
  }

  function renderExport() {
    const n = Exporter.count();
    $('export-info').textContent = n + ' señal' + (n === 1 ? '' : 'es') + ' registrada' + (n === 1 ? '' : 's');
    $('export-btn').disabled = n === 0;
  }

  function renderAll() {
    renderStatus();
    renderHeader();
    renderConfluence();
    renderChart();
    renderExport();
  }

  function evaluate() {
    if (!state.barsEntry.length || !state.barsContext.length) return;
    const price = state.tick ? state.tick.mid : state.barsEntry[state.barsEntry.length - 1].c;
    state.signal = Engine.evaluate(state.barsEntry, state.barsContext, modeCfg(), price);

    const closed = state.tick && state.tick.state === 'closed';
    if (state.signal.active && !closed) {
      const key = state.symbol + '|' + state.mode + '|' + state.signal.direction;
      if (state.lastRegistered !== key) {
        state.lastRegistered = key;
        Exporter.record(state.signal, state.symbol, entryTf(), state.mode);
      }
    } else if (!state.signal.active) {
      state.lastRegistered = null;
    }

    if (state.tick) Exporter.close(state.symbol, state.tick.mid);
  }

  async function loadBars() {
    const token = ++state.loadToken;
    try {
      const [entry, context] = await Promise.all([
        Data.fetchBars(state.symbol, entryTf(), 200),
        Data.fetchBars(state.symbol, contextTf(), 200)
      ]);
      if (token !== state.loadToken) return;
      state.barsEntry = entry;
      state.barsContext = context;
      state.signal = null;
      state.lastRegistered = null;
      evaluate();
      renderAll();
    } catch (e) {
      if (token !== state.loadToken) return;
      console.error('[App] Error cargando barras:', e);
    }
  }

  function selectSymbol(sym) {
    if (state.symbol === sym) return;
    state.symbol = sym;
    state.tick = null;
    document.querySelectorAll('.symbol-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sym === sym);
    });
    $('legend').textContent = 'Pase el cursor sobre el gráfico';
    loadBars();
  }

  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    $('tf-label').textContent = entryTf();
    loadBars();
  }

  function buildUI() {
    const symBar = $('symbol-bar');
    symBar.innerHTML = Object.keys(CONFIG.symbols).map(sym =>
      '<button class="symbol-btn' + (sym === state.symbol ? ' active' : '') + '" data-sym="' + sym + '">' + sym + '</button>'
    ).join('');
    symBar.addEventListener('click', e => {
      const btn = e.target.closest('[data-sym]');
      if (btn) selectSymbol(btn.dataset.sym);
    });

    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === state.mode);
    });
    $('mode-bar').addEventListener('click', e => {
      const btn = e.target.closest('[data-mode]');
      if (btn) setMode(btn.dataset.mode);
    });

    $('copy-levels').addEventListener('click', () => {
      const s = state.signal;
      if (!s || !s.active) return;
      const d = digits();
      const text = state.symbol + ' ' + s.direction.toUpperCase() +
        ' | Entrada: ' + s.entry.toFixed(d) +
        ' | SL: ' + s.stop.toFixed(d) +
        ' | TP: ' + s.target.toFixed(d);
      copyText(text).then(() => {
        const btn = $('copy-levels');
        const orig = btn.textContent;
        btn.textContent = '✓ Copiado';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }).catch(() => {});
    });

    $('export-btn').addEventListener('click', () => Exporter.download());
  }

  function initChart() {
    chart = Chart.create($('chart'));
    chart.onHover(bar => {
      const legend = $('legend');
      if (!bar) { legend.textContent = 'Pase el cursor sobre el gráfico'; return; }
      const d = digits();
      legend.textContent = 'O ' + bar.o.toFixed(d) + '  H ' + bar.h.toFixed(d) + '  L ' + bar.l.toFixed(d) + '  C ' + bar.c.toFixed(d);
    });
    window.addEventListener('resize', () => chart.resize());
  }

  function startFeed() {
    feed = Data.createFeed(Object.keys(CONFIG.symbols), {
      tick(t) {
        if (t.symbol !== state.symbol) return;
        state.tick = t;
        if (state.barsEntry.length) Data.applyTick(state.barsEntry, Data.TF[entryTf()], t.mid, t.ts);
        if (state.barsContext.length) Data.applyTick(state.barsContext, Data.TF[contextTf()], t.mid, t.ts);
        evaluate();
        const now = Date.now();
        if (now - lastRender >= 250) {
          lastRender = now;
          renderAll();
        }
      },
      status(mode) {
        state.feedMode = mode;
        renderStatus();
      }
    });
    feed.start();
  }

  function init() {
    buildUI();
    initChart();
    $('tf-label').textContent = entryTf();
    loadBars();
    startFeed();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();