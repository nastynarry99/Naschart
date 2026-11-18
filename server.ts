import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const ALLOWED_INTERVALS = new Set([
  '1m',
  '2m',
  '5m',
  '15m',
  '30m',
  '60m',
  '1d',
  '1wk',
  '1mo',
]);

const ALLOWED_RANGES = new Set([
  '1d',
  '5d',
  '7d',
  '1mo',
  '60d',
  '3mo',
  '6mo',
  '1y',
  '2y',
  '5y',
  '10y',
]);

interface CacheEntry {
  ts: number;
  payload: unknown;
}

const yahooCache = new Map<string, CacheEntry>();
const cnbcQuoteCache = new Map<string, CacheEntry>();
const tvCandlesCache = new Map<string, CacheEntry>();
const LIVE_QUOTE_CACHE_TTL_MS = 750;
const REALTIME_QUOTE_CACHE_TTL_MS = 500;
const HISTORY_CACHE_TTL_MS = 12_000;

interface TvSymbolSpec {
  tvSymbol: string;
  extended: boolean;
}

const TV_SYMBOL_MAP: Record<string, TvSymbolSpec> = {
  // Use the actual exchange-listed continuous futures contracts, not cash-index CFDs.
  'NQ1!': { tvSymbol: 'CME_MINI:NQ1!', extended: false },
  'ES1!': { tvSymbol: 'CME_MINI:ES1!', extended: false },
  'YM1!': { tvSymbol: 'CBOT_MINI:YM1!', extended: false },
  'CL1!': { tvSymbol: 'NYMEX:CL1!', extended: false },
  AAPL: { tvSymbol: 'NASDAQ:AAPL', extended: true },
  NVDA: { tvSymbol: 'NASDAQ:NVDA', extended: true },
  TSLA: { tvSymbol: 'NASDAQ:TSLA', extended: true },
  MSFT: { tvSymbol: 'NASDAQ:MSFT', extended: true },
  AMZN: { tvSymbol: 'NASDAQ:AMZN', extended: true },
};

const TV_REVERSE_SYMBOL_MAP: Record<string, string[]> = {};
for (const [appSym, spec] of Object.entries(TV_SYMBOL_MAP)) {
  if (!TV_REVERSE_SYMBOL_MAP[spec.tvSymbol]) {
    TV_REVERSE_SYMBOL_MAP[spec.tvSymbol] = [];
  }
  TV_REVERSE_SYMBOL_MAP[spec.tvSymbol].push(appSym);
}

const ALLOWED_TV_RESOLUTIONS = new Set([
  '1',
  '3',
  '5',
  '15',
  '30',
  '60',
  '120',
  '180',
  '240',
  '1D',
  '1W',
  '1M',
]);

type NodeWebSocketCtor = new (
  url: string,
  options?: { headers?: Record<string, string> }
) => WebSocket;

const NodeWS = globalThis.WebSocket as unknown as NodeWebSocketCtor;

function tvPack(method: string, params: unknown[]): string {
  const payload = JSON.stringify({ m: method, p: params });
  return `~m~${payload.length}~m~${payload}`;
}

function tvUnpack(raw: string): string[] {
  const msgs: string[] = [];
  let i = 0;
  while (i < raw.length) {
    if (!raw.startsWith('~m~', i)) break;
    const lenEnd = raw.indexOf('~m~', i + 3);
    if (lenEnd === -1) break;
    const len = parseInt(raw.slice(i + 3, lenEnd), 10);
    if (!Number.isFinite(len) || len < 0) break;
    const bodyStart = lenEnd + 3;
    msgs.push(raw.slice(bodyStart, bodyStart + len));
    i = bodyStart + len;
  }
  return msgs;
}

interface NormalizedRealtimeQuote {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  timestampSec: number;
  session: string;
  realTime: boolean;
}

interface TvLiveQuoteState {
  regularPrice: number;
  extPrice: number;
  prevClose: number;
  changePct: number;
  extChangePct: number;
  session: string;
  updatedAtMs: number;
}

interface TvSecondBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const tvRawQuotes = new Map<string, TvLiveQuoteState>();
const tvLiveQuotes = new Map<string, NormalizedRealtimeQuote>();
const tvSecondBars = new Map<string, TvSecondBar[]>();
const tvStreamListeners = new Map<string, Set<(q: NormalizedRealtimeQuote) => void>>();

