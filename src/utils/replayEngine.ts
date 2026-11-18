import type { UTCTimestamp } from 'lightweight-charts';
import { getDecimalsForPrice } from '../services/binance';
import {
  TIMEFRAME_SECONDS,
  type Candle,
  type ReplayStepTime,
  type Timeframe,
} from '../types/trading';

function roundToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function getEffectiveReplayStepSeconds(
  chartTimeframe: Timeframe,
  stepTime: ReplayStepTime,
  subBarEnabled: boolean
): number {
  if (!subBarEnabled || stepTime === 'match') {
    return TIMEFRAME_SECONDS[chartTimeframe];
  }
  return TIMEFRAME_SECONDS[stepTime];
}

/**
 * Computes deterministic intra-bar price checkpoints (u ∈ [0, 1] -> price)
 * anchored strictly to the real candle's Open, High, Low, Close.
 */
function sampleIntraBarPrice(bar: Candle, u: number, decimals: number): number {
  const clampedU = Math.max(0, Math.min(1, u));
  if (clampedU <= 0) return bar.open;
  if (clampedU >= 1) return bar.close;

  const O = bar.open;
  const C = bar.close;
  const H = Math.max(bar.high, O, C);
  const L = Math.min(bar.low, O, C);
  const range = Math.max(0, H - L);
  if (range <= 1e-12) return O;

  const seedBase = Math.abs(Math.floor(Number(bar.time)) % 997);
  const bullish = C >= O;
  // ~78% of bullish bars probe Low before High; bearish bars probe High before Low
  const lowFirst = bullish ? seedBase % 9 !== 0 : seedBase % 9 === 0;

  const u1 = 0.2 + ((seedBase % 17) / 17) * 0.14; // 0.20 .. 0.34
  const u2 = 0.64 + (((seedBase * 7) % 19) / 19) * 0.18; // 0.64 .. 0.82
  const p1 = lowFirst ? L : H;
  const p2 = lowFirst ? H : L;

  let base: number;
  let segLocal = 0;
  if (clampedU < u1) {
    segLocal = clampedU / u1;
    base = O + (p1 - O) * segLocal;
  } else if (clampedU < u2) {
    segLocal = (clampedU - u1) / (u2 - u1);
    base = p1 + (p2 - p1) * segLocal;
  } else {
    segLocal = (clampedU - u2) / (1 - u2);
    base = p2 + (C - p2) * segLocal;
  }

  // Smooth natural order-flow ripple damped cleanly to zero at key extrema (0, u1, u2, 1)
  const envelope = Math.sin(segLocal * Math.PI);
  const wave =
    (Math.sin(clampedU * Math.PI * 7 + (seedBase % 11)) * 0.6 +
      Math.cos(clampedU * Math.PI * 13 + (seedBase % 5)) * 0.4) *
    range *
    0.045 *
    envelope;

  const bounded = Math.min(H, Math.max(L, base + wave));
  return roundToDecimals(bounded, decimals);
}

/**
 * Builds the cumulative OHLC candle at fractional completion u ∈ (0, 1].
 * Guarantees monotonic high/low wicks as fraction progresses from 0 -> 1,
 * and returns the exact original full bar at fraction >= 1.
 */
export function buildSubBarCandle(bar: Candle, fraction: number): Candle {
  const f = Math.max(0.001, Math.min(1, fraction));
  if (f >= 0.9999) {
    return { ...bar };
  }

  const decimals = getDecimalsForPrice(bar.close);
  const steps = Math.max(4, Math.min(60, Math.ceil(f * 60)));
  let cumHigh = bar.open;
  let cumLow = bar.open;
  let lastPrice = bar.open;

  for (let i = 1; i <= steps; i++) {
    const u = (f * i) / steps;
    const p = sampleIntraBarPrice(bar, u, decimals);
    if (p > cumHigh) cumHigh = p;
    if (p < cumLow) cumLow = p;
    if (i === steps) lastPrice = p;
  }

  return {
    time: bar.time,
    open: bar.open,
    high: Math.max(cumHigh, bar.open, lastPrice),
    low: Math.min(cumLow, bar.open, lastPrice),
    close: lastPrice,
    volume: Math.max(1, Math.round(bar.volume * f)),
  };
}

/**
 * Computes exact price extrema [low, high, close] visited strictly during
 * the forward sub-bar slice (fromFraction, toFraction], so TP/SL checks never
 * trigger from earlier wicks that happened before the trade was entered.
 */
