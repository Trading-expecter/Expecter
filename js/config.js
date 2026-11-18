/* ============================================================
 * SMC Signals — Terminal de Confluencia
 * config.js  (1/11)  ·  Configuración central
 * Fuente de datos: https://biquote.io (gratis, sin API key, CORS abierto)
 * Docs: https://biquote.io/docs/
 * ============================================================ */
window.CONFIG = (function () {
  'use strict';

  // Símbolos originales del proyecto (sin cambios).
  const SYMBOLS = {
    XAUUSD: { digits: 2, point: 0.01,    name: 'Oro/USD' },
    XAUEUR: { digits: 2, point: 0.01,    name: 'Oro/EUR' },
    XAGUSD: { digits: 3, point: 0.001,   name: 'Plata/USD' },
    EURUSD: { digits: 5, point: 0.00001, name: 'Euro/USD' },
    GBPUSD: { digits: 5, point: 0.00001, name: 'Libra/USD' },
    BTCUSD: { digits: 2, point: 0.01,    name: 'Bitcoin' },
    BNBUSD: { digits: 2, point: 0.01,    name: 'BNB' }
  };

  const MODES = {
    scalping: {
      entryTf: '5m', contextTf: '15m',
      emaFast: 50, emaSlow: 200, rsiPeriod: 14, atrPeriod: 10,
      slAtrMult: 1.2, tpAtrMult: 1.8, minConfluences: 2,
      maxBars: 300, label: 'Scalping'
    },
    day: {
      entryTf: '15m', contextTf: '1h',
      emaFast: 50, emaSlow: 200, rsiPeriod: 14, atrPeriod: 14,
      slAtrMult: 1.8, tpAtrMult: 3.0, minConfluences: 2,
      maxBars: 300, label: 'Día'
    }
  };

  const SMC = {
    swingLookback: 4,
    fvgMinAtrMult: 0.25,
    obMaxAgeBars: 120,
    requireClosedBreak: true
  };

  // SignalR en vivo优先 (sin límite), polling como fallback (~5s mínimo).
  const FEED = {
    base: 'https://biquote.io',
    preferSignalR: true,
    pollMs: 5000,
    fetchTimeout: 8000,
    maxRetries: 3,
    retryBackoffMs: 600
  };

  // Alerta temprana "PREPARAR COMPRA / PREPARAR VENTA" (estado ámbar).
  const ALERT = {
    enabled: true,
    proxAtrMult: 1.5,     // precio a <1.5×ATR de la zona institucional
    sound: true,          // beep
    notify: true,         // notificación del navegador
    repeatEveryMs: 60000  // no repetir antes de 60s
  };

  const CHART = {
    defaultCount: 140, minCount: 40, maxCount: 500,
    colors: {
      up: '#00D4AA', down: '#FF4757',
      wickUp: 'rgba(0,212,170,0.85)', wickDown: 'rgba(255,71,87,0.85)',
      ema50: '#F59E0B', ema200: '#A855F7',
      ob: 'rgba(0,212,170,0.10)', obStroke: 'rgba(0,212,170,0.45)',
      fvg: 'rgba(88,166,255,0.10)', fvgStroke: 'rgba(88,166,255,0.45)',
      grid: 'rgba(255,255,255,0.04)', axisText: '#828282',
      crosshair: 'rgba(255,255,255,0.18)', armed: '#FFB800'
    }
  };

  return {
    version: '2.0.0',
    symbols: SYMBOLS, modes: MODES, smc: SMC, feed: FEED,
    alert: ALERT, chart: CHART,
    defaultSymbol: 'XAUUSD', defaultMode: 'day'
  };
})();
