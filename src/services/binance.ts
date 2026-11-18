import type { UTCTimestamp } from 'lightweight-charts';
import {
  SYMBOL_CATALOG,
  TIMEFRAME_SECONDS,
  type Candle,
  type Ticker24h,
  type Timeframe,
} from '../types/trading';
import { getMarketStatus, getSymbolCategory } from '../utils/marketHours';

const REST_BASES = [
  'https://api.binance.com',
  'https://data-api.binance.vision',
];

const WS_BASES = [
  'wss://data-stream.binance.vision/ws',
  'wss://stream.binance.com:9443/ws',
  'wss://stream.binance.us:9443/ws',
];
const CRYPTOCOMPARE_REST = 'https://min-api.cryptocompare.com/data';
const FINNHUB_REST = 'https://finnhub.io/api/v1';
const FINNHUB_WS = 'wss://ws.finnhub.io';

export const BASE_PRICES: Record<string, number> = {
  // Futures
  'NQ1!': 20957.5,
  'ES1!': 5979.75,
  'YM1!': 43887.6,
  'CL1!': 72.5,
  // Stocks
  AAPL: 228.5,
  NVDA: 142.8,
  TSLA: 325.4,
  MSFT: 422.1,
  AMZN: 210.4,
  // Crypto fallbacks
  BTCUSDT: 94250.0,
  ETHUSDT: 3380.0,
  SOLUSDT: 214.5,
  BNBUSDT: 642.0,
};

// Realistic 1-minute baseline volatility (0.015% to 0.06% per 1m bar)
const BASE_1M_VOLATILITY: Record<string, number> = {
  'NQ1!': 0.00029,
  'ES1!': 0.00021,
  'YM1!': 0.0002,
  'CL1!': 0.00044,
  AAPL: 0.00026,
  NVDA: 0.00048,
  TSLA: 0.00052,
  MSFT: 0.00025,
  AMZN: 0.00031,
  BTCUSDT: 0.00042,
  ETHUSDT: 0.00048,
  SOLUSDT: 0.00056,
  BNBUSDT: 0.0004,
};

interface BinanceIntervalSource {
  baseInterval: string;
  bucketSeconds: number;
  aggregate: boolean;
  batches: number;
  limit: number;
}

const BINANCE_INTERVAL_MAP: Record<Timeframe, BinanceIntervalSource> = {
  '1s': { baseInterval: '1s', bucketSeconds: 1, aggregate: false, batches: 1, limit: 600 },
  '5s': { baseInterval: '1s', bucketSeconds: 5, aggregate: true, batches: 2, limit: 1000 },
  '15s': { baseInterval: '1s', bucketSeconds: 15, aggregate: true, batches: 3, limit: 1000 },
  '30s': { baseInterval: '1s', bucketSeconds: 30, aggregate: true, batches: 3, limit: 1000 },
  '1m': { baseInterval: '1m', bucketSeconds: 60, aggregate: false, batches: 2, limit: 1000 },
  '2m': { baseInterval: '1m', bucketSeconds: 120, aggregate: true, batches: 2, limit: 1000 },
  '3m': { baseInterval: '3m', bucketSeconds: 180, aggregate: false, batches: 2, limit: 1000 },
  '4m': { baseInterval: '1m', bucketSeconds: 240, aggregate: true, batches: 3, limit: 1000 },
  '5m': { baseInterval: '5m', bucketSeconds: 300, aggregate: false, batches: 2, limit: 1000 },
  '15m': { baseInterval: '15m', bucketSeconds: 900, aggregate: false, batches: 3, limit: 1000 },
  '30m': { baseInterval: '30m', bucketSeconds: 1800, aggregate: false, batches: 2, limit: 1000 },
  '1h': { baseInterval: '1h', bucketSeconds: 3600, aggregate: false, batches: 1, limit: 1000 },
  '2h': { baseInterval: '2h', bucketSeconds: 7200, aggregate: false, batches: 1, limit: 1000 },
  '3h': { baseInterval: '1h', bucketSeconds: 10800, aggregate: true, batches: 3, limit: 1000 },
  '4h': { baseInterval: '4h', bucketSeconds: 14400, aggregate: false, batches: 1, limit: 1000 },
  '1d': { baseInterval: '1d', bucketSeconds: 86400, aggregate: false, batches: 1, limit: 365 },
  '1w': { baseInterval: '1w', bucketSeconds: 604800, aggregate: false, batches: 1, limit: 260 },
  '1M': { baseInterval: '1M', bucketSeconds: 2592000, aggregate: false, batches: 1, limit: 120 },
};

const FINNHUB_INTERVAL_MAP: Record<
  Timeframe,
  { resolution: string; baseSeconds: number; bucketSeconds: number; aggregate: boolean }
> = {
  '1s': { resolution: '1', baseSeconds: 60, bucketSeconds: 60, aggregate: false },
  '5s': { resolution: '1', baseSeconds: 60, bucketSeconds: 60, aggregate: false },
  '15s': { resolution: '1', baseSeconds: 60, bucketSeconds: 60, aggregate: false },
  '30s': { resolution: '1', baseSeconds: 60, bucketSeconds: 60, aggregate: false },
  '1m': { resolution: '1', baseSeconds: 60, bucketSeconds: 60, aggregate: false },
  '2m': { resolution: '1', baseSeconds: 60, bucketSeconds: 120, aggregate: true },
  '3m': { resolution: '1', baseSeconds: 60, bucketSeconds: 180, aggregate: true },
  '4m': { resolution: '1', baseSeconds: 60, bucketSeconds: 240, aggregate: true },
  '5m': { resolution: '5', baseSeconds: 300, bucketSeconds: 300, aggregate: false },
  '15m': { resolution: '15', baseSeconds: 900, bucketSeconds: 900, aggregate: false },
  '30m': { resolution: '30', baseSeconds: 1800, bucketSeconds: 1800, aggregate: false },
  '1h': { resolution: '60', baseSeconds: 3600, bucketSeconds: 3600, aggregate: false },
  '2h': { resolution: '60', baseSeconds: 3600, bucketSeconds: 7200, aggregate: true },
  '3h': { resolution: '60', baseSeconds: 3600, bucketSeconds: 10800, aggregate: true },
  '4h': { resolution: '60', baseSeconds: 3600, bucketSeconds: 14400, aggregate: true },
  '1d': { resolution: 'D', baseSeconds: 86400, bucketSeconds: 86400, aggregate: false },
  '1w': { resolution: 'W', baseSeconds: 604800, bucketSeconds: 604800, aggregate: false },
  '1M': { resolution: 'M', baseSeconds: 2592000, bucketSeconds: 2592000, aggregate: false },
};

const CRYPTOCOMPARE_INTERVAL_MAP: Record<
  Timeframe,
  { endpoint: 'histominute' | 'histohour' | 'histoday'; aggregate: number; limit: number }
> = {
  '1s': { endpoint: 'histominute', aggregate: 1, limit: 1000 },
  '5s': { endpoint: 'histominute', aggregate: 1, limit: 1000 },
  '15s': { endpoint: 'histominute', aggregate: 1, limit: 1000 },
  '30s': { endpoint: 'histominute', aggregate: 1, limit: 1000 },
  '1m': { endpoint: 'histominute', aggregate: 1, limit: 1500 },
  '2m': { endpoint: 'histominute', aggregate: 2, limit: 1500 },
  '3m': { endpoint: 'histominute', aggregate: 3, limit: 1500 },
  '4m': { endpoint: 'histominute', aggregate: 4, limit: 1500 },
  '5m': { endpoint: 'histominute', aggregate: 5, limit: 1500 },
  '15m': { endpoint: 'histominute', aggregate: 15, limit: 2000 },
  '30m': { endpoint: 'histominute', aggregate: 30, limit: 1440 },
  '1h': { endpoint: 'histohour', aggregate: 1, limit: 720 },
  '2h': { endpoint: 'histohour', aggregate: 2, limit: 500 },
  '3h': { endpoint: 'histohour', aggregate: 3, limit: 400 },
  '4h': { endpoint: 'histohour', aggregate: 4, limit: 360 },
  '1d': { endpoint: 'histoday', aggregate: 1, limit: 365 },
  '1w': { endpoint: 'histoday', aggregate: 7, limit: 260 },
  '1M': { endpoint: 'histoday', aggregate: 30, limit: 120 },
};

const YAHOO_SYMBOL_MAP: Record<string, string> = {
  // Futures
  'NQ1!': 'NQ=F',
  'ES1!': 'ES=F',
  'YM1!': 'YM=F',
  'CL1!': 'CL=F',
  // Stocks
  AAPL: 'AAPL',
  NVDA: 'NVDA',
  TSLA: 'TSLA',
  MSFT: 'MSFT',
  AMZN: 'AMZN',
  // Crypto
  BTCUSDT: 'BTC-USD',
  ETHUSDT: 'ETH-USD',
  SOLUSDT: 'SOL-USD',
  BNBUSDT: 'BNB-USD',
};

const FUTURES_ETF_PROXY_MAP: Record<string, string> = {
  'NQ1!': 'QQQ',
  'ES1!': 'SPY',
  'YM1!': 'DIA',
  'CL1!': 'USO',
};

const ETF_TO_FUTURES_MAP: Record<string, string> = {
  QQQ: 'NQ1!',
  SPY: 'ES1!',
  DIA: 'YM1!',
  USO: 'CL1!',
};

export const LIVE_API_SUBSCRIBED_SYMBOLS = [
  'AAPL',
  'NVDA',
  'TSLA',
  'MSFT',
  'AMZN',
  'QQQ',
  'SPY',
  'DIA',
  'USO',
] as const;

export type LiveApiProvider = 'finnhub' | 'none';
export type LiveApiWsState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LiveApiConnectionStatus {
  state: LiveApiWsState;
  provider: LiveApiProvider;
  finnhubState: LiveApiWsState;
  subscribedSymbols: string[];
  lastTickAt: number | null;
  errorMessage?: string;
}

const DEFAULT_ETF_FUTURES_RATIOS: Record<string, number> = {
  'NQ1!': 41.5,
  'ES1!': 10.05,
  'YM1!': 100.2,
  'CL1!': 0.95,
};

const YAHOO_INTERVAL_MAP: Record<
  Timeframe,
  { interval: string; range: string; bucketSeconds: number; aggregate: boolean; maxDays: number }
> = {
  '1s': { interval: '1m', range: '7d', bucketSeconds: 60, aggregate: false, maxDays: 7 },
  '5s': { interval: '1m', range: '7d', bucketSeconds: 60, aggregate: false, maxDays: 7 },
  '15s': { interval: '1m', range: '7d', bucketSeconds: 60, aggregate: false, maxDays: 7 },
  '30s': { interval: '1m', range: '7d', bucketSeconds: 60, aggregate: false, maxDays: 7 },
  '1m': { interval: '1m', range: '7d', bucketSeconds: 60, aggregate: false, maxDays: 7 },
  '2m': { interval: '2m', range: '60d', bucketSeconds: 120, aggregate: false, maxDays: 59 },
  '3m': { interval: '1m', range: '7d', bucketSeconds: 180, aggregate: true, maxDays: 7 },
  '4m': { interval: '1m', range: '7d', bucketSeconds: 240, aggregate: true, maxDays: 7 },
  '5m': { interval: '5m', range: '60d', bucketSeconds: 300, aggregate: false, maxDays: 59 },
  '15m': { interval: '15m', range: '60d', bucketSeconds: 900, aggregate: false, maxDays: 59 },
  '30m': { interval: '30m', range: '60d', bucketSeconds: 1800, aggregate: false, maxDays: 59 },
  '1h': { interval: '60m', range: '6mo', bucketSeconds: 3600, aggregate: false, maxDays: 720 },
  '2h': { interval: '60m', range: '6mo', bucketSeconds: 7200, aggregate: true, maxDays: 720 },
  '3h': { interval: '60m', range: '6mo', bucketSeconds: 10800, aggregate: true, maxDays: 720 },
  '4h': { interval: '60m', range: '1y', bucketSeconds: 14400, aggregate: true, maxDays: 720 },
  '1d': { interval: '1d', range: '2y', bucketSeconds: 86400, aggregate: false, maxDays: 1800 },
  '1w': { interval: '1wk', range: '5y', bucketSeconds: 604800, aggregate: false, maxDays: 3650 },
  '1M': { interval: '1mo', range: '10y', bucketSeconds: 2592000, aggregate: false, maxDays: 7300 },
};

const TV_SUPPORTED_SYMBOLS = new Set([
  'NQ1!',
  'ES1!',
  'YM1!',
  'CL1!',
  'AAPL',
  'NVDA',
  'TSLA',
  'MSFT',
  'AMZN',
]);

const TV_INTERVAL_MAP: Record<
  Timeframe,
  { resolution: string; aggregateSec: number; count: number }
> = {
  '1s': { resolution: '1', aggregateSec: 0, count: 300 },
  '5s': { resolution: '1', aggregateSec: 0, count: 300 },
  '15s': { resolution: '1', aggregateSec: 0, count: 300 },
  '30s': { resolution: '1', aggregateSec: 0, count: 300 },
  '1m': { resolution: '1', aggregateSec: 0, count: 1500 },
  '2m': { resolution: '1', aggregateSec: 120, count: 1500 },
  '3m': { resolution: '3', aggregateSec: 0, count: 1500 },
  '4m': { resolution: '1', aggregateSec: 240, count: 1500 },
  '5m': { resolution: '5', aggregateSec: 0, count: 1500 },
  '15m': { resolution: '15', aggregateSec: 0, count: 1500 },
  '30m': { resolution: '30', aggregateSec: 0, count: 1500 },
  '1h': { resolution: '60', aggregateSec: 0, count: 1200 },
  '2h': { resolution: '120', aggregateSec: 0, count: 1000 },
  '3h': { resolution: '180', aggregateSec: 0, count: 900 },
  '4h': { resolution: '240', aggregateSec: 0, count: 800 },
  '1d': { resolution: '1D', aggregateSec: 0, count: 365 },
  '1w': { resolution: '1W', aggregateSec: 0, count: 260 },
  '1M': { resolution: '1M', aggregateSec: 0, count: 120 },
};

const CORS_PROXIES: Array<(targetUrl: string) => string> = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

export function getDecimalsForPrice(price: number): number {
  if (price >= 1000) return 2;
  if (price >= 10) return 2;
  if (price >= 1) return 3;
  if (price >= 0.01) return 5;
  return 8;
}

