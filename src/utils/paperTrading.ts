import {
  SYMBOL_CATALOG,
  SYMBOL_CONTRACT_SPECS,
  type PaperAccountState,
  type PaperPosition,
  type PaperTrade,
  type SymbolContractSpec,
  type TradeMode,
} from '../types/trading';

export const DEFAULT_PAPER_LEVERAGE = 20;
const QTY_EPS = 1e-8;

export function roundQty(qty: number): number {
  return Math.round(qty * 1e6) / 1e6;
}

export function getSymbolContractSpec(
  symbol: string,
  referencePrice?: number
): SymbolContractSpec {
  const upper = (symbol || '').toUpperCase().trim();
  const direct = SYMBOL_CONTRACT_SPECS[upper];
  if (direct) return direct;

  const catalogMeta = SYMBOL_CATALOG.find((s) => s.symbol === upper);
  if (catalogMeta?.category === 'Futures') {
    return {
      category: 'Futures',
      pointValue: 20,
      tickSize: 0.25,
      minQty: 1,
      qtyStep: 1,
      isIntegerOnly: true,
      unitLabel: 'Contracts',
    };
  }
  if (catalogMeta?.category === 'Stocks' || (upper && !upper.endsWith('USDT') && !upper.endsWith('USD') && !upper.endsWith('BTC') && !upper.includes('!'))) {
    return {
      category: 'Stocks',
      pointValue: 1,
      tickSize: 0.01,
      minQty: 1,
      qtyStep: 1,
      isIntegerOnly: true,
      unitLabel: 'Shares',
    };
  }

  const ref = referencePrice ?? 0;
  const tickSize = ref >= 1000 ? 0.1 : ref >= 10 ? 0.01 : 0.001;
  return {
    category: 'Crypto',
    pointValue: 1,
    tickSize,
    minQty: 0.01,
    qtyStep: 0.01,
    isIntegerOnly: false,
    unitLabel: 'Qty',
  };
}

export function getDefaultOrderQty(price: number, symbol?: string): number {
  if (symbol) {
    const spec = getSymbolContractSpec(symbol, price);
    if (spec.isIntegerOnly) return 1;
  }
  if (price >= 20000) return 0.1;
  if (price >= 2000) return 0.5;
  if (price >= 200) return 2;
  if (price >= 20) return 10;
  return 25;
}

export function sanitizeOrderQty(
  symbol: string,
  rawQty: number,
  referencePrice?: number
): number {
  const spec = getSymbolContractSpec(symbol, referencePrice);
  if (spec.isIntegerOnly) {
    if (!Number.isFinite(rawQty) || rawQty < 1) return 1;
    return Math.max(1, Math.round(rawQty));
  }
  if (!Number.isFinite(rawQty) || rawQty < spec.minQty) {
    return getDefaultOrderQty(referencePrice ?? 1, symbol);
  }
  return Math.max(spec.minQty, roundQty(rawQty));
}

export function stepOrderQty(
  symbol: string,
  currentQty: number,
  direction: 1 | -1,
  referencePrice?: number
): number {
  const spec = getSymbolContractSpec(symbol, referencePrice);
  const base = sanitizeOrderQty(symbol, currentQty, referencePrice);
  if (spec.isIntegerOnly) {
    return Math.max(1, base + direction);
  }
  const step = base >= 5 ? 1 : base >= 0.5 ? 0.1 : 0.01;
  const next = roundQty(base + direction * step);
  return Math.max(spec.minQty, next);
}

export function getSpreadForPrice(_price: number): number {
  return 0;
}

export function calculatePositionMetrics(
  pos: PaperPosition,
  currentPrice: number
): {
  unrealizedPnl: number;
  unrealizedPct: number;
  usedMargin: number;
  notional: number;
} {
  const effectivePrice = currentPrice > 0 ? currentPrice : pos.entryPrice;
  const priceDiff =
    pos.side === 'long'
      ? effectivePrice - pos.entryPrice
      : pos.entryPrice - effectivePrice;
  const pointValue = Math.max(0.0001, pos.pointValue || 1);
  const unrealizedPnl = priceDiff * pos.qty * pointValue;
  const notional = pos.entryPrice * pos.qty * pointValue;
  const leverage = Math.max(1, pos.leverage || DEFAULT_PAPER_LEVERAGE);
  const usedMargin = notional / leverage;
  const unrealizedPct =
    usedMargin > 0
      ? (unrealizedPnl / usedMargin) * 100
      : pos.entryPrice > 0
      ? (priceDiff / pos.entryPrice) * 100
      : 0;

  return { unrealizedPnl, unrealizedPct, usedMargin, notional };
}

