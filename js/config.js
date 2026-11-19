window.AT_CONFIG = {
  version: '6.0.0-scalping-anticipativo',
  base: 'https://biquote.io',
  signalrUrl: 'https://cdnjs.cloudflare.com/ajax/libs/microsoft-signalr/8.0.0/signalr.min.js',

  timings: {
    updateIntervalMs: 1000,
    priceCheckMs: 500,
    renderRaf: true,
    cycleBudgetMs: 4500,
    staleBarsMs: 20000,
    maxSignalAgeMs: 15000
  },

  scalping: {
    enabled: true,
    entryCooldownMs: 300000,
    flipCooldownMs: 60000,
    lossCooldownMs: 900000,
    maxSignalsPerHour: 12,
    maxSignalsPerSession: 40,
    requireLiveTick: true,
    minSignalScore: 65,
    minValidTfs: 2,
    maxAdxForTrend: 40,
    rejectIfAdxExhausted: true,
    rejectIfRsiExtreme: true,
    defaultVerdict: 'ESPERAR'
  },

  reversal: {
    enabled: true,
    rsiBuyZone: 32,
    rsiSellZone: 68,
    rsiExitBuy: 38,
    rsiExitSell: 62,
    requireDivergence: true,
    requireSweep: true,
    requireCandleRejection: true,
    minScore: 65,
    strongScore: 80,
    adxExhaustion: 35,
    adxDropPct: 15
  },

  continuation: {
    enabled: true,
    emaProximityAtr: 0.5,
    vwapProximityAtr: 0.75,
    requireCandleRejection: true,
    minScore: 60,
    strongScore: 75,
    maxAdx: 40
  },

  symbols: {
    XAUUSD: { name: 'Oro / Dólar',     digits: 2, contract: 100,    spread: 0.30,    family: 'metals', enabled: true },
    XAGUSD: { name: 'Plata / Dólar',   digits: 3, contract: 5000,   spread: 0.03,    family: 'metals', enabled: true },
    XAUEUR: { name: 'Oro / Euro',      digits: 2, contract: 100,    spread: 0.40,    family: 'metals', enabled: true },
    EURUSD: { name: 'Euro / Dólar',    digits: 5, contract: 100000, spread: 0.00010, family: 'forex',  enabled: true },
    BNBUSD: { name: 'BNB / Dólar',     digits: 2, contract: 1,      spread: 0.30,    family: 'crypto', enabled: true },
    BTCUSD: { name: 'Bitcoin / Dólar', digits: 2, contract: 1,      spread: 0.60,    family: 'crypto', enabled: true }
  },

  timeframes: {
    entry: '5m',
    trigger: '1m',
    list: ['1m', '5m', '15m', '1h'],
    bias: ['15m', '1h'],
    optional: ['4h', '1d'],
    weights: { '1m': 1, '5m': 5, '15m': 3, '1h': 2, '4h': 1, '1d': 1 }
  },

  vwap: {
    enabled: true,
    anchor: 'session',
    requireAlignment: true,
    proximityAtrMult: 0.75,
    rejectDistanceAtrMult: 2.5
  },

  regime: {
    adxPeriod: 14,
    adxMin: 18,
    adxStrong: 25,
    adxMax: 40,
    emaPeriods: [9, 21, 50],
    emaStackRequired: true,
    emaSeparationMinPct: 0.08,
    returnLookback: 15,
    returnMinPct: 0.08
  },

  consensus: {
    minimumValidTfs: 2,
    weightedMajority: 0.55,
    thresholds: { strong: 60, moderate: 40 },
    adxNormalizationCeiling: 30,
    tieBreak: 'higher_tf'
  },

  risk: {
    atrPeriod: 14,
    atrStopMult: 1.5,
    atrTargetMult: 2.0,
    minRR: 1.3,
    maxRiskPct: 0.5,
    maxSignalAgeBars: 5,
    maxDailyLossPct: 3.0,
    maxConsecutiveLosses: 3
  },

  anticipation: {
    enabled: true,
    minConfidence: 45,
    strongConfidence: 70,
    rsiDivergenceLookback: 5,
    rsiDivergenceGap: 1,
    rsiDivergenceMinDelta: 1.5,
    macdEnabled: true,
    macdFast: 8,
    macdSlow: 21,
    macdSignal: 5,
    pinBarBodyRatio: 0.4,
    pinBarWickRatio: 2.0,
    engulfingEnabled: true,
    sweepEnabled: true,
    sweepLookback: 6,
    minLevelProximityAtr: 0.6,
    multiTfConfluenceBonus: 15,
    scoreRsiDivergence: 25,
    scoreMacdDivergence: 20,
    scorePinBar: 20,
    scoreEngulfing: 15,
    scoreSweep: 20,
    counterTrendMinConfidence: 80
  },

  signal: {
    primeThreshold: 80,
    goodThreshold: 65,
    moderateThreshold: 40,
    weakBelow: 40,
    entryWindowLabel: 'ENTRY WINDOW',
    stopBandAtrMult: 0.55,
    targetBandAtrMult: 1.2,
    requireHtfAlignment: true,
    minComponents: 2
  },

  exhaustion: {
    rsiPeriod: 14,
    rsiOverbought: 75,
    rsiOversold: 25,
    adxDropPct: 20,
    lookbackCandles: 5,
    volumeDropPct: 40,
    volumeLookback: 15,
    divergenceLookback: 8,
    divergenceGap: 1,
    consensusOverextension: 95,
    dangerBlockThreshold: 2
  },

  smc: {
    atrPeriod: 14,
    pivotLookback: 3,
    mssWindow: 8,
    mssDisplacementBodyRatio: 0.55,
    mssDisplacementAtrMult: 1.0,
    displacementEnabled: false,
    zigzagAtrMult: 1.5,
    zigzagEnabled: true,
    sweepWindow: 3,
    sweepAtrMult: 0.30,
    sweepMaxAtrMult: 1.5,
    sweepRejectionMin: 0.5,
    obAtrMult: 1.5,
    obMaxZones: 3,
    obMaxAgeBars: 80,
    obMitigationCloseOnly: true,
    fvgMaxZones: 3,
    fvgMinAtrMult: 0.25,
    fvgMaxAge: 30,
    fvgMitigationCloseOnly: true,
    eqToleranceAtrMult: 0.10,
    oteMin: 0.618,
    oteMax: 0.79,
    oteMid: 0.705,
    oteSwingRecency: 15,
    minSwingAtrMult: 3,
    maxSwingAge: 100,
    swingBodyRatioMin: 0.5,
    requireBosForOte: false,
    requirePremiumDiscount: false,
    htfZoneRequired: true,
    htfZoneTfs: ['15m', '1h'],
    weights: { mss: 30, sweep: 25, fvg: 15, ob: 15, ote: 15 },
    bosWeightFactor: 0.5,
    staleMssFactor: 0.5,
    sweepAgainstPenalty: 15,
    htfBiasBonus: 10,
    htfBiasPenalty: 10,
    requireZoneForHigh: true,
    highConfluence: 80,
    mediumConfluence: 50,
    minComponentsForMedium: 2,
    minConfidence: 15,
    riskTiers: { high: 1.0, medium: 0.5, low: 0.25, vetoed: 0.0 },
    blockers: {
      enabled: true,
      strict: false,
      lowVolumeHours: [[21, 23], [0, 1]],
      newsWindows: []
    }
  },

  sessions: {
    london:   { startGmt: 8,  endGmt: 16 },
    newYork:  { startGmt: 13, endGmt: 21 },
    combined: { startGmt: 13, endGmt: 16 },
    dstAdjust: false,
    requireActive: false,
    preferredWindows: [
      { startGmt: 7,  endGmt: 11 },
      { startGmt: 13, endGmt: 17 }
    ]
  },

  tradingHours: {
    forex:  { alwaysOpen: false, open: { day: 0, hour: 22 }, close: { day: 5, hour: 22 } },
    metals: { alwaysOpen: false, open: { day: 0, hour: 23 }, close: { day: 5, hour: 22 } },
    crypto: { alwaysOpen: true },
    index:  { alwaysOpen: false, open: { day: 0, hour: 22 }, close: { day: 5, hour: 21 } }
  },

  feed: {
    fetchTimeout: 15000,
    globalTimeout: 60000,
    pollMs: 2000,
    pollSlowMs: 20000,
    retryMs: 60000,
    backoffMs: 10000,
    maxConcurrent: 2,
    staleThresholdMs: 15000,
    wsSilenceTimeoutMs: 8000,
    maxRetries: 3,
    wsEnabled: true,
    wsReconnectMs: 3000,
    wsMaxReconnectMs: 30000
  },

  chart: {
    defaultCount: 100,
    minCount: 30,
    maxCount: 500,
    emaPeriods: [9, 21, 50],
    colors: {
      ema20: '#F59E0B',
      ema50: '#22D3EE',
      ema200: '#A855F7',
      up: '#00D4AA',
      down: '#FF4D6A',
      grid: 'rgba(255, 255, 255, 0.04)',
      zoneOB: 'rgba(0, 212, 170, 0.14)',
      zoneOBbear: 'rgba(255, 77, 106, 0.14)',
      zoneFVG: 'rgba(79, 140, 255, 0.14)',
      zoneOTE: 'rgba(168, 85, 247, 0.14)',
      drawing: '#4F8CFF',
      drawingInProgress: 'rgba(79, 140, 255, 0.75)',
      drawingText: 'rgba(241, 245, 249, 0.85)'
    }
  },

  drawing: {
    enabled: true,
    fullscreenOnly: true,
    defaultColor: '#4F8CFF',
    lineWidth: 1.8,
    previewDash: [4, 4],
    fibLevels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1],
    maxPerScope: 100
  },

  analysis: {
    minBarsPerTf: 30,
    useClosedCandlesOnly: true
  }
};