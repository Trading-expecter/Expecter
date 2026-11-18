/* ============================================================
 * SMC Signals — Terminal de Confluencia
 * app.js  (9/11)  ·  Orquestador (UI + feed + motor + alertas)
 * ============================================================ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const state = {
    symbol: CONFIG.defaultSymbol,
    mode: CONFIG.defaultMode,
    barsEntry: [], barsContext: [], tick: null, signal: null,
    feedMode: 'off', lastRegistered: null,
    lastArmedKey: null, lastArmedAt: 0, loadToken: 0
  };

  let chart = null, feed = null, audioCtx = null, lastRender = 0;

  const entryTf = () => CONFIG.modes[state.mode].entryTf;
  const contextTf = () => CONFIG.modes[state.mode].contextTf;
  const modeCfg = () => CONFIG.modes[state.mode];
  const digits = () => (CONFIG.symbols[state.symbol] || {}).digits || 2;

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); resolve(); } catch (e) { reject(e); }
      finally { document.body.removeChild(ta); }
    });
  }

  function beep(kind) {
    if (!CONFIG.alert.sound) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const notes = kind === 'signal' ? [880, 1175] : [520, 660];
      const t0 = audioCtx.currentTime;
      notes.forEach((f, i) => {
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.type = 'sine'; osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, t0 + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.18 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.16);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + i * 0.18); osc.stop(t0 + i * 0.18 + 0.18);
      });
    } catch (e) {}
  }

  function notify(title, body) {
    if (!CONFIG.alert.notify) return;
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, silent: true });
      }
    } catch (e) {}
  }

  function askNotifyPermission() {
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    } catch (e) {}
  }

  function renderStatus() {
    const conn = $('conn-status'), market = $('market-status');
    const m = state.feedMode;
    conn.className = 'conn-status ' + m;
    conn.textContent = m === 'live' ? 'En vivo' : m === 'polling' ? 'Sondeo'
      : m === 'error' ? 'Error de conexión' : m === 'closed' ? 'Mercado cerrado' : 'Conectando';
    if (state.tick) {
      const closed = state.tick.state === 'closed' || state.tick.stale;
      market.textContent = closed ? 'Mercado cerrado · último precio' : 'Mercado abierto';
      market.style.color = closed ? 'var(--warn)' : 'var(--text-secondary)';
    } else market.textContent = 'Cargando…';
  }

  function renderHeader() {
    const header = $('signal-header'), icon = $('signal-icon'), label = $('signal-label');
    const symLabel = $('signal-symbol'), levels = $('signal-levels'), copyBtn = $('copy-levels');
    const s = state.signal, d = digits();
    symLabel.textContent = state.symbol + ' · ' + entryTf();

    if (s && s.active) {
      header.className = 'signal-header is-' + s.direction;
      icon.textContent = s.direction === 'buy' ? '▲' : '▼';
      label.textContent = s.direction === 'buy' ? 'COMPRA' : 'VENTA';
      levels.hidden = false; copyBtn.hidden = false;
      $('level-entry').textContent = Number.isFinite(s.entry) ? s.entry.toFixed(d) : '—';
      $('level-sl').textContent = Number.isFinite(s.stop) ? s.stop.toFixed(d) : '—';
      $('level-tp').textContent = Number.isFinite(s.target) ? s.target.toFixed(d) : '—';
      $('level-rr').textContent = Number.isFinite(s.riskReward) ? '1 : ' + s.riskReward.toFixed(1) : '—';
    } else if (s && s.armed) {
      header.className = 'signal-header is-armed';
      icon.textContent = '◔';
      label.textContent = s.armedDirection === 'buy' ? 'PREPARAR COMPRA' : 'PREPARAR VENTA';
      levels.hidden = true; copyBtn.hidden = true;
    } else {
      header.className = 'signal-header is-waiting';
      icon.textContent = '◷'; label.textContent = 'ESPERANDO SETUP';
      levels.hidden = true; copyBtn.hidden = true;
    }
  }

  function renderConfluence() {
    const s = state.signal;
    const labels = { trend: 'Sesgo de Tendencia', structure: 'Estructura (BOS/CHoCH)',
      zone: 'Zona Institucional (OB/FVG)', momentum: 'Momentum (RSI)' };
    $('confluence-checklist').innerHTML = Object.keys(labels).map(key => {
      const c = s && s.checklist ? s.checklist[key] : null;
      const cls = c ? (c.valid ? 'valid' : 'invalid') : 'pending';
      return '<li data-factor="' + key + '" class="' + cls + '">' + (c ? c.reason : labels[key]) + '</li>';
    }).join('');

    const fill = $('confidence-fill'), text = $('confidence-text');
    if (s && (s.active || s.armed)) {
      const pct = s.confidence === 'alta' ? 100 : s.confidence === 'media' ? 66 : 33;
      fill.style.width = pct + '%';
      fill.className = 'confidence-fill ' + (s.armed ? 'armed' : s.confidence);
      text.textContent = (s.armed ? 'PREPARANDO · ' : '') + s.confidence.toUpperCase() + ' · ' + s.reasons.length + '/4';
    } else {
      fill.style.width = '0%'; fill.className = 'confidence-fill';
      text.textContent = s ? 'Sin señal' : 'Analizando…';
    }

    const reason = $('smc-reason');
    if (s && s.active) reason.textContent = s.reasons.join(' · ') || 'Confluencia detectada';
    else if (s && s.armed && s.armedZone) {
      const dist = Number.isFinite(s.armedDistance) ? ' a ' + s.armedDistance.toFixed(digits()) + ' pts' : '';
      reason.textContent = (s.armedDirection === 'buy' ? 'Precio aproximándose a zona de compra' : 'Precio aproximándose a zona de venta') + dist + ' (' + s.armedZone.type + ')';
    } else if (s) {
      const missing = Object.values(s.checklist).filter(c => !c.valid).map(c => c.reason);
      reason.textContent = missing[0] || 'Sin confluencia';
    } else reason.textContent = 'Analizando mercado…';
  }

  function renderChart() {
    if (!chart || !state.barsEntry.length) return;
    const closes = state.barsEntry.map(b => b.c);
    chart.setDigits(digits());
    chart.setData(state.barsEntry, Indicators.ema(closes, modeCfg().emaFast), Indicators.ema(closes, modeCfg().emaSlow));
    chart.setZones(state.signal && state.signal.zones ? state.signal.zones : { ob: null, fvg: null });
    chart.setSignal(state.signal);
  }

  function renderExport() {
    const n = Exporter.count(), open = Exporter.openCount();
    $('export-info').textContent = n + ' señal' + (n === 1 ? '' : 'es') + ' registrada' + (n === 1 ? '' : 's') +
      (open ? ' · ' + open + ' abierta' + (open === 1 ? '' : 's') : '');
    $('export-btn').disabled = n === 0;
  }

  function renderAll() { renderStatus(); renderHeader(); renderConfluence(); renderChart(); renderExport(); }

  function evaluate() {
    if (!state.barsEntry.length || !state.barsContext.length) return;
    const price = state.tick ? state.tick.mid : state.barsEntry[state.barsEntry.length - 1].c;
    state.signal = Engine.evaluate(state.barsEntry, state.barsContext, modeCfg(), price);
    const s = state.signal;
    const closed = state.tick && (state.tick.state === 'closed' || state.tick.stale);

    if (s.active && !closed) {
      const key = state.symbol + '|' + state.mode + '|' + s.direction;
      if (state.lastRegistered !== key) {
        state.lastRegistered = key;
        Exporter.record(s, state.symbol, entryTf(), state.mode);
        beep('signal');
        notify('Señal ' + (s.direction === 'buy' ? 'COMPRA' : 'VENTA') + ' · ' + state.symbol,
          'Entrada ' + s.entry.toFixed(digits()) + ' · SL ' + s.stop.toFixed(digits()) + ' · TP ' + s.target.toFixed(digits()));
      }
    } else if (!s.active) state.lastRegistered = null;

    if (s.armed && !closed && CONFIG.alert.enabled) {
      const key = state.symbol + '|' + state.mode + '|' + s.armedDirection + '|' +
        (s.armedZone ? s.armedZone.type + ':' + s.armedZone.index : '');
      const now = Date.now();
      if (state.lastArmedKey !== key || now - state.lastArmedAt > CONFIG.alert.repeatEveryMs) {
        state.lastArmedKey = key; state.lastArmedAt = now;
        beep('armed');
        notify('PREPARAR ' + (s.armedDirection === 'buy' ? 'COMPRA' : 'VENTA') + ' · ' + state.symbol,
          'Precio aproximándose a zona institucional (' + (s.armedZone ? s.armedZone.type : 'OB/FVG') + ')');
      }
    }

    if (state.tick) {
      const closedNow = Exporter.close(state.symbol, state.tick.mid);
      closedNow.forEach(x => notify((x.result === 'WIN' ? '✓ Take profit' : '✕ Stop loss') + ' · ' + x.symbol,
        'Salida a ' + x.exitPrice.toFixed(digits()) + ' · ' + x.direction.toUpperCase()));
    }
  }

  async function loadBars() {
    const token = ++state.loadToken;
    try {
      const [entry, context] = await Promise.all([
        Data.fetchBars(state.symbol, entryTf(), modeCfg().maxBars || 300),
        Data.fetchBars(state.symbol, contextTf(), modeCfg().maxBars || 300)
      ]);
      if (token !== state.loadToken) return;
      state.barsEntry = entry; state.barsContext = context;
      state.signal = null; state.lastRegistered = null;
      evaluate(); renderAll();
    } catch (e) {
      if (token !== state.loadToken) return;
      console.error('[App] Error cargando barras:', e);
      $('market-status').textContent = 'Error cargando ' + state.symbol;
    }
  }

  function selectSymbol(sym) {
    if (!CONFIG.symbols[sym] || state.symbol === sym) return;
    askNotifyPermission();
    state.symbol = sym; state.tick = null;
    document.querySelectorAll('.symbol-btn').forEach(b => b.classList.toggle('active', b.dataset.sym === sym));
    $('legend').textContent = 'Pase el cursor sobre el gráfico';
    loadBars();
  }

  function setMode(mode) {
    if (!CONFIG.modes[mode] || state.mode === mode) return;
    askNotifyPermission();
    state.mode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    $('tf-label').textContent = entryTf();
    loadBars();
  }

  function buildUI() {
    $('symbol-bar').innerHTML = Object.keys(CONFIG.symbols).map(sym =>
      '<button class="symbol-btn' + (sym === state.symbol ? ' active' : '') + '" data-sym="' + sym + '">' + sym + '</button>'
    ).join('');
    $('symbol-bar').addEventListener('click', e => {
      const btn = e.target.closest('[data-sym]'); if (btn) selectSymbol(btn.dataset.sym);
    });
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.mode));
    $('mode-bar').addEventListener('click', e => {
      const btn = e.target.closest('[data-mode]'); if (btn) setMode(btn.dataset.mode);
    });
    $('copy-levels').addEventListener('click', () => {
      const s = state.signal; if (!s || !s.active) return;
      const d = digits();
      const text = state.symbol + ' ' + s.direction.toUpperCase() + ' | Entrada: ' + s.entry.toFixed(d) +
        ' | SL: ' + s.stop.toFixed(d) + ' | TP: ' + s.target.toFixed(d) + ' | R:B 1:' + s.riskReward.toFixed(1);
      copyText(text).then(() => {
        const btn = $('copy-levels'), orig = btn.textContent;
        btn.textContent = '✓ Copiado'; setTimeout(() => { btn.textContent = orig; }, 1500);
      }).catch(() => {});
    });
    $('export-btn').addEventListener('click', () => Exporter.download());
  }

  function initChart() {
    chart = Chart.create($('chart'));
    chart.setDigits(digits());
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
        if (now - lastRender >= 250) { lastRender = now; renderAll(); }
      },
      status(mode) { state.feedMode = mode; renderStatus(); },
      subscriptionState(states) {
        (states || []).forEach(s => { if (s.state === 'unknown') console.warn('[Feed] Símbolo no soportado:', s.symbol); });
      }
    });
    feed.start();
  }

  function init() { buildUI(); initChart(); $('tf-label').textContent = entryTf(); loadBars(); startFeed(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