export function formatPrice(price: number): string {
  const decimals = getDecimalsForPrice(price);
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function roundToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function aggregateCandles(candles: Candle[], bucketSeconds: number): Candle[] {
  if (candles.length === 0 || bucketSeconds <= 1) return candles;
  const result: Candle[] = [];

  for (const c of candles) {
    const t = Number(c.time);
    const bucket = (t - (t % bucketSeconds)) as UTCTimestamp;
    const last = result[result.length - 1];
    if (!last || Number(last.time) !== Number(bucket)) {
      result.push({
        time: bucket,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      });
    } else {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    }
  }
  return result;
}

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function getDefaultHistoryCount(timeframe: Timeframe): number {
  const stepSec = TIMEFRAME_SECONDS[timeframe];
  if (stepSec < 60) return 300;
  if (timeframe === '1M') return 120;
  if (timeframe === '1w') return 260;
  if (timeframe === '1d') return 365;
  const thirtyDaysBars = Math.ceil((30 * 86400) / stepSec);
  if (stepSec >= 900) {
    return Math.min(2880, Math.max(1000, thirtyDaysBars));
  }
  return 1500;
}

function isSecondLevelTimeframe(timeframe: Timeframe): boolean {
  return TIMEFRAME_SECONDS[timeframe] < 60;
}

const clientCaptured1sBars = new Map<string, Candle[]>();
const MAX_CLIENT_CAPTURED_1S_BARS = 3600;

export function recordClient1sTick(
  symbol: string,
  price: number,
  timestampSec = Math.floor(Date.now() / 1000),
  volume = 1
): void {
  const upper = symbol.toUpperCase().trim();
  if (!upper || !Number.isFinite(price) || price <= 0) return;
  const tickSec = Math.floor(timestampSec);
  if (!Number.isFinite(tickSec) || tickSec <= 0) return;

  const list = clientCaptured1sBars.get(upper) ?? [];
  const last = list[list.length - 1];
  if (last && Number(last.time) === tickSec) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    last.volume += Math.max(0.01, volume);
  } else if (!last || tickSec > Number(last.time)) {
    const open =
      last && tickSec - Number(last.time) <= 10 ? last.close : price;
    list.push({
      time: tickSec as UTCTimestamp,
      open,
      high: Math.max(open, price),
      low: Math.min(open, price),
      close: price,
      volume: Math.max(0.01, volume),
    });
    if (list.length > MAX_CLIENT_CAPTURED_1S_BARS) {
      list.splice(0, list.length - MAX_CLIENT_CAPTURED_1S_BARS);
    }
    clientCaptured1sBars.set(upper, list);
  }
}

function getClientCapturedSecondBars(symbol: string, stepSec: number): Candle[] {
  const upper = symbol.toUpperCase().trim();
  const list = clientCaptured1sBars.get(upper);
  if (!list || list.length === 0) return [];
  return stepSec <= 1 ? list.map((b) => ({ ...b })) : aggregateCandles(list, stepSec);
}

async function fetchCapturedSecondBars(
  symbol: string,
  stepSec: number
): Promise<Candle[]> {
  const upper = symbol.toUpperCase().trim();
  const localBars = getClientCapturedSecondBars(upper, stepSec);
  let serverBars: Candle[] = [];

  if (TV_SUPPORTED_SYMBOLS.has(upper)) {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 3000);
      const res = await fetch(
        `/api/market/tv/seconds?symbol=${encodeURIComponent(upper)}&step=${stepSec}`,
        { signal: controller.signal }
      );
      window.clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.bars)) {
          serverBars = data.bars
            .map((b: Record<string, unknown>) => ({
              time: Number(b.time) as UTCTimestamp,
              open: Number(b.open),
              high: Number(b.high),
              low: Number(b.low),
              close: Number(b.close),
              volume: Number(b.volume ?? 1),
            }))
            .filter(
              (b: Candle) =>
                Number.isFinite(Number(b.time)) &&
                Number.isFinite(b.open) &&
                Number.isFinite(b.high) &&
                Number.isFinite(b.low) &&
                Number.isFinite(b.close) &&
                b.close > 0
            );
        }
      }
    } catch {
      // Ignore transient /api/market/tv/seconds failure
    }
  }

  if (serverBars.length === 0) return localBars;
  if (localBars.length === 0) return serverBars;

  const byTime = new Map<number, Candle>();
  for (const b of serverBars) {
    byTime.set(Number(b.time), { ...b });
  }
  for (const b of localBars) {
    const t = Number(b.time);
    const existing = byTime.get(t);
    if (!existing) {
      byTime.set(t, { ...b });
    } else {
      existing.high = Math.max(existing.high, b.high);
      existing.low = Math.min(existing.low, b.low);
      existing.close = b.close;
      existing.volume = Math.max(existing.volume, b.volume);
    }
  }
  return Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

function decomposeMinuteCandleIntoSecondSlots(
  minStartSec: number,
  stepSec: number,
  openVal: number,
  highVal: number,
  lowVal: number,
  closeVal: number,
  totalVolume: number,
  totalSlots: number,
  emitSlots: number,
  decimals: number
): Candle[] {
  const O = roundToDecimals(openVal, decimals);
  const C = roundToDecimals(closeVal, decimals);
  const H = roundToDecimals(Math.max(highVal, O, C), decimals);
  const L = roundToDecimals(Math.min(lowVal, O, C), decimals);
  const range = Math.max(0, H - L);
  const perSlotVol = Math.max(1, Math.round(totalVolume / Math.max(1, totalSlots)));
  const count = Math.max(1, Math.min(totalSlots, emitSlots));

  if (count === 1) {
    return [
      {
        time: minStartSec as UTCTimestamp,
        open: O,
        high: H,
        low: L,
        close: C,
        volume: perSlotVol,
      },
    ];
  }

  if (count === 2) {
    const mid = roundToDecimals(Math.min(H, Math.max(L, O + (C - O) * 0.45)), decimals);
    if (C >= O) {
      return [
        {
          time: minStartSec as UTCTimestamp,
          open: O,
          high: roundToDecimals(Math.max(O, mid), decimals),
          low: L,
          close: mid,
          volume: perSlotVol,
        },
        {
          time: (minStartSec + stepSec) as UTCTimestamp,
          open: mid,
          high: H,
          low: roundToDecimals(Math.min(mid, C), decimals),
          close: C,
          volume: perSlotVol,
        },
      ];
    }
    return [
      {
        time: minStartSec as UTCTimestamp,
        open: O,
        high: H,
        low: roundToDecimals(Math.min(O, mid), decimals),
        close: mid,
        volume: perSlotVol,
      },
      {
        time: (minStartSec + stepSec) as UTCTimestamp,
        open: mid,
        high: roundToDecimals(Math.max(mid, C), decimals),
        low: L,
        close: C,
        volume: perSlotVol,
      },
    ];
  }

  const bullish = C >= O;
  const ext1 = bullish ? L : H;
  const ext2 = bullish ? H : L;
  const w1 = Math.max(1, Math.min(count - 2, Math.round(count * 0.3)));
  const w2 = Math.max(w1 + 1, Math.min(count - 1, Math.round(count * 0.72)));

  const ext1BodyRaw = bullish
    ? L + (Math.min(O, C) - L) * 0.25
    : H - (H - Math.max(O, C)) * 0.25;
  const ext2BodyRaw = bullish
    ? H - (H - Math.max(O, C)) * 0.25
    : L + (Math.min(O, C) - L) * 0.25;
  const ext1Body = Math.min(H, Math.max(L, ext1BodyRaw));
  const ext2Body = Math.min(H, Math.max(L, ext2BodyRaw));

  const anchorCloses: number[] = new Array(count + 1);
  anchorCloses[0] = O;
  anchorCloses[count] = C;

  const interp = (idx: number, aIdx: number, bIdx: number, aVal: number, bVal: number) => {
    const t = (idx - aIdx) / Math.max(1, bIdx - aIdx);
    const base = aVal + (bVal - aVal) * t;
    const harmonic =
      idx === aIdx || idx === bIdx
        ? 0
        : Math.sin((idx + (minStartSec % 97)) * 1.618) * range * 0.06;
    return roundToDecimals(Math.min(H, Math.max(L, base + harmonic)), decimals);
  };

  for (let k = 1; k < count; k++) {
    if (k === w1) {
      anchorCloses[k] = roundToDecimals(ext1Body, decimals);
    } else if (k === w2) {
      anchorCloses[k] = roundToDecimals(ext2Body, decimals);
    } else if (k < w1) {
      anchorCloses[k] = interp(k, 0, w1, O, ext1Body);
    } else if (k < w2) {
      anchorCloses[k] = interp(k, w1, w2, ext1Body, ext2Body);
    } else {
      anchorCloses[k] = interp(k, w2, count, ext2Body, C);
    }
  }

  const out: Candle[] = [];
  for (let j = 0; j < count; j++) {
    const o = anchorCloses[j];
    const c = anchorCloses[j + 1];
    const wickPad = roundToDecimals(range * 0.05 * (j % 3 === 0 ? 1 : 0.4), decimals);
    let h = roundToDecimals(Math.min(H, Math.max(o, c) + wickPad), decimals);
    let l = roundToDecimals(Math.max(L, Math.min(o, c) - wickPad), decimals);

    if (j === w1 - 1) {
      if (ext1 === L) l = L;
      else h = H;
    }
    if (j === w2 - 1) {
      if (ext2 === H) h = H;
      else l = L;
    }

    out.push({
      time: (minStartSec + j * stepSec) as UTCTimestamp,
      open: o,
      high: roundToDecimals(Math.max(h, o, c), decimals),
      low: roundToDecimals(Math.min(l, o, c), decimals),
      close: c,
      volume: perSlotVol,
    });
  }

  return out;
}

function buildSecondLevelSeriesFromMinuteCandles(
  symbol: string,
  timeframe: Timeframe,
  minuteCandles: Candle[],
  targetLivePrice?: number,
  barCount = 300,
  endTimeSec?: number,
  capturedSecondBars?: Candle[]
): Candle[] {
  const stepSec = TIMEFRAME_SECONDS[timeframe];
  const slotsPerMin = Math.max(1, Math.round(60 / stepSec));
  const upper = symbol.toUpperCase();

  const byMinTime = new Map<number, Candle>();
  for (const m of minuteCandles) {
    const t = Number(m.time);
    const minBucket = t - (t % 60);
    if (!Number.isFinite(minBucket) || m.close <= 0) continue;
    const prev = byMinTime.get(minBucket);
    if (!prev) {
      byMinTime.set(minBucket, {
        time: minBucket as UTCTimestamp,
        open: m.open,
        high: Math.max(m.high, m.open, m.close),
        low: Math.min(m.low, m.open, m.close),
        close: m.close,
        volume: Math.max(0, m.volume),
      });
    } else {
      prev.high = Math.max(prev.high, m.high, m.open, m.close);
      prev.low = Math.min(prev.low, m.low, m.open, m.close);
      prev.close = m.close;
      prev.volume = Math.max(prev.volume, m.volume);
    }
  }

  const sortedMins = Array.from(byMinTime.values()).sort(
    (a, b) => Number(a.time) - Number(b.time)
  );
  const lastMinute = sortedMins.length > 0 ? sortedMins[sortedMins.length - 1] : null;
  const liveClose =
    targetLivePrice !== undefined && Number.isFinite(targetLivePrice) && targetLivePrice > 0
      ? targetLivePrice
      : lastMinute?.close ?? BASE_PRICES[upper] ?? 100;
  const decimals = getDecimalsForPrice(liveClose);

  const nowSec = endTimeSec ?? Math.floor(Date.now() / 1000);
  let alignedEnd = nowSec - (nowSec % stepSec);

  // When market is closed and no replay endTimeSec was supplied, anchor to last active session minute
  if (
    endTimeSec === undefined &&
    lastMinute &&
    alignedEnd - Number(lastMinute.time) > 120 &&
    !getMarketStatus(upper).isOpen
  ) {
    alignedEnd = Number(lastMinute.time) + 60 - stepSec;
  }

  const startSec = alignedEnd - (barCount - 1) * stepSec;
  const firstMinStart = startSec - (startSec % 60);
  const lastMinStart = alignedEnd - (alignedEnd % 60);

  let carryPrice =
    sortedMins.find((m) => Number(m.time) >= firstMinStart)?.open ??
    lastMinute?.close ??
    liveClose;
  if (sortedMins.length > 0) {
    for (let idx = sortedMins.length - 1; idx >= 0; idx--) {
      if (Number(sortedMins[idx].time) < firstMinStart) {
        carryPrice = sortedMins[idx].close;
        break;
      }
    }
  }

  const rawSlots: Candle[] = [];
  for (let minStart = firstMinStart; minStart <= lastMinStart; minStart += 60) {
    const minCandle = byMinTime.get(minStart);
    const isActiveTrailingMin = minStart === lastMinStart;
    const elapsedSlots = isActiveTrailingMin
      ? Math.max(1, Math.min(slotsPerMin, Math.floor((alignedEnd - minStart) / stepSec) + 1))
      : slotsPerMin;

    if (minCandle) {
      const targetClose =
        isActiveTrailingMin && endTimeSec === undefined ? liveClose : minCandle.close;
      const decomposed = decomposeMinuteCandleIntoSecondSlots(
        minStart,
        stepSec,
        minCandle.open,
        Math.max(minCandle.high, targetClose),
        Math.min(minCandle.low, targetClose),
        targetClose,
        minCandle.volume,
        slotsPerMin,
        elapsedSlots,
        decimals
      );
      for (const bar of decomposed) {
        rawSlots.push(bar);
      }
      carryPrice = targetClose;
    } else {
      const targetClose =
        isActiveTrailingMin && endTimeSec === undefined
          ? liveClose
          : minStart > (lastMinute ? Number(lastMinute.time) : 0)
          ? liveClose
          : carryPrice;
      const flat = decomposeMinuteCandleIntoSecondSlots(
        minStart,
        stepSec,
        carryPrice,
        Math.max(carryPrice, targetClose),
        Math.min(carryPrice, targetClose),
        targetClose,
        0,
        slotsPerMin,
        elapsedSlots,
        decimals
      );
      for (const bar of flat) {
        rawSlots.push(bar);
      }
      carryPrice = targetClose;
    }
  }

  let result = rawSlots
    .filter((b) => Number(b.time) >= startSec && Number(b.time) <= alignedEnd)
    .slice(-barCount);

  // Splice authentic live-captured second bars (TradingView WS / Finnhub WS / SSE ticks)
  if (endTimeSec === undefined && capturedSecondBars && capturedSecondBars.length > 0) {
    const capMap = new Map<number, Candle>();
    for (const c of capturedSecondBars) {
      const bucket = Number(c.time) - (Number(c.time) % stepSec);
      const prev = capMap.get(bucket);
      if (!prev) {
        capMap.set(bucket, {
          time: bucket as UTCTimestamp,
          open: roundToDecimals(c.open, decimals),
          high: roundToDecimals(Math.max(c.high, c.open, c.close), decimals),
          low: roundToDecimals(Math.min(c.low, c.open, c.close), decimals),
          close: roundToDecimals(c.close, decimals),
          volume: c.volume,
        });
      } else {
        prev.high = roundToDecimals(Math.max(prev.high, c.high, c.close), decimals);
        prev.low = roundToDecimals(Math.min(prev.low, c.low, c.close), decimals);
        prev.close = roundToDecimals(c.close, decimals);
        prev.volume += c.volume;
      }
    }

    result = result.map((slot) => {
      const realBar = capMap.get(Number(slot.time));
      return realBar ?? slot;
    });
  }

  if (result.length > 0 && endTimeSec === undefined && getMarketStatus(upper).isOpen) {
    const last = result[result.length - 1];
    const finalClose = roundToDecimals(liveClose, decimals);
    last.close = finalClose;
    last.high = roundToDecimals(Math.max(last.high, last.open, finalClose), decimals);
    last.low = roundToDecimals(Math.min(last.low, last.open, finalClose), decimals);
  }

  return sanitizeCandleSeries(result);
}