let tvHubWs: WebSocket | null = null;
let tvHubReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let tvHubStarted = false;

function recordTvSecondBar(appSym: string, price: number, timeSec: number) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timeSec) || timeSec <= 0) {
    return;
  }
  let arr = tvSecondBars.get(appSym);
  if (!arr) {
    arr = [];
    tvSecondBars.set(appSym, arr);
  }
  const last = arr[arr.length - 1];
  if (!last) {
    arr.push({
      time: timeSec,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 1,
    });
    return;
  }
  if (timeSec === last.time) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    last.volume += 1;
  } else if (timeSec > last.time) {
    // Fill brief quiet intervals (<= 30s) at last close so contiguous seconds stay seamless
    const gap = timeSec - last.time;
    if (gap > 1 && gap <= 30) {
      for (let t = last.time + 1; t < timeSec; t++) {
        arr.push({
          time: t,
          open: last.close,
          high: last.close,
          low: last.close,
          close: last.close,
          volume: 0,
        });
      }
    }
    const prevClose = arr[arr.length - 1].close;
    arr.push({
      time: timeSec,
      open: gap <= 30 ? prevClose : price,
      high: gap <= 30 ? Math.max(prevClose, price) : price,
      low: gap <= 30 ? Math.min(prevClose, price) : price,
      close: price,
      volume: 1,
    });
    if (arr.length > 3600) {
      arr.splice(0, arr.length - 3600);
    }
  }
}

function buildNormalizedTvQuote(
  appSym: string,
  spec: TvSymbolSpec,
  state: TvLiveQuoteState
): NormalizedRealtimeQuote | null {
  const isRegSession = state.session === 'market';
  const useExt =
    spec.extended &&
    state.extPrice > 0 &&
    (!isRegSession || state.regularPrice <= 0);
  const price = useExt ? state.extPrice : state.regularPrice || state.extPrice;
  if (!Number.isFinite(price) || price <= 0) return null;

  const prevClose = state.prevClose > 0 ? state.prevClose : price;
  const changePct =
    prevClose > 0
      ? ((price - prevClose) / prevClose) * 100
      : useExt
      ? state.extChangePct
      : state.changePct;

  return {
    symbol: appSym,
    price,
    prevClose,
    changePct,
    timestampSec: Math.floor(state.updatedAtMs / 1000),
    session: state.session || 'market',
    realTime: true,
  };
}