export function buildForwardDeltaCandle(
  bar: Candle,
  fromFraction: number,
  toFraction: number
): Candle {
  const f0 = Math.max(0, Math.min(1, fromFraction));
  const f1 = Math.max(f0, Math.min(1, toFraction));
  if (f0 <= 0.0001 && f1 >= 0.9999) {
    return { ...bar };
  }

  const decimals = getDecimalsForPrice(bar.close);
  const startP = f0 <= 0.0001 ? bar.open : sampleIntraBarPrice(bar, f0, decimals);
  const steps = Math.max(4, Math.min(40, Math.ceil((f1 - f0) * 60)));
  let sliceHigh = startP;
  let sliceLow = startP;
  let endP = startP;

  for (let i = 1; i <= steps; i++) {
    const u = f0 + ((f1 - f0) * i) / steps;
    const p = u >= 0.9999 ? bar.close : sampleIntraBarPrice(bar, u, decimals);
    if (p > sliceHigh) sliceHigh = p;
    if (p < sliceLow) sliceLow = p;
    if (i === steps) endP = p;
  }

  if (f1 >= 0.9999 && f0 <= 0.0001) {
    sliceHigh = bar.high;
    sliceLow = bar.low;
    endP = bar.close;
  }

  return {
    time: bar.time,
    open: startP,
    high: Math.max(sliceHigh, startP, endP),
    low: Math.min(sliceLow, startP, endP),
    close: endP,
    volume: Math.max(1, Math.round(bar.volume * Math.max(0.01, f1 - f0))),
  };
}

export interface ResolvedReplaySlice {
  index: number;
  barTimestamp: number;
  barEndTimestamp: number;
  elapsedSec: number;
  remainingSec: number;
  fraction: number;
  isBarComplete: boolean;
  displayCandle: Candle;
}

export function resolveReplaySliceAtTimestamp(
  candles: Candle[],
  barStepSec: number,
  fallbackIndex: number,
  replayTimestamp?: number
): ResolvedReplaySlice | null {
  if (candles.length === 0) return null;
  const clampedFallback = Math.max(0, Math.min(fallbackIndex, candles.length - 1));

  if (replayTimestamp === undefined || !Number.isFinite(replayTimestamp)) {
    const bar = candles[clampedFallback];
    const t = Number(bar.time);
    return {
      index: clampedFallback,
      barTimestamp: t,
      barEndTimestamp: t + barStepSec,
      elapsedSec: barStepSec,
      remainingSec: 0,
      fraction: 1,
      isBarComplete: true,
      displayCandle: { ...bar },
    };
  }

  // Locate the latest bar whose start time is strictly < replayTimestamp
  // Wait: if replayTimestamp === T_i + barStepSec (complete bar i), interval (T_i, T_i + barStepSec] maps to bar i!
  let idx = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    const barStart = Number(candles[i].time);
    if (replayTimestamp > barStart) {
      idx = i;
      break;
    }
    if (replayTimestamp === barStart) {
      idx = Math.max(0, i - 1);
      if (i === 0) idx = 0;
      break;
    }
  }

  const bar = candles[idx];
  const barStart = Number(bar.time);
  const barEnd = barStart + barStepSec;
  const elapsedRaw = replayTimestamp - barStart;
  const elapsedSec = Math.max(0, Math.min(barStepSec, elapsedRaw));
  const fraction = elapsedSec <= 0 ? 1 : Math.min(1, elapsedSec / barStepSec);
  const isBarComplete = fraction >= 0.9999;
  const remainingSec = isBarComplete ? 0 : Math.max(0, Math.ceil(barStepSec - elapsedSec));

  return {
    index: idx,
    barTimestamp: barStart,
    barEndTimestamp: barEnd,
    elapsedSec: isBarComplete ? barStepSec : elapsedSec,
    remainingSec,
    fraction,
    isBarComplete,
    displayCandle: buildSubBarCandle(bar, fraction),
  };
}

export interface StepReplayResult {
  nextIndex: number;
  nextReplayTs: number;
  displayCandle: Candle;
  evalCandles: Candle[];
  atEnd: boolean;
}