export function sanitizeCandleSeries(rawCandles: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of rawCandles) {
    const t = Math.floor(Number(c.time));
    if (
      !Number.isFinite(t) ||
      t <= 0 ||
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.close) ||
      c.open <= 0 ||
      c.close <= 0
    ) {
      continue;
    }
    const hRaw = Number.isFinite(c.high) ? c.high : Math.max(c.open, c.close);
    const lRaw = Number.isFinite(c.low) ? c.low : Math.min(c.open, c.close);
    byTime.set(t, {
      time: t as UTCTimestamp,
      open: c.open,
      high: Math.max(hRaw, c.open, c.close),
      low: Math.min(lRaw, c.open, c.close),
      close: c.close,
      volume: Number.isFinite(c.volume) && c.volume >= 0 ? c.volume : 0,
    });
  }
  return Array.from(byTime.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

function getMacroAnchorPrice(basePrice: number, seed: number, tsSec: number): number {
  const dayPhase = tsSec / 86400;
  const wave1 = Math.sin(dayPhase * 0.34 + (seed % 19)) * 0.018;
  const wave2 = Math.cos(dayPhase * 0.92 + (seed % 7)) * 0.009;
  return basePrice * (1 + wave1 + wave2);
}

type MarketRegime =
  | 'consolidation'
  | 'impulse_up'
  | 'pullback_down'
  | 'impulse_down'
  | 'pullback_up';

/**
 * Realistic Market Structure Generator:
 * - Tight institutional 1m volatility (0.015% - 0.06%), scaling naturally by sqrt(timeframe)
 * - Structured consolidation ranges, impulse legs, and orderly pullbacks
 * - Small proportional wicks (zero giant spiky random needles)
 * - Exact close price anchoring at Friday close / target market price
 */
export function generateSimulatedCandles(
  symbol: string,
  timeframe: Timeframe,
  count?: number,
  endTimeSec?: number
): Candle[] {
  const stepSec = TIMEFRAME_SECONDS[timeframe];
  const barCount = Math.max(10, count ?? getDefaultHistoryCount(timeframe));
  const nowSec = endTimeSec ?? Math.floor(Date.now() / 1000);
  const alignedEnd = nowSec - (nowSec % stepSec);
  const upper = symbol.toUpperCase();
  const basePrice = BASE_PRICES[upper] ?? 100;
  const decimals = getDecimalsForPrice(basePrice);

  let seed = 0;
  for (let i = 0; i < upper.length; i++) {
    seed += upper.charCodeAt(i) * (i + 17);
  }
  const startTimeSec = alignedEnd - (barCount - 1) * stepSec;
  const rand = seededRandom(Math.abs(seed * 31 + stepSec * 13) + 7);

  // Tight 1m baseline volatility (0.015% - 0.06%) scaled by sqrt(timeframe / 1m)
  const base1mVol = BASE_1M_VOLATILITY[upper] ?? 0.00028;
  const tfMultiplier = Math.sqrt(stepSec / 60);
  const barVol = base1mVol * tfMultiplier;

  // Target final close: exact market anchor when current, macro historical anchor if back-scrolled
  const targetClose =
    endTimeSec !== undefined
      ? roundToDecimals(getMacroAnchorPrice(basePrice, seed, alignedEnd), decimals)
      : basePrice;

  // Initial offset so multi-day structure flows naturally toward targetClose
  const macroOffset = ((rand() - 0.48) * 1.4) * barVol * Math.sqrt(barCount * 0.25);
  let price = targetClose * (1 - macroOffset);

  let regime: MarketRegime = 'impulse_up';
  let regimeBarsLeft = 3 + Math.floor(rand() * 5); // 3 to 7 consecutive trend bars
  let rangeMid = price;
  let lastTrendDir: 1 | -1 = rand() > 0.45 ? 1 : -1;

  const pickNextRegime = (prev: MarketRegime): MarketRegime => {
    const r = rand();
    if (prev === 'consolidation') {
      lastTrendDir = r < 0.54 ? 1 : -1;
      regimeBarsLeft = 3 + Math.floor(rand() * 5); // 3 to 7 bars
      return lastTrendDir === 1 ? 'impulse_up' : 'impulse_down';
    }
    if (prev === 'impulse_up') {
      if (r < 0.72) {
        regimeBarsLeft = 3 + Math.floor(rand() * 3); // 3 to 5 pullback bars
        return 'pullback_down';
      }
      rangeMid = price;
      regimeBarsLeft = 4 + Math.floor(rand() * 5);
      return 'consolidation';
    }
    if (prev === 'impulse_down') {
      if (r < 0.72) {
        regimeBarsLeft = 3 + Math.floor(rand() * 3); // 3 to 5 pullback bars
        return 'pullback_up';
      }
      rangeMid = price;
      regimeBarsLeft = 4 + Math.floor(rand() * 5);
      return 'consolidation';
    }
    if (prev === 'pullback_down') {
      if (r < 0.76) {
        regimeBarsLeft = 3 + Math.floor(rand() * 5); // 3 to 7 impulse bars
        return 'impulse_up';
      }
      rangeMid = price;
      regimeBarsLeft = 4 + Math.floor(rand() * 5);
      return 'consolidation';
    }
    // pullback_up
    if (r < 0.76) {
      regimeBarsLeft = 3 + Math.floor(rand() * 5); // 3 to 7 impulse bars
      return 'impulse_down';
    }
    rangeMid = price;
    regimeBarsLeft = 4 + Math.floor(rand() * 5);
    return 'consolidation';
  };

  interface RawBar {
    time: UTCTimestamp;
    open: number;
    close: number;
    upperWick: number;
    lowerWick: number;
    volume: number;
  }

  const rawBars: RawBar[] = [];
  let microDir: 1 | -1 = lastTrendDir;
  let microDirLeft = 3 + Math.floor(rand() * 4);

  for (let i = 0; i < barCount; i++) {
    const time = (startTimeSec + i * stepSec) as UTCTimestamp;

    if (regimeBarsLeft <= 0) {
      regime = pickNextRegime(regime);
    }
    regimeBarsLeft--;
    const isSwingTurn = regimeBarsLeft === 0;

    // Keep final ~6 bars calm so price glides smoothly into exact targetClose
    const isFinalApproach = i >= barCount - 6;
    const expectedStep = price * barVol;

    let bodyMove = 0;
    if (regime === 'consolidation' || isFinalApproach) {
      if (microDirLeft <= 0) {
        microDir = microDir === 1 ? -1 : 1;
        microDirLeft = 3 + Math.floor(rand() * 3);
      }
      microDirLeft--;
      const meanRev = ((rangeMid - price) / Math.max(1e-6, price)) * 0.1 * price;
      const mag = (0.28 + rand() * 0.42) * expectedStep;
      bodyMove = microDir * mag + meanRev * 0.25;
    } else if (regime === 'impulse_up') {
      // Strong momentum persistence (3-7 bullish bars cleanly trending before pullback)
      const keepTrend = rand() < 0.92;
      const mag = (0.42 + rand() * 0.68) * expectedStep;
      bodyMove = keepTrend ? mag : -mag * 0.35;
    } else if (regime === 'impulse_down') {
      const keepTrend = rand() < 0.92;
      const mag = (0.42 + rand() * 0.68) * expectedStep;
      bodyMove = keepTrend ? -mag : mag * 0.35;
    } else if (regime === 'pullback_down') {
      const keepPull = rand() < 0.88;
      const mag = (0.26 + rand() * 0.44) * expectedStep;
      bodyMove = keepPull ? -mag : mag * 0.35;
    } else {
      const keepPull = rand() < 0.88;
      const mag = (0.26 + rand() * 0.44) * expectedStep;
      bodyMove = keepPull ? mag : -mag * 0.35;
    }

    const open = price;
    const close = Math.max(price * 0.25, open + bodyMove);
    const absBody = Math.abs(close - open);

    // Tight proportional wicks: 15% to 40% of body height, with small rejection wicks at swing highs/lows
    const wickRatioUp = isSwingTurn && bodyMove > 0 ? 0.35 + rand() * 0.35 : 0.15 + rand() * 0.25;
    const wickRatioDn = isSwingTurn && bodyMove < 0 ? 0.35 + rand() * 0.35 : 0.15 + rand() * 0.25;
    const minWick = expectedStep * 0.08;
    const upperWick = Math.min(expectedStep * 0.55, Math.max(minWick, absBody * wickRatioUp));
    const lowerWick = Math.min(expectedStep * 0.55, Math.max(minWick, absBody * wickRatioDn));

    const isImpulse = regime === 'impulse_up' || regime === 'impulse_down';
    const baseVolUnits = basePrice > 1000 ? 120 : 1800;
    const volume =
      baseVolUnits * (isImpulse ? 1.25 + rand() * 1.15 : 0.45 + rand() * 0.85);

    rawBars.push({ time, open, close, upperWick, lowerWick, volume });
    price = close;
  }

  // Smooth linear drift bridge so the series maintains exact continuity and closes at targetClose
  const rawLastClose = rawBars[rawBars.length - 1].close;
  const totalResidual = targetClose - rawLastClose;

  const candles: Candle[] = rawBars.map((b, i) => {
    const shiftOpen = (i / barCount) * totalResidual;
    const shiftClose = ((i + 1) / barCount) * totalResidual;
    const adjOpen = roundToDecimals(b.open + shiftOpen, decimals);
    const adjClose =
      i === barCount - 1
        ? targetClose
        : roundToDecimals(b.close + shiftClose, decimals);
    const bodyTop = Math.max(adjOpen, adjClose);
    const bodyBottom = Math.min(adjOpen, adjClose);
    const high = roundToDecimals(bodyTop + b.upperWick, decimals);
    const low = roundToDecimals(Math.max(bodyBottom * 0.2, bodyBottom - b.lowerWick), decimals);

    return {
      time: b.time,
      open: adjOpen,
      high,
      low,
      close: adjClose,
      volume: Math.round(b.volume),
    };
  });

  // Guarantee seamless open[i] === close[i - 1] & strict high/low envelope
  for (let i = 1; i < candles.length; i++) {
    candles[i].open = candles[i - 1].close;
    candles[i].high = Math.max(candles[i].high, candles[i].open, candles[i].close);
    candles[i].low = Math.min(candles[i].low, candles[i].open, candles[i].close);
  }
  const last = candles[candles.length - 1];
  last.close = targetClose;
  last.high = Math.max(last.high, last.open, last.close);
  last.low = Math.min(last.low, last.open, last.close);

  return candles;
}

function parseCryptoPair(symbol: string): { fsym: string; tsym: string } {
  const upper = symbol.toUpperCase();
  for (const quote of ['USDT', 'USDC', 'BUSD', 'USD', 'BTC', 'ETH']) {
    if (upper.endsWith(quote) && upper.length > quote.length) {
      return {
        fsym: upper.slice(0, upper.length - quote.length),
        tsym: quote,
      };
    }
  }
  return { fsym: upper, tsym: 'USDT' };
}

async function fetchBinanceKlinesBatch(
  symbol: string,
  interval: string,
  limit: number,
  endTimeMs?: number
): Promise<Candle[] | null> {
  for (const base of REST_BASES) {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 5000);
      const endParam = endTimeMs ? `&endTime=${endTimeMs}` : '';
      const url = `${base}/api/v3/klines?symbol=${encodeURIComponent(
        symbol.toUpperCase()
      )}&interval=${interval}&limit=${limit}${endParam}`;
      const res = await fetch(url, { signal: controller.signal });
      window.clearTimeout(timer);
      if (!res.ok) continue;
      const raw = (await res.json()) as Array<
        [number, string, string, string, string, string, ...unknown[]]
      >;
      if (!Array.isArray(raw) || raw.length === 0) continue;

      return raw.map((k) => ({
        time: Math.floor(k[0] / 1000) as UTCTimestamp,
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
    } catch {
      // Try next mirror
    }
  }
  return null;
}

async function fetchBinanceMultiBatch(
  symbol: string,
  timeframe: Timeframe,
  endTimeSec?: number
): Promise<Candle[] | null> {
  const src = BINANCE_INTERVAL_MAP[timeframe];
  let merged: Candle[] | null = await fetchBinanceKlinesBatch(
    symbol,
    src.baseInterval,
    src.limit,
    endTimeSec ? endTimeSec * 1000 : undefined
  );

  for (let b = 1; b < src.batches; b++) {
    if (!merged || merged.length === 0) break;
    const oldestMs = Number(merged[0].time) * 1000 - 1;
    const older = await fetchBinanceKlinesBatch(
      symbol,
      src.baseInterval,
      src.limit,
      oldestMs
    );
    if (!older || older.length === 0) break;
    merged = [...older, ...merged];
  }

  if (!merged || merged.length === 0) return null;
  const cleanMerged = sanitizeCandleSeries(merged);
  return src.aggregate ? aggregateCandles(cleanMerged, src.bucketSeconds) : cleanMerged;
}

async function fetchCryptoCompareCandles(
  symbol: string,
  timeframe: Timeframe,
  endTimeSec?: number
): Promise<Candle[] | null> {
  const { fsym, tsym } = parseCryptoPair(symbol);
  const cfg = CRYPTOCOMPARE_INTERVAL_MAP[timeframe];
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6500);
    const toTsParam = endTimeSec ? `&toTs=${endTimeSec}` : '';
    const url = `${CRYPTOCOMPARE_REST}/v2/${cfg.endpoint}?fsym=${encodeURIComponent(
      fsym
    )}&tsym=${encodeURIComponent(tsym)}&limit=${cfg.limit}&aggregate=${cfg.aggregate}${toTsParam}`;
    const res = await fetch(url, { signal: controller.signal });
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const rows = json?.Data?.Data;
    if (json?.Response !== 'Success' || !Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    const candles: Candle[] = sanitizeCandleSeries(
      rows
        .filter((r: Record<string, number>) => r && r.close > 0 && r.open > 0)
        .map((r: Record<string, number>) => ({
          time: r.time as UTCTimestamp,
          open: r.open,
          high: r.high,
          low: r.low,
          close: r.close,
          volume: r.volumeto ?? r.volumefrom ?? 0,
        }))
    );

    if (candles.length === 0) return null;
    if (isSecondLevelTimeframe(timeframe)) {
      const captured =
        endTimeSec === undefined
          ? getClientCapturedSecondBars(symbol, TIMEFRAME_SECONDS[timeframe])
          : undefined;
      return buildSecondLevelSeriesFromMinuteCandles(
        symbol,
        timeframe,
        candles,
        candles[candles.length - 1].close,
        300,
        endTimeSec,
        captured
      );
    }
    return candles;
  } catch {
    return null;
  }
}

export function resolveFinnhubSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  const meta = SYMBOL_CATALOG.find((s) => s.symbol === upper);
  return meta?.finnhubSymbol ?? upper;
}

