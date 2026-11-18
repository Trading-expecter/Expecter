window.CONFIG = {
  base: 'https://biquote.io',

  symbols: {
    XAUUSD: { digits: 2, name: 'Oro/USD' },
    XAUEUR: { digits: 2, name: 'Oro/EUR' },
    XAGUSD: { digits: 3, name: 'Plata/USD' },
    EURUSD: { digits: 5, name: 'Euro/USD' },
    GBPUSD: { digits: 5, name: 'Libra/USD' },
    BTCUSD: { digits: 2, name: 'Bitcoin' },
    BNBUSD: { digits: 2, name: 'BNB' }
  },

  modes: {
    scalping: {
      entryTf: '5m',
      contextTf: '15m',
      emaFast: 50,
      emaSlow: 200,
      rsiPeriod: 14,
      atrPeriod: 10,
      slAtrMult: 1.2,
      tpAtrMult: 1.8,
      minConfluences: 2,
      label: 'Scalping'
    },
    day: {
      entryTf: '15m',
      contextTf: '1h',
      emaFast: 50,
      emaSlow: 200,
      rsiPeriod: 14,
      atrPeriod: 14,
      slAtrMult: 1.8,
      tpAtrMult: 3.0,
      minConfluences: 2,
      label: 'Día'
    }
  },

  smc: {
    swingLookback: 4,
    fvgMinAtrMult: 0.25,
    obMaxAgeBars: 120
  },

  feed: {
    pollMs: 2000,
    fetchTimeout: 8000,
    maxRetries: 3
  },

  chart: {
    defaultCount: 140,
    colors: {
      up: '#00D4AA',
      down: '#FF4757',
      ema50: '#F59E0B',
      ema200: '#A855F7',
      ob: 'rgba(0, 212, 170, 0.10)',
      fvg: 'rgba(88, 166, 255, 0.10)'
    }
  }
};