window.Exporter = (function () {
  let signals = [];
  let nextId = 1;

  function record(signal, symbol, tf, mode) {
    if (!signal.active || !signal.entry) return null;
    const s = {
      id: nextId++,
      timestamp: new Date().toISOString(),
      symbol, timeframe: tf, mode,
      direction: signal.direction,
      entry: signal.entry,
      stop: signal.stop,
      target: signal.target,
      riskReward: signal.riskReward,
      confidence: signal.confidence,
      checklistTrend: signal.checklist.trend.valid,
      checklistStructure: signal.checklist.structure.valid,
      checklistZone: signal.checklist.zone.valid,
      checklistMomentum: signal.checklist.momentum.valid,
      result: 'OPEN',
      exitPrice: '',
      exitTime: ''
    };
    signals.push(s);
    return s;
  }

  function close(symbol, currentPrice) {
    for (const s of signals) {
      if (s.symbol !== symbol || s.result !== 'OPEN') continue;
      if (s.direction === 'buy') {
        if (currentPrice <= s.stop) { s.result = 'LOSS'; s.exitPrice = currentPrice; s.exitTime = new Date().toISOString(); }
        else if (currentPrice >= s.target) { s.result = 'WIN'; s.exitPrice = currentPrice; s.exitTime = new Date().toISOString(); }
      } else {
        if (currentPrice >= s.stop) { s.result = 'LOSS'; s.exitPrice = currentPrice; s.exitTime = new Date().toISOString(); }
        else if (currentPrice <= s.target) { s.result = 'WIN'; s.exitPrice = currentPrice; s.exitTime = new Date().toISOString(); }
      }
    }
  }

  function download() {
    if (!signals.length) return;
    const header = [
      'id', 'timestamp', 'symbol', 'timeframe', 'mode', 'direction',
      'entry', 'stop', 'target', 'riskReward', 'confidence',
      'checklist_trend', 'checklist_structure', 'checklist_zone', 'checklist_momentum',
      'result', 'exitPrice', 'exitTime'
    ].join(',');
    const rows = signals.map(s => [
      s.id, s.timestamp, s.symbol, s.timeframe, s.mode, s.direction,
      s.entry, s.stop, s.target, s.riskReward, s.confidence,
      s.checklistTrend, s.checklistStructure, s.checklistZone, s.checklistMomentum,
      s.result, s.exitPrice, s.exitTime
    ].join(','));
    const csv = header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'smc_signals_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function count() { return signals.length; }

  return { record, close, download, count };
})();