const futuresEtfScaleCache = new Map<
  string,
  { factor: number; updatedAt: number; futuresRefPrice: number; etfRefPrice: number }
>();

const hubTradePrices = new Map<string, { price: number; timestampSec: number; prevPrice?: number }>();
const apiStatusListeners = new Set<(status: LiveApiConnectionStatus) => void>();
const apiTickListeners = new Map<
  string,
  Set<(mappedPrice: number, timestampSec: number) => void>
>();

export interface HistoricalCandlesResult {
  candles: Candle[];
  simulated: boolean;
}

let hubFinnhubKey = '';
let hubFinnhubWs: WebSocket | null = null;
let hubFinnhubState: LiveApiWsState = 'disconnected';
let hubFinnhubError: string | undefined;
let hubFinnhubReconnectTimer: number | null = null;
let hubFinnhubDebounceTimer: number | null = null;
let hubFinnhubSeededFactors = false;
let hubLastTickAt: number | null = null;

function computeAggregatedApiStatus(): LiveApiConnectionStatus {
  const fhActive = hubFinnhubKey.length > 4;
  const provider: LiveApiProvider = fhActive ? 'finnhub' : 'none';
  const state: LiveApiWsState = fhActive ? hubFinnhubState : 'disconnected';
  const errorMessage = fhActive ? hubFinnhubError : undefined;

  return {
    state,
    provider,
    finnhubState: state,
    subscribedSymbols:
      state === 'connected' ? [...LIVE_API_SUBSCRIBED_SYMBOLS] : [],
    lastTickAt: hubLastTickAt,
    errorMessage,
  };
}

function notifyApiStatusListeners() {
  const snap = computeAggregatedApiStatus();
  for (const cb of apiStatusListeners) {
    try {
      cb(snap);
    } catch {
      // Ignore subscriber error
    }
  }
}

export function getLiveApiStatus(): LiveApiConnectionStatus {
  return computeAggregatedApiStatus();
}

export function subscribeLiveApiStatus(
  listener: (status: LiveApiConnectionStatus) => void
): () => void {
  apiStatusListeners.add(listener);
  listener(computeAggregatedApiStatus());
  return () => {
    apiStatusListeners.delete(listener);
  };
}

function getScaledEtfPriceForFutures(futuresSym: string, etfPrice: number): number {
  const cached = futuresEtfScaleCache.get(futuresSym);
  const factor = cached?.factor ?? DEFAULT_ETF_FUTURES_RATIOS[futuresSym] ?? 1;
  return roundToDecimals(etfPrice * factor, getDecimalsForPrice(etfPrice * factor));
}

async function seedAllFuturesScaleFactors() {
  if (hubFinnhubSeededFactors) return;
  hubFinnhubSeededFactors = true;
  try {
    const quotes = await fetchRealtimeQuotes([
      'NQ1!',
      'ES1!',
      'YM1!',
      'CL1!',
      'QQQ',
      'SPY',
      'DIA',
      'USO',
    ]);
    if (!quotes) return;
    for (const [futSym, etfSym] of Object.entries(FUTURES_ETF_PROXY_MAP)) {
      const fq = quotes[futSym];
      const eq = quotes[etfSym];
      if (fq && eq && fq.price > 0 && eq.price > 0) {
        futuresEtfScaleCache.set(futSym, {
          factor: fq.price / eq.price,
          updatedAt: Date.now(),
          futuresRefPrice: fq.price,
          etfRefPrice: eq.price,
        });
      }
    }
  } catch {
    // Allow retry next time
    hubFinnhubSeededFactors = false;
  }
}

function dispatchHubTrade(rawSymbol: string, rawPrice: number, timestampSec: number) {
  const sym = rawSymbol.toUpperCase().trim();
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return;

  const isFirstTick = hubLastTickAt === null;
  hubLastTickAt = Date.now();
  const prevRaw = hubTradePrices.get(sym);
  hubTradePrices.set(sym, {
    price: rawPrice,
    timestampSec,
    prevPrice: prevRaw?.price,
  });
  recordClient1sTick(sym, rawPrice, timestampSec, 1);

  const directListeners = apiTickListeners.get(sym);
  if (directListeners && directListeners.size > 0) {
    for (const cb of directListeners) {
      cb(rawPrice, timestampSec);
    }
  }

  const mappedFut = ETF_TO_FUTURES_MAP[sym];
  if (mappedFut) {
    const scaled = getScaledEtfPriceForFutures(mappedFut, rawPrice);
    const prevFut = hubTradePrices.get(mappedFut);
    hubTradePrices.set(mappedFut, {
      price: scaled,
      timestampSec,
      prevPrice: prevFut?.price,
    });
    recordClient1sTick(mappedFut, scaled, timestampSec, 1);

    const futListeners = apiTickListeners.get(mappedFut);
    if (futListeners && futListeners.size > 0) {
      for (const cb of futListeners) {
        cb(scaled, timestampSec);
      }
    }
  }

  if (isFirstTick) {
    notifyApiStatusListeners();
  }
}

function teardownFinnhubHubWs() {
  if (hubFinnhubReconnectTimer !== null) {
    window.clearTimeout(hubFinnhubReconnectTimer);
    hubFinnhubReconnectTimer = null;
  }
  if (hubFinnhubWs) {
    hubFinnhubWs.onopen = null;
    hubFinnhubWs.onmessage = null;
    hubFinnhubWs.onerror = null;
    hubFinnhubWs.onclose = null;
    if (
      hubFinnhubWs.readyState === WebSocket.OPEN ||
      hubFinnhubWs.readyState === WebSocket.CONNECTING
    ) {
      hubFinnhubWs.close();
    }
    hubFinnhubWs = null;
  }
}

function connectFinnhubHubWs(apiKey: string) {
  teardownFinnhubHubWs();
  if (!apiKey || apiKey.length <= 4) {
    hubFinnhubState = 'disconnected';
    hubFinnhubError = undefined;
    notifyApiStatusListeners();
    return;
  }

  hubFinnhubState = 'connecting';
  hubFinnhubError = undefined;
  notifyApiStatusListeners();

  let ws: WebSocket;
  try {
    ws = new WebSocket(`${FINNHUB_WS}?token=${encodeURIComponent(apiKey)}`);
  } catch {
    hubFinnhubState = 'error';
    hubFinnhubError = 'Failed to open Finnhub WebSocket';
    notifyApiStatusListeners();
    return;
  }

  hubFinnhubWs = ws;
  let openedAt = 0;

  ws.onopen = () => {
    if (hubFinnhubWs !== ws) return;
    openedAt = Date.now();
    hubFinnhubState = 'connected';
    hubFinnhubError = undefined;
    for (const sym of LIVE_API_SUBSCRIBED_SYMBOLS) {
      ws.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
    }
    void seedAllFuturesScaleFactors();
    notifyApiStatusListeners();
  };

  ws.onmessage = (evt) => {
    if (hubFinnhubWs !== ws) return;
    try {
      const msg = JSON.parse(evt.data as string);
      if (msg.type === 'error') {
        hubFinnhubState = 'error';
        hubFinnhubError = typeof msg.msg === 'string' ? msg.msg : 'Finnhub subscription error';
        notifyApiStatusListeners();
        return;
      }
      if (msg.type === 'trade' && Array.isArray(msg.data) && msg.data.length > 0) {
        if (hubFinnhubState !== 'connected') {
          hubFinnhubState = 'connected';
          hubFinnhubError = undefined;
          notifyApiStatusListeners();
        }
        for (const item of msg.data) {
          const sym = typeof item.s === 'string' ? item.s : '';
          const price = typeof item.p === 'number' ? item.p : NaN;
          const tsSec =
            typeof item.t === 'number'
              ? Math.floor(item.t / 1000)
              : Math.floor(Date.now() / 1000);
          if (sym && Number.isFinite(price) && price > 0) {
            dispatchHubTrade(sym, price, tsSec);
          }
        }
      }
    } catch {
      // Ignore malformed frame
    }
  };

  ws.onerror = () => {
    if (hubFinnhubWs !== ws) return;
    hubFinnhubState = 'error';
    hubFinnhubError = 'Check Finnhub API key';
    notifyApiStatusListeners();
  };

  ws.onclose = (evt) => {
    if (hubFinnhubWs !== ws) return;
    hubFinnhubWs = null;
    const rapidClose = openedAt === 0 || Date.now() - openedAt < 2500;
    if (evt.code === 1008 || evt.code === 4001 || evt.code === 4003 || rapidClose) {
      hubFinnhubState = 'error';
      hubFinnhubError =
        evt.reason || (openedAt === 0 ? 'Finnhub rejected API key' : 'Finnhub connection closed');
      notifyApiStatusListeners();
      return;
    }
    hubFinnhubState = 'connecting';
    notifyApiStatusListeners();
    hubFinnhubReconnectTimer = window.setTimeout(() => {
      if (hubFinnhubKey === apiKey) {
        connectFinnhubHubWs(apiKey);
      }
    }, 3500);
  };
}

export function syncLiveApiCredentials(finnhubApiKey?: string) {
  const nextFh = (finnhubApiKey ?? '').trim();

  if (nextFh !== hubFinnhubKey) {
    hubFinnhubKey = nextFh;
    if (hubFinnhubDebounceTimer !== null) {
      window.clearTimeout(hubFinnhubDebounceTimer);
      hubFinnhubDebounceTimer = null;
    }
    if (nextFh.length <= 4) {
      teardownFinnhubHubWs();
      hubFinnhubState = 'disconnected';
      hubFinnhubError = undefined;
      notifyApiStatusListeners();
    } else {
      hubFinnhubState = 'connecting';
      hubFinnhubError = undefined;
      notifyApiStatusListeners();
      hubFinnhubDebounceTimer = window.setTimeout(() => {
        connectFinnhubHubWs(nextFh);
      }, 220);
    }
  }
}

async function resolveFuturesScaleFactor(
  futuresSym: string,
  etfSym: string,
  etfCandles?: Candle[]
): Promise<number> {
  const cached = futuresEtfScaleCache.get(futuresSym);
  if (cached && Date.now() - cached.updatedAt < 60_000) {
    return cached.factor;
  }

  const defaultRatio = DEFAULT_ETF_FUTURES_RATIOS[futuresSym] ?? 1;
  const rtQuotes = await fetchRealtimeQuotes([futuresSym, etfSym]);
  const futQuote = rtQuotes?.[futuresSym];
  const etfQuote = rtQuotes?.[etfSym];

  const etfRefPrice =
    etfQuote && etfQuote.price > 0
      ? etfQuote.price
      : etfCandles && etfCandles.length > 0
      ? etfCandles[etfCandles.length - 1].close
      : 0;

  let factor = defaultRatio;
  let futuresRefPrice = cached?.futuresRefPrice ?? BASE_PRICES[futuresSym] ?? 100;

  if (futQuote && futQuote.price > 0 && etfRefPrice > 0) {
    const liveRatio = futQuote.price / etfRefPrice;
    if (liveRatio >= defaultRatio * 0.55 && liveRatio <= defaultRatio * 1.65) {
      factor = liveRatio;
      futuresRefPrice = futQuote.price;
    }
  } else if (cached?.factor) {
    factor = cached.factor;
  }

  if (etfRefPrice > 0) {
    futuresEtfScaleCache.set(futuresSym, {
      factor,
      updatedAt: Date.now(),
      futuresRefPrice,
      etfRefPrice,
    });
  }

  return factor;
}

async function scaleEtfCandlesToFutures(
  futuresSym: string,
  etfSym: string,
  etfCandles: Candle[]
): Promise<Candle[]> {
  if (etfCandles.length === 0) return etfCandles;
  const factor = await resolveFuturesScaleFactor(futuresSym, etfSym, etfCandles);
  const decimals = getDecimalsForPrice(etfCandles[etfCandles.length - 1].close * factor);
  return etfCandles.map((c) => {
    const o = roundToDecimals(c.open * factor, decimals);
    const cl = roundToDecimals(c.close * factor, decimals);
    const h = Math.max(roundToDecimals(c.high * factor, decimals), o, cl);
    const l = Math.min(roundToDecimals(c.low * factor, decimals), o, cl);
    return {
      time: c.time,
      open: o,
      high: h,
      low: l,
      close: cl,
      volume: c.volume,
    };
  });
}