export function stepReplayTimestampForward(
  candles: Candle[],
  barStepSec: number,
  currentIndex: number,
  currentReplayTs: number | undefined,
  stepSec: number,
  subBarMode: boolean
): StepReplayResult | null {
  if (candles.length === 0) return null;
  const safeIdx = Math.max(0, Math.min(currentIndex, candles.length - 1));
  const currBar = candles[safeIdx];
  const currBarStart = Number(currBar.time);
  const currBarEnd = currBarStart + barStepSec;

  // Full-bar stepping mode (Toggle OFF or Match Chart)
  if (!subBarMode || stepSec === barStepSec) {
    if (safeIdx >= candles.length - 1) {
      // If currently mid-bar on the very last candle, finish it; otherwise already at end
      const currResolved = resolveReplaySliceAtTimestamp(
        candles,
        barStepSec,
        safeIdx,
        currentReplayTs
      );
      if (currResolved && !currResolved.isBarComplete) {
        return {
          nextIndex: safeIdx,
          nextReplayTs: currBarEnd,
          displayCandle: { ...currBar },
          evalCandles: [buildForwardDeltaCandle(currBar, currResolved.fraction, 1)],
          atEnd: true,
        };
      }
      return null;
    }

    const currResolved = resolveReplaySliceAtTimestamp(
      candles,
      barStepSec,
      safeIdx,
      currentReplayTs
    );
    const evalCandles: Candle[] = [];
    if (currResolved && !currResolved.isBarComplete) {
      evalCandles.push(buildForwardDeltaCandle(currBar, currResolved.fraction, 1));
    }
    const nextIdx = safeIdx + 1;
    const nextBar = candles[nextIdx];
    const nextBarEnd = Number(nextBar.time) + barStepSec;
    evalCandles.push({ ...nextBar });

    return {
      nextIndex: nextIdx,
      nextReplayTs: nextBarEnd,
      displayCandle: { ...nextBar },
      evalCandles,
      atEnd: nextIdx >= candles.length - 1,
    };
  }

  // Sub-bar stepping (or multi-bar if stepSec > barStepSec)
  const resolved = resolveReplaySliceAtTimestamp(
    candles,
    barStepSec,
    safeIdx,
    currentReplayTs
  );
  const currTs = currentReplayTs ?? currBarEnd;
  const prevFraction = resolved ? resolved.fraction : 1;
  const idx = resolved ? resolved.index : safeIdx;
  const activeBar = candles[idx];
  const activeStart = Number(activeBar.time);
  const activeEnd = activeStart + barStepSec;

  const evalCandles: Candle[] = [];
  let cursorIdx = idx;
  let cursorStart = activeStart;
  let cursorEnd = activeEnd;
  let cursorFrac = prevFraction;
  let remainingBudget = Math.max(1, stepSec);

  // If currently at the end of cursorIdx (fraction === 1), jump to next candle (skipping any market gap)
  if (currTs >= cursorEnd || cursorFrac >= 0.9999) {
    if (cursorIdx >= candles.length - 1) {
      return null;
    }
    cursorIdx += 1;
    cursorStart = Number(candles[cursorIdx].time);
    cursorEnd = cursorStart + barStepSec;
    cursorFrac = 0;
  } else if (currTs > activeStart) {
    // Still inside cursorIdx
    const availableInBar = cursorEnd - currTs;
    if (remainingBudget <= availableInBar) {
      const nextTs = currTs + remainingBudget;
      const nextFrac = Math.min(1, (nextTs - cursorStart) / barStepSec);
      const targetBar = candles[cursorIdx];
      evalCandles.push(buildForwardDeltaCandle(targetBar, cursorFrac, nextFrac));
      return {
        nextIndex: cursorIdx,
        nextReplayTs: nextTs,
        displayCandle: buildSubBarCandle(targetBar, nextFrac),
        evalCandles,
        atEnd: cursorIdx >= candles.length - 1 && nextFrac >= 0.9999,
      };
    }

    // Consume remainder of current candle and carry spill to subsequent candles
    evalCandles.push(buildForwardDeltaCandle(candles[cursorIdx], cursorFrac, 1));
    remainingBudget -= availableInBar;

    if (cursorIdx >= candles.length - 1) {
      return {
        nextIndex: cursorIdx,
        nextReplayTs: cursorEnd,
        displayCandle: { ...candles[cursorIdx] },
        evalCandles,
        atEnd: true,
      };
    }
    cursorIdx += 1;
    cursorStart = Number(candles[cursorIdx].time);
    cursorEnd = cursorStart + barStepSec;
    cursorFrac = 0;
  }

  // Advance across full bars while remainingBudget > barStepSec
  while (remainingBudget > barStepSec) {
    evalCandles.push({ ...candles[cursorIdx] });
    remainingBudget -= barStepSec;
    if (cursorIdx >= candles.length - 1) {
      return {
        nextIndex: cursorIdx,
        nextReplayTs: cursorEnd,
        displayCandle: { ...candles[cursorIdx] },
        evalCandles,
        atEnd: true,
      };
    }
    cursorIdx += 1;
    cursorStart = Number(candles[cursorIdx].time);
    cursorEnd = cursorStart + barStepSec;
    cursorFrac = 0;
  }

  const finalFrac = Math.min(1, remainingBudget / barStepSec);
  const finalTs =
    finalFrac >= 0.9999 ? cursorEnd : (cursorStart + remainingBudget) as UTCTimestamp;
  const finalBar = candles[cursorIdx];
  evalCandles.push(buildForwardDeltaCandle(finalBar, 0, finalFrac));

  return {
    nextIndex: cursorIdx,
    nextReplayTs: Number(finalTs),
    displayCandle: buildSubBarCandle(finalBar, finalFrac),
    evalCandles,
    atEnd: cursorIdx >= candles.length - 1 && finalFrac >= 0.9999,
  };
}
