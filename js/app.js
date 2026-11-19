(function () {
  'use strict';

  const AT = window.AT;
  const D = AT.data;
  const A = AT.analysis;
  const SMC = AT.smcEngine;
  const CFG = window.AT_CONFIG;
  const TIM = (CFG && CFG.timings) || {};

  const UPDATE_INTERVAL_MS = TIM.updateIntervalMs || 1000;
  const PRICE_CHECK_MS = TIM.priceCheckMs || 500;
  const MAX_SIGNAL_LOG = 500;
  const BAR_LIMIT = 150;                // Velas por timeframe (bajado de 300)
  const LOAD_RETRIES = 2;               // Reintentos por TF
  const RETRY_DELAY_MS = 1000;          // Espera entre reintentos

  const state = {
    symbol: 'XAUUSD',
    tf: (CFG.timeframes && CFG.timeframes.entry) || '15m',
    bars: {},
    ticks: {},
    analysis: null,
    smcResult: null,
    feedMode: 'off',
    loading: false,
    requestId: 0,
    signalLog: [],
    lastSignalKey: '',
    lastSignalAt: 0,
    drawMenuOpen: false,
    gapRefill: {},
    lastRenderHash: '',
    lastAnalysisAt: 0,
    lastPriceCheckAt: 0,
    cycleSkipCount: 0,
    cycleErrorCount: 0
  };

  const loop = { masterId: 0, priceId: 0, locked: false, stopped: true };
  let chart = null;
  let feed = null;
  let fsAbort = null;
  let rafId = 0;
  let rafPending = false;

  function $ (id) { return document.getElementById(id); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(sym, price) {
    const inst = CFG.symbols[sym];
    if (!inst || price == null || !Number.isFinite(price)) return '—';
    return Number(price).toFixed(inst.digits);
  }

  function sgn(v, d) {
    if (v == null || !Number.isFinite(v)) return '—';
    return (v >= 0 ? '+' : '') + Number(v).toFixed(d);
  }

  function needleAngle(score, dir) {
    if (dir === 0 || dir == null) return 0;
    const s = Math.max(0, Math.min(100, score || 0));
    return (s / 100) * 90 * dir;
  }

  function currentTool() {
    return chart && typeof chart.getTool === 'function' ? chart.getTool() : 'cursor';
  }

  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    rafId = requestAnimationFrame(function () {
      rafPending = false;
      rafId = 0;
      try { renderAll(false); }
      catch (e) { console.error('[app] renderAll excepción:', e); }
    });
  }

  function renderStatus() {
    const dot = $('statusDot');
    const txt = $('statusText');
    if (!dot || !txt) return;
    const m = state.feedMode;
    let cls = '', msg = 'Conectando…';
    if (m === 'live') { cls = 'ok'; msg = 'En vivo'; }
    else if (m === 'polling') { cls = 'warn'; msg = 'Sondeo'; }
    else if (m === 'reconnecting') { cls = 'warn'; msg = 'Reconectando…'; }
    else if (m === 'stale') { cls = 'warn'; msg = 'Datos obsoletos'; }
    else if (m === 'error') { cls = 'bad'; msg = 'Sin conexión'; }
    dot.className = 'dot ' + cls;
    txt.textContent = msg;
  }

  function renderPrice() {
    const t = state.ticks[state.symbol];
    const bars = state.bars[state.tf] || [];
    const price = t ? t.mid : (bars.length ? bars[bars.length - 1].c : null);

    const el = $('priceBig');
    if (el) el.textContent = fmt(state.symbol, price);

    const chg = $('priceChg');
    if (chg) {
      if (t && t.dayPct != null && t.state !== 'closed') {
        chg.textContent = sgn(t.dayPct, 2) + '% hoy';
        chg.className = 'price-chg ' + (t.dayPct >= 0 ? 'up' : 'down');
      } else chg.textContent = '';
    }

    const sub = $('priceSub');
    if (sub) {
      sub.textContent = t
        ? 'Bid ' + fmt(state.symbol, t.bid) + ' · Ask ' + fmt(state.symbol, t.ask) + ' · Spread ' + fmt(state.symbol, t.spread)
        : 'Esperando precio…';
    }

    const sb = $('sessionBadge');
    if (sb) {
      const a = state.analysis;
      const open = a ? a.marketOpen : false;
      const label = a ? a.sessionLabel : '—';
      sb.textContent = label;
      sb.className = 'session-badge ' + (open ? 'ok' : 'bad');
      sb.title = open
        ? (a && a.highLiquidity ? 'Mercado abierto, liquidez alta' : 'Mercado abierto, liquidez normal')
        : 'Mercado cerrado';
    }
  }

  function renderGauge() {
    const a = state.analysis;
    const needle = $('needle');
    const label = $('gaugeLabel');
    const score = $('gaugeScore');
    if (!needle || !label || !score) return;

    if (!a) {
      needle.style.opacity = '0.3';
      label.textContent = 'Cargando…';
      label.className = 'gauge-label neutral';
      score.textContent = '';
      return;
    }

    needle.style.opacity = '1';
    needle.setAttribute('transform', 'rotate(' + needleAngle(a.consensusScore, a.overallDirection).toFixed(1) + ' 100 100)');
    label.textContent = a.consensusText;
    label.className = 'gauge-label ' + a.consensusLabel;

    const parts = ['Consenso: ' + a.consensusScore.toFixed(0) + '%'];
    if (Number.isFinite(a.confidence)) parts.push('confianza: ' + a.confidence.toFixed(0) + '%');
    score.textContent = parts.join(' · ');
  }

  function renderVerdict() {
    const a = state.analysis;
    const badge = $('verdictBadge');
    const reason = $('verdictReason');
    if (!badge || !reason) return;

    if (!a) {
      badge.innerHTML = '<span class="verdict-icon" aria-hidden="true">◷</span><span class="verdict-text">ESPERAR</span>';
      badge.className = 'verdict-badge wait';
      reason.textContent = 'Esperando datos del mercado...';
      return;
    }

    const icon = a.verdictState === 'buy' ? '▲' : a.verdictState === 'sell' ? '▼' : '◷';
    badge.innerHTML = '<span class="verdict-icon" aria-hidden="true">' + icon + '</span>' +
      '<span class="verdict-text">' + esc(a.verdictLabel) + '</span>';
    badge.className = 'verdict-badge ' + a.verdictState;

    let text = a.verdictReason || '';
    if (a.verdictRisk && a.verdictRisk.valid) {
      const r = a.verdictRisk;
      text += ' · Stop ' + fmt(state.symbol, r.stop) + ' · Target ' + fmt(state.symbol, r.target);
    }
    reason.textContent = text;
  }

  function renderSMC() {
    const smc = state.smcResult;
    const scoreEl = $('smcScore');
    const barEl = $('smcBarFill');
    const reasonsEl = $('smcReasons');
    if (!scoreEl || !barEl || !reasonsEl) return;

    if (!smc) {
      scoreEl.textContent = '0%';
      scoreEl.style.color = 'var(--accent)';
      barEl.style.width = '0%';
      barEl.style.backgroundColor = 'var(--accent)';
      reasonsEl.innerHTML = '<li class="muted">Esperando datos...</li>';
      return;
    }

    scoreEl.textContent = smc.score.toFixed(0) + '%';
    barEl.style.width = smc.score + '%';

    if (smc.score >= 80) { barEl.style.backgroundColor = 'var(--up)'; scoreEl.style.color = 'var(--up)'; }
    else if (smc.score >= 50) { barEl.style.backgroundColor = 'var(--warn)'; scoreEl.style.color = 'var(--warn)'; }
    else { barEl.style.backgroundColor = 'var(--down)'; scoreEl.style.color = 'var(--down)'; }

    const lines = [];
    const bd = smc.breakdown || {};
    const order = ['mss', 'sweep', 'fvg', 'ob', 'ote', 'htfBias', 'penalty', 'vetoed'];
    const names = {
      mss: 'Estructura', sweep: 'Sweep', fvg: 'FVG', ob: 'Order Block',
      ote: 'OTE', htfBias: 'Sesgo HTF', penalty: 'Penalización', vetoed: 'Veto'
    };

    order.forEach(function (key) {
      const e = bd[key];
      if (!e || !e.weighted) return;
      const sign = (key === 'penalty' || key === 'vetoed') ? '−' : (e.weighted < 0 ? '−' : '+');
      lines.push('<li>' + esc(names[key] || key) + ': ' + sign + Math.abs(e.weighted).toFixed(1) +
        (e.reason ? ' — ' + esc(e.reason) : '') + '</li>');
    });

    if (lines.length === 0) lines.push('<li class="muted">Sin componentes ponderados.</li>');

    if (smc.vetoes && smc.vetoes.length) {
      smc.vetoes.forEach(function (v) { lines.push('<li style="color: var(--warn)">⚠ ' + esc(v) + '</li>'); });
    }

    if (typeof smc.riskMultiplier === 'number' && !smc.vetoed) {
      const pct = Math.round(smc.riskMultiplier * 100);
      const color = pct >= 100 ? 'var(--up)' : pct >= 50 ? 'var(--warn)' : 'var(--down)';
      lines.push('<li style="color: ' + color + '">Riesgo sugerido: ' + pct + '% del máximo.</li>');
    }

    reasonsEl.innerHTML = lines.join('');
  }

  function renderAlerts() {
    const a = state.analysis;
    const card = $('alertCard');
    const list = $('alertList');
    if (!card || !list) return;

    if (!a) { card.hidden = true; list.innerHTML = ''; return; }
    const alerts = a.alerts || [];
    if (alerts.length === 0) { card.hidden = true; list.innerHTML = ''; return; }

    card.hidden = false;
    list.innerHTML = alerts.map(function (al) {
      return '<li><strong>[' + esc(al.type.toUpperCase()) + ']</strong> ' + esc(al.text) + '</li>';
    }).join('');
  }

  function renderMetrics() {
    const a = state.analysis;
    if (!a) return;

    const tEl = $('macroTrend');
    if (tEl) {
      let txt = a.macroTrend || '—';
      if (Number.isFinite(a.avgAdxAligned) && a.avgAdxAligned > 0) txt += ' (' + a.avgAdxAligned.toFixed(1) + ')';
      tEl.textContent = txt;
    }
    const mEl = $('macroMomentum');
    if (mEl) mEl.textContent = a.macroMomentum || '—';
    const vEl = $('macroVolatility');
    if (vEl) vEl.textContent = a.macroVolatility || '—';

    const sEl = $('macroStructure');
    if (sEl) {
      let txt = 'Lateral', cls = 'metric-val';
      if (a.consensusLabel !== 'neutral' && a.overallDirection !== 0) {
        txt = a.overallDirection === 1 ? 'Alcista' : 'Bajista';
        cls += ' ' + (a.overallDirection === 1 ? 'up' : 'down');
        if (Number.isFinite(a.avgAdxOpposed) && a.avgAdxOpposed > 0) txt += ' · contra ' + a.avgAdxOpposed.toFixed(1);
      }
      sEl.textContent = txt;
      sEl.className = cls;
    }
  }

  function renderMtf() {
    const a = state.analysis;
    const box = $('mtf');
    if (!box) return;
    const allTfs = CFG.timeframes.list || ['15m', '1h', '4h', '1d'];
    const optional = CFG.timeframes.optional || [];

    if (box.children.length !== allTfs.length) {
      let html = '';
      allTfs.forEach(function (tf) {
        const isOpt = optional.indexOf(tf) !== -1;
        html += '<button type="button" role="tab" data-tf="' + esc(tf) + '"' +
          ' aria-selected="' + (tf === state.tf ? 'true' : 'false') + '"' +
          (isOpt ? ' data-optional="true"' : '') + '>' +
          '<span class="tfn">' + esc(tf) + '</span><span class="lab neutral">—</span></button>';
      });
      box.innerHTML = html;
    }

    Array.prototype.forEach.call(box.children, function (btn) {
      const tf = btn.dataset.tf;
      const tfData = a && a.perTf ? a.perTf[tf] : null;
      btn.classList.toggle('active', tf === state.tf);
      btn.setAttribute('aria-selected', tf === state.tf ? 'true' : 'false');

      const lab = btn.querySelector('.lab');
      if (!lab) return;
      if (tfData) {
        if (tfData.direction === 1) { lab.textContent = 'Alcista'; lab.className = 'lab buy'; }
        else { lab.textContent = 'Bajista'; lab.className = 'lab sell'; }
        if (tfData.regimeValid === false) { lab.textContent += ' ·'; lab.title = 'Régimen no válido'; }
        else lab.title = '';
      } else if (a) { lab.textContent = '—'; lab.className = 'lab neutral'; }
      else { lab.textContent = '…'; lab.className = 'lab neutral'; }
    });
  }

  function renderConclusion() {
    const a = state.analysis;
    const el = $('conclusionText');
    if (!el) return;
    el.textContent = a ? a.conclusion : 'Esperando datos suficientes para generar un veredicto...';
  }

  function renderChart() {
    if (!chart) return;
    const bars = state.bars[state.tf] || [];
    const inst = CFG.symbols[state.symbol];
    if (!inst) return;
    chart.setData(bars, { tf: state.tf, digits: inst.digits, symbol: state.symbol });
    const z = state.smcResult && state.smcResult.zones;
    chart.setZones(z && (z.ob || z.fvg || z.ote) ? z : null);
  }

  function computeRenderHash() {
    const a = state.analysis;
    if (!a) return 'none';
    return [
      state.symbol, state.tf,
      a.verdictState, a.consensusLabel,
      Math.round(a.consensusScore || 0), Math.round(a.confidence || 0),
      state.smcResult ? Math.round(state.smcResult.score || 0) : 0,
      state.smcResult ? state.smcResult.grade || '' : '',
      (a.alerts || []).length, state.feedMode
    ].join('|');
  }

  function renderAll(force) {
    const hash = computeRenderHash();
    if (!force && hash === state.lastRenderHash) { renderPrice(); return; }
    state.lastRenderHash = hash;

    renderStatus();
    renderPrice();
    renderGauge();
    renderVerdict();
    renderSMC();
    renderAlerts();
    renderMetrics();
    renderMtf();
    renderConclusion();
    renderChart();
  }

  function currentEntryPrice() {
    const t = state.ticks[state.symbol];
    if (t && Number.isFinite(t.mid)) return t.mid;
    const bars = state.bars[state.tf];
    return bars && bars.length ? bars[bars.length - 1].c : null;
  }

  function makeSignalKey(analysis) {
    return [
      state.symbol, analysis.entryTf, analysis.overallDirection,
      analysis.verdictState,
      Math.round((analysis.consensusScore || 0) / 10)
    ].join('::');
  }

  function logSignalIfChanged(analysis) {
    if (!analysis) return;
    const curr = analysis.verdictState;
    if (curr !== 'buy' && curr !== 'sell') { state.lastSignalKey = ''; return; }
    if (!analysis.verdictRisk) return;

    const now = Date.now();
    const maxAge = TIM.maxSignalAgeMs || 5000;
    const key = makeSignalKey(analysis);

    if (key === state.lastSignalKey && (now - state.lastSignalAt) < maxAge) return;
    if (key !== state.lastSignalKey && (now - state.lastSignalAt) < 1500) return;

    const entryPrice = currentEntryPrice();
    if (entryPrice == null) return;

    state.signalLog.push({
      ts: now,
      symbol: state.symbol,
      tf: analysis.entryTf,
      direction: analysis.overallDirection,
      entryPrice,
      stopPrice: analysis.verdictRisk.stop,
      targetPrice: analysis.verdictRisk.target,
      rr: analysis.verdictRisk.rr,
      score: analysis.consensusScore,
      confidence: analysis.confidence
    });
    if (state.signalLog.length > MAX_SIGNAL_LOG) state.signalLog.shift();

    state.lastSignalKey = key;
    state.lastSignalAt = now;
  }

  function updateBarsFromTick(tick) {
    const tfMs = D.TF;
    let newBar = false;
    Object.keys(state.bars).forEach(function (tf) {
      const ms = tfMs[tf];
      if (ms && state.bars[tf] && state.bars[tf].length) {
        const result = D.applyTick(state.bars[tf], ms, tick.mid, tick.ts);
        if (result === 'new') newBar = true;
        if (result === 'gap') { newBar = true; refillGap(tf); }
      }
    });
    return newBar;
  }

  function refillGap(tf) {
    if (state.gapRefill[tf]) return;
    state.gapRefill[tf] = true;
    const myId = state.requestId;

    D.fetchBars(state.symbol, tf, BAR_LIMIT).then(function (bars) {
      if (state.requestId !== myId || !bars || !bars.length) return;
      state.bars[tf] = bars;
      if (chart && state.tf === tf) {
        const inst = CFG.symbols[state.symbol];
        if (inst) chart.setData(bars, { tf: state.tf, digits: inst.digits, symbol: state.symbol });
      }
    }).catch(function () { void 0; }).then(function () { delete state.gapRefill[tf]; });
  }

  function processTick(tick) {
    if (!tick || !tick.symbol) return;
    state.ticks[tick.symbol] = tick;

    if (tick.symbol !== state.symbol) { updateSymbolBarPrices(); return; }
    if (tick.stale) return;

    updateBarsFromTick(tick);
    updateSymbolBarPrices();
    scheduleRender();
  }

  function onTick(tick) {
    if (!tick || !tick.symbol) return;
    processTick(tick);
  }

  function runAnalysisStep() {
    let res = null;
    try {
      res = A.analyze(state.bars, { currentTf: state.tf, symbol: state.symbol });
    } catch (e) {
      console.error('[app] A.analyze excepción:', e);
      state.cycleErrorCount++;
    }
    state.analysis = res;

    if (!res) { state.smcResult = null; return; }

    try {
      const entryTf = res.entryTf || state.tf;
      const raw = state.bars[entryTf];
      const minBars = (CFG.analysis && CFG.analysis.minBarsPerTf) || 30;

      if (raw && raw.length >= minBars) {
        const useClosed = (CFG.analysis && CFG.analysis.useClosedCandlesOnly) !== false;
        const closed = (useClosed && raw.length > 1) ? raw.slice(0, -1) : raw;
        state.smcResult = SMC.evaluate(closed, res.overallDirection, {
          confidence: res.confidence,
          marketOpen: res.marketOpen,
          sessionActive: res.highLiquidity,
          entryTf,
          htfDirection: res.overallDirection
        });
      } else {
        state.smcResult = {
          score: 0, label: 'Sin datos', reasons: ['Esperando velas históricas…'],
          vetoes: ['Historial insuficiente'], breakdown: {},
          zones: { ob: null, fvg: null, ote: null, allOBs: [], allFVGs: [] },
          direction: 0, trend: 'Débil', vetoed: true, grade: 'Débil',
          riskMultiplier: 0, blockerInfo: null, activeComponents: 0
        };
      }
    } catch (e) {
      console.error('[app] SMC.evaluate excepción:', e);
      state.smcResult = null;
      state.cycleErrorCount++;
    }

    logSignalIfChanged(res);
  }

  function masterCycle() {
    if (loop.locked || loop.stopped) {
      if (loop.locked) state.cycleSkipCount++;
      return;
    }
    loop.locked = true;

    try { runAnalysisStep(); }
    catch (e) { console.error('[app] masterCycle análisis excepción:', e); }

    scheduleRender();

    state.lastAnalysisAt = Date.now();
    loop.locked = false;
  }

  function priceCheckCycle() {
    if (loop.stopped) return;
    state.lastPriceCheckAt = Date.now();
    try { renderPrice(); }
    catch (e) { console.error('[app] priceCheckCycle excepción:', e); }
  }

  function startMasterLoop() {
    if (loop.masterId) return;
    loop.stopped = false;
    loop.masterId = setInterval(masterCycle, UPDATE_INTERVAL_MS);
    loop.priceId = setInterval(priceCheckCycle, PRICE_CHECK_MS);
  }

  function stopMasterLoop() {
    loop.stopped = true;
    if (loop.masterId) { clearInterval(loop.masterId); loop.masterId = 0; }
    if (loop.priceId) { clearInterval(loop.priceId); loop.priceId = 0; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; rafPending = false; }
  }

  // -----------------------------------------------------------------
  // CARGA SECUENCIAL CON REINTENTOS (evita 429 / cortes de la API)
  // -----------------------------------------------------------------
  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  async function loadAllBars() {
    state.loading = true;
    state.requestId++;
    const myId = state.requestId;
    const tfs = CFG.timeframes.list || ['15m', '1h', '4h', '1d'];

    // Limpieza antes de empezar (evita mezclar con datos del símbolo anterior)
    state.bars = {};

    for (let i = 0; i < tfs.length; i++) {
      if (state.requestId !== myId) return null;
      const tf = tfs[i];
      let success = false;
      let attempts = 0;

      while (!success && attempts <= LOAD_RETRIES) {
        if (state.requestId !== myId) return null;
        try {
          const bars = await D.fetchBars(state.symbol, tf, BAR_LIMIT);
          if (bars && bars.length > 0) {
            state.bars[tf] = bars;
            success = true;
          } else {
            attempts++;
          }
        } catch (e) {
          attempts++;
          console.warn('[app] Fallo cargando ' + tf + ' (intento ' + attempts + '/' + (LOAD_RETRIES + 1) + '):', e && e.message);
          if (attempts <= LOAD_RETRIES) await delay(RETRY_DELAY_MS);
        }
      }

      if (!success) {
        console.warn('[app] TF ' + tf + ' descartado tras ' + (LOAD_RETRIES + 1) + ' intentos');
      }

      // Pequeña pausa entre TF para no saturar (aunque ya es secuencial)
      if (i < tfs.length - 1) await delay(150);
    }

    if (state.requestId !== myId) return null;
    state.loading = false;
    runAnalysisStep();
    renderAll(true);
    return state.bars;
  }

  function selectSymbol(sym) {
    if (state.symbol === sym) return;
    const old = state.symbol;
    state.symbol = sym;
    state.bars = {};
    state.analysis = null;
    state.smcResult = null;
    state.lastSignalKey = '';
    state.lastSignalAt = 0;
    state.gapRefill = {};
    state.lastRenderHash = '';
    delete state.ticks[old];

    if (typeof A.invalidateCache === 'function') A.invalidateCache();

    const bar = $('symbolBar');
    if (bar) {
      Array.prototype.forEach.call(bar.children, function (b) {
        const on = b.dataset.sym === sym;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    renderAll(true);
    loadAllBars();
  }

  function buildSymbolBar() {
    const bar = $('symbolBar');
    if (!bar) return;
    bar.innerHTML = '';
    Object.keys(CFG.symbols).forEach(function (sym) {
      const def = CFG.symbols[sym];
      if (def.enabled === false) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sym' + (sym === state.symbol ? ' active' : '');
      b.setAttribute('aria-pressed', sym === state.symbol ? 'true' : 'false');
      b.dataset.sym = sym;
      b.innerHTML = '<span class="sym-name">' + esc(sym) + '</span><span class="sym-price">—</span><span class="sym-chg muted">&nbsp;</span>';
      b.addEventListener('click', function () { selectSymbol(sym); });
      bar.appendChild(b);
    });
  }

  function updateSymbolBarPrices() {
    const bar = $('symbolBar');
    if (!bar) return;
    Array.prototype.forEach.call(bar.children, function (b) {
      const sym = b.dataset.sym;
      const t = state.ticks[sym];
      const p = b.querySelector('.sym-price');
      const c = b.querySelector('.sym-chg');
      if (!t || !p || !c) return;
      p.textContent = fmt(sym, t.mid);
      if (t.dayPct != null && t.state !== 'closed') {
        c.textContent = sgn(t.dayPct, 2) + '%';
        c.className = 'sym-chg ' + (t.dayPct >= 0 ? 'up' : 'down');
      } else { c.textContent = ' '; c.className = 'sym-chg muted'; }
    });
  }

  function initChart() {
    const canvas = $('chart');
    if (!canvas) return;

    chart = AT.chart.create(canvas, {
      onHover: function (bar) {
        const el = $('legend');
        if (!el) return;
        if (!bar) { el.innerHTML = '&nbsp;'; return; }
        const f = function (p) { return fmt(state.symbol, p); };
        const chg = bar.o ? (bar.c - bar.o) / bar.o * 100 : 0;
        el.textContent = 'A ' + f(bar.o) + '  Máx ' + f(bar.h) + '  Mín ' + f(bar.l) +
          '  C ' + f(bar.c) + '  ' + sgn(chg, 2) + '%';
      }
    });

    ['zoomIn', 'zoomOut', 'zoomReset', 'chartFullscreen'].forEach(function (id) {
      const btn = $(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        if (id === 'zoomIn') chart.zoom(0.8);
        else if (id === 'zoomOut') chart.zoom(1.25);
        else if (id === 'zoomReset') chart.reset();
        else {
          const card = $('chartCard');
          if (!document.fullscreenElement) {
            if (card.requestFullscreen) card.requestFullscreen().catch(function () { void 0; });
          } else document.exitFullscreen();
        }
      });
    });

    fsAbort = new AbortController();
    const fsOpts = { signal: fsAbort.signal };
    document.addEventListener('fullscreenchange', function () {
      updateDrawVisibility();
      if (chart) chart.resize();
    }, fsOpts);
    document.addEventListener('webkitfullscreenchange', function () {
      updateDrawVisibility();
      if (chart) chart.resize();
    }, fsOpts);

    initDrawingMenu();
    initDrawingShortcuts();

    const mtf = $('mtf');
    if (mtf) {
      mtf.addEventListener('click', function (e) {
        const b = e.target.closest('button[data-tf]');
        if (!b) return;
        state.tf = b.dataset.tf;
        renderMtf();
        renderChart();
        masterCycle();
      });
    }
  }

  function isFullscreen() {
    return document.fullscreenElement === $('chartCard') ||
           document.webkitFullscreenElement === $('chartCard');
  }

  function updateDrawVisibility() {
    const toggle = $('drawToggle');
    if (!toggle) return;
    const fs = isFullscreen();
    const enabled = CFG.drawing && CFG.drawing.enabled !== false;
    if (fs && enabled) toggle.hidden = false;
    else { toggle.hidden = true; closeDrawingMenu(); setTool('cursor'); }
  }

  function openDrawingMenu() {
    const menu = $('drawingMenu');
    const toggle = $('drawToggle');
    if (!menu || !toggle) return;
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    state.drawMenuOpen = true;
  }

  function closeDrawingMenu() {
    const menu = $('drawingMenu');
    const toggle = $('drawToggle');
    if (!menu || !toggle) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    state.drawMenuOpen = false;
  }

  function toggleDrawingMenu() {
    if (state.drawMenuOpen) closeDrawingMenu(); else openDrawingMenu();
  }

  function setTool(tool) {
    const menu = $('drawingMenu');
    if (menu) {
      Array.prototype.forEach.call(menu.querySelectorAll('[data-tool]'), function (btn) {
        const on = btn.dataset.tool === tool;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    const toggle = $('drawToggle');
    if (toggle) {
      if (tool === 'cursor') toggle.classList.remove('active'); else toggle.classList.add('active');
    }
    if (chart && typeof chart.setTool === 'function') chart.setTool(tool);
  }

  function handleUndo() { if (chart && chart.undo) chart.undo(); }
  function handleClear() { if (chart && chart.clearDrawings) chart.clearDrawings(); }

  function initDrawingMenu() {
    const toggle = $('drawToggle');
    const menu = $('drawingMenu');
    if (!toggle || !menu) return;

    toggle.addEventListener('click', function (e) { e.stopPropagation(); toggleDrawingMenu(); });

    menu.addEventListener('click', function (e) {
      const toolBtn = e.target.closest('[data-tool]');
      if (toolBtn) {
        setTool(toolBtn.dataset.tool);
        if (toolBtn.dataset.tool !== 'cursor') closeDrawingMenu();
        return;
      }
      if (e.target.closest('#drawUndo')) { handleUndo(); return; }
      if (e.target.closest('#drawClear')) { handleClear(); closeDrawingMenu(); return; }
    });

    document.addEventListener('click', function (e) {
      if (!state.drawMenuOpen) return;
      if (menu.contains(e.target) || toggle.contains(e.target)) return;
      closeDrawingMenu();
    });
  }

  function initDrawingShortcuts() {
    document.addEventListener('keydown', function (e) {
      if (!isFullscreen()) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable)) return;

      if (e.key === 'Escape') {
        if (state.drawMenuOpen) { closeDrawingMenu(); e.preventDefault(); return; }
        if (currentTool() !== 'cursor') { setTool('cursor'); e.preventDefault(); }
        return;
      }
      if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); toggleDrawingMenu(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); handleUndo();
      }
    });
  }

  function initMtfToggle() {
    const toggle = $('mtfToggle');
    const mtfCard = $('mtfCard');
    const conc = $('conclusionCard');
    if (!toggle || !mtfCard || !conc) return;
    toggle.addEventListener('click', function () {
      const exp = mtfCard.classList.toggle('expanded');
      conc.classList.toggle('shrunk', exp);
      toggle.setAttribute('aria-expanded', exp ? 'true' : 'false');
    });
  }

  function startFeed() {
    feed = D.createFeed(Object.keys(CFG.symbols), {
      tick: onTick,
      status: function (mode) { state.feedMode = mode; scheduleRender(); },
      loadClient: function () {
        return new Promise(function (resolve) {
          if (window.signalR) { resolve(true); return; }
          const s = document.createElement('script');
          s.src = CFG.signalrUrl;
          s.onload = function () { resolve(!!window.signalR); };
          s.onerror = function () { resolve(false); };
          document.head.appendChild(s);
        });
      }
    });
    feed.start();
  }

  function auditSignals() {
    const log = state.signalLog.slice();
    let wins = 0, losses = 0, open = 0, invalid = 0, sumRWin = 0, sumRLoss = 0;

    log.forEach(function (s) {
      if (s.entryPrice == null || s.stopPrice == null || s.targetPrice == null) { invalid++; return; }
      const bars = state.bars[s.tf];
      if (!bars || !bars.length) { invalid++; return; }
      const after = bars.filter(function (b) { return b.t > s.ts; });
      if (!after.length) { open++; return; }

      const risk = Math.abs(s.entryPrice - s.stopPrice);
      if (!(risk > 0)) { invalid++; return; }
      const reward = Math.abs(s.targetPrice - s.entryPrice);
      const rrReal = reward / risk;

      let hitT = false, hitS = false;
      for (let i = 0; i < after.length; i++) {
        const b = after[i];
        if (s.direction === 1) {
          if (b.l <= s.stopPrice) { hitS = true; break; }
          if (b.h >= s.targetPrice) { hitT = true; break; }
        } else {
          if (b.h >= s.stopPrice) { hitS = true; break; }
          if (b.l <= s.targetPrice) { hitT = true; break; }
        }
      }

      if (hitT) { wins++; sumRWin += rrReal; }
      else if (hitS) { losses++; sumRLoss += 1; }
      else open++;
    });

    const closed = wins + losses;
    const winRate = closed > 0 ? (wins / closed) * 100 : 0;
    const avgWinR = wins > 0 ? sumRWin / wins : 0;
    const avgLossR = losses > 0 ? sumRLoss / losses : 0;
    const expectancyR = closed > 0 ? (wins / closed) * avgWinR - (losses / closed) * avgLossR : 0;
    const profitFactor = sumRLoss > 0 ? (sumRWin / sumRLoss) : (sumRWin > 0 ? Infinity : 0);

    return { total: log.length, closed, wins, losses, open, invalid, winRate, avgWinR, avgLossR, expectancyR, profitFactor };
  }

  function init() {
    buildSymbolBar();
    initMtfToggle();

    try { initChart(); }
    catch (e) { console.error('[app] initChart falló:', e); }

    try { startFeed(); }
    catch (e) {
      console.error('[app] startFeed falló:', e);
      state.feedMode = 'error';
      renderStatus();
    }

    startMasterLoop();

    loadAllBars().then(function (results) {
      if (!results) return;
      D.fetchLatest(Object.keys(CFG.symbols)).then(function (ticks) {
        ticks.forEach(function (t) { state.ticks[t.symbol] = t; });
        updateSymbolBarPrices();
        renderAll(true);
      }).catch(function (e) {
        console.error('[app] fetchLatest falló:', e);
        renderAll(true);
      });
    }).catch(function (e) {
      console.error('[app] loadAllBars rechazó en init:', e);
      renderAll(true);
    });
  }

  function cleanup() {
    stopMasterLoop();
    if (fsAbort) { fsAbort.abort(); fsAbort = null; }
    if (chart) { if (chart.destroy) chart.destroy(); chart = null; }
    if (feed) { feed.stop(); feed = null; }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else init();

  window.addEventListener('beforeunload', cleanup);

  AT.app = {
    getSignalLog: function () { return state.signalLog.slice(); },
    getState: function () { return state; },
    auditSignals,
    getLoopStats: function () {
      return {
        updateIntervalMs: UPDATE_INTERVAL_MS,
        priceCheckMs: PRICE_CHECK_MS,
        skips: state.cycleSkipCount,
        errors: state.cycleErrorCount,
        lastAnalysisAt: state.lastAnalysisAt,
        lastPriceCheckAt: state.lastPriceCheckAt
      };
    }
  };
})();