async function fetchFinnhubCandles(
  symbol: string,
  timeframe: Timeframe,
  apiKey: string,
  endTimeSec?: number
): Promise<Candle[] | null> {
  const upper = symbol.toUpperCase();
  const fhSym = resolveFinnhubSymbol(upper);
  const etfProxy = resolveFuturesEtfProxy(upper);
  const cfg = FINNHUB_INTERVAL_MAP[timeframe];
  const toSec = endTimeSec ?? Math.floor(Date.now() / 1000);
  const targetBars = getDefaultHistoryCount(timeframe);
  const lookbackSec = Math.max(
    cfg.baseSeconds * Math.min(1800, targetBars),
    cfg.baseSeconds < 3600 ? 7 * 86400 : 30 * 86400
  );
  const fromSec = toSec - lookbackSec;

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 7000);
    const url = `${FINNHUB_REST}/stock/candle?symbol=${encodeURIComponent(
      fhSym
    )}&resolution=${encodeURIComponent(
      cfg.resolution
    )}&from=${fromSec}&to=${toSec}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { signal: controller.signal });
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.s !== 'ok' || !Array.isArray(data.t) || data.t.length === 0) {
      return null;
    }

    const raw: Candle[] = [];
    for (let i = 0; i < data.t.length; i++) {
      const t = Number(data.t[i]);
      const o = Number(data.o?.[i]);
      const h = Number(data.h?.[i]);
      const l = Number(data.l?.[i]);
      const c = Number(data.c?.[i]);
      const v = Number(data.v?.[i] ?? 100);
      if (Number.isFinite(t) && Number.isFinite(c) && c > 0) {
        raw.push({
          time: t as UTCTimestamp,
          open: Number.isFinite(o) ? o : c,
          high: Number.isFinite(h) ? h : c,
          low: Number.isFinite(l) ? l : c,
          close: c,
          volume: Number.isFinite(v) ? v : 100,
        });
      }
    }

    raw.sort((a, b) => Number(a.time) - Number(b.time));
    if (raw.length === 0) return null;
    let agg = cfg.aggregate ? aggregateCandles(raw, cfg.bucketSeconds) : raw;
    if (etfProxy) {
      agg = await scaleEtfCandlesToFutures(upper, etfProxy, agg);
    }
    if (isSecondLevelTimeframe(timeframe)) {
      const captured =
        endTimeSec === undefined
          ? await fetchCapturedSecondBars(upper, TIMEFRAME_SECONDS[timeframe])
          : undefined;
      return buildSecondLevelSeriesFromMinuteCandles(
        upper,
        timeframe,
        agg,
        agg[agg.length - 1]?.close,
        300,
        endTimeSec,
        captured
      );
    }
    return agg;
  } catch {
    return null;
  }
}

export function resolveYahooSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  return YAHOO_SYMBOL_MAP[upper] ?? upper;
}

export function resolveFuturesEtfProxy(symbol: string): string | undefined {
  return FUTURES_ETF_PROXY_MAP[symbol.toUpperCase()];
}

async function fetchYahooChartJson(
  yahooSymbol: string,
  interval: string,
  range: string,
  includePrePost: boolean,
  period1?: number,
  period2?: number
): Promise<any | null> {
  const apiParams = new URLSearchParams({
    symbol: yahooSymbol,
    interval,
    includePrePost: includePrePost ? 'true' : 'false',
  });
  if (period1 !== undefined && period2 !== undefined) {
    apiParams.set('period1', String(period1));
    apiParams.set('period2', String(period2));
  } else {
    apiParams.set('range', range);
  }

  // 1. Try local Express backend proxy first (zero CORS, real headers, fast)
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 7500);
    const res = await fetch(`/api/market/yahoo?${apiParams.toString()}`, {
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data?.chart?.result?.[0]) return data;
    }
  } catch {
    // Fall through to CORS proxy chain if backend route is unavailable
  }

  // 2. Fallback to public CORS proxy chain for standalone static builds
  const yahooParams = new URLSearchParams({
    interval,
    includePrePost: includePrePost ? 'true' : 'false',
  });
  if (period1 !== undefined && period2 !== undefined) {
    yahooParams.set('period1', String(period1));
    yahooParams.set('period2', String(period2));
  } else {
    yahooParams.set('range', range);
  }
  const yahooUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol
  )}?${yahooParams.toString()}`;

  for (const buildProxyUrl of CORS_PROXIES) {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 6500);
      const res = await fetch(buildProxyUrl(yahooUrl), { signal: controller.signal });
      window.clearTimeout(timer);
      if (!res.ok) continue;
      let json = await res.json();
      if (json && typeof json.contents === 'string') {
        json = JSON.parse(json.contents);
      }
      if (json?.chart?.result?.[0]) return json;
    } catch {
      // Try next proxy
    }
  }

  return null;
}

interface RealtimeQuoteSnapshot {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  timestampSec: number;
  session: string;
  realTime: boolean;
}

async function fetchRealtimeQuotes(
  symbols: string[]
): Promise<Record<string, RealtimeQuoteSnapshot> | null> {
  const clean = Array.from(
    new Set(symbols.map((s) => s.toUpperCase().trim()).filter(Boolean))
  );
  if (clean.length === 0) return {};
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3500);
    const res = await fetch(
      `/api/market/quotes?symbols=${encodeURIComponent(clean.join(','))}`,
      { signal: controller.signal }
    );
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data.quotes === 'object') {
      return data.quotes as Record<string, RealtimeQuoteSnapshot>;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchTradingViewProxyCandles(
  symbol: string,
  timeframe: Timeframe,
  endTimeSec?: number
): Promise<Candle[] | null> {
  const upper = symbol.toUpperCase();
  if (!TV_SUPPORTED_SYMBOLS.has(upper)) return null;
  const cfg = TV_INTERVAL_MAP[timeframe];
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 7500);
    const res = await fetch(
      `/api/market/tv/candles?symbol=${encodeURIComponent(upper)}&resolution=${encodeURIComponent(
        cfg.resolution
      )}&count=${cfg.count}`,
      { signal: controller.signal }
    );
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.bars) || data.bars.length === 0) return null;

    const rawBars: Candle[] = data.bars
      .map((b: Record<string, unknown>) => ({
        time: Number(b.time) as UTCTimestamp,
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.volume ?? 0),
      }))
      .filter(
        (b: Candle) =>
          Number.isFinite(Number(b.time)) &&
          Number.isFinite(b.open) &&
          Number.isFinite(b.high) &&
          Number.isFinite(b.low) &&
          Number.isFinite(b.close) &&
          b.close > 0
      )
      .sort((a: Candle, b: Candle) => Number(a.time) - Number(b.time));

    if (rawBars.length === 0) return null;

    const prepared =
      cfg.aggregateSec > 0 ? aggregateCandles(rawBars, cfg.aggregateSec) : rawBars;

    if (endTimeSec !== undefined) {
      if (endTimeSec < Number(prepared[0].time)) {
        return null;
      }
      const sliced = prepared.filter((b) => Number(b.time) <= endTimeSec);
      return sliced.length >= 20 ? sliced : null;
    }

    return prepared;
  } catch {
    return null;
  }
}

function extractYahooRawLastPoint(json: any): { time: number; close: number } | null {
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return null;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    const t = Number(timestamps[i]);
    const c = Number(closes[i]);
    if (Number.isFinite(t) && t > 0 && Number.isFinite(c) && c > 0) {
      return { time: t, close: c };
    }
  }
  return null;
}

function parseYahooCandlesFromJson(
  json: any,
  isFutures: boolean,
  isIntraday: boolean
): Candle[] {
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  if (!Array.isArray(timestamps) || !quote || timestamps.length === 0) {
    return [];
  }

  const opens = quote.open ?? [];
  const highs = quote.high ?? [];
  const lows = quote.low ?? [];
  const closes = quote.close ?? [];
  const volumes = quote.volume ?? [];

  let lastValidIdx = -1;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    const t = Number(timestamps[i]);
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    if (
      o !== null &&
      h !== null &&
      l !== null &&
      c !== null &&
      Number.isFinite(t) &&
      Number.isFinite(o) &&
      Number.isFinite(h) &&
      Number.isFinite(l) &&
      Number.isFinite(c) &&
      o > 0 &&
      h > 0 &&
      l > 0 &&
      c > 0
    ) {
      lastValidIdx = i;
      break;
    }
  }

  let hadOffMinutePrint = false;
  let offMinuteClose = 0;

  const byTime = new Map<number, Candle>();
  for (let i = 0; i < timestamps.length; i++) {
    const t = Number(timestamps[i]);
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const v = volumes[i];

    if (
      o === null ||
      h === null ||
      l === null ||
      c === null ||
      !Number.isFinite(t) ||
      !Number.isFinite(o) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(c) ||
      o <= 0 ||
      h <= 0 ||
      l <= 0 ||
      c <= 0
    ) {
      continue;
    }

    let candleTime = t;
    if (isIntraday && t % 60 !== 0) {
      const isLiveTailTick = i === lastValidIdx && !(isFutures && t % 60 === 59);
      if (!isLiveTailTick) {
        hadOffMinutePrint = true;
        offMinuteClose = Number(c);
        continue;
      }
      // Bucket in-progress real-time bar (e.g. 09:16:02 -> 09:16:00) instead of discarding it
      candleTime = t - (t % 60);
    }

    const safeHigh = Math.max(Number(h), Number(o), Number(c), Number(l));
    const safeLow = Math.min(Number(l), Number(o), Number(c), Number(h));
    const vol = v !== null && Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
    const existing = byTime.get(candleTime);
    if (existing) {
      byTime.set(candleTime, {
        time: candleTime as UTCTimestamp,
        open: existing.open,
        high: Math.max(existing.high, safeHigh),
        low: Math.min(existing.low, safeLow),
        close: Number(c),
        volume: Math.max(existing.volume, vol),
      });
    } else {
      byTime.set(candleTime, {
        time: candleTime as UTCTimestamp,
        open: Number(o),
        high: safeHigh,
        low: safeLow,
        close: Number(c),
        volume: vol,
      });
    }
  }

  const sorted = Array.from(byTime.values()).sort(
    (a, b) => Number(a.time) - Number(b.time)
  );

  // If CME appended an off-minute settlement print whose price contaminated the final 21:59 bar (NQ=F, ES=F, YM=F)
  if (isFutures && isIntraday && hadOffMinutePrint && sorted.length >= 2) {
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const jumpPct = Math.abs(last.close - prev.close) / Math.max(1, prev.close);
    if (Math.abs(last.close - offMinuteClose) < 0.05 && jumpPct > 0.001) {
      sorted.pop();
    }
  }

  // Fold flat zero-volume regular closing-cross tick (e.g. AAPL 21:00:00Z on 60m) into previous candle
  if (!isFutures && isIntraday && sorted.length >= 2) {
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    if (
      last.volume === 0 &&
      last.open === last.high &&
      last.high === last.low &&
      last.low === last.close &&
      Number(last.time) - Number(prev.time) <= 3600
    ) {
      prev.close = last.close;
      prev.high = Math.max(prev.high, last.close);
      prev.low = Math.min(prev.low, last.close);
      sorted.pop();
    }
  }

  return sorted;
}

interface EtfLiveSnapshot {
  livePrice: number;
  prevClose: number;
  bars: Candle[];
  timestampSec: number;
}

interface FuturesDelayedAnchor {
  ts: number;
  futuresClose: number;
  futuresTime: number;
  futuresPrevClose: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
}

const etfBarsCache = new Map<
  string,
  { ts: number; bars: Candle[]; prevClose: number; fallbackPrice: number; fallbackTime: number }
>();
const futuresAnchorCache = new Map<string, FuturesDelayedAnchor>();
const ETF_BARS_CACHE_TTL_MS = 12_000;
const FUTURES_ANCHOR_CACHE_TTL_MS = 15_000;

function extractYahooLivePriceFromJson(json: any, bars: Candle[]): {
  livePrice: number;
  prevClose: number;
  timestampSec: number;
} {
  const meta = json?.chart?.result?.[0]?.meta;
  const latestBar = bars.length > 0 ? bars[bars.length - 1] : null;
  const rawLast = extractYahooRawLastPoint(json);

  const candidates: Array<{ time: number; price: number }> = [];
  if (rawLast) {
    candidates.push({ time: rawLast.time, price: rawLast.close });
  }
  if (latestBar) {
    candidates.push({ time: Number(latestBar.time), price: latestBar.close });
  }
  if (
    typeof meta?.regularMarketTime === 'number' &&
    typeof meta?.regularMarketPrice === 'number' &&
    meta.regularMarketPrice > 0
  ) {
    candidates.push({ time: meta.regularMarketTime, price: meta.regularMarketPrice });
  }
  if (
    typeof meta?.postMarketTime === 'number' &&
    typeof meta?.postMarketPrice === 'number' &&
    meta.postMarketPrice > 0
  ) {
    candidates.push({ time: meta.postMarketTime, price: meta.postMarketPrice });
  }
  if (
    typeof meta?.preMarketTime === 'number' &&
    typeof meta?.preMarketPrice === 'number' &&
    meta.preMarketPrice > 0
  ) {
    candidates.push({ time: meta.preMarketTime, price: meta.preMarketPrice });
  }

  let best = candidates[0] ?? {
    time: Math.floor(Date.now() / 1000),
    price: 0,
  };
  for (const cand of candidates) {
    if (cand.time > best.time) {
      best = cand;
    }
  }

  const prevClose =
    typeof meta?.chartPreviousClose === 'number' && meta.chartPreviousClose > 0
      ? meta.chartPreviousClose
      : typeof meta?.previousClose === 'number' && meta.previousClose > 0
      ? meta.previousClose
      : bars[0]?.open ?? best.price;

  return {
    livePrice: best.price,
    prevClose,
    timestampSec: best.time,
  };
}

function buildFuturesAnchorFromYahooJson(json: any): FuturesDelayedAnchor | null {
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!result) return null;

  const bars = parseYahooCandlesFromJson(json, true, true);
  const rawLast = extractYahooRawLastPoint(json);
  const latestBar = bars.length > 0 ? bars[bars.length - 1] : null;
  const regTime =
    typeof meta?.regularMarketTime === 'number' ? meta.regularMarketTime : 0;
  const regPrice =
    typeof meta?.regularMarketPrice === 'number' && meta.regularMarketPrice > 0
      ? meta.regularMarketPrice
      : 0;

  let futuresClose = latestBar?.close ?? 0;
  let futuresTime = latestBar ? Number(latestBar.time) : 0;

  if (rawLast && rawLast.time >= futuresTime) {
    futuresClose = rawLast.close;
    futuresTime = rawLast.time;
  }
  if (regPrice > 0 && regTime >= futuresTime) {
    futuresClose = regPrice;
    futuresTime = regTime;
  }

  if (!Number.isFinite(futuresClose) || futuresClose <= 0) return null;
  if (futuresTime <= 0) futuresTime = Math.floor(Date.now() / 1000) - 600;

  const prevClose =
    typeof meta?.chartPreviousClose === 'number' && meta.chartPreviousClose > 0
      ? meta.chartPreviousClose
      : typeof meta?.previousClose === 'number' && meta.previousClose > 0
      ? meta.previousClose
      : latestBar?.open ?? futuresClose;

  return {
    ts: Date.now(),
    futuresClose,
    futuresTime,
    futuresPrevClose: prevClose,
    dayHigh:
      typeof meta?.regularMarketDayHigh === 'number' && meta.regularMarketDayHigh > 0
        ? meta.regularMarketDayHigh
        : futuresClose,
    dayLow:
      typeof meta?.regularMarketDayLow === 'number' && meta.regularMarketDayLow > 0
        ? meta.regularMarketDayLow
        : futuresClose,
    volume:
      typeof meta?.regularMarketVolume === 'number' ? meta.regularMarketVolume : 0,
  };
}

async function fetchFuturesDelayedAnchor(
  sym: string,
  forceRefresh = false
): Promise<FuturesDelayedAnchor | null> {
  const upper = sym.toUpperCase();
  const cached = futuresAnchorCache.get(upper);
  if (!forceRefresh && cached && Date.now() - cached.ts < FUTURES_ANCHOR_CACHE_TTL_MS) {
    return cached;
  }
  const yahooSym = resolveYahooSymbol(upper);
  const json = await fetchYahooChartJson(yahooSym, '1m', '5d', true);
  if (!json) return cached ?? null;
  const anchor = buildFuturesAnchorFromYahooJson(json);
  if (anchor) {
    futuresAnchorCache.set(upper, anchor);
  }
  return anchor ?? cached ?? null;
}

