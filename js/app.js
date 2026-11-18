(function () {
  'use strict';

  const AT = window.AT;
  const D = AT.data;
  const A = AT.analysis;
  const SMC = AT.smcEngine;
  const CFG = window.AT_CONFIG;

  const state = {
    symbol: 'XAUUSD',
    tf: (CFG.timeframes && CFG.timeframes.entry) || '15m',
    bars: {},
    ticks: {},
    analysis: null,
    smcResult: null,
    feedMode: 'off',
    loading: true,
    requestId: 0,
    analysisTimer: null,
    lastAnalysisAt: 0,
    signalLog: [],
    currentTool: 'cursor',
    drawMenuOpen: false,
    tickBuffer: new Map(),
    rafId: 0,
    gapRefill: {},
    verdict: {
      committed: {
        state: 'wait',
        label: 'ESPERAR',
        reason: 'Iniciando...',
        risk: null,
        sizing: null,
        direction: 0,
        score: 0,
        confidence: 0,
        smcGrade: null,
        smcScore: 0,
        at: 0
      },
      pending: {
        state: null,
        count: 0,
        firstSeenAt: 0
      }
    }
  };

  let chart = null;
  let feed = null;

  const MAX_SIGNAL_LOG = 500;

  function $(id) { return document.getElementById(id); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(sym, price) {
    const inst = CFG.symbols[sym];
    if (!inst || price == null || !Number.isFinite(price)) return '0.00';
    return Number(price).toFixed(inst.digits);
  }

  function sgn(v, d) {
    if (v == null || !Number.isFinite(v)) return '+0.00';
    return (v >= 0 ? '+' : '') + Number(v).toFixed(d);
  }

  function needleAngle(score, dir) {
    if (dir === 0 || dir == null) return 0;
    const s = Math.max(0, Math.min(100, score || 0));
    return (s / 100) * 90 * dir;
  }

  function verdictCfg() { return CFG.verdict || {}; }

  function resetVerdict() {
    state.verdict.committed = {
      state: 'wait',
      label: 'ESPERAR',
      reason: 'Reiniciando análisis...',
      risk: null,
      sizing: null,
      direction: 0,
      score: 0,
      confidence: 0,
      smcGrade: null,
      smcScore: 0,
      at: 0
    };
    state.verdict.pending = { state: null, count: 0, firstSeenAt: 0 };
  }

  function committedDirection() {
    const s = state.verdict.committed.state;
    if (s === 'buy') return 1;
    if (s === 'sell') return -1;
    return 0;
  }

  function commitVerdict(proposed, now) {
    const vCfg = verdictCfg();
    const minHoldMs = vCfg.minHoldMs != null ? vCfg.minHoldMs : 45000;
    const minConfirmations = vCfg.minConfirmations != null ? vCfg.minConfirmations : 2;
    const minPendingMs = vCfg.minPendingMs != null ? vCfg.minPendingMs : 5000;
    const v = state.verdict;
    const committed = v.committed;

    if (!proposed.marketOpen) {
      v.committed = {
        state: 'wait',
        label: 'ESPERAR',
        reason: proposed.reason || 'Mercado cerrado.',
        risk: null,
        sizing: null,
        direction: 0,
        score: proposed.score || 0,
        confidence: 0,
        smcGrade: proposed.smcGrade || null,
        smcScore: proposed.smcScore || 0,
        at: now
      };
      v.pending = { state: null, count: 0, firstSeenAt: 0 };
      return;
    }

    if (proposed.state === committed.state) {
      committed.reason = proposed.reason;
      committed.risk = proposed.risk;
      committed.sizing = proposed.sizing;
      committed.direction = proposed.direction;
      committed.score = proposed.score;
      committed.confidence = proposed.confidence;
      committed.smcGrade = proposed.smcGrade;
      committed.smcScore = proposed.smcScore;
      v.pending = { state: null, count: 0, firstSeenAt: 0 };
      return;
    }

    if (v.pending.state !== proposed.state) {
      v.pending.state = proposed.state;
      v.pending.count = 1;
      v.pending.firstSeenAt = now;
      return;
    }

    v.pending.count++;

    const sinceCommit = now - committed.at;
    const sincePending = now - v.pending.firstSeenAt;
    const enoughCount = v.pending.count >= minConfirmations;
    const enoughHold = sinceCommit >= minHoldMs;
    const enoughPending = sincePending >= minPendingMs;

    if (enoughCount && enoughHold && enoughPending) {
      v.committed = {
        state: proposed.state,
        label: proposed.label,
        reason: proposed.reason,
        risk: proposed.risk,
        sizing: proposed.sizing,
        direction: proposed.direction,
        score: proposed.score,
        confidence: proposed.confidence,
        smcGrade: proposed.smcGrade || null,
        smcScore: proposed.smcScore || 0,
        at: now
      };
      v.pending = { state: null, count: 0, firstSeenAt: 0 };
    }
  }

  function flushTicks() {
    if (state.rafId) return;
    state.rafId = requestAnimationFrame(function () {
      state.rafId = 0;
      const buffer = state.tickBuffer;
      state.tickBuffer = new Map();
      buffer.forEach(function (tick) { processTick(tick); });
    });
  }

  function refillGap(tf) {
    if (!state.gapRefill) state.gapRefill = {};
    if (state.gapRefill[tf]) return;
    state.gapRefill[tf] = true;

    const myId = state.requestId;
    D.fetchBars(state.symbol, tf, 500).then(function (bars) {
      if (state.requestId !== myId) return;
      if (bars && bars.length) {
        state.bars[tf] = bars;
        if (chart && state.tf === tf) {
          const inst = CFG.symbols[state.symbol];
          if (inst) chart.setData(bars, { tf: state.tf, digits: inst.digits, symbol: state.symbol });
        }
        scheduleAnalysis(true);
      }
    }).catch(function () { void 0; }).then(function () {
      if (state.gapRefill) delete state.gapRefill[tf];
    });
  }

  function processTick(tick) {
    if (!tick || !tick.symbol) return;
    state.ticks[tick.symbol] = tick;

    if (tick.symbol !== state.symbol) {
      updateSymbolBarPrices();
      return;
    }

    if (tick.stale) return;

    let newBar = false;
    const tfMs = D.TF;
    Object.keys(state.bars).forEach(function (tf) {
      const ms = tfMs[tf];
      if (ms && state.bars[tf] && state.bars[tf].length) {
        const result = D.applyTick(state.bars[tf], ms, tick.mid, tick.ts);
        if (result === 'new') newBar = true;
        if (result === 'gap') { newBar = true; refillGap(tf); }
      }
    });

    if (chart) {
      const bars = state.bars[state.tf];
      const inst = CFG.symbols[state.symbol];
      if (bars && bars.length && inst) {
        chart.setData(bars, { tf: state.tf, digits: inst.digits, symbol: state.symbol });
      }
    }

    updateSymbolBarPrices();
    renderPrice();
    scheduleAnalysis(newBar);
  }

  function renderStatus() {
    const dot = $('statusDot');
    const txt = $('statusText');
    if (!dot || !txt) return;
    const m = state.feedMode;
    let cls = '';
    let msg = 'Conectando…';
    if (m === 'live') { cls = 'ok'; msg = 'En vivo'; }
    else if (m === 'polling') { cls = 'warn'; msg = 'Sincronizando'; }
    else if (m === 'reconnecting') { cls = 'warn'; msg = 'Reconectando…'; }
    else if (m === 'error') { cls = 'bad'; msg = 'Sin conexión'; }
    dot.className = 'dot ' + cls;
    txt.textContent = msg;
  }

  function renderPrice() {
    const t = state.ticks[state.symbol];
    const bars = state.bars[state.tf] || [];
    const price = t ? t.mid : (bars.length ? bars[bars.length - 1].c : null);

    $('priceBig').textContent = fmt(state.symbol, price);

    const chg = $('priceChg');
    if (t && t.dayPct != null && t.state !== 'closed') {
      chg.textContent = sgn(t.dayPct, 2) + '%';
      chg.className = 'price-chg ' + (t.dayPct >= 0 ? 'up' : 'down');
    } else {
      chg.textContent = '0.00%';
      chg.className = 'price-chg';
    }

    $('priceSub').textContent = t
      ? 'Bid ' + fmt(state.symbol, t.bid) + ' · Ask ' + fmt(state.symbol, t.ask) + ' · Spread ' + fmt(state.symbol, t.spread)
      : 'Esperando precio...';

    const sb = $('sessionBadge');
    const a = state.analysis;
    const open = a ? a.marketOpen : true;
    const label = a ? a.sessionLabel : 'Escaneando';
    sb.textContent = label;
    sb.className = 'session-badge ' + (open ? 'ok' : 'bad');
  }

  function renderGauge() {
    const a = state.analysis;
    const needle = $('needle');
    const label = $('gaugeLabel');
    const score = $('gaugeScore');

    if (!a) {
      needle.style.opacity = '0.3';
      label.textContent = 'Cargando...';
      label.className = 'gauge-label neutral';
      score.textContent = 'Consenso: 0%';
      return;
    }

    needle.style.opacity = '1';
    const angle = needleAngle(a.consensusScore, a.overallDirection);
    needle.setAttribute('transform', 'rotate(' + angle.toFixed(1) + ' 100 100)');

    label.textContent = a.consensusText;
    label.className = 'gauge-label ' + a.consensusLabel;

    const parts = ['Consenso: ' + a.consensusScore.toFixed(0) + '%'];
    if (Number.isFinite(a.confidence)) parts.push('confianza: ' + a.confidence.toFixed(0) + '%');
    score.textContent = parts.join(' · ');
  }

  function renderVerdict() {
    const badge = $('verdictBadge');
    const reason = $('verdictReason');
    const sizingEl = $('verdictSizing');
    const c = state.verdict.committed;

    badge.textContent = c.label || 'ESPERAR';
    badge.className = 'verdict-badge ' + (c.state || 'wait');
    reason.textContent = c.reason || 'Analizando condiciones...';

    if (sizingEl) {
      if (c.sizing && (c.state === 'buy' || c.state === 'sell')) {
        sizingEl.hidden = false;
        sizingEl.textContent = 'Lotes: ' + c.sizing.lots.toFixed(2) +
          ' · Riesgo: $' + c.sizing.riskAmount.toFixed(2) +
          ' (' + c.sizing.riskPct + '%)';
      } else {
        sizingEl.hidden = true;
        sizingEl.textContent = '';
      }
    }
  }

  function renderSMC() {
    const smc = state.smcResult;
    const scoreEl = $('smcScore');
    const barEl = $('smcBarFill');
    const reasonsEl = $('smcReasons');
    const seqEl = $('smcSequence');

    if (!smc) {
      scoreEl.textContent = '0%';
      scoreEl.style.color = 'var(--accent)';
      barEl.style.width = '0%';
      barEl.style.backgroundColor = 'var(--accent)';
      reasonsEl.innerHTML = '<li class="muted">Escaneando bloques institucionales...</li>';
      if (seqEl) { seqEl.hidden = true; seqEl.textContent = ''; }
      return;
    }

    scoreEl.textContent = smc.score.toFixed(0) + '%';
    barEl.style.width = Math.max(0, Math.min(100, smc.score)) + '%';

    if (smc.score >= 70) {
      barEl.style.backgroundColor = 'var(--up)';
      scoreEl.style.color = 'var(--up)';
    } else if (smc.score >= 45) {
      barEl.style.backgroundColor = 'var(--warn)';
      scoreEl.style.color = 'var(--warn)';
    } else {
      barEl.style.backgroundColor = 'var(--down)';
      scoreEl.style.color = 'var(--down)';
    }

    const lines = [];
    const bd = smc.breakdown || {};
    const order = ['sequence', 'mss', 'sweep', 'fvg', 'ob', 'ote', 'penalty', 'vetoed'];
    const names = {
      sequence: 'Secuencia', mss: 'Estructura', sweep: 'Sweep', fvg: 'FVG',
      ob: 'Order Block', ote: 'OTE', penalty: 'Penalización', vetoed: 'Veto'
    };

    order.forEach(function (key) {
      const e = bd[key];
      if (!e || !e.weighted) return;
      const sign = (key === 'penalty' || key === 'vetoed') ? '−' : '+';
      const val = Math.abs(e.weighted).toFixed(1);
      const detail = e.reason ? ' — ' + e.reason : '';
      lines.push('<li>' + esc(names[key] || key) + ': ' + sign + val + esc(detail) + '</li>');
    });

    if (lines.length === 0) lines.push('<li class="muted">Sin componentes de alta probabilidad.</li>');

    reasonsEl.innerHTML = lines.join('');

    if (seqEl) {
      if (smc.sequence && smc.sequence.valid) {
        seqEl.hidden = false;
        seqEl.textContent = 'Secuencia institucional: Sweep → MSS → Zona';
      } else {
        seqEl.hidden = true;
        seqEl.textContent = '';
      }
    }
  }

  function renderAlerts() {
    const a = state.analysis;
    const card = $('alertCard');
    const list = $('alertList');

    if (!a) { card.hidden = true; list.innerHTML = ''; return; }

    const alerts = a.alerts || [];
    if (alerts.length === 0) { card.hidden = true; list.innerHTML = ''; return; }

    card.hidden = false;
    list.innerHTML = alerts.map(function (alert) {
      return '<li><strong>[' + esc(alert.type.toUpperCase()) + ']</strong> ' + esc(alert.text) + '</li>';
    }).join('');
  }

  function renderMetrics() {
    const a = state.analysis;
    if (!a) {
      $('macroTrend').textContent = 'Calculando...';
      $('macroMomentum').textContent = 'Calculando...';
      $('macroVolatility').textContent = 'Calculando...';
      $('macroStructure').textContent = 'Lateral';
      $('macroStructure').className = 'metric-val';
      return;
    }

    const tEl = $('macroTrend');
    let trendTxt = a.macroTrend || 'Débil';
    if (Number.isFinite(a.avgAdxAligned) && a.avgAdxAligned > 0) {
      trendTxt += ' (' + a.avgAdxAligned.toFixed(1) + ')';
    }
    tEl.textContent = trendTxt;

    $('macroMomentum').textContent = a.macroMomentum || 'Neutro';
    $('macroVolatility').textContent = a.macroVolatility || 'Normal';

    const sEl = $('macroStructure');
    let structTxt = 'Lateral';
    let structCls = 'metric-val';
    if (a.consensusLabel !== 'neutral' && a.overallDirection !== 0) {
      structTxt = a.overallDirection === 1 ? 'Alcista' : 'Bajista';
      structCls += ' ' + (a.overallDirection === 1 ? 'up' : 'down');
    }
    sEl.textContent = structTxt;
    sEl.className = structCls;
  }

  function renderMtf() {
    const a = state.analysis;
    const box = $('mtf');
    const allTfs = CFG.timeframes.list || ['5m', '15m', '1h'];
    const optional = CFG.timeframes.optional || [];

    if (box.children.length !== allTfs.length) {
      let html = '';
      allTfs.forEach(function (tf) {
        const isOpt = optional.indexOf(tf) !== -1;
        const selected = tf === state.tf ? 'true' : 'false';
        html += '<button type="button" role="tab" data-tf="' + esc(tf) + '"' +
          ' aria-selected="' + selected + '"' +
          (isOpt ? ' data-optional="true"' : '') + '>' +
          '<span class="tfn">' + esc(tf) + '</span>' +
          '<span class="lab neutral">...</span>' +
          '</button>';
      });
      box.innerHTML = html;
    }

    Array.prototype.forEach.call(box.children, function (btn) {
      const tf = btn.dataset.tf;
      const tfData = a && a.perTf ? a.perTf[tf] : null;
      const active = tf === state.tf;
      if (active) { btn.classList.add('active'); btn.setAttribute('aria-selected', 'true'); }
      else { btn.classList.remove('active'); btn.setAttribute('aria-selected', 'false'); }

      const lab = btn.querySelector('.lab');
      if (!lab) return;

      if (tfData) {
        if (tfData.direction === 1) { lab.textContent = 'Alcista'; lab.className = 'lab buy'; }
        else { lab.textContent = 'Bajista'; lab.className = 'lab sell'; }
        if (tfData.regimeValid === false) lab.className += ' weak';
      } else {
        lab.textContent = '...';
        lab.className = 'lab neutral';
      }
    });
  }

  function renderConclusion() {
    const a = state.analysis;
    const el = $('conclusionText');
    if (!el) return;
    if (!a) {
      el.textContent = 'Escaneando el mercado en busca de entradas perfectas...';
      return;
    }
    el.textContent = a.conclusion;
  }

  function renderChart() {
    if (!chart) return;
    const bars = state.bars[state.tf] || [];
    const inst = CFG.symbols[state.symbol];
    if (!inst) return;
    chart.setData(bars, { tf: state.tf, digits: inst.digits, symbol: state.symbol });

    const z = state.smcResult && state.smcResult.zones;
    const hasZones = z && (z.ob || z.fvg || z.ote);
    chart.setZones(hasZones ? z : null);
  }

  function renderAll() {
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
    if (bars && bars.length) return bars[bars.length - 1].c;
    return null;
  }

  function logSignalIfChanged(now) {
    const c = state.verdict.committed;
    if (c.state !== 'buy' && c.state !== 'sell') return;
    if (!c.risk || !c.risk.valid) return;

    const last = state.signalLog[state.signalLog.length - 1];
    if (last && last.ts === c.at && last.direction === c.direction) return;

    const entryPrice = currentEntryPrice();
    if (entryPrice == null) return;

    state.signalLog.push({
      ts: now,
      symbol: state.symbol,
      tf: state.tf,
      direction: c.direction,
      entryPrice: entryPrice,
      stopPrice: c.risk.stop,
      targetPrice: c.risk.target,
      rr: c.risk.rr,
      lots: c.sizing ? c.sizing.lots : null,
      riskAmount: c.sizing ? c.sizing.riskAmount : null,
      score: c.score,
      confidence: c.confidence,
      smcGrade: c.smcGrade,
      smcScore: c.smcScore
    });
    if (state.signalLog.length > MAX_SIGNAL_LOG) state.signalLog.shift();
  }

  function runAnalysis() {
    const now = Date.now();
    state.lastAnalysisAt = now;

    const res = A.analyze(state.bars, {
      currentTf: state.tf,
      symbol: state.symbol,
      previousDirection: committedDirection()
    });

    const entryTf = res.entryTf || state.tf;
    const entryBarsRaw = state.bars[entryTf];

    if (entryBarsRaw && entryBarsRaw.length > 15 && res.overallDirection !== 0) {
      const smcCtx = {
        confidence: res.confidence,
        marketOpen: res.marketOpen,
        sessionActive: res.highLiquidity,
        entryTf: entryTf
      };
      state.smcResult = SMC.evaluate(entryBarsRaw, res.overallDirection, smcCtx);
    } else {
      state.smcResult = {
        score: 0,
        label: 'Escaneando',
        reasons: ['Sin dirección o historial suficiente.'],
        vetoes: [],
        breakdown: {},
        zones: { ob: null, fvg: null, ote: null },
        direction: 0,
        trend: 'Débil',
        vetoed: false,
        grade: null,
        activeComponents: 0,
        sequence: null
      };
    }

    state.analysis = A.applySmc(res, state.smcResult);

    const proposed = {
      state: state.analysis.verdictState,
      label: state.analysis.verdictLabel,
      reason: state.analysis.verdictReason,
      risk: state.analysis.verdictRisk,
      sizing: state.analysis.positionSizing,
      direction: state.analysis.overallDirection,
      score: state.analysis.consensusScore,
      confidence: state.analysis.confidence,
      smcGrade: state.analysis.smcGrade,
      smcScore: state.analysis.smcScore,
      marketOpen: state.analysis.marketOpen
    };

    const before = state.verdict.committed.state;
    const beforeAt = state.verdict.committed.at;
    commitVerdict(proposed, now);
    if (state.verdict.committed.state !== before || state.verdict.committed.at !== beforeAt) {
      logSignalIfChanged(now);
    }

    renderAll();
  }

  function scheduleAnalysis(force) {
    const throttleMs = (CFG.analysis && CFG.analysis.throttleMs) || 1500;
    const elapsed = Date.now() - state.lastAnalysisAt;

    if (force) {
      if (state.analysisTimer) { clearTimeout(state.analysisTimer); state.analysisTimer = null; }
      runAnalysis();
      return;
    }
    if (state.analysisTimer) return;
    if (elapsed >= throttleMs) { runAnalysis(); return; }
    state.analysisTimer = setTimeout(function () {
      state.analysisTimer = null;
      runAnalysis();
    }, throttleMs - elapsed);
  }

  function loadAllBars() {
    state.loading = true;
    state.requestId++;
    const myId = state.requestId;
    const tfs = CFG.timeframes.list || ['5m', '15m', '1h'];

    const tasks = tfs.map(function (tf) {
      return function () { return D.fetchBars(state.symbol, tf, 500); };
    });

    return D.pool(tasks, 3, 15000).then(function (results) {
      if (state.requestId !== myId) return null;
      state.bars = {};
      results.forEach(function (r, i) {
        if (r && r.ok) state.bars[tfs[i]] = r.v;
      });
      state.loading = false;
      runAnalysis();
      return results;
    }).catch(function (err) {
      if (state.requestId !== myId) return null;
      state.loading = false;
      const partial = err && err.partial;
      if (partial && Array.isArray(partial) && partial.length === tfs.length) {
        state.bars = {};
        partial.forEach(function (r, i) {
          if (r && r.ok) state.bars[tfs[i]] = r.v;
        });
        runAnalysis();
        return partial;
      }
      console.error('loadAllBars:', err.message || err);
      renderAll();
      return null;
    });
  }

  function selectSymbol(sym) {
    if (state.symbol === sym) return;
    const old = state.symbol;
    state.symbol = sym;
    state.bars = {};
    state.analysis = null;
    state.smcResult = null;
    state.gapRefill = {};
    delete state.ticks[old];
    resetVerdict();

    Array.prototype.forEach.call($('symbolBar').children, function (b) {
      if (b.dataset.sym === sym) {
        b.classList.add('active');
        b.setAttribute('aria-pressed', 'true');
      } else {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      }
    });

    renderAll();
    loadAllBars();
  }

  function buildSymbolBar() {
    const bar = $('symbolBar');
    bar.innerHTML = '';
    Object.keys(CFG.symbols).forEach(function (sym) {
      const def = CFG.symbols[sym];
      if (def.enabled === false) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sym' + (sym === state.symbol ? ' active' : '');
      b.setAttribute('aria-pressed', sym === state.symbol ? 'true' : 'false');
      b.dataset.sym = sym;
      b.innerHTML = '<span class="sym-name">' + esc(sym) + '</span>' +
                    '<span class="sym-price">0.00</span>' +
                    '<span class="sym-chg muted">&nbsp;</span>';
      b.addEventListener('click', function () { selectSymbol(sym); });
      bar.appendChild(b);
    });
  }

  function updateSymbolBarPrices() {
    Array.prototype.forEach.call($('symbolBar').children, function (b) {
      const sym = b.dataset.sym;
      const t = state.ticks[sym];
      const p = b.querySelector('.sym-price');
      const c = b.querySelector('.sym-chg');
      if (!t) return;
      p.textContent = fmt(sym, t.mid);
      if (t.dayPct != null && t.state !== 'closed') {
        c.textContent = sgn(t.dayPct, 2) + '%';
        c.className = 'sym-chg ' + (t.dayPct >= 0 ? 'up' : 'down');
      } else {
        c.textContent = ' ';
        c.className = 'sym-chg muted';
      }
    });
  }

  function onTick(tick) {
    if (!tick || !tick.symbol) return;
    state.tickBuffer.set(tick.symbol, tick);
    flushTicks();
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

    const zoomIn = $('zoomIn');
    const zoomOut = $('zoomOut');
    const zoomReset = $('zoomReset');
    const chartFullscreen = $('chartFullscreen');
    if (zoomIn) zoomIn.addEventListener('click', function () { chart.zoom(0.8); });
    if (zoomOut) zoomOut.addEventListener('click', function () { chart.zoom(1.25); });
    if (zoomReset) zoomReset.addEventListener('click', function () { chart.reset(); });

    if (chartFullscreen) {
      chartFullscreen.addEventListener('click', function () {
        const chartCard = $('chartCard');
        if (!document.fullscreenElement) {
          if (chartCard && chartCard.requestFullscreen) {
            chartCard.requestFullscreen().catch(function (err) { console.log('Fullscreen:', err.message); });
          }
        } else {
          document.exitFullscreen();
        }
      });
    }

    document.addEventListener('fullscreenchange', function () {
      updateDrawVisibility();
      if (chart) chart.resize();
    });
    document.addEventListener('webkitfullscreenchange', function () {
      updateDrawVisibility();
      if (chart) chart.resize();
    });

    initDrawingMenu();
    initDrawingShortcuts();

    const mtf = $('mtf');
    if (mtf) {
      mtf.addEventListener('click', function (e) {
        const b = e.target.closest('button[data-tf]');
        if (!b) return;
        state.tf = b.dataset.tf;
        resetVerdict();
        renderMtf();
        renderChart();
        scheduleAnalysis(true);
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
    if (fs && enabled) { toggle.hidden = false; }
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
    if (state.drawMenuOpen) closeDrawingMenu();
    else openDrawingMenu();
  }

  function setTool(tool) {
    state.currentTool = tool;
    const menu = $('drawingMenu');
    if (menu) {
      Array.prototype.forEach.call(menu.querySelectorAll('[data-tool]'), function (btn) {
        const isActive = btn.dataset.tool === tool;
        if (isActive) btn.classList.add('active'); else btn.classList.remove('active');
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      });
    }
    const toggle = $('drawToggle');
    if (toggle) {
      if (tool === 'cursor') toggle.classList.remove('active');
      else toggle.classList.add('active');
    }
    if (chart && typeof chart.setTool === 'function') chart.setTool(tool);
  }

  function handleUndo() { if (chart && typeof chart.undo === 'function') chart.undo(); }
  function handleClear() { if (chart && typeof chart.clearDrawings === 'function') chart.clearDrawings(); }

  function initDrawingMenu() {
    const toggle = $('drawToggle');
    const menu = $('drawingMenu');
    if (!toggle || !menu) return;

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDrawingMenu();
    });

    menu.addEventListener('click', function (e) {
      const toolBtn = e.target.closest('[data-tool]');
      if (toolBtn) {
        const tool = toolBtn.dataset.tool;
        setTool(tool);
        if (tool !== 'cursor') closeDrawingMenu();
        return;
      }
      if (e.target.closest('#drawUndo')) { handleUndo(); return; }
      if (e.target.closest('#drawClear')) { handleClear(); closeDrawingMenu(); return; }
    });

    document.addEventListener('click', function (e) {
      if (!state.drawMenuOpen) return;
      if (menu.contains(e.target)) return;
      if (toggle.contains(e.target)) return;
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
        if (state.currentTool !== 'cursor') { setTool('cursor'); e.preventDefault(); }
        return;
      }
      if (e.key === 'd' || e.key === 'D') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleDrawingMenu(); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); handleUndo(); return;
      }
    });
  }

  function initMtfToggle() {
    const toggle = $('mtfToggle');
    const mtfCard = $('mtfCard');
    const conclusionCard = $('conclusionCard');
    if (!toggle || !mtfCard || !conclusionCard) return;

    toggle.addEventListener('click', function () {
      const isExpanded = mtfCard.classList.toggle('expanded');
      conclusionCard.classList.toggle('shrunk', isExpanded);
      toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      toggle.setAttribute('aria-label', isExpanded ? 'Ocultar temporalidades adicionales' : 'Mostrar temporalidades adicionales');
    });
  }

  function startFeed() {
    feed = D.createFeed(Object.keys(CFG.symbols), {
      tick: onTick,
      status: function (mode) { state.feedMode = mode; renderStatus(); },
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
    let wins = 0;
    let losses = 0;
    let open = 0;
    let invalid = 0;
    let sumRWin = 0;
    let sumRLoss = 0;

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

      let hitT = false;
      let hitS = false;
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
      else { open++; }
    });

    const closed = wins + losses;
    const winRate = closed > 0 ? (wins / closed) * 100 : 0;
    const avgWinR = wins > 0 ? sumRWin / wins : 0;
    const avgLossR = losses > 0 ? sumRLoss / losses : 0;
    const expectancyR = closed > 0
      ? (wins / closed) * avgWinR - (losses / closed) * avgLossR
      : 0;
    const profitFactor = sumRLoss > 0 ? (sumRWin / sumRLoss) : (sumRWin > 0 ? Infinity : 0);

    return {
      total: log.length,
      closed: closed,
      wins: wins,
      losses: losses,
      open: open,
      invalid: invalid,
      winRate: winRate,
      avgWinR: avgWinR,
      avgLossR: avgLossR,
      expectancyR: expectancyR,
      profitFactor: profitFactor
    };
  }

  function init() {
    buildSymbolBar();
    initMtfToggle();
    initChart();
    startFeed();

    loadAllBars().then(function (results) {
      if (!results) return;
      D.fetchLatest(Object.keys(CFG.symbols)).then(function (ticks) {
        ticks.forEach(function (t) { state.ticks[t.symbol] = t; });
        updateSymbolBarPrices();
        renderAll();
      }).catch(function () { void 0; });
    });
  }

  function cleanup() {
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; }
    if (chart) { if (typeof chart.destroy === 'function') chart.destroy(); chart = null; }
    if (feed) { feed.stop(); feed = null; }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('beforeunload', cleanup);

  AT.app = {
    getSignalLog: function () { return state.signalLog.slice(); },
    getState: function () { return state; },
    getVerdict: function () { return state.verdict.committed; },
    auditSignals: auditSignals
  };
})();