function startTradingViewQuoteHub() {
  if (tvHubStarted || !NodeWS) return;
  tvHubStarted = true;

  const connect = () => {
    if (tvHubReconnectTimer) {
      clearTimeout(tvHubReconnectTimer);
      tvHubReconnectTimer = null;
    }
    try {
      const ws = new NodeWS(
        'wss://data.tradingview.com/socket.io/websocket?from=chart%2F',
        {
          headers: {
            Origin: 'https://www.tradingview.com',
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        }
      );
      tvHubWs = ws;
      const qs = `qs_${Math.random().toString(36).slice(2, 10)}`;

      ws.onopen = () => {
        ws.send(tvPack('set_auth_token', ['unauthorized_user_token']));
        ws.send(tvPack('quote_create_session', [qs]));
        const uniqueTvSyms = Object.keys(TV_REVERSE_SYMBOL_MAP);
        for (const tvSym of uniqueTvSyms) {
          ws.send(tvPack('quote_add_symbols', [qs, tvSym]));
        }
      };

      ws.onmessage = (ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
        for (const part of tvUnpack(raw)) {
          if (part.startsWith('~h~')) {
            if (ws.readyState === 1) {
              ws.send(`~m~${part.length}~m~${part}`);
            }
            continue;
          }
          try {
            const msg = JSON.parse(part);
            if (msg?.m !== 'qsd' || !Array.isArray(msg.p)) continue;
            const tvSym = String(msg.p[1]?.n ?? '');
            const v = msg.p[1]?.v;
            if (!tvSym || !v || typeof v !== 'object') continue;

            const prev = tvRawQuotes.get(tvSym) ?? {
              regularPrice: 0,
              extPrice: 0,
              prevClose: 0,
              changePct: 0,
              extChangePct: 0,
              session: 'market',
              updatedAtMs: Date.now(),
            };

            const next: TvLiveQuoteState = {
              regularPrice:
                typeof v.lp === 'number' && v.lp > 0 ? v.lp : prev.regularPrice,
              extPrice:
                typeof v.rtc === 'number' && v.rtc > 0
                  ? v.rtc
                  : v.rtc === null
                  ? 0
                  : prev.extPrice,
              prevClose:
                typeof v.prev_close_price === 'number' && v.prev_close_price > 0
                  ? v.prev_close_price
                  : prev.prevClose,
              changePct: typeof v.chp === 'number' ? v.chp : prev.changePct,
              extChangePct: typeof v.rchp === 'number' ? v.rchp : prev.extChangePct,
              session:
                typeof v.current_session === 'string' && v.current_session
                  ? v.current_session
                  : prev.session,
              updatedAtMs: Date.now(),
            };

            tvRawQuotes.set(tvSym, next);

            const appSymbols = TV_REVERSE_SYMBOL_MAP[tvSym] ?? [];
            const tickSec = Math.floor(Date.now() / 1000);
            for (const appSym of appSymbols) {
              const spec = TV_SYMBOL_MAP[appSym];
              if (!spec) continue;
              const normalized = buildNormalizedTvQuote(appSym, spec, next);
              if (!normalized) continue;
              tvLiveQuotes.set(appSym, normalized);
              recordTvSecondBar(appSym, normalized.price, tickSec);
              const listeners = tvStreamListeners.get(appSym);
              if (listeners && listeners.size > 0) {
                for (const cb of listeners) {
                  cb(normalized);
                }
              }
            }
          } catch {
            // Ignore malformed frame
          }
        }
      };

      const scheduleReconnect = () => {
        if (tvHubWs === ws) tvHubWs = null;
        if (!tvHubReconnectTimer) {
          tvHubReconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = scheduleReconnect;
      ws.onclose = scheduleReconnect;
    } catch {
      if (!tvHubReconnectTimer) {
        tvHubReconnectTimer = setTimeout(connect, 3000);
      }
    }
  };

  connect();
}

async function fetchTradingViewCandlesFromUpstream(
  spec: TvSymbolSpec,
  resolution: string,
  count: number
): Promise<Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}> | null> {
  if (!NodeWS) return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      bars: Array<{
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }> | null
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (ws.readyState === 0 || ws.readyState === 1) ws.close();
      } catch {
        // Ignore close error
      }
      resolve(bars);
    };

    const ws = new NodeWS(
      'wss://data.tradingview.com/socket.io/websocket?from=chart%2F',
      {
        headers: {
          Origin: 'https://www.tradingview.com',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      }
    );

    const cs = `cs_${Math.random().toString(36).slice(2, 10)}`;
    const timer = setTimeout(() => finish(null), 6500);
    let collected: Array<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }> = [];

    ws.onopen = () => {
      ws.send(tvPack('set_auth_token', ['unauthorized_user_token']));
      ws.send(tvPack('chart_create_session', [cs, '']));
      const symSpec: Record<string, string> = {
        symbol: spec.tvSymbol,
        adjustment: 'splits',
      };
      if (spec.extended) {
        symSpec.session = 'extended';
      }
      ws.send(tvPack('resolve_symbol', [cs, 'sds_sym_1', `=${JSON.stringify(symSpec)}`]));
      ws.send(tvPack('create_series', [cs, 'sds_1', 's1', 'sds_sym_1', resolution, count]));
    };

    ws.onmessage = (ev) => {
      const raw = typeof ev.data === 'string' ? ev.data : String(ev.data);
      for (const part of tvUnpack(raw)) {
        if (part.startsWith('~h~')) {
          if (ws.readyState === 1) {
            ws.send(`~m~${part.length}~m~${part}`);
          }
          continue;
        }
        try {
          const msg = JSON.parse(part);
          if (msg?.m === 'timescale_update') {
            const rawBars = msg.p?.[1]?.sds_1?.s;
            if (Array.isArray(rawBars) && rawBars.length > 0) {
              collected = rawBars
                .map((entry: { v?: number[] }) => {
                  const v = entry?.v;
                  if (!Array.isArray(v) || v.length < 5) return null;
                  const time = Number(v[0]);
                  const open = Number(v[1]);
                  const high = Number(v[2]);
                  const low = Number(v[3]);
                  const close = Number(v[4]);
                  const volume = Number(v[5] ?? 0);
                  if (
                    !Number.isFinite(time) ||
                    !Number.isFinite(open) ||
                    !Number.isFinite(high) ||
                    !Number.isFinite(low) ||
                    !Number.isFinite(close) ||
                    close <= 0
                  ) {
                    return null;
                  }
                  return {
                    time,
                    open,
                    high: Math.max(high, open, close),
                    low: Math.min(low, open, close),
                    close,
                    volume: Number.isFinite(volume) && volume >= 0 ? volume : 0,
                  };
                })
                .filter(
                  (
                    b: {
                      time: number;
                      open: number;
                      high: number;
                      low: number;
                      close: number;
                      volume: number;
                    } | null
                  ): b is {
                    time: number;
                    open: number;
                    high: number;
                    low: number;
                    close: number;
                    volume: number;
                  } => b !== null
                )
                .sort((a, b) => a.time - b.time);
            }
          } else if (msg?.m === 'series_completed') {
            finish(collected.length > 0 ? collected : null);
          } else if (msg?.m === 'symbol_error' || msg?.m === 'series_error') {
            finish(null);
          }
        } catch {
          // Ignore non-JSON frame
        }
      }
    };

    ws.onerror = () => finish(null);
    ws.onclose = () => finish(collected.length > 0 ? collected : null);
  });
}

function parseCnbcNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[$,%\s+]/g, '').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseCnbcTimeSec(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  // Date-only strings like "2026-11-13" lack intraday time
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : null;
}

async function fetchCnbcQuotesFromUpstream(
  symbols: string[]
): Promise<Record<string, NormalizedRealtimeQuote> | null> {
  if (symbols.length === 0) return {};
  const joined = symbols.map((s) => encodeURIComponent(s)).join('|');
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${joined}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json,text/plain,*/*',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const rawList = data?.FormattedQuoteResult?.FormattedQuote;
    const list: any[] = Array.isArray(rawList)
      ? rawList
      : rawList
      ? [rawList]
      : [];

    const out: Record<string, NormalizedRealtimeQuote> = {};
    const nowSec = Math.floor(Date.now() / 1000);
    for (const q of list) {
      const sym = String(q?.symbol ?? '').toUpperCase().trim();
      if (!sym) continue;

      const regPrice = parseCnbcNumber(q.last);
      const regTimeSec = parseCnbcTimeSec(q.last_time);
      const extPrice = parseCnbcNumber(q?.ExtendedMktQuote?.last);
      const extTimeSec = parseCnbcTimeSec(q?.ExtendedMktQuote?.last_time);
      const session = String(q?.curmktstatus ?? 'REG_MKT');

      const useExt =
        extPrice !== null &&
        extPrice > 0 &&
        (session !== 'REG_MKT' ||
          (extTimeSec !== null && (regTimeSec === null || extTimeSec >= regTimeSec)));

      const price = useExt ? extPrice : regPrice;
      if (price === null || price <= 0) continue;

      const prevClose = parseCnbcNumber(q.previous_day_closing) ?? regPrice ?? price;
      const timestampSec = useExt
        ? extTimeSec ?? regTimeSec ?? nowSec
        : regTimeSec ?? extTimeSec ?? nowSec;
      const changePct =
        prevClose > 0
          ? ((price - prevClose) / prevClose) * 100
          : parseCnbcNumber(useExt ? q?.ExtendedMktQuote?.change_pct : q.change_pct) ?? 0;

      out[sym] = {
        symbol: sym,
        price,
        prevClose,
        changePct,
        timestampSec,
        session: useExt ? String(q?.ExtendedMktQuote?.type ?? session) : session,
        realTime: String(q?.realTime ?? '').toLowerCase() === 'true',
      };
    }
    return out;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function fetchYahooChartFromUpstream(
  symbol: string,
  params: URLSearchParams
): Promise<{ status: number; data: unknown } | null> {
  const hosts = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com'];
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'application/json,text/plain,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  for (const host of hosts) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.chart?.result?.[0]) {
        return { status: 200, data };
      }
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}

async function startServer() {
  const app = express();
  startTradingViewQuoteHub();

  app.get('/api/market/tv/candles', async (req, res) => {
    const rawSymbol = String(req.query.symbol ?? '').trim().toUpperCase();
    const resolution = String(req.query.resolution ?? '1').trim();
    const rawCount = parseInt(String(req.query.count ?? '500'), 10);
    const count = Number.isFinite(rawCount)
      ? Math.max(20, Math.min(2000, rawCount))
      : 500;

    const spec = TV_SYMBOL_MAP[rawSymbol];
    if (!spec) {
      res.status(404).json({ error: 'Unsupported TradingView symbol mapping' });
      return;
    }
    if (!ALLOWED_TV_RESOLUTIONS.has(resolution)) {
      res.status(400).json({ error: 'Invalid resolution' });
      return;
    }

    const ttl =
      resolution === '1' || resolution === '3' || resolution === '5'
        ? LIVE_QUOTE_CACHE_TTL_MS
        : 5000;
    const cacheKey = `${spec.tvSymbol}:${resolution}:${count}`;
    const cached = tvCandlesCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ttl) {
      res.json(cached.payload);
      return;
    }

    const bars = await fetchTradingViewCandlesFromUpstream(spec, resolution, count);
    if (!bars || bars.length === 0) {
      res.status(502).json({ error: 'TradingView candles unavailable' });
      return;
    }

    // Sync the latest bar close/high/low with the zero-delay streaming quote if fresher
    const liveQuote = tvLiveQuotes.get(rawSymbol);
    if (liveQuote && liveQuote.price > 0 && bars.length > 0) {
      const last = bars[bars.length - 1];
      if (Date.now() - liveQuote.timestampSec * 1000 < 30_000) {
        last.close = liveQuote.price;
        last.high = Math.max(last.high, liveQuote.price);
        last.low = Math.min(last.low, liveQuote.price);
      }
    }

    const payload = {
      symbol: rawSymbol,
      tvSymbol: spec.tvSymbol,
      bars,
      fetchedAt: Date.now(),
    };
    tvCandlesCache.set(cacheKey, { ts: Date.now(), payload });
    if (tvCandlesCache.size > 80) {
      const oldestKey = tvCandlesCache.keys().next().value;
      if (oldestKey) tvCandlesCache.delete(oldestKey);
    }

    res.json(payload);
  });

  app.get('/api/market/tv/seconds', (req, res) => {
    const rawSymbol = String(req.query.symbol ?? '').trim().toUpperCase();
    const rawStep = parseInt(String(req.query.step ?? '1'), 10);
    const step = [1, 5, 15, 30].includes(rawStep) ? rawStep : 1;

    if (!TV_SYMBOL_MAP[rawSymbol]) {
      res.status(404).json({ error: 'Unsupported symbol' });
      return;
    }

    const secBars = tvSecondBars.get(rawSymbol) ?? [];
    if (step === 1 || secBars.length === 0) {
      res.json({ symbol: rawSymbol, step, bars: secBars });
      return;
    }

    const aggregated: TvSecondBar[] = [];
    for (const b of secBars) {
      const bucket = b.time - (b.time % step);
      const tail = aggregated[aggregated.length - 1];
      if (!tail || tail.time !== bucket) {
        aggregated.push({
          time: bucket,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        });
      } else {
        tail.high = Math.max(tail.high, b.high);
        tail.low = Math.min(tail.low, b.low);
        tail.close = b.close;
        tail.volume += b.volume;
      }
    }

    res.json({ symbol: rawSymbol, step, bars: aggregated });
  });

  app.get('/api/market/tv/stream', (req, res) => {
    const rawSymbol = String(req.query.symbol ?? '').trim().toUpperCase();
    if (!TV_SYMBOL_MAP[rawSymbol]) {
      res.status(404).json({ error: 'Unsupported streaming symbol' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (q: NormalizedRealtimeQuote) => {
      try {
        res.write(`data: ${JSON.stringify(q)}\n\n`);
      } catch {
        // Ignore broken pipe
      }
    };

    const existing = tvLiveQuotes.get(rawSymbol);
    if (existing) {
      sendEvent(existing);
    }

    let set = tvStreamListeners.get(rawSymbol);
    if (!set) {
      set = new Set();
      tvStreamListeners.set(rawSymbol, set);
    }
    set.add(sendEvent);

    const pingTimer = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // Ignore
      }
    }, 15_000);

    req.on('close', () => {
      clearInterval(pingTimer);
      tvStreamListeners.get(rawSymbol)?.delete(sendEvent);
    });
  });

  app.get('/api/market/quotes', async (req, res) => {
    const rawSymbols = String(req.query.symbols ?? '').trim();
    if (!rawSymbols) {
      res.status(400).json({ error: 'Missing symbols' });
      return;
    }
    const symbols = Array.from(
      new Set(
        rawSymbols
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^[A-Z0-9=^.\-!]{1,20}$/.test(s))
      )
    ).slice(0, 25);

    if (symbols.length === 0) {
      res.status(400).json({ error: 'No valid symbols' });
      return;
    }

    const combined: Record<string, NormalizedRealtimeQuote> = {};
    const missingForCnbc: string[] = [];

    for (const sym of symbols) {
      const tvQ = tvLiveQuotes.get(sym);
      if (tvQ && Date.now() - tvQ.timestampSec * 1000 < 120_000) {
        combined[sym] = tvQ;
      } else {
        missingForCnbc.push(sym);
      }
    }

    if (missingForCnbc.length > 0) {
      const cacheKey = [...missingForCnbc].sort().join(',');
      const cached = cnbcQuoteCache.get(cacheKey);
      let cnbcMap: Record<string, NormalizedRealtimeQuote> | null = null;
      if (cached && Date.now() - cached.ts < REALTIME_QUOTE_CACHE_TTL_MS) {
        cnbcMap = (cached.payload as { quotes: Record<string, NormalizedRealtimeQuote> }).quotes;
      } else {
        cnbcMap = await fetchCnbcQuotesFromUpstream(missingForCnbc);
        if (cnbcMap) {
          cnbcQuoteCache.set(cacheKey, {
            ts: Date.now(),
            payload: { quotes: cnbcMap, fetchedAt: Date.now() },
          });
          if (cnbcQuoteCache.size > 60) {
            const oldestKey = cnbcQuoteCache.keys().next().value;
            if (oldestKey) cnbcQuoteCache.delete(oldestKey);
          }
        }
      }
      if (cnbcMap) {
        Object.assign(combined, cnbcMap);
      }
    }

    res.json({ quotes: combined, fetchedAt: Date.now() });
  });

  app.get('/api/market/yahoo', async (req, res) => {
    const rawSymbol = String(req.query.symbol ?? '').trim();
    const interval = String(req.query.interval ?? '1m').trim();
    const range = String(req.query.range ?? '').trim();
    const period1 = String(req.query.period1 ?? '').trim();
    const period2 = String(req.query.period2 ?? '').trim();
    const includePrePost = String(req.query.includePrePost ?? 'true') === 'true';

    if (!/^[A-Za-z0-9=^.\-]{1,20}$/.test(rawSymbol)) {
      res.status(400).json({ error: 'Invalid symbol' });
      return;
    }
    if (!ALLOWED_INTERVALS.has(interval)) {
      res.status(400).json({ error: 'Invalid interval' });
      return;
    }

    const params = new URLSearchParams();
    params.set('interval', interval);
    params.set('includePrePost', includePrePost ? 'true' : 'false');

    if (period1 && period2 && /^\d+$/.test(period1) && /^\d+$/.test(period2)) {
      params.set('period1', period1);
      params.set('period2', period2);
    } else {
      params.set('range', ALLOWED_RANGES.has(range) ? range : '7d');
    }

    const ttl =
      interval === '1m' && (range === '1d' || range === '5d')
        ? LIVE_QUOTE_CACHE_TTL_MS
        : HISTORY_CACHE_TTL_MS;
    const cacheKey = `${rawSymbol}:${params.toString()}`;
    const cached = yahooCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ttl) {
      res.json(cached.payload);
      return;
    }

    const result = await fetchYahooChartFromUpstream(rawSymbol, params);
    if (!result) {
      res.status(502).json({ error: 'Upstream market data unavailable' });
      return;
    }

    yahooCache.set(cacheKey, { ts: Date.now(), payload: result.data });
    if (yahooCache.size > 120) {
      const oldestKey = yahooCache.keys().next().value;
      if (oldestKey) yahooCache.delete(oldestKey);
    }

    res.json(result.data);
  });

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(__dirname, 'dist');
  let servedViaVite = false;

  if (!isProd) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      servedViaVite = true;
    } catch {
      servedViaVite = false;
    }
  }

  if (!servedViaVite && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