async function ensureEtfBarsSnapshot(
  etfSymbol: string,
  forceRefresh = false
): Promise<{
  bars: Candle[];
  prevClose: number;
  fallbackPrice: number;
  fallbackTime: number;
} | null> {
  const upperEtf = etfSymbol.toUpperCase();
  const cached = etfBarsCache.get(upperEtf);
  if (!forceRefresh && cached && Date.now() - cached.ts < ETF_BARS_CACHE_TTL_MS) {
    return cached;
  }
  const json = await fetchYahooChartJson(upperEtf, '1m', '5d', true);
  if (!json) return cached ?? null;
  const bars = parseYahooCandlesFromJson(json, false, true);
  const { livePrice, prevClose, timestampSec } = extractYahooLivePriceFromJson(json, bars);
  const entry = {
    ts: Date.now(),
    bars,
    prevClose,
    fallbackPrice: livePrice,
    fallbackTime: timestampSec,
  };
  if (bars.length > 0 || livePrice > 0) {
    etfBarsCache.set(upperEtf, entry);
  }
  return entry;
}

async function fetchYahooLiveEtfSnapshot(
  etfSymbol: string,
  preloadedRealtimeQuote?: RealtimeQuoteSnapshot | null
): Promise<EtfLiveSnapshot | null> {
  const upperEtf = etfSymbol.toUpperCase();
  const [etfHist, rtMap] = await Promise.all([
    ensureEtfBarsSnapshot(upperEtf),
    preloadedRealtimeQuote !== undefined
      ? Promise.resolve(
          preloadedRealtimeQuote ? { [upperEtf]: preloadedRealtimeQuote } : null
        )
      : fetchRealtimeQuotes([upperEtf]),
  ]);

  const rtQuote = rtMap?.[upperEtf];
  const livePrice =
    rtQuote && rtQuote.price > 0 ? rtQuote.price : etfHist?.fallbackPrice ?? 0;
  const prevClose =
    rtQuote && rtQuote.prevClose > 0
      ? rtQuote.prevClose
      : etfHist?.prevClose ?? livePrice;
  const timestampSec =
    rtQuote && rtQuote.timestampSec > 0
      ? rtQuote.timestampSec
      : etfHist?.fallbackTime ?? Math.floor(Date.now() / 1000);

  if (!Number.isFinite(livePrice) || livePrice <= 0) return null;

  const bars = etfHist?.bars ? [...etfHist.bars] : [];
  if (bars.length > 0 && timestampSec >= Number(bars[bars.length - 1].time)) {
    const curMin = (timestampSec - (timestampSec % 60)) as UTCTimestamp;
    const last = bars[bars.length - 1];
    if (Number(curMin) === Number(last.time)) {
      bars[bars.length - 1] = {
        ...last,
        high: Math.max(last.high, livePrice),
        low: Math.min(last.low, livePrice),
        close: livePrice,
      };
    } else if (Number(curMin) > Number(last.time)) {
      bars.push({
        time: curMin,
        open: last.close,
        high: Math.max(last.close, livePrice),
        low: Math.min(last.close, livePrice),
        close: livePrice,
        volume: 10,
      });
    }
  }

  return { livePrice, prevClose, bars, timestampSec };
}

function findAnchorEtfBar(
  bars: Candle[],
  futuresAnchorTimeSec: number
): { bar: Candle; diffSec: number } | null {
  let closestEtfBar: Candle | null = null;
  let closestDiff = Infinity;
  for (const bar of bars) {
    const dt = Math.abs(Number(bar.time) - futuresAnchorTimeSec);
    if (dt < closestDiff) {
      closestDiff = dt;
      closestEtfBar = bar;
    }
  }
  if (!closestEtfBar) return null;
  return { bar: closestEtfBar, diffSec: closestDiff };
}

function computeZeroDelayFuturesPrice(
  futuresAnchorClose: number,
  futuresAnchorTimeSec: number,
  futuresPrevClose: number,
  etfSnap: EtfLiveSnapshot
): number {
  if (!Number.isFinite(futuresAnchorClose) || futuresAnchorClose <= 0) {
    return futuresAnchorClose;
  }

  // Only project via ETF during hours when ETF extended/regular feed is fresher than Futures delayed print
  if (etfSnap.timestampSec <= futuresAnchorTimeSec - 30) {
    return roundToDecimals(futuresAnchorClose, getDecimalsForPrice(futuresAnchorClose));
  }

  const matched = findAnchorEtfBar(etfSnap.bars, futuresAnchorTimeSec);
  let projected = futuresAnchorClose;
  if (matched && matched.diffSec <= 1800 && matched.bar.close > 0) {
    const livePctChange = (etfSnap.livePrice - matched.bar.close) / matched.bar.close;
    projected = futuresAnchorClose * (1 + livePctChange);
  } else if (futuresPrevClose > 0 && etfSnap.prevClose > 0) {
    const dayPctChange = (etfSnap.livePrice - etfSnap.prevClose) / etfSnap.prevClose;
    projected = futuresPrevClose * (1 + dayPctChange);
  }

  const decimals = getDecimalsForPrice(futuresAnchorClose);
  return roundToDecimals(projected, decimals);
}

export async function fetchRealHistoricalCandles(
  symbol: string,
  timeframe: Timeframe,
  endTimeSec?: number
): Promise<Candle[] | null> {
  const upper = symbol.toUpperCase();
  const cfg = YAHOO_INTERVAL_MAP[timeframe];
  const category = getSymbolCategory(upper);
  const isIntraday = !['1d', '1w', '1M'].includes(timeframe);
  const isFutures = category === 'Futures';
  // Keep futures candles on the futures contract itself; ETF proxy prices are not futures prints.
  const etfProxy = isFutures ? undefined : resolveFuturesEtfProxy(upper);
  const isSecondTf = isSecondLevelTimeframe(timeframe);

  if (TV_SUPPORTED_SYMBOLS.has(upper)) {
    const [tvCandles, tvRtMap, tvCapturedSec] = await Promise.all([
      fetchTradingViewProxyCandles(upper, timeframe, endTimeSec),
      isSecondTf && endTimeSec === undefined && getMarketStatus(upper).isOpen
        ? fetchRealtimeQuotes([upper])
        : Promise.resolve(null),
      isSecondTf && endTimeSec === undefined
        ? fetchCapturedSecondBars(upper, TIMEFRAME_SECONDS[timeframe])
        : Promise.resolve(undefined),
    ]);
    if (tvCandles && tvCandles.length > 0) {
      if (isSecondTf) {
        const livePrice =
          tvRtMap?.[upper]?.price && tvRtMap[upper].price > 0
            ? tvRtMap[upper].price
            : tvCandles[tvCandles.length - 1].close;
        return buildSecondLevelSeriesFromMinuteCandles(
          upper,
          timeframe,
          tvCandles,
          livePrice,
          300,
          endTimeSec,
          tvCapturedSec
        );
      }
      return tvCandles;
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  let period1: number | undefined;
  let period2: number | undefined;
  if (endTimeSec !== undefined && endTimeSec < nowSec - 3600) {
    period2 = Math.min(nowSec, Math.floor(endTimeSec));
    const lookbackSec = Math.min(cfg.maxDays * 86400, 30 * 86400);
    period1 = Math.max(0, period2 - lookbackSec);
  }

  const yahooSymbol = resolveYahooSymbol(upper);
  const [json, etfSnap, stockRtMap] = await Promise.all([
    fetchYahooChartJson(
      yahooSymbol,
      cfg.interval,
      cfg.range,
      isFutures || !isIntraday ? true : true,
      period1,
      period2
    ),
    etfProxy && endTimeSec === undefined && getMarketStatus(upper).isOpen
      ? fetchYahooLiveEtfSnapshot(etfProxy)
      : Promise.resolve(null),
    !isFutures && isSecondTf && endTimeSec === undefined && getMarketStatus(upper).isOpen
      ? fetchRealtimeQuotes([upper])
      : Promise.resolve(null),
  ]);

  const sorted = parseYahooCandlesFromJson(json, isFutures, isIntraday);
  if (sorted.length === 0) return null;

  const finalCandles = cfg.aggregate
    ? aggregateCandles(sorted, cfg.bucketSeconds)
    : sorted;

  // Eliminate 10-minute CME Futures delay on initial load by projecting real-time ETF bars + CNBC live quote
  if (etfSnap && finalCandles.length > 0) {
    const rawAnchor = buildFuturesAnchorFromYahooJson(json);
    if (rawAnchor) {
      futuresAnchorCache.set(upper, rawAnchor);
    }

    const lastBar = finalCandles[finalCandles.length - 1];
    const meta = json?.chart?.result?.[0]?.meta;
    const rawLast = extractYahooRawLastPoint(json);
    const metaRegTime =
      typeof meta?.regularMarketTime === 'number' ? meta.regularMarketTime : 0;
    const metaRegPrice =
      typeof meta?.regularMarketPrice === 'number' && meta.regularMarketPrice > 0
        ? meta.regularMarketPrice
        : 0;

    // Crucial: anchor at actual delayed Futures print time (not truncated 1h/1d bar open!)
    const anchorTimeSec =
      rawAnchor?.futuresTime ??
      (metaRegTime > 0 && Math.abs(nowSec - metaRegTime) <= 7200
        ? metaRegTime
        : rawLast?.time ?? Number(lastBar.time));
    const anchorClose =
      rawAnchor?.futuresClose ??
      (metaRegPrice > 0 && metaRegTime >= anchorTimeSec - 60
        ? metaRegPrice
        : lastBar.close);
    const futuresPrevClose =
      rawAnchor?.futuresPrevClose ??
      (typeof meta?.chartPreviousClose === 'number' && meta.chartPreviousClose > 0
        ? meta.chartPreviousClose
        : lastBar.open);

    const decimals = getDecimalsForPrice(anchorClose);
    const stepSec = TIMEFRAME_SECONDS[timeframe];

    if (etfSnap.timestampSec > anchorTimeSec - 30) {
      const matched = findAnchorEtfBar(etfSnap.bars, anchorTimeSec);
      // Fill the trailing 10-minute CME gap with ETF proxy candles so 1m/5m charts stay continuous
      if (isIntraday && stepSec < 86400 && matched && matched.diffSec <= 1800 && matched.bar.close > 0) {
        const scale = anchorClose / matched.bar.close;
        const anchorBucketStart = anchorTimeSec - (anchorTimeSec % 60);
        for (const etfBar of etfSnap.bars) {
          const etfT = Number(etfBar.time);
          if (etfT <= anchorBucketStart) continue;
          const bucket = (etfT - (etfT % stepSec)) as UTCTimestamp;
          const projClose = roundToDecimals(etfBar.close * scale, decimals);
          const projHigh = roundToDecimals(etfBar.high * scale, decimals);
          const projLow = roundToDecimals(etfBar.low * scale, decimals);
          const tail = finalCandles[finalCandles.length - 1];

          if (Number(bucket) > Number(tail.time)) {
            finalCandles.push({
              time: bucket,
              open: tail.close,
              high: Math.max(tail.close, projHigh, projClose),
              low: Math.min(tail.close, projLow, projClose),
              close: projClose,
              volume: 8,
            });
          } else if (Number(bucket) === Number(tail.time)) {
            tail.high = Math.max(tail.high, projHigh, projClose);
            tail.low = Math.min(tail.low, projLow, projClose);
            tail.close = projClose;
          }
        }
      }

      const zeroDelayPrice = computeZeroDelayFuturesPrice(
        anchorClose,
        anchorTimeSec,
        futuresPrevClose,
        etfSnap
      );

      const tail = finalCandles[finalCandles.length - 1];
      const currentBucket = (nowSec - (nowSec % stepSec)) as UTCTimestamp;
      if (Number(currentBucket) > Number(tail.time) && stepSec < 86400) {
        finalCandles.push({
          time: currentBucket,
          open: tail.close,
          high: Math.max(tail.close, zeroDelayPrice),
          low: Math.min(tail.close, zeroDelayPrice),
          close: zeroDelayPrice,
          volume: 10,
        });
      } else {
        tail.close = zeroDelayPrice;
        tail.high = Math.max(tail.high, zeroDelayPrice);
        tail.low = Math.min(tail.low, zeroDelayPrice);
      }
    }
  }

  if (isSecondTf && finalCandles.length > 0) {
    const stockRt = stockRtMap?.[upper];
    const targetSecondLivePrice =
      stockRt && stockRt.price > 0
        ? stockRt.price
        : finalCandles[finalCandles.length - 1].close;
    const captured =
      endTimeSec === undefined
        ? await fetchCapturedSecondBars(upper, TIMEFRAME_SECONDS[timeframe])
        : undefined;
    return buildSecondLevelSeriesFromMinuteCandles(
      upper,
      timeframe,
      finalCandles,
      targetSecondLivePrice,
      300,
      endTimeSec,
      captured
    );
  }

  return finalCandles;
}

export async function fetchHistoricalCandles(
  symbol: string,
  timeframe: Timeframe,
  finnhubApiKey?: string
): Promise<HistoricalCandlesResult> {
  const upper = symbol.toUpperCase();
  const category = getSymbolCategory(upper);

  if (category === 'Crypto') {
    const binanceCandles = await fetchBinanceMultiBatch(upper, timeframe);
    if (binanceCandles && binanceCandles.length > 0) {
      return { candles: sanitizeCandleSeries(binanceCandles), simulated: false };
    }
    const ccCandles = await fetchCryptoCompareCandles(upper, timeframe);
    if (ccCandles && ccCandles.length > 0) {
      return { candles: sanitizeCandleSeries(ccCandles), simulated: false };
    }
    return { candles: [], simulated: true };
  }

  const realCandles = await fetchRealHistoricalCandles(upper, timeframe);
  if (realCandles && realCandles.length > 0) {
    return { candles: sanitizeCandleSeries(realCandles), simulated: false };
  }

  const fhKey = (finnhubApiKey ?? '').trim();
  if (fhKey.length > 4) {
    const fhCandles = await fetchFinnhubCandles(upper, timeframe, fhKey);
    if (fhCandles && fhCandles.length > 0) {
      return { candles: sanitizeCandleSeries(fhCandles), simulated: false };
    }
  }

  return { candles: [], simulated: true };
}

export async function fetchHistoricalCandlesAround(
  symbol: string,
  timeframe: Timeframe,
  targetTimeSec: number,
  finnhubApiKey?: string
): Promise<HistoricalCandlesResult> {
  const upper = symbol.toUpperCase();
  const category = getSymbolCategory(upper);
  const stepSec = TIMEFRAME_SECONDS[timeframe];
  const barCount = getDefaultHistoryCount(timeframe);
  const nowSec = Math.floor(Date.now() / 1000);
  const endTimeSec = Math.min(
    nowSec,
    targetTimeSec + Math.floor(barCount * 0.45) * stepSec
  );

  if (category === 'Crypto') {
    const binanceCandles = await fetchBinanceMultiBatch(upper, timeframe, endTimeSec);
    if (binanceCandles && binanceCandles.length > 0) {
      return { candles: sanitizeCandleSeries(binanceCandles), simulated: false };
    }
    const ccCandles = await fetchCryptoCompareCandles(upper, timeframe, endTimeSec);
    if (ccCandles && ccCandles.length > 0) {
      return { candles: sanitizeCandleSeries(ccCandles), simulated: false };
    }
    return { candles: [], simulated: true };
  }

  const realCandles = await fetchRealHistoricalCandles(upper, timeframe, endTimeSec);
  if (realCandles && realCandles.length > 0) {
    return { candles: sanitizeCandleSeries(realCandles), simulated: false };
  }

  const fhKey = (finnhubApiKey ?? '').trim();
  if (fhKey.length > 4) {
    const fhCandles = await fetchFinnhubCandles(upper, timeframe, fhKey, endTimeSec);
    if (fhCandles && fhCandles.length > 0) {
      return { candles: sanitizeCandleSeries(fhCandles), simulated: false };
    }
  }

  return { candles: [], simulated: true };
}

async function fetchCryptoCompareTicker(symbol: string): Promise<Ticker24h | null> {
  const { fsym, tsym } = parseCryptoPair(symbol);
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4500);
    const url = `${CRYPTOCOMPARE_REST}/pricemultifull?fsyms=${encodeURIComponent(
      fsym
    )}&tsyms=${encodeURIComponent(tsym)}`;
    const res = await fetch(url, { signal: controller.signal });
    window.clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    const raw = json?.RAW?.[fsym]?.[tsym];
    if (!raw || typeof raw.PRICE !== 'number') return null;
    return {
      symbol: symbol.toUpperCase(),
      lastPrice: raw.PRICE,
      priceChangePercent: raw.CHANGEPCT24HOUR ?? 0,
      priceChange: raw.CHANGE24HOUR ?? 0,
      highPrice: raw.HIGH24HOUR ?? raw.PRICE,
      lowPrice: raw.LOW24HOUR ?? raw.PRICE,
      quoteVolume: raw.VOLUME24HOURTO ?? 0,
    };
  } catch {
    return null;
  }
}

