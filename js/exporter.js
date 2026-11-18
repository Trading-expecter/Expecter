/* ============================================================
 * SMC Signals — Terminal de Confluencia
 * exporter.js  (8/11)  ·  Registro y exportación CSV de señales
 * ============================================================ */
window.Exporter = (function () {
  'use strict';

  let signals = [];
  let nextId = 1;

  const HEADER = [
    'id', 'timestamp', 'symbol', 'timeframe', 'mode', 'direction',
    'entry', 'stop', 'target', 'riskReward', 'confidence',
    'checklist_trend', 'checklist_structure', 'checklist_zone', 'checklist_momentum',
    'result', 'exitPrice', 'exitTime'
  ];

  function esc(v) {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function record(signal, symbol, tf, mode) {
    if (!signal || !signal.active || !Number.isFinite(signal.entry)) return null;
    const s = {
      id: nextId++,
      timestamp: new Date().toISOString(),
      symbol, timeframe: tf, mode,
      direction: signal.direction,
      entry: signal.entry, stop: signal.stop, target: signal.target,
      riskReward: signal.riskReward, confidence: signal.confidence,
      checklistTrend: !!signal.checklist.trend.valid,
      checklistStructure: !!signal.checklist.structure.valid,
      checklistZone: !!signal.checklist.zone.valid,
      checklistMomentum: !!signal.checklist.momentum.valid,
      result: 'OPEN', exitPrice: '', exitTime: ''
    };
    signals.push(s);
    return s;
  }

  function close(symbol, currentPrice) {
    if (!Number.isFinite(currentPrice)) return [];
    const closed = [];
    for (const s of signals) {
      if (s.symbol !== symbol || s.result !== 'OPEN') continue;
      let result = null;
      if (s.direction === 'buy') {
        if (currentPrice <= s.stop) result = 'LOSS';
        else if (currentPrice >= s.target) result = 'WIN';
      } else {
        if (currentPrice >= s.stop) result = 'LOSS';
        else if (currentPrice <= s.target) result = 'WIN';
      }
      if (result) {
        s.result = result; s.exitPrice = currentPrice;
        s.exitTime = new Date().toISOString(); closed.push(s);
      }
    }
    return closed;
  }

  function toCSV() {
    const rows = signals.map(s => [
      s.id, s.timestamp, s.symbol, s.timeframe, s.mode, s.direction,
      s.entry, s.stop, s.target, s.riskReward, s.confidence,
      s.checklistTrend, s.checklistStructure, s.checklistZone, s.checklistMomentum,
      s.result, s.exitPrice, s.exitTime
    ].map(esc).join(','));
    return '\uFEFF' + HEADER.join(',') + '\n' + rows.join('\n');
  }

  function download() {
    if (!signals.length) return;
    const blob = new Blob([toCSV()], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'smc_signals_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const count = () => signals.length;
  const openCount = () => signals.filter(s => s.result === 'OPEN').length;
  const all = () => signals.slice();

  return { record, close, download, count, openCount, all, toCSV };
})();