export function calculateAccountOverview(
  account: PaperAccountState,
  livePrices: Record<string, number>
): {
  balance: number;
  equity: number;
  unrealizedPnl: number;
  usedMargin: number;
  availableMargin: number;
} {
  let unrealizedPnl = 0;
  let usedMargin = 0;

  for (const pos of account.positions) {
    const price = livePrices[pos.symbol] ?? pos.entryPrice;
    const m = calculatePositionMetrics(pos, price);
    unrealizedPnl += m.unrealizedPnl;
    usedMargin += m.usedMargin;
  }

  const equity = account.balance + unrealizedPnl;
  const availableMargin = Math.max(0, equity - usedMargin);

  return {
    balance: account.balance,
    equity,
    unrealizedPnl,
    usedMargin,
    availableMargin,
  };
}

export interface NettingFillInput {
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  price: number;
  fillTime: number;
  candleTime: number;
  tpPrice?: number;
  slPrice?: number;
  pointValue: number;
  leverage: number;
  mode: TradeMode;
}

export type NettingAction =
  | 'opened'
  | 'added'
  | 'partial_closed'
  | 'closed'
  | 'reversed';

export interface NettingFillResult {
  nextAccount: PaperAccountState;
  action: NettingAction;
  realizedPnl: number;
  closedQty: number;
  resultingPos?: PaperPosition;
}

export function calculateRequiredNettingMargin(
  account: PaperAccountState,
  input: {
    symbol: string;
    side: 'long' | 'short';
    qty: number;
    price: number;
    pointValue: number;
    leverage: number;
    mode: TradeMode;
  }
): number {
  const incomingQty = roundQty(input.qty);
  const pointValue = Math.max(0.0001, input.pointValue || 1);
  const leverage = Math.max(1, input.leverage || DEFAULT_PAPER_LEVERAGE);

  const oppPositions = account.positions.filter(
    (p) =>
      p.symbol === input.symbol &&
      p.mode === input.mode &&
      p.side !== input.side
  );

  if (oppPositions.length === 0) {
    return (incomingQty * input.price * pointValue) / leverage;
  }

  const openOppQty = roundQty(
    oppPositions.reduce((sum, p) => sum + p.qty, 0)
  );
  if (incomingQty <= openOppQty + QTY_EPS) {
    return 0;
  }

  const excessQty = roundQty(incomingQty - openOppQty);
  const freedOppMargin = oppPositions.reduce((sum, p) => {
    const pv = Math.max(0.0001, p.pointValue || 1);
    const lev = Math.max(1, p.leverage || DEFAULT_PAPER_LEVERAGE);
    return sum + (p.entryPrice * p.qty * pv) / lev;
  }, 0);
  const newMargin = (excessQty * input.price * pointValue) / leverage;
  return Math.max(0, newMargin - freedOppMargin);
}