export async function fetchTicker24h(
  symbol: string,
  finnhubApiKey?: string
): Promise<Ticker24h | null> {
  const upper = symbol.toUpperCase();
  const category = getSymbolCategory(upper);

  if (category === 'Crypto') {
    for (const base of REST_BASES) {
      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 4500);
        const url = `${base}/api/v3/ticker/24hr?symbol=${encodeURIComponent(upper)}`;
        const res = await fetch(url, { signal: controller.signal });
        window.clearTimeout(timer);
        if (!res.ok) continue;
        const data = await res.json();
        return {
          symbol: data.symbol,
          lastPrice: parseFloat(data.lastPrice),
          priceChangePercent: parseFloat(data.priceChangePercent),
          priceChange: parseFloat(data.priceChange),
          highPrice: parseFloat(data.highPrice),
          lowPrice: parseFloat(data.lowPrice),
          quoteVolume: parseFloat(data.quoteVolume),
        };
      } catch {
        // Try next mirror
      }
    }
    return fetchCryptoCompareTicker(upper);
  }

  const liveHubTick = hubTradePrices.get(upper);
  if (
    category !== 'Futures' &&
    liveHubTick &&
    liveHubTick.price > 0 &&
    Math.floor(Date.now() / 1000) - liveHubTick.timestampSec < 60
  ) {
    const tvQ = TV_SUPPORTED_SYMBOLS.has(upper) ? await fetchRealtimeQuotes([upper]) : null;
    const prevClose = tvQ?.[upper]?.prevClose ?? liveHubTick.price;
    const priceChange = liveHubTick.price - prevClose;
    const priceChangePercent = prevClose > 0 ? (priceChange / prevClose) * 100 : 0;
    return {
      symbol: upper,
      lastPrice: liveHubTick.price,
      priceChange,
      priceChangePercent,
      highPrice: liveHubTick.price,
      lowPrice: liveHubTick.price,
      quoteVolume: 0,
    };
  }

  const tickerEtfProxy = resolveFuturesEtfProxy(upper);

  if (category !== 'Futures' && finnhubApiKey && finnhubApiKey.trim().length > 4) {
    try {
      const fhSym = resolveFinnhubSymbol(upper);
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 4500);
      const res = await fetch(
        `${FINNHUB_REST}/quote?symbol=${encodeURIComponent(fhSym)}&token=${encodeURIComponent(
          finnhubApiKey.trim()
        )}`,
        { signal: controller.signal }
      );
      window.clearTimeout(timer);
      if (res.ok) {
        const q = await res.json();
        if (q && typeof q.c === 'number' && q.c > 0) {
          const factor = tickerEtfProxy
            ? await resolveFuturesScaleFactor(upper, tickerEtfProxy)
            : 1;
          const decimals = getDecimalsForPrice(q.c * factor);
          return {
            symbol: upper,
            lastPrice: roundToDecimals(q.c * factor, decimals),
            priceChangePercent: typeof q.dp === 'number' ? q.dp : 0,
            priceChange: roundToDecimals((typeof q.d === 'number' ? q.d : 0) * factor, decimals),
            highPrice: roundToDecimals(
              (typeof q.h === 'number' && q.h > 0 ? q.h : q.c) * factor,
              decimals
            ),
            lowPrice: roundToDecimals(
              (typeof q.l === 'number' && q.l > 0 ? q.l : q.c) * factor,
              decimals
            ),
            quoteVolume: 0,
          };
        }
      }
    } catch {
      // Fallback below
    }
  }

  if (TV_SUPPORTED_SYMBOLS.has(upper)) {
    const tvQuotes = await fetchRealtimeQuotes([upper]);
    const tq = tvQuotes?.[upper];
    if (tq && tq.price > 0) {
      const priceChange = tq.price - tq.prevClose;
      const priceChangePercent =
        tq.prevClose > 0 ? (priceChange / tq.prevClose) * 100 : tq.changePct;
      return {
        symbol: upper,
        lastPrice: tq.price,
        priceChange,
        priceChangePercent,
        highPrice: tq.price,
        lowPrice: tq.price,
        quoteVolume: 0,
      };
    }
  }

  async function fetchYahooTicker(
    sym: string,
    preloadedQuotes?: Record<string, RealtimeQuoteSnapshot> | null
  ): Promise<Ticker24h | null> {
    const upperSym = sym.toUpperCase();
    const yahooSym = resolveYahooSymbol(upperSym);
    const etfProxy = resolveFuturesEtfProxy(upperSym);

    if (etfProxy && getSymbolCategory(upperSym) !== 'Futures') {
      const [anchor, etfSnap] = await Promise.all([
        fetchFuturesDelayedAnchor(upperSym),
        fetchYahooLiveEtfSnapshot(
          etfProxy,
          preloadedQuotes ? preloadedQuotes[etfProxy.toUpperCase()] ?? null : undefined
        ),
      ]);
      if (!anchor) return null;

      const zeroDelayPrice = etfSnap
        ? computeZeroDelayFuturesPrice(
            anchor.futuresClose,
            anchor.futuresTime,
            anchor.futuresPrevClose,
            etfSnap
          )
        : anchor.futuresClose;

      const priceChange = zeroDelayPrice - anchor.futuresPrevClose;
      const priceChangePercent =
        anchor.futuresPrevClose > 0 ? (priceChange / anchor.futuresPrevClose) * 100 : 0;

      return {
        symbol: upperSym,
        lastPrice: zeroDelayPrice,
        priceChange,
        priceChangePercent,
        highPrice: Math.max(zeroDelayPrice, anchor.dayHigh),
        lowPrice: Math.min(zeroDelayPrice, anchor.dayLow),
        quoteVolume: anchor.volume,
      };
    }

    const rtQuote = preloadedQuotes?.[upperSym];
    if (rtQuote && rtQuote.price > 0) {
      const priceChange = rtQuote.price - rtQuote.prevClose;
      const priceChangePercent =
        rtQuote.prevClose > 0 ? (priceChange / rtQuote.prevClose) * 100 : rtQuote.changePct;
      return {
        symbol: upperSym,
        lastPrice: rtQuote.price,
        priceChange,
        priceChangePercent,
        highPrice: rtQuote.price,
        lowPrice: rtQuote.price,
        quoteVolume: 0,
      };
    }

    const json = await fetchYahooChartJson(yahooSym, '1m', '5d', true);
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return null;

    const bars = parseYahooCandlesFromJson(json, false, true);
    const { livePrice, prevClose } = extractYahooLivePriceFromJson(json, bars);
    if (!Number.isFinite(livePrice) || livePrice <= 0) return null;

    const priceChange = livePrice - prevClose;
    const priceChangePercent = prevClose > 0 ? (priceChange / prevClose) * 100 : 0;

    return {
      symbol: upperSym,
      lastPrice: livePrice,
      priceChange,
      priceChangePercent,
      highPrice: Math.max(
        livePrice,
        typeof meta.regularMarketDayHigh === 'number' && meta.regularMarketDayHigh > 0
          ? meta.regularMarketDayHigh
          : livePrice
      ),
      lowPrice: Math.min(
        livePrice,
        typeof meta.regularMarketDayLow === 'number' && meta.regularMarketDayLow > 0
          ? meta.regularMarketDayLow
          : livePrice
      ),
      quoteVolume:
        typeof meta.regularMarketVolume === 'number' ? meta.regularMarketVolume : 0,
    };
  }

  return fetchYahooTicker(upper);
}

