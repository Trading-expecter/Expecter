(function () {
  'use strict';

  const AT = window.AT;
  const D = AT.data;
  const A = AT.analysis;
  const SMC = AT.smcEngine;
  const J = AT.journal;
  const CFG = window.AT_CONFIG;
  const TIM = (CFG && CFG.timings) || {};

  const UPDATE_INTERVAL_MS = TIM.updateIntervalMs || 1000;
  const PRICE_CHECK_MS = TIM.priceCheckMs || 500;
  const MAX_SIGNAL_LOG = 500;
  const BAR_LIMIT = 300;
  const SNAPSHOT_BARS_ENTRY = 200;
  const SNAPSHOT_BARS_HTF = 50;
  const OUTCOME_UPDATE_THROTTLE_MS = 15000;

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
    lastOutcomeUpdateAt: 0,
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

  function num(v) { return v != null && Number.isFinite(v); }

  function setText(id, text, className) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    if (className !== undefined) el.className = className;
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
    if (needle.hasAttribute('transform')) needle.removeAttribute('transform');
    needle.style.transformBox = 'view-box';
    needle.style.transformOrigin = '100px 100px';
    needle.style.transform = 'rotate(' + needleAngle(a.consensusScore, a.overallDirection).toFixed(1) + 'deg)';

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

    const mtf = a.multiTfSignal;
    let mainLabel = a.verdictLabel;
    let mainState = a.verdictState;
    let isAnticipation = false;

    if (a.anticipation && a.anticipation.strength === 'strong') {
      isAnticipation = true;
    }

    if (!isAnticipation && mtf && mtf.action !== 'wait' && (a.verdictState === 'wait' || a.verdictState !== mtf.action)) {
      if (mtf.strength === 'strong' || mtf.strength === 'moderate') {
        mainLabel = mtf.action === 'buy'
          ? 'CONSENSO: COMPRAR' + (mtf.strength === 'strong' ? ' ★' : '')
          : 'CONSENSO: VENDER' + (mtf.strength === 'strong' ? ' ★' : '');
        mainState = mtf.action;
      }
    }

    let icon = mainState === 'buy' ? '▲' : mainState === 'sell' ? '▼' : '◷';
    if (isAnticipation) icon = '⚡';

    badge.innerHTML = '<span class="verdict-icon" aria-hidden="true">' + icon + '</span>' +
      '<span class="verdict-text">' + esc(mainLabel) + '</span>';
    badge.className = 'verdict-badge ' + mainState;

    let text = '';

    if (mtf) {
      text += '📊 ' + mtf.summary;
    }

    if (a.anticipation) {
      text += ' · ⚡ ' + a.anticipation.factors.join(', ') + ' (' + a.anticipation.score + '%)';
    }

    if (a.verdictState === 'buy' || a.verdictState === 'sell') {
      text += ' · 🎯 ' + a.verdictLabel + ': ' + (a.verdictReason || '');
    } else if (a.verdictReason && a.verdictReason.indexOf('Faltan') === -1 && a.verdictReason.indexOf('Fuerte confluencia') === -1) {
      text += ' · ' + a.verdictReason;
    }

    if (a.proximitySignal) {
      text += ' · 📍 ' + a.proximitySignal.label +
        ' @ ' + fmt(state.symbol, a.proximitySignal.level) +
        ' (' + a.proximitySignal.touches + ' toques)';
    }
    if (a.verdictRisk && a.verdictRisk.valid) {
      const r = a.verdictRisk;
      text += ' · Stop ' + fmt(state.symbol, r.stop) + ' · Target ' + fmt(state.symbol, r.target);
    }

    reason.textContent = text.replace(/^ · /, '');
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
          '<span class="tfn">' + esc(tf) + '</span>' +
          '<span class="lab neutral">—</span>' +
          '<span class="meta" style="display:block;font-size:9px;opacity:0.65;line-height:1.1;margin-top:1px;"></span>' +
          '</button>';
      });
      box.innerHTML = html;
    }

    Array.prototype.forEach.call(box.children, function (btn) {
      const tf = btn.dataset.tf;
      const tfData = a && a.perTf ? a.perTf[tf] : null;
      btn.classList.toggle('active', tf === state.tf);
      btn.setAttribute('aria-selected', tf === state.tf ? 'true' : 'false');

      const lab = btn.querySelector('.lab');
      const meta = btn.querySelector('.meta');
      if (!lab) return;

      if (!tfData) {
        if (a) { lab.textContent = '—'; lab.className = 'lab neutral'; }
        else { lab.textContent = '…'; lab.className = 'lab neutral'; }
        if (meta) meta.textContent = '';
        return;
      }

      const dir = tfData.direction;
      const adx = tfData.adx;
      const rsi = tfData.rsi;
      const strong = tfData.adxStrong || (num(adx) && adx >= 28);

      let dirText, dirClass;
      if (dir === 1) {
        dirText = strong ? 'Alcista ★' : 'Alcista';
        dirClass = 'lab buy';
      } else if (dir === -1) {
        dirText = strong ? 'Bajista ★' : 'Bajista';
        dirClass = 'lab sell';
      } else {
        dirText = 'Lateral';
        dirClass = 'lab neutral';
      }
      lab.textContent = dirText;
      lab.className = dirClass;
      lab.title = tfData.degraded ? 'EMA degradada (historial corto)' : '';

      if (meta) {
        const parts = [];
        if (num(adx)) parts.push('ADX ' + adx.toFixed(0));
        if (num(rsi)) parts.push('RSI ' + rsi.toFixed(0));
        meta.textContent = parts.join(' · ');
      }
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
      (a.alerts || []).length,
      a.proximitySignal ? a.proximitySignal.type : '',
      a.anticipation ? a.anticipation.type + ':' + a.anticipation.score : '',
      a.multiTfSignal ? a.multiTfSignal.action + ':' + a.multiTfSignal.strength : '',
      state.feedMode
    ].join('|');
  }

  function renderAll(force) {
    const hash = computeRenderHash();
    if (!force && hash === state.lastRenderHash) {
      renderPrice();
      renderChart();
      return;
    }
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

  function cleanBarsForSnapshot(bars) {
    if (!bars || !bars.length) return [];
    const useClosed = (CFG.analysis && CFG.analysis.useClosedCandlesOnly) !== false;
    const src = (useClosed && bars.length > 1) ? bars.slice(0, -1) : bars;
    return src.map(function (b) {
      return { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 };
    });
  }

  function buildSignalSnapshot(analysis, entryPrice) {
    const t = state.ticks[state.symbol];
    const entryTf = analysis.entryTf || state.tf;
    const entryBars = state.bars[entryTf] || [];

    const entrySnapshot = cleanBarsForSnapshot(entryBars).slice(-SNAPSHOT_BARS_ENTRY);

    const higherTfs = {};
    ['1h', '4h', '1d'].forEach(function (tf) {
      if (tf === entryTf) return;
      const barsHtf = state.bars[tf];
      if (barsHtf && barsHtf.length) {
        higherTfs[tf] = cleanBarsForSnapshot(barsHtf).slice(-SNAPSHOT_BARS_HTF);
      }
    });

    const perTfSnap = {};
    Object.keys(analysis.perTf || {}).forEach(function (tf) {
      const d = analysis.perTf[tf];
      perTfSnap[tf] = {
        direction: d.direction,
        adx: d.adx,
        adxStrong: d.adxStrong,
        rsi: d.rsi,
        emaSepPct: d.emaSepPct,
        returnPct: d.returnPct,
        regimeValid: d.regimeValid,
        price: d.price,
        fast: d.fast,
        slow: d.slow,
        plusDI: d.plusDI,
        minusDI: d.minusDI,
        weight: d.weight,
        evidence: d.evidence,
        degraded: d.degraded
      };
    });

    const risk = analysis.verdictRisk;

    return {
      ts: Date.now(),
      symbol: state.symbol,
      tf: state.tf,
      entryTf: entryTf,
      direction: analysis.overallDirection,
      action: analysis.overallDirection === 1 ? 'buy' : analysis.overallDirection === -1 ? 'sell' : 'wait',

      verdict: {
        state: analysis.verdictState,
        label: analysis.verdictLabel,
        reason: analysis.verdictReason,
        score: analysis.consensusScore,
        confidence: analysis.confidence,
        consensusScore: analysis.consensusScore,
        consensusLabel: analysis.consensusLabel
      },

      multiTfSignal: {
        action: analysis.multiTfSignal.action,
        strength: analysis.multiTfSignal.strength,
        alignment: analysis.multiTfSignal.alignment,
        votes: analysis.multiTfSignal.votes,
        summary: analysis.multiTfSignal.summary
      },

      anticipation: analysis.anticipation ? {
        type: analysis.anticipation.type,
        score: analysis.anticipation.score,
        strength: analysis.anticipation.strength,
        factors: analysis.anticipation.factors ? analysis.anticipation.factors.slice() : []
      } : null,

      prices: {
        bid: t ? t.bid : null,
        ask: t ? t.ask : null,
        mid: entryPrice,
        spread: t ? t.spread : null,
        entry: entryPrice,
        stop: risk ? risk.stop : null,
        target: risk ? risk.target : null,
        rr: risk ? risk.rr : null
      },

      smc: state.smcResult ? {
        score: state.smcResult.score,
        grade: state.smcResult.grade,
        trend: state.smcResult.trend,
        breakdown: state.smcResult.breakdown,
        vetoes: state.smcResult.vetoes,
        zones: {
          ob: state.smcResult.zones ? state.smcResult.zones.ob : null,
          fvg: state.smcResult.zones ? state.smcResult.zones.fvg : null,
          ote: state.smcResult.zones ? state.smcResult.zones.ote : null
        }
      } : null,

      snapshot: {
        entryTf: { bars: entrySnapshot },
        higherTfs: higherTfs,
        context: {
          macroTrend: analysis.macroTrend,
          macroMomentum: analysis.macroMomentum,
          macroVolatility: analysis.macroVolatility,
          avgAdxAligned: analysis.avgAdxAligned,
          avgAdxOpposed: analysis.avgAdxOpposed,
          sessionLabel: analysis.sessionLabel,
          marketOpen: analysis.marketOpen,
          highLiquidity: analysis.highLiquidity,
          perTf: perTfSnap,
          levels: {
            supports: (analysis.levels && analysis.levels.supports ? analysis.levels.supports.slice(0, 5) : []),
            resistances: (analysis.levels && analysis.levels.resistances ? analysis.levels.resistances.slice(0, 5) : []),
            bestSupport: analysis.levels ? analysis.levels.bestSupport : null,
            bestResistance: analysis.levels ? analysis.levels.bestResistance : null
          },
          alerts: (analysis.alerts || []).map(function (a) { return { type: a.type, text: a.text }; })
        }
      }
    };
  }

  function logSignalIfChanged(analysis) {
    if (!analysis) return;
    const curr = analysis.verdictState;
    if (curr !== 'buy' && curr !== 'sell') { state.lastSignalKey = ''; return; }
    if (!analysis.verdictRisk && !analysis.anticipation) return;

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
      stopPrice: analysis.verdictRisk ? analysis.verdictRisk.stop : null,
      targetPrice: analysis.verdictRisk ? analysis.verdictRisk.target : null,
      rr: analysis.verdictRisk ? analysis.verdictRisk.rr : null,
      score: analysis.consensusScore,
      confidence: analysis.confidence
    });
    if (state.signalLog.length > MAX_SIGNAL_LOG) state.signalLog.shift();

    if (J && typeof J.record === 'function') {
      try {
        const snap = buildSignalSnapshot(analysis, entryPrice);
        J.record(snap).then(function () {
          renderJournal();
        }).catch(function (e) {
          console.warn('[app] journal.record falló:', e);
        });
      } catch (e) {
        console.warn('[app] buildSignalSnapshot falló:', e);
      }
    }

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
    const gapRef = state.gapRefill;

    D.fetchBars(state.symbol, tf, BAR_LIMIT).then(function (bars) {
      if (state.requestId !== myId || !bars || !bars.length) return;
      state.bars[tf] = bars;
      if (chart && state.tf === tf) {
        const inst = CFG.symbols[state.symbol];
        if (inst) chart.setData(bars, { tf: state.tf, digits: inst.digits, symbol: state.symbol });
      }
    }).catch(function () { void 0; }).then(function () {
      delete gapRef[tf];
    });
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

  function updateJournalOutcomes() {
    if (!J || typeof J.updateOutcomes !== 'function') return;
    const now = Date.now();
    if (state.lastOutcomeUpdateAt && (now - state.lastOutcomeUpdateAt) < OUTCOME_UPDATE_THROTTLE_MS) return;
    state.lastOutcomeUpdateAt = now;

    J.updateOutcomes(state.bars, { symbol: state.symbol }).then(function (changed) {
      if (changed && changed > 0) renderJournal();
    }).catch(function (e) {
      console.warn('[app] journal.updateOutcomes falló:', e);
    });
  }

  function masterCycle() {
    if (loop.locked || loop.stopped) {
      if (loop.locked) state.cycleSkipCount++;
      return;
    }
    loop.locked = true;

    try { runAnalysisStep(); }
    catch (e) { console.error('[app] masterCycle análisis excepción:', e); }

    updateJournalOutcomes();

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

  async function loadAllBars() {
    state.loading = true;
    state.requestId++;
    const myId = state.requestId;
    const tfs = CFG.timeframes.list || ['15m', '1h', '4h', '1d'];
    const newBars = {};

    const tasks = tfs.map(function (tf) {
      return function (signal) {
        return D.fetchBars(state.symbol, tf, BAR_LIMIT, signal).then(function (bars) {
          return { tf: tf, bars: bars };
        });
      };
    });

    let results = [];
    try {
      results = await D.pool(tasks, 2, 45000);
    } catch (e) {
      console.warn('[app] pool timeout, usando resultados parciales');
      results = (e && e.partial) || [];
    }

    if (state.requestId !== myId) return null;

    results.forEach(function (r) {
      if (r && r.ok && r.v && r.v.bars && r.v.bars.length) {
        newBars[r.v.tf] = r.v.bars;
      }
    });

    Object.keys(newBars).forEach(function (tf) {
      state.bars[tf] = newBars[tf];
    });

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
    state.lastOutcomeUpdateAt = 0;
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

  function renderJournal() {
    if (!J) return;

    const storage = $('journalStorage');
    if (storage) {
      const fallback = J.isFallback && J.isFallback();
      storage.textContent = fallback ? 'localStorage' : 'IndexedDB';
      storage.className = 'journal-storage muted small' + (fallback ? ' fallback' : '');
    }

    J.stats().then(function (s) {
      setText('jTotal', String(s.total));
      setText('jWins', String(s.wins), 'journal-stat-val up');
      setText('jLosses', String(s.losses), 'journal-stat-val down');
      setText('jPending', String(s.pending + s.open));
      setText('jWinRate', s.closed > 0 ? s.winRate.toFixed(1) + '%' : '—');
      setText('jExpectancy', s.closed > 0 ? (s.expectancyR >= 0 ? '+' : '') + s.expectancyR.toFixed(2) + 'R' : '—');
      const pf = s.profitFactor;
      setText('jProfitFactor', !isFinite(pf) ? (pf === Infinity ? '∞' : '—') : pf.toFixed(2));
    }).catch(function (e) {
      console.warn('[app] journal.stats falló:', e);
    });
  }

  function journalFeedback(msg, kind) {
    const el = $('journalFeedback');
    if (!el) return;
    el.textContent = msg;
    el.className = 'journal-feedback small ' + (kind || 'muted');
    if (el._timer) clearTimeout(el._timer);
    el._timer = setTimeout(function () {
      el.textContent = '';
      el.className = 'journal-feedback muted small';
    }, 4500);
  }

  function initJournal() {
    if (!J) {
      console.warn('[app] journal no disponible');
      return;
    }

    J.init().then(function () {
      renderJournal();

      const btnJSON = $('journalExportJSON');
      const btnCSV = $('journalExportCSV');
      const btnClear = $('journalClear');

      if (btnJSON) {
        btnJSON.addEventListener('click', function () {
          btnJSON.disabled = true;
          J.exportJSON().then(function (n) {
            journalFeedback(n + ' señales exportadas (JSON)', 'ok');
          }).catch(function (e) {
            journalFeedback('Error al exportar', 'bad');
            console.warn(e);
          }).then(function () { btnJSON.disabled = false; });
        });
      }

      if (btnCSV) {
        btnCSV.addEventListener('click', function () {
          btnCSV.disabled = true;
          J.exportCSV().then(function (n) {
            journalFeedback(n + ' señales exportadas (CSV)', 'ok');
          }).catch(function (e) {
            journalFeedback('Error al exportar', 'bad');
            console.warn(e);
          }).then(function () { btnCSV.disabled = false; });
        });
      }

      if (btnClear) {
        btnClear.addEventListener('click', function () {
          if (!confirm('¿Borrar todo el historial de señales? Esta acción no se puede deshacer.')) return;
          btnClear.disabled = true;
          J.clear().then(function () {
            journalFeedback('Historial borrado', 'ok');
            renderJournal();
          }).catch(function (e) {
            journalFeedback('Error al borrar', 'bad');
            console.warn(e);
          }).then(function () { btnClear.disabled = false; });
        });
      }
    }).catch(function (e) {
      console.error('[app] journal.init falló:', e);
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
    initJournal();

    try { initChart(); }
    catch (e) { console.error('[app] initChart falló:', e); }

    startMasterLoop();

    loadAllBars().then(function () {
      try { startFeed(); }
      catch (e) {
        console.error('[app] startFeed falló:', e);
        state.feedMode = 'error';
        renderStatus();
      }
    }).catch(function (e) {
      console.error('[app] loadAllBars rechazó en init:', e);
      try { startFeed(); } catch (err) { void 0; }
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
        lastPriceCheckAt: state.lastPriceCheckAt,
        lastOutcomeUpdateAt: state.lastOutcomeUpdateAt
      };
    }
  };
})();