export function executeNettingOrderFill(
  account: PaperAccountState,
  fill: NettingFillInput
): NettingFillResult {
  const incomingQty = roundQty(fill.qty);
  const pointValue = Math.max(0.0001, fill.pointValue || 1);
  const leverage = Math.max(1, fill.leverage || DEFAULT_PAPER_LEVERAGE);

  const otherPositions: PaperPosition[] = [];
  const samePositions: PaperPosition[] = [];
  const oppPositions: PaperPosition[] = [];

  for (const pos of account.positions) {
    if (pos.symbol === fill.symbol && pos.mode === fill.mode) {
      if (pos.side === fill.side) {
        samePositions.push(pos);
      } else {
        oppPositions.push(pos);
      }
    } else {
      otherPositions.push(pos);
    }
  }

  if (oppPositions.length > 0) {
    let remaining = incomingQty;
    let totalRealizedPnl = 0;
    let totalClosedQty = 0;
    const keptOppPositions: PaperPosition[] = [];
    const newlyClosedTrades: PaperTrade[] = [];

    for (const pos of oppPositions) {
      if (remaining <= QTY_EPS) {
        keptOppPositions.push(pos);
        continue;
      }

      const closeQty = roundQty(Math.min(pos.qty, remaining));
      if (closeQty > QTY_EPS) {
        const pv = Math.max(0.0001, pos.pointValue || 1);
        const lev = Math.max(1, pos.leverage || DEFAULT_PAPER_LEVERAGE);
        const priceDiff =
          pos.side === 'long'
            ? fill.price - pos.entryPrice
            : pos.entryPrice - fill.price;
        const realizedPnl = priceDiff * closeQty * pv;
        const closedMargin = (pos.entryPrice * closeQty * pv) / lev;
        const realizedPnlPct =
          closedMargin > 0
            ? (realizedPnl / closedMargin) * 100
            : pos.entryPrice > 0
            ? (priceDiff / pos.entryPrice) * 100
            : 0;

        const leftoverQty = roundQty(pos.qty - closeQty);
        const isPartial = leftoverQty > QTY_EPS;

        newlyClosedTrades.push({
          id: `trd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          symbol: pos.symbol,
          side: pos.side,
          qty: closeQty,
          entryPrice: pos.entryPrice,
          exitPrice: fill.price,
          entryTime: pos.entryTime,
          exitTime: fill.fillTime,
          realizedPnl,
          realizedPnlPct,
          pointValue: pv,
          mode: pos.mode,
          exitReason: isPartial ? 'Partial' : 'Manual',
        });

        totalRealizedPnl += realizedPnl;
        totalClosedQty = roundQty(totalClosedQty + closeQty);
        remaining = roundQty(remaining - closeQty);

        if (isPartial) {
          keptOppPositions.push({
            ...pos,
            qty: leftoverQty,
          });
        }
      } else {
        keptOppPositions.push(pos);
      }
    }

    let nextSamePositions = [...samePositions];
    let resultingPos: PaperPosition | undefined = keptOppPositions[0];
    let action: NettingAction =
      keptOppPositions.length > 0 ? 'partial_closed' : 'closed';

    if (remaining > QTY_EPS) {
      const reversedPos: PaperPosition = {
        id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        symbol: fill.symbol,
        side: fill.side,
        qty: remaining,
        entryPrice: fill.price,
        entryTime: fill.fillTime,
        openedAtCandleTime: fill.candleTime,
        tpPrice: fill.tpPrice,
        slPrice: fill.slPrice,
        pointValue,
        leverage,
        mode: fill.mode,
      };
      nextSamePositions = [reversedPos, ...samePositions];
      resultingPos = reversedPos;
      action = 'reversed';
    }

    return {
      nextAccount: {
        ...account,
        balance: account.balance + totalRealizedPnl,
        positions: [...nextSamePositions, ...keptOppPositions, ...otherPositions],
        closedTrades: [...newlyClosedTrades, ...account.closedTrades],
      },
      action,
      realizedPnl: totalRealizedPnl,
      closedQty: totalClosedQty,
      resultingPos,
    };
  }

  if (samePositions.length > 0) {
    const primary = samePositions[0];
    const prevQty = roundQty(samePositions.reduce((sum, p) => sum + p.qty, 0));
    const prevNotional = samePositions.reduce(
      (sum, p) => sum + p.entryPrice * p.qty,
      0
    );
    const totalQty = roundQty(prevQty + incomingQty);
    const weightedEntry =
      totalQty > 0
        ? (prevNotional + fill.price * incomingQty) / totalQty
        : fill.price;

    const scaledPos: PaperPosition = {
      ...primary,
      qty: totalQty,
      entryPrice: weightedEntry,
      openedAtCandleTime: fill.candleTime,
      tpPrice: fill.tpPrice ?? primary.tpPrice,
      slPrice: fill.slPrice ?? primary.slPrice,
    };

    return {
      nextAccount: {
        ...account,
        positions: [scaledPos, ...otherPositions],
      },
      action: 'added',
      realizedPnl: 0,
      closedQty: 0,
      resultingPos: scaledPos,
    };
  }

  const newPos: PaperPosition = {
    id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    symbol: fill.symbol,
    side: fill.side,
    qty: incomingQty,
    entryPrice: fill.price,
    entryTime: fill.fillTime,
    openedAtCandleTime: fill.candleTime,
    tpPrice: fill.tpPrice,
    slPrice: fill.slPrice,
    pointValue,
    leverage,
    mode: fill.mode,
  };

  return {
    nextAccount: {
      ...account,
      positions: [newPos, ...otherPositions],
    },
    action: 'opened',
    realizedPnl: 0,
    closedQty: 0,
    resultingPos: newPos,
  };
}

export interface JournalMetrics {
  netPnl: number;
  winRate: number;
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  liveCount: number;
  replayCount: number;
}

export function calculateJournalMetrics(
  trades: PaperTrade[],
  startingBalance: number
): JournalMetrics {
  if (trades.length === 0) {
    return {
      netPnl: 0,
      winRate: 0,
      profitFactor: null,
      avgWin: 0,
      avgLoss: 0,
      maxDrawdownUsd: 0,
      maxDrawdownPct: 0,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      breakeven: 0,
      liveCount: 0,
      replayCount: 0,
    };
  }

  // Sort chronologically by exitTime for accurate drawdown calculation
  const chronological = [...trades].sort((a, b) => a.exitTime - b.exitTime);

  let netPnl = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let liveCount = 0;
  let replayCount = 0;

  let runningBalance = startingBalance;
  let peakBalance = startingBalance;
  let maxDrawdownUsd = 0;
  let maxDrawdownPct = 0;

  for (const t of chronological) {
    netPnl += t.realizedPnl;
    if (t.mode === 'Live') liveCount += 1;
    else replayCount += 1;

    if (t.realizedPnl > 0) {
      wins += 1;
      grossProfit += t.realizedPnl;
    } else if (t.realizedPnl < 0) {
      losses += 1;
      grossLoss += Math.abs(t.realizedPnl);
    } else {
      breakeven += 1;
    }

    runningBalance += t.realizedPnl;
    if (runningBalance > peakBalance) {
      peakBalance = runningBalance;
    }
    const ddUsd = peakBalance - runningBalance;
    if (ddUsd > maxDrawdownUsd) {
      maxDrawdownUsd = ddUsd;
      maxDrawdownPct = peakBalance > 0 ? (ddUsd / peakBalance) * 100 : 0;
    }
  }

  const winRate = (wins / trades.length) * 100;
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null;
  const avgWin = wins > 0 ? grossProfit / wins : 0;
  const avgLoss = losses > 0 ? grossLoss / losses : 0;

  return {
    netPnl,
    winRate,
    profitFactor,
    avgWin,
    avgLoss,
    maxDrawdownUsd,
    maxDrawdownPct,
    totalTrades: trades.length,
    wins,
    losses,
    breakeven,
    liveCount,
    replayCount,
  };
}

export function toLocalDateKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface DayTradeSummary {
  dateKey: string;
  pnl: number;
  count: number;
  wins: number;
  losses: number;
  trades: PaperTrade[];
}

export function groupTradesByDate(trades: PaperTrade[]): Record<string, DayTradeSummary> {
  const map: Record<string, DayTradeSummary> = {};
  for (const t of trades) {
    const key = toLocalDateKey(t.exitTime);
    if (!map[key]) {
      map[key] = { dateKey: key, pnl: 0, count: 0, wins: 0, losses: 0, trades: [] };
    }
    map[key].pnl += t.realizedPnl;
    map[key].count += 1;
    if (t.realizedPnl > 0) map[key].wins += 1;
    else if (t.realizedPnl < 0) map[key].losses += 1;
    map[key].trades.push(t);
  }
  return map;
}

export function formatSignedUsd(value: number, compact = false): string {
  const abs = Math.abs(value);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  if (compact && abs >= 1000) {
    return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 1 : 2)}k`;
  }
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: compact && abs >= 100 ? 0 : 2,
    maximumFractionDigits: compact && abs >= 100 ? 0 : 2,
  });
  return `${sign}$${formatted}`;
}

export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatTradeTimestamp(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