export async function fetchBatchTickers(symbols: string[]): Promise<Record<string, Ticker24h>> {
  const upper = symbols.map((s) => s.toUpperCase());
  const cryptoSyms = upper.filter((s) => getSymbolCategory(s) === 'Crypto');
  const nonCryptoSyms = upper.filter((s) => getSymbolCategory(s) !== 'Crypto');
  const map: Record<string, Ticker24h> = {};

  if (cryptoSyms.length > 0) {
    const param = encodeURIComponent(JSON.stringify(cryptoSyms));
    for (const base of REST_BASES) {
      try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${base}/api/v3/ticker/24hr?symbols=${param}`, {
          signal: controller.signal,
        });
        window.clearTimeout(timer);
        if (!res.ok) continue;
        const list = (await res.json()) as Array<Record<string, string>>;
        for (const item of list) {
          map[item.symbol] = {
            symbol: item.symbol,
            lastPrice: parseFloat(item.lastPrice),
            priceChangePercent: parseFloat(item.priceChangePercent),
            priceChange: parseFloat(item.priceChange),
            highPrice: parseFloat(item.highPrice),
            lowPrice: parseFloat(item.lowPrice),
            quoteVolume: parseFloat(item.quoteVolume),
          };
        }
        break;
      } catch {
        // Try next mirror
      }
    }

    // CryptoCompare batch fallback if Binance is geo-restricted
    const missingCrypto = cryptoSyms.filter((s) => !map[s]);
    if (missingCrypto.length > 0) {
      try {
        const fsyms = missingCrypto.map((s) => parseCryptoPair(s).fsym).join(',');
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 5000);
        const res = await fetch(
          `${CRYPTOCOMPARE_REST}/pricemultifull?fsyms=${encodeURIComponent(
            fsyms
          )}&tsyms=USDT`,
          { signal: controller.signal }
        );
        window.clearTimeout(timer);
        if (res.ok) {
          const json = await res.json();
          for (const sym of missingCrypto) {
            const { fsym } = parseCryptoPair(sym);
            const raw = json?.RAW?.[fsym]?.USDT;
            if (raw && typeof raw.PRICE === 'number') {
              map[sym] = {
                symbol: sym,
                lastPrice: raw.PRICE,
                priceChangePercent: raw.CHANGEPCT24HOUR ?? 0,
                priceChange: raw.CHANGE24HOUR ?? 0,
                highPrice: raw.HIGH24HOUR ?? raw.PRICE,
                lowPrice: raw.LOW24HOUR ?? raw.PRICE,
                quoteVolume: raw.VOLUME24HOURTO ?? 0,
              };
            }
          }
        }
      } catch {
        // Fallback to anchored prices below
      }
    }
  }

  if (nonCryptoSyms.length > 0) {
    // 1. Fetch zero-delay TradingView streaming quotes + overlay any live WS hub ticks
    const directQuotes = await fetchRealtimeQuotes(nonCryptoSyms);
    const missingForFallback: string[] = [];

    for (const sym of nonCryptoSyms) {
      const q = directQuotes?.[sym];
      const hubTick = hubTradePrices.get(sym);
      const hasFreshHubTick =
        hubTick &&
        hubTick.price > 0 &&
        Math.floor(Date.now() / 1000) - hubTick.timestampSec < 60;
      const livePx = hasFreshHubTick ? hubTick.price : q?.price ?? 0;

      if (livePx > 0) {
        const prevClose = q?.prevClose ?? livePx;
        const priceChange = livePx - prevClose;
        const priceChangePercent =
          prevClose > 0 ? (priceChange / prevClose) * 100 : q?.changePct ?? 0;
        map[sym] = {
          symbol: sym,
          lastPrice: livePx,
          priceChange,
          priceChangePercent,
          highPrice: livePx,
          lowPrice: livePx,
          quoteVolume: 0,
        };
      } else {
        missingForFallback.push(sym);
      }
    }

    // 2. Fallback to ETF proxy + Yahoo only if any non-crypto symbol wasn't in TradingView hub
    if (missingForFallback.length > 0) {
      const rtTargets = missingForFallback.map((s) => resolveFuturesEtfProxy(s) ?? s);
      const rtQuotes = await fetchRealtimeQuotes(rtTargets);

      const resolvedResults = await Promise.all(
        missingForFallback.map(async (sym) => {
          const etfProxy = resolveFuturesEtfProxy(sym);
          if (etfProxy) {
            const [anchor, etfSnap] = await Promise.all([
              fetchFuturesDelayedAnchor(sym),
              fetchYahooLiveEtfSnapshot(etfProxy, rtQuotes?.[etfProxy] ?? null),
            ]);
            if (!anchor) return null;
            const zeroDelayPrice = etfSnap
              ? computeZeroDelayFuturesPrice(
                  anchor.futuresClose,
                  anchor.futuresTime,
                  anchor.futuresPrevClose,
                  etfSnap
                )
              : anchor.futuresClose;
            const priceChange = zeroDelayPrice - anchor.futuresPrevClose;
            const priceChangePercent =
              anchor.futuresPrevClose > 0
                ? (priceChange / anchor.futuresPrevClose) * 100
                : 0;
            return {
              symbol: sym,
              lastPrice: zeroDelayPrice,
              priceChange,
              priceChangePercent,
              highPrice: Math.max(zeroDelayPrice, anchor.dayHigh),
              lowPrice: Math.min(zeroDelayPrice, anchor.dayLow),
              quoteVolume: anchor.volume,
            } satisfies Ticker24h;
          }

          const q = rtQuotes?.[sym];
          if (q && q.price > 0) {
            const priceChange = q.price - q.prevClose;
            const priceChangePercent =
              q.prevClose > 0 ? (priceChange / q.prevClose) * 100 : q.changePct;
            return {
              symbol: sym,
              lastPrice: q.price,
              priceChange,
              priceChangePercent,
              highPrice: q.price,
              lowPrice: q.price,
              quoteVolume: 0,
            } satisfies Ticker24h;
          }

          return fetchTicker24h(sym).catch(() => null);
        })
      );

      for (const ticker of resolvedResults) {
        if (ticker) {
          map[ticker.symbol] = ticker;
        }
      }
    }
  }

  return map;
}

export interface StreamHandlers {
  onCandle: (candle: Candle, isClosed: boolean) => void;
  onStatusChange?: (live: boolean) => void;
  onError?: (reason?: string) => void;
  onMarketStateChange?: (isOpen: boolean) => void;
}

export function subscribeMarketStream(
  symbol: string,
  timeframe: Timeframe,
  lastKnownCandle: Candle | undefined,
  handlers: StreamHandlers,
  finnhubApiKey?: string
): () => void {
  const upper = symbol.toUpperCase();
  const category = getSymbolCategory(upper);

  if (category === 'Crypto') {
    return subscribeBinanceAggregatedStream(upper, timeframe, lastKnownCandle, handlers);
  }

  return subscribeEquityOrFuturesStream(
    upper,
    timeframe,
    lastKnownCandle,
    finnhubApiKey,
    handlers
  );
}

function subscribeBinanceAggregatedStream(
  symbol: string,
  timeframe: Timeframe,
  lastKnownCandle: Candle | undefined,
  handlers: StreamHandlers
): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let ccPollTimer: number | null = null;
  let reconnectTimer: number | null = null;

  const stepSec = TIMEFRAME_SECONDS[timeframe];
  const streamName = `${symbol.toLowerCase()}@trade`;
  const { fsym, tsym } = parseCryptoPair(symbol);

  let currentAggCandle: Candle | null = lastKnownCandle ? { ...lastKnownCandle } : null;

  const applyTradeTick = (price: number, qty = 0.25, tradeTimeSec?: number) => {
    const nowSec = tradeTimeSec ?? Math.floor(Date.now() / 1000);
    const nextBucket = (nowSec - (nowSec % stepSec)) as UTCTimestamp;
    const isSameDailyOrHigherBar =
      currentAggCandle &&
      stepSec >= 86400 &&
      nowSec - Number(currentAggCandle.time) < stepSec;
    const bucket = isSameDailyOrHigherBar
      ? currentAggCandle!.time
      : currentAggCandle && Number(nextBucket) < Number(currentAggCandle.time)
      ? currentAggCandle.time
      : nextBucket;

    if (!currentAggCandle || Number(bucket) > Number(currentAggCandle.time)) {
      if (currentAggCandle) {
        handlers.onCandle({ ...currentAggCandle }, true);
      }
      currentAggCandle = {
        time: bucket,
        open: currentAggCandle ? currentAggCandle.close : price,
        high: currentAggCandle ? Math.max(currentAggCandle.close, price) : price,
        low: currentAggCandle ? Math.min(currentAggCandle.close, price) : price,
        close: price,
        volume: Math.max(0.01, qty),
      };
    } else {
      currentAggCandle = {
        ...currentAggCandle,
        high: Math.max(currentAggCandle.high, price),
        low: Math.min(currentAggCandle.low, price),
        close: price,
        volume: currentAggCandle.volume + Math.max(0.01, qty),
      };
    }
    handlers.onCandle({ ...currentAggCandle }, false);
  };

  const stopCryptoComparePoll = () => {
    if (ccPollTimer !== null) {
      window.clearInterval(ccPollTimer);
      ccPollTimer = null;
    }
  };

  const startCryptoComparePollFallback = () => {
    if (ccPollTimer !== null || closed) return;
    let consecutiveFailures = 0;
    let lastRealCryptoPrice: number | null = currentAggCandle?.close ?? null;

    const pollOnce = async () => {
      if (closed) return;
      try {
        const res = await fetch(
          `${CRYPTOCOMPARE_REST}/price?fsym=${encodeURIComponent(
            fsym
          )}&tsyms=${encodeURIComponent(tsym)}`
        );
        if (!res.ok) throw new Error('CryptoCompare poll failed');
        const data = await res.json();
        const px = Number(data?.[tsym]);
        if (Number.isFinite(px) && px > 0) {
          consecutiveFailures = 0;
          lastRealCryptoPrice = px;
          handlers.onError?.(undefined);
          handlers.onStatusChange?.(true);
          applyTradeTick(px, 2);
          return;
        }
      } catch {
        // Ignore transient poll failure
      }
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        handlers.onStatusChange?.(false);
        handlers.onError?.('Binance WS Disconnected');
      } else if (lastRealCryptoPrice !== null) {
        const nowSec = Math.floor(Date.now() / 1000);
        const nextBucket = nowSec - (nowSec % stepSec);
        if (currentAggCandle && stepSec < 86400 && Number(currentAggCandle.time) < nextBucket) {
          applyTradeTick(lastRealCryptoPrice, 0.25, nowSec);
        }
      }
    };

    pollOnce();
    ccPollTimer = window.setInterval(pollOnce, 650);
  };

  let wsMirrorIdx = 0;

  const connect = () => {
    if (closed) return;
    const baseUrl = WS_BASES[wsMirrorIdx % WS_BASES.length];
    wsMirrorIdx = (wsMirrorIdx + 1) % WS_BASES.length;
    try {
      ws = new WebSocket(`${baseUrl}/${streamName}`);
    } catch {
      startCryptoComparePollFallback();
      reconnectTimer = window.setTimeout(connect, 2000);
      return;
    }

    const connectTimeout = window.setTimeout(() => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        try {
          ws.close();
        } catch {
          // Ignore close error
        }
        startCryptoComparePollFallback();
      }
    }, 2600);

    ws.onopen = () => {
      window.clearTimeout(connectTimeout);
      stopCryptoComparePoll();
      handlers.onError?.(undefined);
      handlers.onStatusChange?.(true);
    };

    ws.onmessage = (event) => {
      if (closed) return;
      try {
        const payload = JSON.parse(event.data as string);
        if (payload.p === undefined) return;
        const price = parseFloat(payload.p);
        const qty = payload.q !== undefined ? parseFloat(payload.q) : 0.25;
        const tradeTimeSec =
          typeof payload.T === 'number' ? Math.floor(payload.T / 1000) : undefined;
        if (Number.isFinite(price) && price > 0) {
          applyTradeTick(price, Number.isFinite(qty) ? qty : 0.25, tradeTimeSec);
        }
      } catch {
        // Ignore malformed tick
      }
    };

    ws.onerror = () => {
      window.clearTimeout(connectTimeout);
      startCryptoComparePollFallback();
    };

    ws.onclose = () => {
      window.clearTimeout(connectTimeout);
      if (!closed) {
        startCryptoComparePollFallback();
        reconnectTimer = window.setTimeout(connect, 1800);
      }
    };
  };

  connect();

  return () => {
    closed = true;
    stopCryptoComparePoll();
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
  };
}

function subscribeEquityOrFuturesStream(
  symbol: string,
  timeframe: Timeframe,
  lastKnownCandle: Candle | undefined,
  finnhubApiKey: string | undefined,
  handlers: StreamHandlers
): () => void {
  let closed = false;
  let quotePollTimer: number | null = null;
  let marketCheckTimer: number | null = null;
  let tvEventSource: EventSource | null = null;
  let unsubApiTick: (() => void) | null = null;
  let unsubApiStatus: (() => void) | null = null;
  let activeCandle: Candle | null = lastKnownCandle ? { ...lastKnownCandle } : null;

  const upperSym = symbol.toUpperCase();
  const isFutures = getSymbolCategory(upperSym) === 'Futures';
  const etfProxySym = isFutures ? resolveFuturesEtfProxy(upperSym) : undefined;
  const fhSym = resolveFinnhubSymbol(upperSym);
  const stepSec = TIMEFRAME_SECONDS[timeframe];
  const refAnchorPrice = lastKnownCandle?.close ?? BASE_PRICES[upperSym] ?? 100;
  const decimals = getDecimalsForPrice(refAnchorPrice);
  const fhKey = (finnhubApiKey ?? '').trim();
  // Finnhub subscriptions are stocks/ETF proxies, not direct CME futures trades.
  const hasFhKey = fhKey.length > 4 && !isFutures;

  let latestQuotePrice: number | null = lastKnownCandle?.close ?? null;
  let lastRealTickMs = 0;

  const applyPriceTick = (rawPrice: number, timestampSec?: number) => {
    const price = roundToDecimals(rawPrice, decimals);
    if (!Number.isFinite(price) || price <= 0) return;

    const nowSec = timestampSec ?? Math.floor(Date.now() / 1000);
    const nextBucket = (nowSec - (nowSec % stepSec)) as UTCTimestamp;
    const isSameDailyOrHigherBar =
      activeCandle &&
      stepSec >= 86400 &&
      nowSec - Number(activeCandle.time) < stepSec;
    const bucket = isSameDailyOrHigherBar
      ? activeCandle!.time
      : activeCandle && Number(nextBucket) < Number(activeCandle.time)
      ? activeCandle.time
      : nextBucket;

    if (!activeCandle || Number(bucket) > Number(activeCandle.time)) {
      if (activeCandle) {
        handlers.onCandle({ ...activeCandle }, true);
      }
      activeCandle = {
        time: bucket,
        open: activeCandle ? activeCandle.close : price,
        high: activeCandle ? Math.max(activeCandle.close, price) : price,
        low: activeCandle ? Math.min(activeCandle.close, price) : price,
        close: price,
        volume: 12,
      };
    } else {
      activeCandle = {
        ...activeCandle,
        high: Math.max(activeCandle.high, price),
        low: Math.min(activeCandle.low, price),
        close: price,
        volume: activeCandle.volume + 3,
      };
    }

    handlers.onCandle({ ...activeCandle }, false);
  };

  const stopAllStreams = () => {
    if (quotePollTimer !== null) {
      window.clearInterval(quotePollTimer);
      quotePollTimer = null;
    }
    if (tvEventSource) {
      tvEventSource.close();
      tvEventSource = null;
    }
    if (unsubApiTick) {
      unsubApiTick();
      unsubApiTick = null;
    }
    if (unsubApiStatus) {
      unsubApiStatus();
      unsubApiStatus = null;
    }
  };

  const evaluateMarketState = () => {
    if (closed) return;
    const status = getMarketStatus(symbol);
    handlers.onMarketStateChange?.(status.isOpen);
  };

  evaluateMarketState();
  marketCheckTimer = window.setInterval(evaluateMarketState, 15000);

  // Register Finnhub WS tick listener when key is supplied
  if (hasFhKey) {
    let listeners = apiTickListeners.get(upperSym);
    if (!listeners) {
      listeners = new Set();
      apiTickListeners.set(upperSym, listeners);
    }
    const tickCb = (mappedPrice: number, timestampSec: number) => {
      if (closed) return;
      lastRealTickMs = Date.now();
      latestQuotePrice = mappedPrice;
      handlers.onError?.(undefined);
      handlers.onStatusChange?.(true);
      applyPriceTick(mappedPrice, timestampSec);
    };
    listeners.add(tickCb);
    unsubApiTick = () => {
      apiTickListeners.get(upperSym)?.delete(tickCb);
    };

    syncLiveApiCredentials(fhKey);
    if (etfProxySym) {
      void seedAllFuturesScaleFactors();
    }

    unsubApiStatus = subscribeLiveApiStatus((st) => {
      if (closed) return;
      if (st.finnhubState === 'connected') {
        handlers.onError?.(undefined);
        handlers.onStatusChange?.(true);
      } else if (st.finnhubState === 'error') {
        handlers.onError?.(st.errorMessage);
      }
    });
  }

  // Server-side zero-delay TradingView stream SSE (if available)
  if (TV_SUPPORTED_SYMBOLS.has(upperSym) && typeof EventSource !== 'undefined') {
    try {
      const es = new EventSource(
        `/api/market/tv/stream?symbol=${encodeURIComponent(upperSym)}`
      );
      tvEventSource = es;
      es.onmessage = (evt) => {
        if (closed) return;
        try {
          const msg = JSON.parse(evt.data);
          const px = Number(msg?.price);
          const tsValue = Number(msg?.timestampSec ?? msg?.time);
          const tsSec = Number.isFinite(tsValue) && tsValue > 0
            ? Math.floor(tsValue)
            : 0;
          if (Number.isFinite(px) && px > 0) {
            lastRealTickMs = Date.now();
            latestQuotePrice = px;
            handlers.onStatusChange?.(true);
            applyPriceTick(px, tsSec);
          }
        } catch {
          // Ignore malformed SSE payload
        }
      };
    } catch {
      // Ignore if EventSource fails
    }
  }

  // Fallback real-quote poller (Finnhub /quote + TradingView /api/market/quotes) when no active WS/SSE tick arrived recently
  const pollRealtimeQuote = async () => {
    if (closed) return;
    if (Date.now() - lastRealTickMs < 2200) return;

    try {
      if (hasFhKey) {
        const res = await fetch(
          `${FINNHUB_REST}/quote?symbol=${encodeURIComponent(
            fhSym
          )}&token=${encodeURIComponent(fhKey)}`
        );
        if (res.ok) {
          const q = await res.json();
          if (q && typeof q.c === 'number' && q.c > 0) {
            const factor = etfProxySym
              ? await resolveFuturesScaleFactor(upperSym, etfProxySym)
              : 1;
            const scaledPrice = q.c * factor;
            const quoteTimeSec = Number(q.t);
            const nowSec = Math.floor(Date.now() / 1000);
            if (!Number.isFinite(quoteTimeSec) || quoteTimeSec <= 0 || nowSec - quoteTimeSec > 90) return;
            lastRealTickMs = Date.now();
            latestQuotePrice = scaledPrice;
            handlers.onStatusChange?.(true);
            applyPriceTick(scaledPrice, quoteTimeSec);
            return;
          }
        }
      }

      if (TV_SUPPORTED_SYMBOLS.has(upperSym)) {
        const quotes = await fetchRealtimeQuotes([upperSym]);
        const tq = quotes?.[upperSym];
        if (tq && tq.price > 0) {
          const quoteTimeSec = Number(tq.timestampSec ?? tq.time);
          if (Number.isFinite(quoteTimeSec) && quoteTimeSec > 0) {
            lastRealTickMs = Date.now();
            latestQuotePrice = tq.price;
            handlers.onStatusChange?.(true);
            applyPriceTick(tq.price, Math.floor(quoteTimeSec));
          }
        }
      }
    } catch {
      // Keep running smoothly
    }
  };

  void pollRealtimeQuote();
  quotePollTimer = window.setInterval(pollRealtimeQuote, 2500);


  return () => {
    closed = true;
    if (marketCheckTimer !== null) window.clearInterval(marketCheckTimer);
    stopAllStreams();
  };
}
