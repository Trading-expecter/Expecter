window.AT_CONFIG = {
  version: '4.0.0-SMC-FUSION',
  base: 'https://biquote.io',
  signalrUrl: 'https://cdnjs.cloudflare.com/ajax/libs/microsoft-signalr/8.0.0/signalr.min.js',

  symbols: {
    XAUUSD: { name: 'Oro / Dólar', digits: 2, contract: 100, spread: 0.30, family: 'metals', enabled: true },
    XAGUSD: { name: 'Plata / Dólar', digits: 3, contract: 5000, spread: 0.03, family: 'metals', enabled: false },
    XAUEUR: { name: 'Oro / Euro', digits: 2, contract: 100, spread: 0.40, family: 'metals', enabled: false },
    EURUSD: { name: 'Euro / Dólar', digits: 5, contract: 100000, spread: 0.00010, family: 'forex', enabled: false },
    BNBUSD: { name: 'BNB / Dólar', digits: 2, contract: 1, spread: 0.30, family: 'crypto', enabled: false },
    BTCUSD: { name: 'Bitcoin / Dólar', digits: 2, contract: 1, spread: 0.60, family: 'crypto', enabled: false }
  },

  alias: {
    XAUUSD: 'XAUUSD',
    XAGUSD: 'XAGUSD',
    XAUEUR: 'XAUEUR',
    EURUSD: 'EURUSD',
    BNBUSD: 'BNBUSD',
    BTCUSD: 'BTCUSD'
  },

  timeframes: {
    entry: '15m',
    list: ['5m', '15m', '1h'],
    bias: ['1h'],
    weights: { '5m': 1, '15m': 3, '1h': 4 }
  },

  regime: {
    adxPeriod: 14,
    adxMin: 20,
    adxStrong: 25,
    emaFast: 9,
    emaSlow: 21,
    emaSeparationMinPct: 0.10,
    returnLookback: 10,
    returnMinPct: 0.15
  },

  consensus: {
    minimumValidTfs: 2,
    enterThreshold: 0.60,
    exitThreshold: 0.45,
    weightedMajority: 0.60,
    adxNormalizationCeiling: 40,
    thresholds: { strong: 60, moderate: 40 }
  },

  verdict: {
    minHoldMs: 45000,
    minConfirmations: 2,
    minPendingMs: 5000
  },

  risk: {
    atrPeriod: 14,
    atrStopMult: 1.2,
    atrTargetMult: 2.0,
    minRR: 1.5,
    maxRiskPct: 0.5,
    maxSignalAgeBars: 5,
    accountBalance: 10000
  },

  vwap: {
    enabled: true,
    resetHourUtc: 0,
    biasFilterPct: 0.10,
    useAsBiasFilter: true
  },

  exhaustion: {
    rsiPeriod: 14,
    rsiOverbought: 75,
    rsiOversold: 25,
    adxDropPct: 30,
    lookbackCandles: 5,
    volumeDropPct: 40,
    volumeLookback: 20,
    divergenceLookback: 10,
    divergenceGap: 1,
    consensusOverextension: 90,
    dangerBlockThreshold: 3
  },

  smc: {
    atrPeriod: 14,
    pivotLookback: 3,
    mssWindow: 12,
    sweepWindow: 4,
    sweepAtrMult: 0.35,
    sweepMaxAtrMult: 1.8,
    sweepRejectionMin: 0.5,
    obAtrMult: 1.5,
    obMidlineRatio: 0.5,
    obMaxZones: 3,
    obMaxAgeBars: 150,
    fvgMaxZones: 3,
    fvgMinAtrMult: 0.30,
    fvgMaxAge: 60,
    fvgMiddleBodyAtrMult: 0.5,
    eqToleranceAtrMult: 0.10,
    oteMin: 0.618,
    oteMax: 0.79,
    oteMid: 0.705,
    oteSwingRecency: 25,
    minSwingAtrMult: 4,
    maxSwingAge: 200,
    weights: { mss: 30, sweep: 25, fvg: 15, ob: 15, ote: 15 },
    requireZoneForHigh: true,
    highConfluence: 70,
    mediumConfluence: 45,
    minComponentsForMedium: 2
  },

  sessions: {
    london: { startGmt: 8, endGmt: 16 },
    newYork: { startGmt: 13, endGmt: 21 },
    combined: { startGmt: 13, endGmt: 16 },
    dstAdjust: false,
    requireActive: false
  },

  tradingHours: {
    forex: { alwaysOpen: false, open: { day: 0, hour: 22 }, close: { day: 5, hour: 22 } },
    metals: { alwaysOpen: false, open: { day: 0, hour: 23 }, close: { day: 5, hour: 22 } },
    crypto: { alwaysOpen: true },
    index: { alwaysOpen: false, open: { day: 0, hour: 22 }, close: { day: 5, hour: 21 } }
  },

  feed: {
    fetchTimeout: 8000,
    globalTimeout: 20000,
    pollMs: 1000,
    pollSlowMs: 5000,
    retryMs: 60000,
    backoffMs: 10000,
    maxConcurrent: 3,
    staleThresholdMs: 15000
  },

  chart: {
    defaultCount: 150,
    minCount: 20,
    maxCount: 1000,
    emaPeriods: [9, 21, 50],
    colors: {
      ema9: '#f59e0b',
      ema21: '#00b8d9',
      ema50: '#a855f7',
      up: '#10b981',
      down: '#f43f5e',
      grid: 'rgba(255, 255, 255, 0.06)',
      zoneOB: 'rgba(16, 185, 129, 0.15)',
      zoneFVG: 'rgba(0, 184, 217, 0.15)',
      zoneOTE: 'rgba(168, 85, 247, 0.15)',
      vwap: '#eab308',
      drawing: '#00b8d9',
      drawingInProgress: 'rgba(34, 211, 238, 0.75)',
      drawingText: 'rgba(230, 237, 243, 0.85)'
    }
  },

  drawing: {
    enabled: true,
    fullscreenOnly: true,
    defaultColor: '#00b8d9',
    lineWidth: 1.8,
    previewDash: [4, 4],
    fibLevels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1],
    maxPerScope: 100
  },

  analysis: {
    minBarsPerTf: 30,
    throttleMs: 1500,
    useClosedCandlesOnly: false
  }
};