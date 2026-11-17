import type { IChartApi, ISeriesApi, Logical, Time, UTCTimestamp } from 'lightweight-charts';
import { BellRing, Check, GripVertical, PaintBucket, Pencil, Play, Settings, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatPrice } from '../services/binance';
import type {
  Candle,
  ChartPoint,
  DrawingLineStyle,
  DrawingObject,
  PaperPosition,
  PaperTrade,
  PendingOrderType,
  PendingPaperOrder,
  PriceAlert,
  PriceAlertCondition,
} from '../types/trading';
import {
  calculatePositionMetrics,
  formatSignedUsd,
  getSymbolContractSpec,
  sanitizeOrderQty,
} from '../utils/paperTrading';

export interface PositionOrderPayload {
  side: 'long' | 'short';
  qty: number;
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
  pointValue: number;
}

interface DrawingLayerProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  isChartDisposedRef?: React.RefObject<boolean>;
  candles: Candle[];
  symbol?: string;
  timeframeSeconds: number;
  drawings: DrawingObject[];
  draft: DrawingObject | null;
  openPositions?: PaperPosition[];
  closedTrades?: PaperTrade[];
  pendingOrders?: PendingPaperOrder[];
  priceAlerts?: PriceAlert[];
  showExecutions?: boolean;
  exportSvgRef?: React.RefObject<SVGSVGElement | null>;
  currentPrice?: number;
  hiddenDrawings: boolean;
  lockedDrawings: boolean;
  magnetMode: boolean;
  isDark: boolean;
  interactive: boolean; // false when placing a new drawing or picking replay candle
  replayHoverTime?: UTCTimestamp | null;
  selectedId: string | null;
  onSelectDrawing: (id: string | null) => void;
  onUpdateDrawing: (drawing: DrawingObject) => void;
  onDeleteDrawing: (id: string) => void;
  onExecuteOrder?: (order: PositionOrderPayload) => void;
  onClosePosition?: (positionId: string) => void;
  onUpdatePositionTPSL?: (
    positionId: string,
    tpPrice?: number,
    slPrice?: number,
    silent?: boolean
  ) => void;
  onUpdatePendingOrder?: (
    orderId: string,
    patch: {
      targetPrice?: number;
      orderType?: PendingOrderType;
      tpPrice?: number;
      slPrice?: number;
    },
    silent?: boolean
  ) => void;
  onCancelPendingOrder?: (orderId: string) => void;
  onUpdatePriceAlert?: (
    alertId: string,
    patch: {
      targetPrice?: number;
      condition?: PriceAlertCondition;
      note?: string;
    },
    silent?: boolean
  ) => void;
  onDeletePriceAlert?: (alertId: string) => void;
}

const TV_PALETTE_40 = [
  '#ffffff', '#d1d4dc', '#b2b5be', '#9598a1', '#787b86', '#5d606b', '#363a45', '#131722',
  '#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#9c27b0',
  '#fccbcd', '#ffe0b2', '#fff9c4', '#c8e6c9', '#ace5dc', '#b2ebf2', '#bbd9fb', '#e1bee7',
  '#f77c80', '#ffb74d', '#fff176', '#81c784', '#42bda8', '#4dd0e1', '#5b9cf6', '#ba68c8',
  '#cc2f3c', '#e65100', '#fbc02d', '#2e7d32', '#066656', '#0097a7', '#1e53e5', '#7b1fa2',
];

const FILLABLE_DRAWING_TYPES = new Set<DrawingObject['type']>([
  'rectangle',
  'rotatedRectangle',
  'ellipse',
  'triangle',
  'parallelChannel',
  'fibChannel',
  'fibRetracement',
  'pitchfork',
  'priceRange',
  'datePriceRange',
  'barsPattern',
  'measure',
  'contractRuler',
  'callout',
  'priceLabel',
  'text',
  'long',
  'short',
]);

function hexToRgba(hex: string | undefined, alpha: number): string {
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  const clean = (hex || '#2962ff').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(clean)) {
    const r = parseInt(clean.slice(1, 3), 16);
    const g = parseInt(clean.slice(3, 5), 16);
    const b = parseInt(clean.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha.toFixed(3)})`;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
    const r = parseInt(clean[1] + clean[1], 16);
    const g = parseInt(clean[2] + clean[2], 16);
    const b = parseInt(clean[3] + clean[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha.toFixed(3)})`;
  }
  return clean;
}

const WIDTH_OPTIONS = [1, 2, 3, 4];
const LINE_STYLE_OPTIONS: Array<{ id: DrawingLineStyle; label: string }> = [
  { id: 'solid', label: 'Solid' },
  { id: 'dashed', label: 'Dashed' },
  { id: 'dotted', label: 'Dotted' },
];

const FIB_LEVELS = [
  { ratio: 0, color: '#787b86', fill: 'rgba(120, 123, 134, 0.06)' },
  { ratio: 0.236, color: '#f23645', fill: 'rgba(242, 54, 69, 0.06)' },
  { ratio: 0.382, color: '#f59e0b', fill: 'rgba(245, 158, 11, 0.06)' },
  { ratio: 0.5, color: '#089981', fill: 'rgba(8, 153, 129, 0.07)' },
  { ratio: 0.618, color: '#2962ff', fill: 'rgba(41, 98, 255, 0.08)' },
  { ratio: 0.786, color: '#0ea5e9', fill: 'rgba(14, 165, 233, 0.06)' },
  { ratio: 1, color: '#787b86', fill: 'rgba(120, 123, 134, 0.05)' },
];

function formatDuration(seconds: number): string {
  const abs = Math.abs(Math.round(seconds));
  if (abs < 60) return `${abs}s`;
  if (abs < 3600) {
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  if (abs < 86400) {
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(abs / 86400);
  const h = Math.floor((abs % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function formatShortTime(ts: number): string {
  const d = new Date(ts * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function snapPointToMagnet(
  point: ChartPoint,
  candles: Candle[],
  timeframeSeconds: number
): ChartPoint {
  if (candles.length === 0) return point;
  const targetTime = Number(point.time);
  let nearest = candles[0];
  let bestDist = Math.abs(Number(nearest.time) - targetTime);

  for (let i = 1; i < candles.length; i++) {
    const dist = Math.abs(Number(candles[i].time) - targetTime);
    if (dist < bestDist) {
      bestDist = dist;
      nearest = candles[i];
    }
  }

  // Only snap if reasonably close in time
  if (bestDist > timeframeSeconds * 3) return point;

  const candidates = [nearest.open, nearest.high, nearest.low, nearest.close];
  let snappedPrice = candidates[0];
  let minPriceDiff = Math.abs(candidates[0] - point.price);
  for (let i = 1; i < candidates.length; i++) {
    const diff = Math.abs(candidates[i] - point.price);
    if (diff < minPriceDiff) {
      minPriceDiff = diff;
      snappedPrice = candidates[i];
    }
  }

  return { time: nearest.time, price: snappedPrice };
}

function timeToLogical(
  candles: Candle[],
  timeframeSeconds: number,
  time: UTCTimestamp
): number | null {
  const n = candles.length;
  if (n === 0) return null;
  const t = Number(time);
  const firstTime = Number(candles[0].time);
  if (n === 1) {
    return (t - firstTime) / Math.max(1, timeframeSeconds);
  }
  const lastIdx = n - 1;
  const lastTime = Number(candles[lastIdx].time);

  if (t <= firstTime) {
    const firstStep = Math.max(1, Number(candles[1].time) - firstTime);
    return (t - firstTime) / firstStep;
  }
  if (t >= lastTime) {
    const lastStep = Math.max(1, lastTime - Number(candles[lastIdx - 1].time));
    return lastIdx + (t - lastTime) / lastStep;
  }

  let lo = 0;
  let hi = lastIdx;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (Number(candles[mid].time) <= t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const t0 = Number(candles[lo].time);
  const t1 = Number(candles[lo + 1].time);
  const span = Math.max(1e-6, t1 - t0);
  return lo + (t - t0) / span;
}

function logicalToTime(
  candles: Candle[],
  timeframeSeconds: number,
  logical: number
): UTCTimestamp | null {
  const n = candles.length;
  if (n === 0) return null;
  const firstTime = Number(candles[0].time);
  if (n === 1) {
    return (firstTime + logical * Math.max(1, timeframeSeconds)) as UTCTimestamp;
  }
  const lastIdx = n - 1;
  const lastTime = Number(candles[lastIdx].time);

  if (logical <= 0) {
    const firstStep = Math.max(1, Number(candles[1].time) - firstTime);
    return (firstTime + logical * firstStep) as UTCTimestamp;
  }
  if (logical >= lastIdx) {
    const lastStep = Math.max(1, lastTime - Number(candles[lastIdx - 1].time));
    return (lastTime + (logical - lastIdx) * lastStep) as UTCTimestamp;
  }

  const idx = Math.floor(logical);
  const frac = logical - idx;
  const t0 = Number(candles[idx].time);
  const t1 = Number(candles[idx + 1].time);
  return (t0 + frac * (t1 - t0)) as UTCTimestamp;
}

export function resolveTimeX(
  chart: IChartApi,
  candles: Candle[],
  timeframeSeconds: number,
  time: UTCTimestamp
): number | null {
  try {
    const logical = timeToLogical(candles, timeframeSeconds, time);
    if (logical !== null) {
      const logicalCoord = chart.timeScale().logicalToCoordinate(logical as Logical);
      if (logicalCoord !== null && Number.isFinite(logicalCoord)) {
        return logicalCoord;
      }
    }

    const direct = chart.timeScale().timeToCoordinate(time as Time);
    if (direct !== null) return direct;

    if (candles.length < 2) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const lastX = chart.timeScale().timeToCoordinate(last.time as Time);
    const prevX = chart.timeScale().timeToCoordinate(prev.time as Time);

    if (lastX !== null && prevX !== null) {
      const dt = Math.max(1, Number(last.time) - Number(prev.time));
      const pxPerSec = (lastX - prevX) / dt;
      return lastX + (Number(time) - Number(last.time)) * pxPerSec;
    }

    const vr = chart.timeScale().getVisibleRange();
    const paneW = chart.paneSize(0).width;
    if (vr && paneW > 0) {
      const from = Number(vr.from);
      const to = Number(vr.to);
      if (to > from) {
        return ((Number(time) - from) / (to - from)) * paneW;
      }
    }

    const barSpacing = chart.timeScale().options().barSpacing || 6;
    return ((Number(time) - Number(last.time)) / Math.max(1, timeframeSeconds)) * barSpacing + paneW * 0.8;
  } catch {
    return null;
  }
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function distToInfiniteLine(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return Math.hypot(px - x1, py - y1);
  return Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len;
}

function distToRay(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, ((px - x1) * dx + (py - y1) * dy) / lenSq);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pointInPolygon(
  px: number,
  py: number,
  pts: Array<{ x: number; y: number }>
): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function hitTestDrawings(
  drawings: DrawingObject[],
  px: number,
  py: number,
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  candles: Candle[],
  timeframeSeconds: number
): DrawingObject | null {
  const HIT_TOL = 18;
  const toXY = (pt: ChartPoint): { x: number; y: number } | null => {
    const x = resolveTimeX(chart, candles, timeframeSeconds, pt.time);
    const y = series.priceToCoordinate(pt.price);
    if (x === null || y === null) return null;
    return { x, y };
  };

  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];

    if (d.type === 'horizontal') {
      const c1 = toXY(d.p1);
      if (c1 && Math.abs(py - c1.y) <= HIT_TOL) return d;
      continue;
    }

    if (d.type === 'horizontalRay') {
      const c1 = toXY(d.p1);
      if (c1 && px >= c1.x - HIT_TOL && Math.abs(py - c1.y) <= HIT_TOL) return d;
      continue;
    }

    if (d.type === 'vertical') {
      const c1 = toXY(d.p1);
      if (c1 && Math.abs(px - c1.x) <= HIT_TOL) return d;
      continue;
    }

    if (d.type === 'crossLine') {
      const c1 = toXY(d.p1);
      if (c1 && (Math.abs(py - c1.y) <= HIT_TOL || Math.abs(px - c1.x) <= HIT_TOL)) {
        return d;
      }
      continue;
    }

    if (d.type === 'text') {
      const c1 = toXY(d.p1);
      if (!c1) continue;
      const w = Math.max(60, (d.text || 'Text').length * 7.5 + 16);
      if (px >= c1.x - 10 && px <= c1.x + w && py >= c1.y - 26 && py <= c1.y + 12) {
        return d;
      }
      continue;
    }

    if (d.type === 'priceLabel') {
      const c1 = toXY(d.p1);
      if (!c1) continue;
      const w = Math.max(64, formatPrice(d.p1.price).length * 7.2 + 16);
      if (px >= c1.x - 6 && px <= c1.x + 16 + w && py >= c1.y - 18 && py <= c1.y + 18) {
        return d;
      }
      continue;
    }

    if (d.type === 'callout') {
      const c1 = toXY(d.p1);
      const c2 = toXY(d.p2);
      if (!c1 || !c2) continue;
      if (distToSegment(px, py, c1.x, c1.y, c2.x, c2.y) <= HIT_TOL) return d;
      const w = Math.max(76, (d.text || 'Callout').length * 7.2 + 18);
      if (
        px >= c2.x - w / 2 - 8 &&
        px <= c2.x + w / 2 + 8 &&
        py >= c2.y - 20 &&
        py <= c2.y + 20
      ) {
        return d;
      }
      continue;
    }

    if (
      d.type === 'trendline' ||
      d.type === 'infoLine' ||
      d.type === 'arrow'
    ) {
      const c1 = toXY(d.p1);
      const c2 = toXY(d.p2);
      if (c1 && c2 && distToSegment(px, py, c1.x, c1.y, c2.x, c2.y) <= HIT_TOL) {
        return d;
      }
      continue;
    }

    if (d.type === 'ray') {
      const c1 = toXY(d.p1);
      const c2 = toXY(d.p2);
      if (c1 && c2 && distToRay(px, py, c1.x, c1.y, c2.x, c2.y) <= HIT_TOL) {
        return d;
      }
      continue;
    }

    if (d.type === 'extendedLine') {
      const c1 = toXY(d.p1);
      const c2 = toXY(d.p2);
      if (c1 && c2 && distToInfiniteLine(px, py, c1.x, c1.y, c2.x, c2.y) <= HIT_TOL) {
        return d;
      }
      continue;
    }

    if (d.type === 'fibRetracement') {
      const c1 = toXY(d.p1);
      const c2 = toXY(d.p2);
      if (!c1 || !c2) continue;
      if (distToSegment(px, py, c1.x, c1.y, c2.x, c2.y) <= HIT_TOL) return d;
      const left = Math.min(c1.x, c2.x);
      const right = Math.max(left + 140, Math.max(c1.x, c2.x));
      const top = Math.min(c1.y, c2.y);
      const bottom = Math.max(c1.y, c2.y);
      if (px >= left - 8 && px <= right + 8 && py >= top - 14 && py <= bottom + 14) {
        return d;
      }
      continue;
    }

    if (d.type === 'fibChannel') {
      const c1 = toXY(d.p1);
      const c2 = toXY(d.p2);
      if (!c1 || !c2) continue;
      const dy = c2.y - c1.y || 40;
      const poly = [
        { x: c1.x, y: c1.y },
        { x: c2.x, y: c2.y },
        { x: c2.x, y: c2.y + dy },
        { x: c1.x, y: c1.y + dy },
      ];
      if (
        pointInPolygon(px, py, poly) ||
        distToSegment(px, py, c1.x, c1.y, c2.x, c2.y) <= HIT_TOL ||
        distToSegment(px, py, c1.x, c1.y + dy, c2.x, c2.y + dy) <= HIT_TOL
      ) {
        return d;
      }
      continue;
    }

    if (d.type === 'pitchfork') {
      const c1 = toXY(d.p1);
      const c2 = toXY(d.p2);
      const c3 = toXY(d.p3);
      if (!c1 || !c2 || !c3) continue;
      const midX = (c2.x + c3.x) / 2;
      const midY = (c2.y + c3.y) / 2;
      if (
        distToSegment(px, py, c2.x, c2.y, c3.x, c3.y) <= HIT_TOL ||
        distToRay(px, py, c1.x, c1.y, midX, midY) <= HIT_TOL ||
        distToRay(px, py, c2.x, c2.y, c2.x + (midX - c1.x), c2.y + (midY - c1.y)) <= HIT_TOL ||
        distToRay(px, py, c3.x, c3.y, c3.x + (midX - c1.x), c3.y + (midY - c1.y)) <= HIT_TOL
      ) {
        return d;
      }
      continue;
    }

    if (d.type === 'long' || d.type === 'short') {
      const xStart = resolveTimeX(chart, candles, timeframeSeconds, d.startTime);
      const xEnd = resolveTimeX(chart, candles, timeframeSeconds, d.endTime);
      const entryY = series.priceToCoordinate(d.entryPrice);
      const tpY = series.priceToCoordinate(d.tpPrice);
      const slY = series.priceToCoordinate(d.slPrice);
      if (xStart === null || xEnd === null || entryY === null || tpY === null || slY === null) {
        continue;
      }
      const left = Math.min(xStart, xEnd);
      const width = Math.max(96, Math.abs(xEnd - xStart));
      const top = Math.min(entryY, tpY, slY);
      const bottom = Math.max(entryY, tpY, slY);
      if (px >= left - 8 && px <= left + width + 8 && py >= top - 12 && py <= bottom + 12) {
        return d;
      }
      continue;
    }

    if (
      d.type === 'rectangle' ||
      d.type === 'priceRange' ||
      d.type === 'datePriceRange' ||
      d.type === 'measure' ||
      d.type === 'contractRuler' ||
      d.type === 'barsPattern'
    ) {
      const c1 = toXY(d.p1);
      const c2 = toXY(d.p2);
      if (!c1 || !c2) continue;
      const left = Math.min(c1.x, c2.x);
      const top = Math.min(c1.y, c2.y);
      const w = Math.max(12, Math.abs(c2.x - c1.x));
      const h = Math.max(12, Math.abs(c2.y - c1.y));
      if (px >= left - 10 && px <= left + w + 10 && py >= top - 10 && py <= top + h + 10) {
        return d;
      }
      continue;
    }

    if (d.type === 'ellipse') {
      const c1 = toXY(d.p1);
      const c2 = toXY(d.p2);
      if (!c1 || !c2) continue;
      const cx = (c1.x + c2.x) / 2;
      const cy = (c1.y + c2.y) / 2;
      const rx = Math.max(4, Math.abs(c2.x - c1.x) / 2) + 12;
      const ry = Math.max(4, Math.abs(c2.y - c1.y) / 2) + 12;
      const norm = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
      if (norm <= 1) return d;
      continue;
    }

    if (d.type === 'triangle') {
      const c1 = toXY(d.p1);
      const c2 = toXY(d.p2);
      const c3 = toXY(d.p3);
      if (!c1 || !c2 || !c3) continue;
      if (
        pointInPolygon(px, py, [c1, c2, c3]) ||
        distToSegment(px, py, c1.x, c1.y, c2.x, c2.y) <= HIT_TOL ||
        distToSegment(px, py, c2.x, c2.y, c3.x, c3.y) <= HIT_TOL ||
        distToSegment(px, py, c3.x, c3.y, c1.x, c1.y) <= HIT_TOL
      ) {
        return d;
      }
      continue;
    }

    if (d.type === 'rotatedRectangle') {
      const c1 = toXY(d.p1);
      const c2 = toXY(d.p2);
      const c3 = toXY(d.p3);
      if (!c1 || !c2 || !c3) continue;
      const vx = c2.x - c1.x;
      const vy = c2.y - c1.y;
      const len = Math.max(1, Math.hypot(vx, vy));
      const nx = -vy / len;
      const ny = vx / len;
      const proj = (c3.x - c1.x) * nx + (c3.y - c1.y) * ny;
      const p4 = { x: c1.x + nx * proj, y: c1.y + ny * proj };
      const p3 = { x: c2.x + nx * proj, y: c2.y + ny * proj };
      if (
        pointInPolygon(px, py, [c1, c2, p3, p4]) ||
        distToSegment(px, py, c1.x, c1.y, c2.x, c2.y) <= HIT_TOL ||
        distToSegment(px, py, c2.x, c2.y, p3.x, p3.y) <= HIT_TOL ||
        distToSegment(px, py, p3.x, p3.y, p4.x, p4.y) <= HIT_TOL ||
        distToSegment(px, py, p4.x, p4.y, c1.x, c1.y) <= HIT_TOL
      ) {
        return d;
      }
      continue;
    }

    if (d.type === 'parallelChannel') {
      const c1 = toXY(d.p1);
      const c2 = toXY(d.p2);
      const c3 = toXY(d.p3);
      if (!c1 || !c2 || !c3) continue;
      const dx = c2.x - c1.x;
      const dy = c2.y - c1.y;
      const t =
        dx * dx + dy * dy > 1
          ? ((c3.x - c1.x) * dx + (c3.y - c1.y) * dy) / (dx * dx + dy * dy)
          : 0;
      const offX = c3.x - (c1.x + t * dx);
      const offY = c3.y - (c1.y + t * dy);
      const q1 = { x: c1.x + offX, y: c1.y + offY };
      const q2 = { x: c2.x + offX, y: c2.y + offY };
      if (
        pointInPolygon(px, py, [c1, c2, q2, q1]) ||
        distToSegment(px, py, c1.x, c1.y, c2.x, c2.y) <= HIT_TOL ||
        distToSegment(px, py, q1.x, q1.y, q2.x, q2.y) <= HIT_TOL
      ) {
        return d;
      }
      continue;
    }

    if (d.type === 'brush' || d.type === 'highlighter') {
      const coords = d.points
        .map((pt) => toXY(pt))
        .filter((pt): pt is { x: number; y: number } => pt !== null);
      for (let k = 1; k < coords.length; k++) {
        if (
          distToSegment(
            px,
            py,
            coords[k - 1].x,
            coords[k - 1].y,
            coords[k].x,
            coords[k].y
          ) <= HIT_TOL
        ) {
          return d;
        }
      }
    }
  }

  return null;
}

export function resolveXTime(
  chart: IChartApi,
  candles: Candle[],
  timeframeSeconds: number,
  x: number
): UTCTimestamp | null {
  try {
    if (candles.length > 0) {
      const logical = chart.timeScale().coordinateToLogical(x);
      if (logical !== null && Number.isFinite(logical)) {
        const resolved = logicalToTime(candles, timeframeSeconds, logical);
        if (resolved !== null) return resolved;
      }
    }

    const direct = chart.timeScale().coordinateToTime(x);
    if (direct !== null) return direct as UTCTimestamp;

    if (candles.length >= 2) {
      const last = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      const lastX = chart.timeScale().timeToCoordinate(last.time as Time);
      const prevX = chart.timeScale().timeToCoordinate(prev.time as Time);
      if (lastX !== null && prevX !== null && lastX !== prevX) {
        const dt = Math.max(1, Number(last.time) - Number(prev.time));
        const secPerPx = dt / (lastX - prevX);
        return (Number(last.time) + (x - lastX) * secPerPx) as UTCTimestamp;
      }
    }

    if (candles.length > 0) {
      const last = candles[candles.length - 1];
      const barSpacing = chart.timeScale().options().barSpacing || 6;
      const paneW = chart.paneSize(0).width || 300;
      const approxBarsFromRight = (x - paneW * 0.85) / barSpacing;
      return (Number(last.time) + approxBarsFromRight * timeframeSeconds) as UTCTimestamp;
    }
  } catch {
    return null;
  }

  return null;
}

type PixelPt = { x: number; y: number };

type DragSnapshotPixels = {
  p1?: PixelPt;
  p2?: PixelPt;
  p3?: PixelPt;
  points?: PixelPt[];
  longShort?: {
    startX: number;
    endX: number;
    entryY: number;
    tpY: number;
    slY: number;
  };
};

type DragTarget = {
  drawingId: string;
  handle:
    | 'p1'
    | 'p2'
    | 'p3'
    | 'entry'
    | 'tp'
    | 'sl'
    | 'end'
    | 'corner_start_tp'
    | 'corner_end_tp'
    | 'corner_start_sl'
    | 'corner_end_sl'
    | 'body';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  snapshot: DrawingObject;
  origPixels: DragSnapshotPixels;
};

type PositionDragTarget = {
  positionId: string;
  field: 'tp' | 'sl';
  pointerId: number;
};

type PendingOrderDragTarget = {
  orderId: string;
  field: 'target' | 'tp' | 'sl';
  pointerId: number;
};

type AlertDragTarget = {
  alertId: string;
  pointerId: number;
};

export function DrawingLayer({
  chart,
  series,
  isChartDisposedRef,
  candles,
  symbol = '',
  timeframeSeconds,
  drawings,
  draft,
  openPositions = [],
  closedTrades = [],
  pendingOrders = [],
  priceAlerts = [],
  showExecutions = true,
  exportSvgRef,
  currentPrice = 0,
  hiddenDrawings,
  lockedDrawings,
  magnetMode,
  isDark,
  interactive,
  replayHoverTime,
  selectedId,
  onSelectDrawing,
  onUpdateDrawing,
  onDeleteDrawing,
  onExecuteOrder,
  onClosePosition,
  onUpdatePositionTPSL,
  onUpdatePendingOrder,
  onCancelPendingOrder,
  onUpdatePriceAlert,
  onDeletePriceAlert,
}: DrawingLayerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const setCombinedSvgRef = useCallback(
    (node: SVGSVGElement | null) => {
      svgRef.current = node;
      if (exportSvgRef) {
        exportSvgRef.current = node;
      }
    },
    [exportSvgRef]
  );
  const [, setSyncVersion] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragTargetRef = useRef<DragTarget | null>(null);
  const posDragTargetRef = useRef<PositionDragTarget | null>(null);
  const posSpawnDragRef = useRef<{
    positionId: string;
    field: 'tp' | 'sl';
    pointerId: number;
    startClientY: number;
    startedDrag: boolean;
  } | null>(null);
  const pendingDragTargetRef = useRef<PendingOrderDragTarget | null>(null);
  const alertDragTargetRef = useRef<AlertDragTarget | null>(null);
  const handledPointerEventRef = useRef<Event | null>(null);
  const scrollLockedChartRef = useRef<IChartApi | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [calcModalDrawingId, setCalcModalDrawingId] = useState<string | null>(null);
  const [activeColorMenu, setActiveColorMenu] = useState<'stroke' | 'fill' | null>(null);
  const [hoveredExecutionId, setHoveredExecutionId] = useState<string | null>(null);
  const [expandedPosId, setExpandedPosId] = useState<string | null>(null);

  useEffect(() => {
    setEditingTextId(null);
    setCalcModalDrawingId(null);
    setActiveColorMenu(null);
  }, [selectedId]);

  useEffect(() => {
    if (expandedPosId && !openPositions.some((p) => p.id === expandedPosId)) {
      setExpandedPosId(null);
    }
  }, [expandedPosId, openPositions]);

  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const openPositionsRef = useRef(openPositions);
  openPositionsRef.current = openPositions;
  const pendingOrdersRef = useRef(pendingOrders);
  pendingOrdersRef.current = pendingOrders;
  const priceAlertsRef = useRef(priceAlerts);
  priceAlertsRef.current = priceAlerts;
  const currentPriceRef = useRef(currentPrice);
  currentPriceRef.current = currentPrice;
  const magnetModeRef = useRef(magnetMode);
  magnetModeRef.current = magnetMode;
  const timeframeSecondsRef = useRef(timeframeSeconds);
  timeframeSecondsRef.current = timeframeSeconds;
  const onUpdateDrawingRef = useRef(onUpdateDrawing);
  onUpdateDrawingRef.current = onUpdateDrawing;
  const onUpdatePositionTPSLRef = useRef(onUpdatePositionTPSL);
  onUpdatePositionTPSLRef.current = onUpdatePositionTPSL;
  const onUpdatePendingOrderRef = useRef(onUpdatePendingOrder);
  onUpdatePendingOrderRef.current = onUpdatePendingOrder;
  const onUpdatePriceAlertRef = useRef(onUpdatePriceAlert);
  onUpdatePriceAlertRef.current = onUpdatePriceAlert;

  // Re-sync coordinates whenever chart pans, zooms, resizes, or data updates
  useEffect(() => {
    if (!chart || isChartDisposedRef?.current) return;
    let rafId = 0;

    const triggerSync = () => {
      if (isChartDisposedRef?.current) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!isChartDisposedRef?.current) {
          setSyncVersion((v) => v + 1);
        }
      });
    };

    const ts = chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(triggerSync);
    ts.subscribeVisibleTimeRangeChange(triggerSync);
    chart.subscribeCrosshairMove(triggerSync);

    const observer = new ResizeObserver(triggerSync);
    if (svgRef.current?.parentElement) {
      observer.observe(svgRef.current.parentElement);
    }

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      if (!isChartDisposedRef?.current) {
        try {
          ts.unsubscribeVisibleLogicalRangeChange(triggerSync);
          ts.unsubscribeVisibleTimeRangeChange(triggerSync);
          chart.unsubscribeCrosshairMove(triggerSync);
        } catch {
          // Chart already disposed
        }
      }
    };
  }, [chart, isChartDisposedRef]);

  // Also re-sync whenever candle data changes (new candle / price auto-scale)
  const lastCandle = candles[candles.length - 1];
  useEffect(() => {
    setSyncVersion((v) => v + 1);
  }, [candles.length, lastCandle?.high, lastCandle?.low, lastCandle?.close]);

  const toXY = useCallback(
    (pt: ChartPoint): { x: number; y: number } | null => {
      if (!chart || !series) return null;
      const x = resolveTimeX(chart, candles, timeframeSeconds, pt.time);
      const y = series.priceToCoordinate(pt.price);
      if (x === null || y === null) return null;
      return { x, y };
    },
    [chart, series, candles, timeframeSeconds]
  );

  const captureOrigPixels = useCallback(
    (drawing: DrawingObject): DragSnapshotPixels | null => {
      if (!chart || !series) return null;

      if (drawing.type === 'long' || drawing.type === 'short') {
        const startX = resolveTimeX(chart, candles, timeframeSeconds, drawing.startTime);
        const endX = resolveTimeX(chart, candles, timeframeSeconds, drawing.endTime);
        const entryY = series.priceToCoordinate(drawing.entryPrice);
        const tpY = series.priceToCoordinate(drawing.tpPrice);
        const slY = series.priceToCoordinate(drawing.slPrice);
        if (
          startX === null ||
          endX === null ||
          entryY === null ||
          tpY === null ||
          slY === null
        ) {
          return null;
        }
        return {
          longShort: { startX, endX, entryY, tpY, slY },
        };
      }

      if (drawing.type === 'brush' || drawing.type === 'highlighter') {
        const pts: PixelPt[] = [];
        for (const pt of drawing.points) {
          const xy = toXY(pt);
          if (!xy) return null;
          pts.push(xy);
        }
        return { points: pts };
      }

      const result: DragSnapshotPixels = {};
      if ('p1' in drawing) {
        const xy = toXY(drawing.p1);
        if (!xy) return null;
        result.p1 = xy;
      }
      if ('p2' in drawing) {
        const xy = toXY(drawing.p2);
        if (!xy) return null;
        result.p2 = xy;
      }
      if ('p3' in drawing) {
        const xy = toXY(drawing.p3);
        if (!xy) return null;
        result.p3 = xy;
      }
      return result;
    },
    [chart, series, candles, timeframeSeconds, toXY]
  );

  const applyDragMove = useCallback(
    (clientX: number, clientY: number) => {
      const spawnDrag = posSpawnDragRef.current;
      if (spawnDrag && series && svgRef.current) {
        if (!spawnDrag.startedDrag) {
          if (Math.abs(clientY - spawnDrag.startClientY) < 4) return;
          spawnDrag.startedDrag = true;
          posDragTargetRef.current = {
            positionId: spawnDrag.positionId,
            field: spawnDrag.field,
            pointerId: spawnDrag.pointerId,
          };
          posSpawnDragRef.current = null;
        }
      }

      const posDrag = posDragTargetRef.current;
      if (posDrag && series && svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        const y = clientY - rect.top;
        const nextPrice = series.coordinateToPrice(y);
        if (nextPrice === null || nextPrice <= 0) return;
        const pos = openPositionsRef.current.find((p) => p.id === posDrag.positionId);
        if (!pos) return;
        const nextTp = posDrag.field === 'tp' ? nextPrice : pos.tpPrice;
        const nextSl = posDrag.field === 'sl' ? nextPrice : pos.slPrice;
        onUpdatePositionTPSLRef.current?.(pos.id, nextTp, nextSl, true);
        return;
      }

      const pendingDrag = pendingDragTargetRef.current;
      if (pendingDrag && series && svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        const y = clientY - rect.top;
        const nextPrice = series.coordinateToPrice(y);
        if (nextPrice === null || nextPrice <= 0) return;
        const ord = pendingOrdersRef.current.find((o) => o.id === pendingDrag.orderId);
        if (!ord) return;
        if (pendingDrag.field === 'target') {
          const refPrice = currentPriceRef.current;
          const nextOrderType: PendingOrderType =
            refPrice > 0
              ? ord.side === 'long'
                ? nextPrice <= refPrice
                  ? 'limit'
                  : 'stop'
                : nextPrice < refPrice
                ? 'stop'
                : 'limit'
              : ord.orderType;
          onUpdatePendingOrderRef.current?.(
            ord.id,
            { targetPrice: nextPrice, orderType: nextOrderType },
            true
          );
        } else if (pendingDrag.field === 'tp') {
          onUpdatePendingOrderRef.current?.(ord.id, { tpPrice: nextPrice }, true);
        } else if (pendingDrag.field === 'sl') {
          onUpdatePendingOrderRef.current?.(ord.id, { slPrice: nextPrice }, true);
        }
        return;
      }

      const alertDrag = alertDragTargetRef.current;
      if (alertDrag && series && svgRef.current) {
        const rect = svgRef.current.getBoundingClientRect();
        const y = clientY - rect.top;
        const nextPrice = series.coordinateToPrice(y);
        if (nextPrice === null || nextPrice <= 0) return;
        const alertItem = priceAlertsRef.current.find((a) => a.id === alertDrag.alertId);
        if (!alertItem) return;

        const refPrice = currentPriceRef.current;
        const nextCondition: PriceAlertCondition =
          alertItem.condition === 'crossing'
            ? 'crossing'
            : refPrice > 0
            ? nextPrice >= refPrice
              ? 'crossing_up'
              : 'crossing_down'
            : alertItem.condition;

        onUpdatePriceAlertRef.current?.(
          alertItem.id,
          { targetPrice: nextPrice, condition: nextCondition },
          true
        );
        return;
      }

      const targetMeta = dragTargetRef.current;
      if (!targetMeta || !chart || !series) return;

      // Raw signed pixel delta from initial snapshot — never clamp or use Math.abs
      const dx = clientX - targetMeta.startClientX;
      const dy = clientY - targetMeta.startClientY;

      const curCandles = candlesRef.current;
      const curTfSec = timeframeSecondsRef.current;
      const snap = targetMeta.snapshot;
      const orig = targetMeta.origPixels;

      const pixelToPoint = (px: number, py: number, fallback: ChartPoint): ChartPoint => {
        const nextTime = resolveXTime(chart, curCandles, curTfSec, px);
        const nextPrice = series.coordinateToPrice(py);
        return {
          time: nextTime !== null && Number.isFinite(nextTime) ? nextTime : fallback.time,
          price: nextPrice !== null && Number.isFinite(nextPrice) ? nextPrice : fallback.price,
        };
      };

      if (targetMeta.handle === 'body') {
        if ((snap.type === 'long' || snap.type === 'short') && orig.longShort) {
          const nextStartTime =
            resolveXTime(chart, curCandles, curTfSec, orig.longShort.startX + dx) ??
            snap.startTime;
          const nextEndTime =
            resolveXTime(chart, curCandles, curTfSec, orig.longShort.endX + dx) ??
            snap.endTime;
          const nextEntryPrice =
            series.coordinateToPrice(orig.longShort.entryY + dy) ?? snap.entryPrice;
          const nextTpPrice =
            series.coordinateToPrice(orig.longShort.tpY + dy) ?? snap.tpPrice;
          const nextSlPrice =
            series.coordinateToPrice(orig.longShort.slY + dy) ?? snap.slPrice;

          onUpdateDrawingRef.current({
            ...snap,
            startTime: nextStartTime,
            endTime: nextEndTime,
            entryPrice: nextEntryPrice,
            tpPrice: nextTpPrice,
            slPrice: nextSlPrice,
          });
        } else if ((snap.type === 'brush' || snap.type === 'highlighter') && orig.points) {
          const shiftedPoints = snap.points.map((pt, idx) => {
            const op = orig.points?.[idx];
            return op ? pixelToPoint(op.x + dx, op.y + dy, pt) : pt;
          });
          onUpdateDrawingRef.current({
            ...snap,
            points: shiftedPoints,
          });
        } else if ('p3' in snap && orig.p1 && orig.p2 && orig.p3) {
          onUpdateDrawingRef.current({
            ...snap,
            p1: pixelToPoint(orig.p1.x + dx, orig.p1.y + dy, snap.p1),
            p2: pixelToPoint(orig.p2.x + dx, orig.p2.y + dy, snap.p2),
            p3: pixelToPoint(orig.p3.x + dx, orig.p3.y + dy, snap.p3),
          });
        } else if ('p2' in snap && orig.p1 && orig.p2) {
          onUpdateDrawingRef.current({
            ...snap,
            p1: pixelToPoint(orig.p1.x + dx, orig.p1.y + dy, snap.p1),
            p2: pixelToPoint(orig.p2.x + dx, orig.p2.y + dy, snap.p2),
          });
        } else if ('p1' in snap && orig.p1) {
          onUpdateDrawingRef.current({
            ...snap,
            p1: pixelToPoint(orig.p1.x + dx, orig.p1.y + dy, snap.p1),
          });
        }
        return;
      }

      if ((snap.type === 'long' || snap.type === 'short') && orig.longShort) {
        const minGap = Math.max(snap.entryPrice * 0.0005, snap.tickSize ?? 0.0001);
        if (targetMeta.handle === 'tp') {
          const rawTp = series.coordinateToPrice(orig.longShort.tpY + dy) ?? snap.tpPrice;
          const nextTp =
            snap.type === 'long'
              ? Math.max(snap.entryPrice + minGap, rawTp)
              : Math.min(snap.entryPrice - minGap, rawTp);
          onUpdateDrawingRef.current({ ...snap, tpPrice: nextTp });
        } else if (targetMeta.handle === 'sl') {
          const rawSl = series.coordinateToPrice(orig.longShort.slY + dy) ?? snap.slPrice;
          const nextSl =
            snap.type === 'long'
              ? Math.min(snap.entryPrice - minGap, rawSl)
              : Math.max(snap.entryPrice + minGap, rawSl);
          onUpdateDrawingRef.current({ ...snap, slPrice: nextSl });
        } else if (targetMeta.handle === 'entry') {
          const nextStartTime =
            resolveXTime(chart, curCandles, curTfSec, orig.longShort.startX + dx) ??
            snap.startTime;
          const nextEndTime =
            resolveXTime(chart, curCandles, curTfSec, orig.longShort.endX + dx) ??
            snap.endTime;
          const nextEntryPrice =
            series.coordinateToPrice(orig.longShort.entryY + dy) ?? snap.entryPrice;
          const nextTpPrice =
            series.coordinateToPrice(orig.longShort.tpY + dy) ?? snap.tpPrice;
          const nextSlPrice =
            series.coordinateToPrice(orig.longShort.slY + dy) ?? snap.slPrice;
          onUpdateDrawingRef.current({
            ...snap,
            startTime: nextStartTime,
            endTime: nextEndTime,
            entryPrice: nextEntryPrice,
            tpPrice: nextTpPrice,
            slPrice: nextSlPrice,
          });
        } else if (targetMeta.handle === 'end') {
          const rawEndTime =
            resolveXTime(chart, curCandles, curTfSec, orig.longShort.endX + dx) ??
            snap.endTime;
          const minEnd = Number(snap.startTime) + curTfSec * 3;
          onUpdateDrawingRef.current({
            ...snap,
            endTime: Math.max(minEnd, Number(rawEndTime)) as UTCTimestamp,
          });
        } else if (targetMeta.handle === 'corner_start_tp') {
          const rawStart =
            resolveXTime(chart, curCandles, curTfSec, orig.longShort.startX + dx) ??
            snap.startTime;
          const maxStart = Number(snap.endTime) - curTfSec * 2;
          const rawTp = series.coordinateToPrice(orig.longShort.tpY + dy) ?? snap.tpPrice;
          const nextTp =
            snap.type === 'long'
              ? Math.max(snap.entryPrice + minGap, rawTp)
              : Math.min(snap.entryPrice - minGap, rawTp);
          onUpdateDrawingRef.current({
            ...snap,
            startTime: Math.min(maxStart, Number(rawStart)) as UTCTimestamp,
            tpPrice: nextTp,
          });
        } else if (targetMeta.handle === 'corner_end_tp') {
          const rawEnd =
            resolveXTime(chart, curCandles, curTfSec, orig.longShort.endX + dx) ??
            snap.endTime;
          const minEnd = Number(snap.startTime) + curTfSec * 2;
          const rawTp = series.coordinateToPrice(orig.longShort.tpY + dy) ?? snap.tpPrice;
          const nextTp =
            snap.type === 'long'
              ? Math.max(snap.entryPrice + minGap, rawTp)
              : Math.min(snap.entryPrice - minGap, rawTp);
          onUpdateDrawingRef.current({
            ...snap,
            endTime: Math.max(minEnd, Number(rawEnd)) as UTCTimestamp,
            tpPrice: nextTp,
          });
        } else if (targetMeta.handle === 'corner_start_sl') {
          const rawStart =
            resolveXTime(chart, curCandles, curTfSec, orig.longShort.startX + dx) ??
            snap.startTime;
          const maxStart = Number(snap.endTime) - curTfSec * 2;
          const rawSl = series.coordinateToPrice(orig.longShort.slY + dy) ?? snap.slPrice;
          const nextSl =
            snap.type === 'long'
              ? Math.min(snap.entryPrice - minGap, rawSl)
              : Math.max(snap.entryPrice + minGap, rawSl);
          onUpdateDrawingRef.current({
            ...snap,
            startTime: Math.min(maxStart, Number(rawStart)) as UTCTimestamp,
            slPrice: nextSl,
          });
        } else if (targetMeta.handle === 'corner_end_sl') {
          const rawEnd =
            resolveXTime(chart, curCandles, curTfSec, orig.longShort.endX + dx) ??
            snap.endTime;
          const minEnd = Number(snap.startTime) + curTfSec * 2;
          const rawSl = series.coordinateToPrice(orig.longShort.slY + dy) ?? snap.slPrice;
          const nextSl =
            snap.type === 'long'
              ? Math.min(snap.entryPrice - minGap, rawSl)
              : Math.max(snap.entryPrice + minGap, rawSl);
          onUpdateDrawingRef.current({
            ...snap,
            endTime: Math.max(minEnd, Number(rawEnd)) as UTCTimestamp,
            slPrice: nextSl,
          });
        }
        return;
      }

      const resolveHandlePt = (origPt: PixelPt, fallback: ChartPoint): ChartPoint => {
        const rawPt = pixelToPoint(origPt.x + dx, origPt.y + dy, fallback);
        return magnetModeRef.current
          ? snapPointToMagnet(rawPt, curCandles, curTfSec)
          : rawPt;
      };

      if ('p1' in snap && targetMeta.handle === 'p1' && orig.p1) {
        onUpdateDrawingRef.current({ ...snap, p1: resolveHandlePt(orig.p1, snap.p1) });
      } else if ('p2' in snap && targetMeta.handle === 'p2' && orig.p2) {
        onUpdateDrawingRef.current({ ...snap, p2: resolveHandlePt(orig.p2, snap.p2) });
      } else if ('p3' in snap && targetMeta.handle === 'p3' && orig.p3) {
        onUpdateDrawingRef.current({ ...snap, p3: resolveHandlePt(orig.p3, snap.p3) });
      }
    },
    [chart, series]
  );

  const endDrag = useCallback(() => {
    const spawnDrag = posSpawnDragRef.current;
    if (spawnDrag && !spawnDrag.startedDrag && series) {
      const pos = openPositionsRef.current.find((p) => p.id === spawnDrag.positionId);
      if (pos) {
        const markPrice = currentPriceRef.current > 0 ? currentPriceRef.current : pos.entryPrice;
        const refPrice = markPrice > 0 ? markPrice : pos.entryPrice;
        const entryY = series.priceToCoordinate(pos.entryPrice);
        const dirSign =
          spawnDrag.field === 'tp'
            ? pos.side === 'long'
              ? -1
              : 1
            : pos.side === 'long'
            ? 1
            : -1;
        const offsetPrice =
          entryY !== null
            ? series.coordinateToPrice(entryY + dirSign * 46)
            : null;
        const fallbackPrice =
          spawnDrag.field === 'tp'
            ? pos.side === 'long'
              ? refPrice * 1.008
              : Math.max(0.0001, refPrice * 0.992)
            : pos.side === 'long'
            ? Math.max(0.0001, refPrice * 0.996)
            : refPrice * 1.004;
        const chosenPrice =
          offsetPrice !== null && offsetPrice > 0 ? offsetPrice : fallbackPrice;

        if (spawnDrag.field === 'tp') {
          onUpdatePositionTPSLRef.current?.(pos.id, chosenPrice, pos.slPrice);
        } else {
          onUpdatePositionTPSLRef.current?.(pos.id, pos.tpPrice, chosenPrice);
        }
      }
      posSpawnDragRef.current = null;
    }

    if (
      !dragTargetRef.current &&
      !posDragTargetRef.current &&
      !pendingDragTargetRef.current &&
      !alertDragTargetRef.current &&
      !spawnDrag
    ) {
      return;
    }
    dragTargetRef.current = null;
    posDragTargetRef.current = null;
    posSpawnDragRef.current = null;
    pendingDragTargetRef.current = null;
    alertDragTargetRef.current = null;
    handledPointerEventRef.current = null;
    setIsDragging(false);
    if (chart && scrollLockedChartRef.current === chart && !isChartDisposedRef?.current) {
      try {
        chart.applyOptions({
          handleScroll: true,
          handleScale: true,
        });
      } catch {
        // Ignore if chart disposed
      }
    }
    scrollLockedChartRef.current = null;
  }, [chart, series, isChartDisposedRef]);

  // Keep global pointer listeners always ready so fast 1-tap drags never miss early moves before re-render
  useEffect(() => {
    if (!chart) return;

    const handleWindowMove = (e: PointerEvent) => {
      if (
        !dragTargetRef.current &&
        !posDragTargetRef.current &&
        !posSpawnDragRef.current &&
        !pendingDragTargetRef.current &&
        !alertDragTargetRef.current
      ) {
        return;
      }
      if (handledPointerEventRef.current === e) return;
      const activePointerId =
        alertDragTargetRef.current?.pointerId ??
        pendingDragTargetRef.current?.pointerId ??
        posSpawnDragRef.current?.pointerId ??
        posDragTargetRef.current?.pointerId ??
        dragTargetRef.current?.pointerId;
      if (activePointerId === undefined || e.pointerId !== activePointerId) return;
      applyDragMove(e.clientX, e.clientY);
    };

    const handleWindowUp = () => {
      if (
        !dragTargetRef.current &&
        !posDragTargetRef.current &&
        !posSpawnDragRef.current &&
        !pendingDragTargetRef.current &&
        !alertDragTargetRef.current
      ) {
        return;
      }
      endDrag();
    };

    window.addEventListener('pointermove', handleWindowMove);
    window.addEventListener('pointerup', handleWindowUp);
    window.addEventListener('touchend', handleWindowUp);
    window.addEventListener('pointercancel', handleWindowUp);
    return () => {
      window.removeEventListener('pointermove', handleWindowMove);
      window.removeEventListener('pointerup', handleWindowUp);
      window.removeEventListener('touchend', handleWindowUp);
      window.removeEventListener('pointercancel', handleWindowUp);
      if (scrollLockedChartRef.current === chart && !isChartDisposedRef?.current) {
        try {
          chart.applyOptions({
            handleScroll: true,
            handleScale: true,
          });
        } catch {
          // Chart already disposed
        }
      }
      if (scrollLockedChartRef.current === chart) {
        scrollLockedChartRef.current = null;
      }
    };
  }, [chart, applyDragMove, endDrag, isChartDisposedRef]);

  if (!chart || !series || isChartDisposedRef?.current) return null;

  let plotW = 0;
  let plotH = 0;
  try {
    const paneSize = chart.paneSize(0);
    plotW = paneSize.width || 0;
    plotH = paneSize.height || 0;
  } catch {
    return null;
  }

  if (
    plotW <= 0 ||
    plotH <= 0 ||
    (hiddenDrawings &&
      replayHoverTime == null &&
      openPositions.length === 0 &&
      (!showExecutions || closedTrades.length === 0) &&
      pendingOrders.length === 0 &&
      priceAlerts.length === 0)
  ) {
    return null;
  }

  const allItems: Array<{ d: DrawingObject; isDraft: boolean }> = hiddenDrawings
    ? []
    : [
        ...drawings.map((d) => ({ d, isDraft: false })),
        ...(draft ? [{ d: draft, isDraft: true }] : []),
      ];

  const selectedDrawing = drawings.find((d) => d.id === selectedId) ?? null;

  const startDrag = (
    e: React.PointerEvent,
    drawingId: string,
    handle: DragTarget['handle']
  ) => {
    if (lockedDrawings || !interactive) return;
    const drawing = drawingsRef.current.find((d) => d.id === drawingId);
    if (!drawing) return;
    const origPixels = captureOrigPixels(drawing);
    if (!origPixels) return;

    e.stopPropagation();
    e.preventDefault();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Fallback to window listener if capture unsupported
    }
    onSelectDrawing(drawingId);
    if (!isChartDisposedRef?.current) {
      try {
        chart.applyOptions({
          handleScroll: false,
          handleScale: false,
        });
        scrollLockedChartRef.current = chart;
      } catch {
        // Ignore if chart disposed
      }
    }
    dragTargetRef.current = {
      drawingId,
      handle,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      snapshot: drawing,
      origPixels,
    };
    setIsDragging(true);
  };

  const startBodyDrag = (e: React.PointerEvent, drawing: DrawingObject) => {
    if (!interactive) return;
    e.stopPropagation();
    onSelectDrawing(drawing.id);
    if (lockedDrawings || !svgRef.current) return;

    const origPixels = captureOrigPixels(drawing);
    if (!origPixels) return;

    e.preventDefault();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Fallback to window listener
    }
    if (!isChartDisposedRef?.current) {
      try {
        chart.applyOptions({
          handleScroll: false,
          handleScale: false,
        });
        scrollLockedChartRef.current = chart;
      } catch {
        // Ignore if chart disposed
      }
    }
    dragTargetRef.current = {
      drawingId: drawing.id,
      handle: 'body',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      snapshot: drawing,
      origPixels,
    };
    setIsDragging(true);
  };

  const handleElementPointerMove = (e: React.PointerEvent) => {
    const activePointerId =
      alertDragTargetRef.current?.pointerId ??
      pendingDragTargetRef.current?.pointerId ??
      posSpawnDragRef.current?.pointerId ??
      posDragTargetRef.current?.pointerId ??
      dragTargetRef.current?.pointerId;
    if (activePointerId === undefined || e.pointerId !== activePointerId) return;
    e.stopPropagation();
    handledPointerEventRef.current = e.nativeEvent;
    applyDragMove(e.clientX, e.clientY);
  };

  const handleElementPointerUp = (e: React.PointerEvent) => {
    const activePointerId =
      alertDragTargetRef.current?.pointerId ??
      pendingDragTargetRef.current?.pointerId ??
      posSpawnDragRef.current?.pointerId ??
      posDragTargetRef.current?.pointerId ??
      dragTargetRef.current?.pointerId;
    if (activePointerId === undefined || e.pointerId !== activePointerId) return;
    e.stopPropagation();
    try {
      if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    endDrag();
  };

  const startPositionLineDrag = (
    e: React.PointerEvent,
    positionId: string,
    field: 'tp' | 'sl'
  ) => {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Fallback to window listener
    }
    if (!isChartDisposedRef?.current) {
      try {
        chart.applyOptions({
          handleScroll: false,
          handleScale: false,
        });
        scrollLockedChartRef.current = chart;
      } catch {
        // Ignore if chart disposed
      }
    }
    posDragTargetRef.current = {
      positionId,
      field,
      pointerId: e.pointerId,
    };
    setIsDragging(true);
  };

  const startPositionSpawnDrag = (
    e: React.PointerEvent,
    positionId: string,
    field: 'tp' | 'sl'
  ) => {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Fallback to window listener
    }
    if (!isChartDisposedRef?.current) {
      try {
        chart.applyOptions({
          handleScroll: false,
          handleScale: false,
        });
        scrollLockedChartRef.current = chart;
      } catch {
        // Ignore if chart disposed
      }
    }
    posSpawnDragRef.current = {
      positionId,
      field,
      pointerId: e.pointerId,
      startClientY: e.clientY,
      startedDrag: false,
    };
    setIsDragging(true);
  };

  const startPendingOrderLineDrag = (
    e: React.PointerEvent,
    orderId: string,
    field: 'target' | 'tp' | 'sl'
  ) => {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Fallback to window listener
    }
    if (!isChartDisposedRef?.current) {
      try {
        chart.applyOptions({
          handleScroll: false,
          handleScale: false,
        });
        scrollLockedChartRef.current = chart;
      } catch {
        // Ignore if chart disposed
      }
    }
    pendingDragTargetRef.current = {
      orderId,
      field,
      pointerId: e.pointerId,
    };
    setIsDragging(true);
  };

  const startAlertLineDrag = (e: React.PointerEvent, alertId: string) => {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Fallback to window listener
    }
    if (!isChartDisposedRef?.current) {
      try {
        chart.applyOptions({
          handleScroll: false,
          handleScale: false,
        });
        scrollLockedChartRef.current = chart;
      } catch {
        // Ignore if chart disposed
      }
    }
    alertDragTargetRef.current = {
      alertId,
      pointerId: e.pointerId,
    };
    setIsDragging(true);
  };

  const renderHandle = (
    drawingId: string,
    handle: DragTarget['handle'],
    x: number,
    y: number,
    _color = '#2962ff'
  ) => {
    if (lockedDrawings) return null;
    return (
      <g
        key={`${drawingId}-${handle}`}
        data-export-ignore="true"
        className="pointer-events-auto touch-none cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => startDrag(e, drawingId, handle)}
        onPointerMove={handleElementPointerMove}
        onPointerUp={handleElementPointerUp}
        onPointerCancel={handleElementPointerUp}
        onClick={(e) => e.stopPropagation()}
      >
        <circle cx={x} cy={y} r={22} fill="transparent" />
        <circle
          cx={x}
          cy={y}
          r={6}
          fill="#ffffff"
          stroke="#2962ff"
          strokeWidth={2}
        />
      </g>
    );
  };

  const extendRayToEdge = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    bothWays = false
  ) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      return { ax: x1, ay: y1, bx: x2, by: y2 };
    }
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const span = Math.max(plotW, plotH) * 2.5;
    return {
      ax: bothWays ? x1 - ux * span : x1,
      ay: bothWays ? y1 - uy * span : y1,
      bx: x2 + ux * span,
      by: y2 + uy * span,
    };
  };

  return (
    <>
      <svg
        ref={setCombinedSvgRef}
        width={plotW}
        height={plotH}
        viewBox={`0 0 ${plotW} ${plotH}`}
        className="pointer-events-none absolute top-0 left-0 z-10 overflow-hidden select-none"
        style={{ touchAction: 'none' }}
      >
        <defs>
          {allItems.map(({ d }) => (
            <marker
              key={`arrow-${d.id}`}
              id={`arrowhead-${d.id}`}
              markerWidth="10"
              markerHeight="8"
              refX="8"
              refY="4"
              orient="auto"
            >
              <polygon points="0 0, 10 4, 0 8" fill={d.color} />
            </marker>
          ))}
        </defs>

        {allItems.map(({ d, isDraft }) => {
          const isSelected = !isDraft && d.id === selectedId;
          const customOpacity = d.opacity ?? 1;
          const opacity = isDraft ? 0.8 : Math.max(0.05, Math.min(1, customOpacity));
          const resolvedFillBase = d.fillColor ?? d.color;
          const fillAlpha = Math.max(0.05, Math.min(0.85, (d.opacity ?? 0.2) * 0.28 + 0.04));
          const shapeFillRgba = d.fillColor
            ? hexToRgba(d.fillColor, Math.max(0.05, Math.min(0.95, d.opacity ?? 0.25)))
            : hexToRgba(resolvedFillBase, fillAlpha);
          const lineStyle = d.lineStyle ?? 'solid';
          const dash = isDraft
            ? '5 4'
            : lineStyle === 'dashed'
            ? '7 4'
            : lineStyle === 'dotted'
            ? `${Math.max(1.5, d.lineWidth)} ${Math.max(3, d.lineWidth * 2.2)}`
            : undefined;
          // Tap-first-then-drag: only an already-selected drawing intercepts pointerdown to drag/shift;
          // unselected drawings let pointer events pass cleanly to the chart so panning never shifts them by accident.
          const hitProps =
            interactive && !isDraft && isSelected && !lockedDrawings
              ? {
                  className: 'pointer-events-auto touch-none cursor-move',
                  style: { touchAction: 'none' as const },
                  onPointerDown: (e: React.PointerEvent) => startBodyDrag(e, d),
                  onPointerMove: handleElementPointerMove,
                  onPointerUp: handleElementPointerUp,
                  onPointerCancel: handleElementPointerUp,
                  onClick: (e: React.MouseEvent) => e.stopPropagation(),
                }
              : {
                  className: 'pointer-events-none',
                };

          // 1. HORIZONTAL LINE
          if (d.type === 'horizontal') {
            const c1 = toXY(d.p1);
            if (!c1) return null;
            return (
              <g key={d.id} opacity={opacity}>
                <line
                  x1={0}
                  y1={c1.y}
                  x2={plotW}
                  y2={c1.y}
                  stroke="transparent"
                  strokeWidth={32}
                  {...hitProps}
                />
                <line
                  x1={0}
                  y1={c1.y}
                  x2={plotW}
                  y2={c1.y}
                  stroke={d.color}
                  strokeWidth={d.lineWidth}
                  strokeDasharray={dash}
                  className="pointer-events-none"
                />
                <g transform={`translate(${Math.max(8, plotW - 88)}, ${c1.y - 10})`} {...hitProps}>
                  <rect width={82} height={20} rx={4} fill={d.color} />
                  <text
                    x={41}
                    y={13.5}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={10}
                    fontWeight={600}
                    fontFamily="'JetBrains Mono', monospace"
                    className="pointer-events-none"
                  >
                    {formatPrice(d.p1.price)}
                  </text>
                </g>
                {d.label && (
                  <text
                    x={Math.max(12, Math.min(plotW - 120, 14))}
                    y={c1.y - 6}
                    fill={d.color}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && renderHandle(d.id, 'p1', Math.min(Math.max(40, c1.x), plotW - 110), c1.y, d.color)}
              </g>
            );
          }

          // 2. HORIZONTAL RAY
          if (d.type === 'horizontalRay') {
            const c1 = toXY(d.p1);
            if (!c1) return null;
            return (
              <g key={d.id} opacity={opacity}>
                <line
                  x1={c1.x}
                  y1={c1.y}
                  x2={plotW}
                  y2={c1.y}
                  stroke="transparent"
                  strokeWidth={32}
                  {...hitProps}
                />
                <line
                  x1={c1.x}
                  y1={c1.y}
                  x2={plotW}
                  y2={c1.y}
                  stroke={d.color}
                  strokeWidth={d.lineWidth}
                  strokeDasharray={dash}
                  className="pointer-events-none"
                />
                <circle cx={c1.x} cy={c1.y} r={3.5} fill={d.color} className="pointer-events-none" />
                <g transform={`translate(${Math.max(8, plotW - 88)}, ${c1.y - 10})`} {...hitProps}>
                  <rect width={82} height={20} rx={4} fill={d.color} />
                  <text
                    x={41}
                    y={13.5}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={10}
                    fontWeight={600}
                    fontFamily="'JetBrains Mono', monospace"
                    className="pointer-events-none"
                  >
                    {formatPrice(d.p1.price)}
                  </text>
                </g>
                {d.label && (
                  <text
                    x={Math.min(plotW - 110, Math.max(8, c1.x + 8))}
                    y={c1.y - 6}
                    fill={d.color}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
              </g>
            );
          }

          // 3. VERTICAL LINE
          if (d.type === 'vertical') {
            const c1 = toXY(d.p1);
            if (!c1) return null;
            return (
              <g key={d.id} opacity={opacity}>
                <line
                  x1={c1.x}
                  y1={0}
                  x2={c1.x}
                  y2={plotH}
                  stroke="transparent"
                  strokeWidth={32}
                  {...hitProps}
                />
                <line
                  x1={c1.x}
                  y1={0}
                  x2={c1.x}
                  y2={plotH}
                  stroke={d.color}
                  strokeWidth={d.lineWidth}
                  strokeDasharray={dash}
                  className="pointer-events-none"
                />
                <g transform={`translate(${Math.min(Math.max(4, c1.x - 26), plotW - 56)}, ${plotH - 22})`} {...hitProps}>
                  <rect width={52} height={18} rx={4} fill={d.color} />
                  <text
                    x={26}
                    y={12.5}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={10}
                    fontWeight={600}
                    fontFamily="'JetBrains Mono', monospace"
                    className="pointer-events-none"
                  >
                    {formatShortTime(Number(d.p1.time))}
                  </text>
                </g>
                {d.label && (
                  <text
                    x={Math.min(plotW - 100, c1.x + 6)}
                    y={24}
                    fill={d.color}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && renderHandle(d.id, 'p1', c1.x, Math.min(Math.max(40, c1.y), plotH - 40), d.color)}
              </g>
            );
          }

          // 4. CROSS LINE
          if (d.type === 'crossLine') {
            const c1 = toXY(d.p1);
            if (!c1) return null;
            return (
              <g key={d.id} opacity={opacity}>
                <line x1={0} y1={c1.y} x2={plotW} y2={c1.y} stroke="transparent" strokeWidth={30} {...hitProps} />
                <line x1={c1.x} y1={0} x2={c1.x} y2={plotH} stroke="transparent" strokeWidth={30} {...hitProps} />
                <line
                  x1={0}
                  y1={c1.y}
                  x2={plotW}
                  y2={c1.y}
                  stroke={d.color}
                  strokeWidth={d.lineWidth}
                  strokeDasharray={dash}
                  className="pointer-events-none"
                />
                <line
                  x1={c1.x}
                  y1={0}
                  x2={c1.x}
                  y2={plotH}
                  stroke={d.color}
                  strokeWidth={d.lineWidth}
                  strokeDasharray={dash}
                  className="pointer-events-none"
                />
                {d.label && (
                  <text
                    x={Math.min(plotW - 100, c1.x + 8)}
                    y={c1.y - 8}
                    fill={d.color}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
              </g>
            );
          }

          // 5. TEXT NOTE
          if (d.type === 'text') {
            const c1 = toXY(d.p1);
            if (!c1) return null;
            const label = d.text || 'Note';
            const boxW = Math.max(64, label.length * 7.2 + 16);
            return (
              <g key={d.id} opacity={opacity}>
                <rect
                  x={c1.x - 4}
                  y={c1.y - 14}
                  width={boxW}
                  height={24}
                  rx={5}
                  fill={
                    d.fillColor
                      ? hexToRgba(d.fillColor, Math.max(0.1, d.opacity ?? 0.9))
                      : isDark
                      ? 'rgba(30, 34, 45, 0.9)'
                      : 'rgba(255, 255, 255, 0.92)'
                  }
                  stroke={isSelected ? d.color : 'rgba(120, 123, 134, 0.35)'}
                  strokeWidth={isSelected ? 1.5 : 1}
                  {...hitProps}
                />
                <text
                  x={c1.x + 4}
                  y={c1.y + 2}
                  fill={d.color}
                  fontSize={12}
                  fontWeight={600}
                  fontFamily="'Plus Jakarta Sans', sans-serif"
                  className="pointer-events-none"
                >
                  {label}
                </text>
                {isSelected && renderHandle(d.id, 'p1', c1.x - 4, c1.y - 14, d.color)}
              </g>
            );
          }

          // 6. PRICE LABEL
          if (d.type === 'priceLabel') {
            const c1 = toXY(d.p1);
            if (!c1) return null;
            const txt = formatPrice(d.p1.price);
            const w = Math.max(64, txt.length * 7.2 + 16);
            return (
              <g key={d.id} opacity={opacity}>
                <g transform={`translate(${c1.x}, ${c1.y})`} {...hitProps}>
                  <path
                    d={`M 0 0 L 10 -11 L ${10 + w} -11 L ${10 + w} 11 L 10 11 Z`}
                    fill={d.fillColor ?? d.color}
                  />
                  <text
                    x={10 + w / 2}
                    y={3.5}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={10.5}
                    fontWeight={600}
                    fontFamily="'JetBrains Mono', monospace"
                  >
                    {txt}
                  </text>
                </g>
                {isSelected && renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
              </g>
            );
          }

          // 7. CALLOUT
          if (d.type === 'callout') {
            const c1 = toXY(d.p1);
            const c2 = toXY(d.p2);
            if (!c1 || !c2) return null;
            const txt = d.text || 'Callout';
            const w = Math.max(76, txt.length * 7.2 + 18);
            const h = 26;
            return (
              <g key={d.id} opacity={opacity}>
                <line
                  x1={c1.x}
                  y1={c1.y}
                  x2={c2.x}
                  y2={c2.y}
                  stroke="transparent"
                  strokeWidth={28}
                  {...hitProps}
                />
                <line
                  x1={c1.x}
                  y1={c1.y}
                  x2={c2.x}
                  y2={c2.y}
                  stroke={d.color}
                  strokeWidth={d.lineWidth}
                  strokeDasharray={dash}
                  className="pointer-events-none"
                />
                <circle cx={c1.x} cy={c1.y} r={3.5} fill={d.color} className="pointer-events-none" />
                <rect
                  x={c2.x - w / 2}
                  y={c2.y - h / 2}
                  width={w}
                  height={h}
                  rx={6}
                  fill={d.fillColor ?? d.color}
                  stroke={d.fillColor ? d.color : 'none'}
                  strokeWidth={d.fillColor ? d.lineWidth : 0}
                  {...hitProps}
                />
                <text
                  x={c2.x}
                  y={c2.y + 4}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={11}
                  fontWeight={600}
                  fontFamily="'Plus Jakarta Sans', sans-serif"
                  className="pointer-events-none"
                >
                  {txt}
                </text>
                {isSelected && (
                  <>
                    {renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
                    {renderHandle(d.id, 'p2', c2.x, c2.y, d.color)}
                  </>
                )}
              </g>
            );
          }

          // 8. TRENDLINE / RAY / EXTENDED LINE / INFO LINE / ARROW
          if (
            d.type === 'trendline' ||
            d.type === 'ray' ||
            d.type === 'extendedLine' ||
            d.type === 'infoLine' ||
            d.type === 'arrow'
          ) {
            const c1 = toXY(d.p1);
            const c2 = toXY(d.p2);
            if (!c1 || !c2) return null;

            const seg =
              d.type === 'ray'
                ? extendRayToEdge(c1.x, c1.y, c2.x, c2.y, false)
                : d.type === 'extendedLine'
                ? extendRayToEdge(c1.x, c1.y, c2.x, c2.y, true)
                : { ax: c1.x, ay: c1.y, bx: c2.x, by: c2.y };

            const angleDeg =
              (-Math.atan2(c2.y - c1.y, c2.x - c1.x) * 180) / Math.PI;
            const deltaPrice = d.p2.price - d.p1.price;
            const pct = d.p1.price !== 0 ? (deltaPrice / d.p1.price) * 100 : 0;
            const bars = Math.max(
              1,
              Math.round(Math.abs(Number(d.p2.time) - Number(d.p1.time)) / timeframeSeconds)
            );
            const infoTxt = `${deltaPrice >= 0 ? '+' : ''}${formatPrice(deltaPrice)} (${
              pct >= 0 ? '+' : ''
            }${pct.toFixed(2)}%) · ${bars} bars · ${angleDeg.toFixed(1)}°`;

            return (
              <g key={d.id} opacity={opacity}>
                <line
                  x1={seg.ax}
                  y1={seg.ay}
                  x2={seg.bx}
                  y2={seg.by}
                  stroke="transparent"
                  strokeWidth={32}
                  {...hitProps}
                />
                <line
                  x1={seg.ax}
                  y1={seg.ay}
                  x2={seg.bx}
                  y2={seg.by}
                  stroke={d.color}
                  strokeWidth={d.lineWidth}
                  strokeDasharray={dash}
                  markerEnd={d.type === 'arrow' ? `url(#arrowhead-${d.id})` : undefined}
                  className="pointer-events-none"
                />
                {d.type === 'infoLine' && (
                  <g
                    transform={`translate(${Math.min(
                      Math.max(8, (c1.x + c2.x) / 2 - 110),
                      Math.max(8, plotW - 230)
                    )}, ${Math.max(8, (c1.y + c2.y) / 2 - 28)})`}
                    {...hitProps}
                  >
                    <rect
                      width={Math.max(170, infoTxt.length * 6.5 + 16)}
                      height={22}
                      rx={5}
                      fill={d.color}
                    />
                    <text
                      x={Math.max(170, infoTxt.length * 6.5 + 16) / 2}
                      y={14.5}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={10}
                      fontWeight={600}
                      fontFamily="'JetBrains Mono', monospace"
                      className="pointer-events-none"
                    >
                      {infoTxt}
                    </text>
                  </g>
                )}
                {d.label && (
                  <text
                    x={(c1.x + c2.x) / 2}
                    y={(c1.y + c2.y) / 2 - 8}
                    textAnchor="middle"
                    fill={d.color}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && (
                  <>
                    {renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
                    {renderHandle(d.id, 'p2', c2.x, c2.y, d.color)}
                  </>
                )}
              </g>
            );
          }

          // 9. FIB RETRACEMENT
          if (d.type === 'fibRetracement') {
            const c1 = toXY(d.p1);
            const c2 = toXY(d.p2);
            if (!c1 || !c2) return null;

            const left = Math.min(c1.x, c2.x);
            const right = Math.max(left + 140, Math.max(c1.x, c2.x));
            const width = right - left;
            const diffPrice = d.p2.price - d.p1.price;

            const levelCoords = FIB_LEVELS.map((lvl) => {
              const price = d.p2.price - diffPrice * lvl.ratio;
              const y = series.priceToCoordinate(price);
              return { ...lvl, price, y };
            });

            return (
              <g key={d.id} opacity={opacity}>
                {/* Diagonal anchor guide */}
                <line
                  x1={c1.x}
                  y1={c1.y}
                  x2={c2.x}
                  y2={c2.y}
                  stroke="transparent"
                  strokeWidth={20}
                  {...hitProps}
                />
                <line
                  x1={c1.x}
                  y1={c1.y}
                  x2={c2.x}
                  y2={c2.y}
                  stroke={d.color}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  className="pointer-events-none"
                />
                {levelCoords.map((lvl, idx) => {
                  const next = levelCoords[idx + 1];
                  if (lvl.y === null) return null;
                  return (
                    <g key={lvl.ratio}>
                      {next && next.y !== null && (
                        <rect
                          x={left}
                          y={Math.min(lvl.y, next.y)}
                          width={width}
                          height={Math.abs(next.y - lvl.y)}
                          fill={d.fillColor ? shapeFillRgba : lvl.fill}
                          {...hitProps}
                        />
                      )}
                      <line
                        x1={left}
                        y1={lvl.y}
                        x2={right}
                        y2={lvl.y}
                        stroke="transparent"
                        strokeWidth={18}
                        {...hitProps}
                      />
                      <line
                        x1={left}
                        y1={lvl.y}
                        x2={right}
                        y2={lvl.y}
                        stroke={lvl.color}
                        strokeWidth={Math.max(1, d.lineWidth - 0.5)}
                        strokeDasharray={dash}
                        className="pointer-events-none"
                      />
                      <text
                        x={left + 4}
                        y={lvl.y - 4}
                        fill={lvl.color}
                        fontSize={10}
                        fontWeight={600}
                        fontFamily="'JetBrains Mono', monospace"
                        className="pointer-events-none"
                      >
                        {lvl.ratio} ({formatPrice(lvl.price)})
                      </text>
                    </g>
                  );
                })}
                {d.label && (
                  <text
                    x={left + width / 2}
                    y={Math.min(c1.y, c2.y) - 8}
                    textAnchor="middle"
                    fill={d.color}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && (
                  <>
                    {renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
                    {renderHandle(d.id, 'p2', c2.x, c2.y, d.color)}
                  </>
                )}
              </g>
            );
          }

          // 10. FIB CHANNEL
          if (d.type === 'fibChannel') {
            const c1 = toXY(d.p1);
            const c2 = toXY(d.p2);
            if (!c1 || !c2) return null;
            const dy = c2.y - c1.y || 40;
            const ratios = [0, 0.236, 0.382, 0.5, 0.618, 1];
            return (
              <g key={d.id} opacity={opacity}>
                <polygon
                  points={`${c1.x},${c1.y} ${c2.x},${c2.y} ${c2.x},${c2.y + dy} ${c1.x},${c1.y + dy}`}
                  fill={d.fillColor ? shapeFillRgba : `${d.color}12`}
                  {...hitProps}
                />
                {ratios.map((r, i) => {
                  const offset = dy * r;
                  const col = FIB_LEVELS[i]?.color ?? d.color;
                  return (
                    <g key={r}>
                      <line
                        x1={c1.x}
                        y1={c1.y + offset}
                        x2={c2.x}
                        y2={c2.y + offset}
                        stroke="transparent"
                        strokeWidth={26}
                        {...hitProps}
                      />
                      <line
                        x1={c1.x}
                        y1={c1.y + offset}
                        x2={c2.x}
                        y2={c2.y + offset}
                        stroke={col}
                        strokeWidth={d.lineWidth}
                        strokeDasharray={r === 0 || r === 1 ? undefined : '4 3'}
                        className="pointer-events-none"
                      />
                      <text
                        x={c1.x + 4}
                        y={c1.y + offset - 3}
                        fill={col}
                        fontSize={9.5}
                        fontWeight={600}
                        fontFamily="'JetBrains Mono', monospace"
                        className="pointer-events-none"
                      >
                        {r}
                      </text>
                    </g>
                  );
                })}
                {isSelected && (
                  <>
                    {renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
                    {renderHandle(d.id, 'p2', c2.x, c2.y, d.color)}
                  </>
                )}
              </g>
            );
          }

          // 11. ANDREWS' PITCHFORK (3 points)
          if (d.type === 'pitchfork') {
            const c1 = toXY(d.p1);
            const c2 = toXY(d.p2);
            const c3 = toXY(d.p3);
            if (!c1 || !c2 || !c3) return null;

            const midX = (c2.x + c3.x) / 2;
            const midY = (c2.y + c3.y) / 2;
            const median = extendRayToEdge(c1.x, c1.y, midX, midY, false);
            const dx = median.bx - c1.x;
            const dy = median.by - c1.y;

            return (
              <g key={d.id} opacity={opacity}>
                <polygon
                  points={`${c2.x},${c2.y} ${c2.x + dx},${c2.y + dy} ${c3.x + dx},${c3.y + dy} ${c3.x},${c3.y}`}
                  fill={d.fillColor ? shapeFillRgba : 'rgba(41, 98, 255, 0.08)'}
                  {...hitProps}
                />
                <line x1={c2.x} y1={c2.y} x2={c3.x} y2={c3.y} stroke="transparent" strokeWidth={26} {...hitProps} />
                <line x1={c1.x} y1={c1.y} x2={median.bx} y2={median.by} stroke="transparent" strokeWidth={28} {...hitProps} />
                <line x1={c2.x} y1={c2.y} x2={c2.x + dx} y2={c2.y + dy} stroke="transparent" strokeWidth={28} {...hitProps} />
                <line x1={c3.x} y1={c3.y} x2={c3.x + dx} y2={c3.y + dy} stroke="transparent" strokeWidth={28} {...hitProps} />
                <line x1={c2.x} y1={c2.y} x2={c3.x} y2={c3.y} stroke={d.color} strokeWidth={1} strokeDasharray="3 3" className="pointer-events-none" />
                <line x1={c1.x} y1={c1.y} x2={median.bx} y2={median.by} stroke={d.color} strokeWidth={d.lineWidth} strokeDasharray={dash} className="pointer-events-none" />
                <line x1={c2.x} y1={c2.y} x2={c2.x + dx} y2={c2.y + dy} stroke={d.color} strokeWidth={d.lineWidth} strokeDasharray={dash} className="pointer-events-none" />
                <line x1={c3.x} y1={c3.y} x2={c3.x + dx} y2={c3.y + dy} stroke={d.color} strokeWidth={d.lineWidth} strokeDasharray={dash} className="pointer-events-none" />
                {d.label && (
                  <text
                    x={midX}
                    y={midY - 8}
                    textAnchor="middle"
                    fill={d.color}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && (
                  <>
                    {renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
                    {renderHandle(d.id, 'p2', c2.x, c2.y, d.color)}
                    {renderHandle(d.id, 'p3', c3.x, c3.y, d.color)}
                  </>
                )}
              </g>
            );
          }

          // 12. EXACT TRADINGVIEW LONG / SHORT POSITION TOOL + LIVE CANDLE TRACKING
          if (d.type === 'long' || d.type === 'short') {
            const xStart = resolveTimeX(chart, candles, timeframeSeconds, d.startTime);
            const xEnd = resolveTimeX(chart, candles, timeframeSeconds, d.endTime);
            const entryY = series.priceToCoordinate(d.entryPrice);
            const tpY = series.priceToCoordinate(d.tpPrice);
            const slY = series.priceToCoordinate(d.slPrice);

            if (xStart === null || xEnd === null || entryY === null || tpY === null || slY === null) {
              return null;
            }

            const left = Math.min(xStart, xEnd);
            const width = Math.max(96, Math.abs(xEnd - xStart));

            const tpTop = Math.min(entryY, tpY);
            const tpH = Math.max(2, Math.abs(tpY - entryY));
            const slTop = Math.min(entryY, slY);
            const slH = Math.max(2, Math.abs(slY - entryY));

            const tpDist = Math.abs(d.tpPrice - d.entryPrice);
            const slDist = Math.max(1e-9, Math.abs(d.entryPrice - d.slPrice));
            const rr = tpDist / slDist;
            const tpPct = d.entryPrice !== 0 ? ((tpDist / d.entryPrice) * 100).toFixed(2) : '0.00';
            const slPct = d.entryPrice !== 0 ? ((slDist / d.entryPrice) * 100).toFixed(2) : '0.00';

            const symbolSpec = getSymbolContractSpec(symbol, d.entryPrice);
            const tickSize = Math.max(0.00001, d.tickSize ?? symbolSpec.tickSize);
            const tpTicks = Math.round(tpDist / tickSize);
            const slTicks = Math.round(slDist / tickSize);

            const riskMode = d.riskMode ?? 'usd';
            const riskValue = d.riskValue ?? 100;
            const accountBalance = d.accountBalance ?? 10000;
            const pointValue = Math.max(0.0001, d.pointValue ?? symbolSpec.pointValue);

            const riskDollars =
              riskMode === 'percent' ? (accountBalance * riskValue) / 100 : riskValue;
            const rawQty = riskDollars / (slDist * pointValue);
            const calcQty = symbolSpec.isIntegerOnly
              ? Math.max(1, Math.round(rawQty))
              : rawQty;
            const formattedQty = symbolSpec.isIntegerOnly
              ? `${calcQty} ${symbolSpec.unitLabel}`
              : calcQty >= 100
              ? calcQty.toFixed(1)
              : calcQty >= 1
              ? calcQty.toFixed(2)
              : calcQty.toFixed(4);

            // Real-time chronological candle tracking through the Long/Short zone
            const tStart = Math.min(Number(d.startTime), Number(d.endTime));
            const tEnd = Math.max(Number(d.startTime), Number(d.endTime));
            const barsInRange = candles.filter((c) => {
              const t = Number(c.time);
              return t >= tStart && t <= tEnd;
            });

            let outcome: 'open' | 'tp' | 'sl' = 'open';
            let outcomeBar: Candle | null = null;
            let outcomePrice: number | null = null;

            for (const bar of barsInRange) {
              const hitTp = d.type === 'long' ? bar.high >= d.tpPrice : bar.low <= d.tpPrice;
              const hitSl = d.type === 'long' ? bar.low <= d.slPrice : bar.high >= d.slPrice;
              if (hitTp && hitSl) {
                const distToTp = Math.abs(d.tpPrice - bar.open);
                const distToSl = Math.abs(d.slPrice - bar.open);
                if (distToSl <= distToTp) {
                  outcome = 'sl';
                  outcomeBar = bar;
                  outcomePrice = d.slPrice;
                } else {
                  outcome = 'tp';
                  outcomeBar = bar;
                  outcomePrice = d.tpPrice;
                }
                break;
              }
              if (hitTp) {
                outcome = 'tp';
                outcomeBar = bar;
                outcomePrice = d.tpPrice;
                break;
              }
              if (hitSl) {
                outcome = 'sl';
                outcomeBar = bar;
                outcomePrice = d.slPrice;
                break;
              }
            }

            const lastBarInRange = barsInRange[barsInRange.length - 1] ?? null;
            const chartLastBar = candles[candles.length - 1] ?? null;
            const trackBar = outcome === 'open' ? lastBarInRange : outcomeBar;
            const trackPrice =
              outcome !== 'open' && outcomePrice !== null
                ? outcomePrice
                : lastBarInRange
                ? chartLastBar &&
                  Number(lastBarInRange.time) === Number(chartLastBar.time) &&
                  currentPrice > 0
                  ? currentPrice
                  : lastBarInRange.close
                : currentPrice > 0
                ? currentPrice
                : d.entryPrice;

            const trackXRaw = trackBar
              ? resolveTimeX(chart, candles, timeframeSeconds, trackBar.time)
              : null;
            const trackX =
              trackXRaw !== null
                ? Math.min(left + width, Math.max(left + 4, trackXRaw))
                : null;
            const trackYRaw =
              barsInRange.length > 0 ? series.priceToCoordinate(trackPrice) : null;
            const boxMinY = Math.min(tpY, slY);
            const boxMaxY = Math.max(tpY, slY);
            const trackY =
              trackYRaw !== null
                ? Math.min(boxMaxY, Math.max(boxMinY, trackYRaw))
                : null;

            const markPrice =
              barsInRange.length > 0
                ? trackPrice
                : currentPrice > 0
                ? currentPrice
                : d.entryPrice;
            const openPnl =
              d.type === 'long'
                ? (markPrice - d.entryPrice) * calcQty * pointValue
                : (d.entryPrice - markPrice) * calcQty * pointValue;
            const rewardDollars = tpDist * calcQty * pointValue;
            const targetEquity = accountBalance + rewardDollars;
            const stopEquity = Math.max(0, accountBalance - riskDollars);

            const targetPrefix = outcome === 'tp' ? '✓ Target Reached · ' : '';
            const stopPrefix = outcome === 'sl' ? '✕ Stopped Out · ' : '';
            const targetText = `${targetPrefix}Target: ${formatPrice(tpDist)} (${tpPct}%) ${tpTicks}, Amount: $${targetEquity.toFixed(2)}`;
            const rrText = `Open PnL: ${formatSignedUsd(openPnl)}, ${
              symbolSpec.isIntegerOnly ? formattedQty : `Qty: ${formattedQty}`
            } / R:R ${rr.toFixed(2)}`;
            const stopText = `${stopPrefix}Stop: ${formatPrice(slDist)} (${slPct}%) ${slTicks}, Amount: $${stopEquity.toFixed(2)}`;

            const targetBadgeW = Math.min(Math.max(220, targetText.length * 6.05 + 16), Math.max(220, plotW - 12));
            const stopBadgeW = Math.min(Math.max(210, stopText.length * 6.05 + 16), Math.max(210, plotW - 12));
            const rrBadgeW = Math.min(Math.max(248, rrText.length * 6.0 + 38), Math.max(248, plotW - 12));

            const targetBadgeY = d.type === 'long' ? tpTop - 24 : tpTop + tpH + 4;
            const stopBadgeY = d.type === 'long' ? slTop + slH + 4 : slTop - 24;

            const zoneAlpha = d.opacity !== undefined ? Math.max(0.04, Math.min(0.65, d.opacity * 0.28)) : 0.18;
            const tpFill = `rgba(8, 153, 129, ${zoneAlpha.toFixed(2)})`;
            const slFill = `rgba(242, 54, 69, ${zoneAlpha.toFixed(2)})`;

            const axisPillW = 68;
            const renderAxisPill = (priceVal: number, yPos: number, bg: string) => {
              if (yPos < 8 || yPos > plotH - 8) return null;
              const label = formatPrice(priceVal);
              const w = Math.max(axisPillW, label.length * 6.5 + 10);
              return (
                <g transform={`translate(${Math.max(4, plotW - w)}, ${yPos - 9})`} className="pointer-events-none">
                  <rect width={w} height={18} rx={3} fill={bg} />
                  <text
                    x={w / 2}
                    y={12.5}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={10}
                    fontWeight={700}
                    fontFamily="'JetBrains Mono', monospace"
                  >
                    {label}
                  </text>
                </g>
              );
            };

            const showStatsOverlay = isSelected || isDraft;
            const progressIsProfit = openPnl >= 0;

            return (
              <g key={d.id} opacity={opacity}>
                {/* Target Box: Translucent Teal-Green Fill */}
                <rect
                  x={left}
                  y={tpTop}
                  width={width}
                  height={tpH}
                  fill={tpFill}
                  stroke="#089981"
                  strokeWidth={outcome === 'tp' ? Math.max(1.8, d.lineWidth) : Math.max(1, d.lineWidth * 0.75)}
                  strokeDasharray={dash}
                  {...hitProps}
                />
                {/* Stop Box: Translucent Crimson-Red Fill */}
                <rect
                  x={left}
                  y={slTop}
                  width={width}
                  height={slH}
                  fill={slFill}
                  stroke="#f23645"
                  strokeWidth={outcome === 'sl' ? Math.max(1.8, d.lineWidth) : Math.max(1, d.lineWidth * 0.75)}
                  strokeDasharray={dash}
                  {...hitProps}
                />

                {/* Live Candle Progress Fill Overlay inside the Position Box */}
                {trackX !== null && trackY !== null && (
                  <g className="pointer-events-none">
                    <rect
                      x={left}
                      y={Math.min(entryY, trackY)}
                      width={Math.max(2, trackX - left)}
                      height={Math.max(2, Math.abs(trackY - entryY))}
                      fill={
                        progressIsProfit
                          ? 'rgba(16, 185, 129, 0.28)'
                          : 'rgba(242, 54, 69, 0.28)'
                      }
                    />
                    <line
                      x1={left}
                      y1={trackY}
                      x2={trackX}
                      y2={trackY}
                      stroke={progressIsProfit ? '#10b981' : '#f23645'}
                      strokeWidth={1.5}
                      strokeDasharray="3 2"
                    />
                    <circle
                      cx={trackX}
                      cy={trackY}
                      r={3.5}
                      fill={progressIsProfit ? '#10b981' : '#f23645'}
                      stroke="#ffffff"
                      strokeWidth={1.25}
                    />
                  </g>
                )}

                {/* Center Entry Line */}
                <line
                  x1={left}
                  y1={entryY}
                  x2={left + width}
                  y2={entryY}
                  stroke="transparent"
                  strokeWidth={28}
                  {...hitProps}
                />
                <line
                  x1={left}
                  y1={entryY}
                  x2={left + width}
                  y2={entryY}
                  stroke={d.color !== '#2962ff' ? d.color : isDark ? '#787b86' : '#2962ff'}
                  strokeWidth={Math.max(1.5, d.lineWidth)}
                  strokeDasharray={dash}
                  className="pointer-events-none"
                />

                {/* Clean Corner Outcome Status Tag even when collapsed */}
                {outcome !== 'open' && !showStatsOverlay && (
                  <g
                    transform={`translate(${Math.min(
                      Math.max(4, left + width - 92),
                      Math.max(4, plotW - 96)
                    )}, ${outcome === 'tp' ? Math.max(4, tpTop + 4) : Math.max(4, slTop + slH - 22)})`}
                    className="pointer-events-none"
                  >
                    <rect
                      width={88}
                      height={18}
                      rx={4}
                      fill={outcome === 'tp' ? '#10b981' : '#ef4444'}
                    />
                    <text
                      x={44}
                      y={12.5}
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize={9}
                      fontWeight={700}
                      fontFamily="'Plus Jakarta Sans', sans-serif"
                    >
                      {outcome === 'tp' ? 'Target Reached' : 'Stopped Out'}
                    </text>
                  </g>
                )}

                {/* Right Y-Axis Colored Price Pills + Floating TradingView Stats Badges: ONLY when Selected or Placing Draft */}
                {showStatsOverlay && (
                  <>
                    {renderAxisPill(d.tpPrice, tpY, outcome === 'tp' ? '#10b981' : '#089981')}
                    {renderAxisPill(d.entryPrice, entryY, '#2962ff')}
                    {renderAxisPill(d.slPrice, slY, outcome === 'sl' ? '#ef4444' : '#f23645')}

                    {/* Top/Target Floating Badge */}
                    <g
                      transform={`translate(${Math.min(
                        Math.max(4, left + width / 2 - targetBadgeW / 2),
                        Math.max(4, plotW - targetBadgeW - 4)
                      )}, ${Math.min(Math.max(4, targetBadgeY), Math.max(4, plotH - 24))})`}
                      className="pointer-events-none"
                    >
                      <rect
                        width={targetBadgeW}
                        height={20}
                        rx={5}
                        fill={outcome === 'tp' ? '#10b981' : '#089981'}
                        stroke={outcome === 'tp' ? '#ffffff' : undefined}
                        strokeWidth={outcome === 'tp' ? 1.25 : 0}
                      />
                      <text
                        x={targetBadgeW / 2}
                        y={13.5}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize={9.75}
                        fontWeight={700}
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {targetText}
                      </text>
                    </g>

                    {/* Bottom/Stop Floating Badge */}
                    <g
                      transform={`translate(${Math.min(
                        Math.max(4, left + width / 2 - stopBadgeW / 2),
                        Math.max(4, plotW - stopBadgeW - 4)
                      )}, ${Math.min(Math.max(4, stopBadgeY), Math.max(4, plotH - 24))})`}
                      className="pointer-events-none"
                    >
                      <rect
                        width={stopBadgeW}
                        height={20}
                        rx={5}
                        fill={outcome === 'sl' ? '#ef4444' : '#f23645'}
                        stroke={outcome === 'sl' ? '#ffffff' : undefined}
                        strokeWidth={outcome === 'sl' ? 1.25 : 0}
                      />
                      <text
                        x={stopBadgeW / 2}
                        y={13.5}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize={9.75}
                        fontWeight={700}
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {stopText}
                      </text>
                    </g>

                    {/* Center Entry Floating Pill: Open PnL, Qty / Risk/reward ratio + Calculator Button */}
                    <g
                      transform={`translate(${Math.min(
                        Math.max(4, left + width / 2 - rrBadgeW / 2),
                        Math.max(4, plotW - rrBadgeW - 4)
                      )}, ${Math.min(Math.max(26, entryY - 11), Math.max(26, plotH - 26))})`}
                    >
                      <rect
                        width={rrBadgeW}
                        height={22}
                        rx={6}
                        fill={isDark ? '#1e222d' : '#ffffff'}
                        stroke="#2962ff"
                        strokeWidth={1.25}
                        {...hitProps}
                      />
                      <text
                        x={(rrBadgeW - 24) / 2}
                        y={14.5}
                        textAnchor="middle"
                        fill={isDark ? '#d1d4dc' : '#131722'}
                        fontSize={9.75}
                        fontWeight={700}
                        fontFamily="'JetBrains Mono', monospace"
                        className="pointer-events-none"
                      >
                        {rrText}
                      </text>
                      {!isDraft && interactive && (
                        <g
                          className="pointer-events-auto cursor-pointer"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectDrawing(d.id);
                            setCalcModalDrawingId(
                              calcModalDrawingId === d.id ? null : d.id
                            );
                          }}
                        >
                          <rect
                            x={rrBadgeW - 24}
                            y={1}
                            width={22}
                            height={20}
                            rx={4}
                            fill="rgba(41, 98, 255, 0.12)"
                          />
                          <text
                            x={rrBadgeW - 13}
                            y={14.5}
                            textAnchor="middle"
                            fill="#2962ff"
                            fontSize={12}
                            fontWeight={700}
                          >
                            ⚙
                          </text>
                        </g>
                      )}
                    </g>
                  </>
                )}

                {d.label && (
                  <text
                    x={left + 6}
                    y={entryY - 6}
                    fill={d.color !== '#2962ff' ? d.color : isDark ? '#d1d4dc' : '#131722'}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && (
                  <>
                    {renderHandle(d.id, 'corner_start_tp', left, tpY, '#2962ff')}
                    {renderHandle(d.id, 'corner_end_tp', left + width, tpY, '#2962ff')}
                    {renderHandle(d.id, 'corner_start_sl', left, slY, '#2962ff')}
                    {renderHandle(d.id, 'corner_end_sl', left + width, slY, '#2962ff')}
                    {renderHandle(d.id, 'entry', left, entryY, '#2962ff')}
                    {renderHandle(d.id, 'end', left + width, entryY, '#2962ff')}
                    {renderHandle(d.id, 'tp', left + width / 2, tpY, '#089981')}
                    {renderHandle(d.id, 'sl', left + width / 2, slY, '#f23645')}
                  </>
                )}
              </g>
            );
          }

          // 13. RECTANGLE / PRICE RANGE / DATE & PRICE RANGE / MEASURE RULER / CONTRACT SIZE RULER
          if (
            d.type === 'rectangle' ||
            d.type === 'priceRange' ||
            d.type === 'datePriceRange' ||
            d.type === 'measure' ||
            d.type === 'contractRuler'
          ) {
            const c1 = toXY(d.p1);
            const c2 = toXY(d.p2);
            if (!c1 || !c2) return null;

            const left = Math.min(c1.x, c2.x);
            const top = Math.min(c1.y, c2.y);
            const w = Math.max(4, Math.abs(c2.x - c1.x));
            const h = Math.max(4, Math.abs(c2.y - c1.y));

            const deltaPrice = d.p2.price - d.p1.price;
            const absPoints = Math.abs(deltaPrice);
            const pct = d.p1.price !== 0 ? (deltaPrice / d.p1.price) * 100 : 0;
            const isUp = deltaPrice >= 0;
            const accent =
              d.type === 'rectangle'
                ? d.color
                : d.type === 'contractRuler'
                ? '#089981'
                : isUp
                ? '#2962ff'
                : '#f23645';

            const tMin = Math.min(Number(d.p1.time), Number(d.p2.time));
            const tMax = Math.max(Number(d.p1.time), Number(d.p2.time));
            const deltaSec = Number(d.p2.time) - Number(d.p1.time);
            const barsInCandles = candles.filter(
              (c) => Number(c.time) >= tMin && Number(c.time) <= tMax
            ).length;
            const bars =
              barsInCandles >= 2
                ? barsInCandles - 1
                : Math.max(1, Math.round(Math.abs(deltaSec) / timeframeSeconds));

            const showBadge = d.type !== 'rectangle';

            let line1 = `${isUp ? '+' : ''}${formatPrice(deltaPrice)} (${
              pct >= 0 ? '+' : ''
            }${pct.toFixed(2)}%)`;
            let line2 =
              d.type === 'priceRange'
                ? 'Price Range'
                : `${bars} bars · ${formatDuration(deltaSec)}`;

            if (d.type === 'contractRuler') {
              const symbolSpec = getSymbolContractSpec(symbol, d.p1.price);
              const pointValue = Math.max(0.0001, d.pointValue ?? symbolSpec.pointValue);
              const riskMode = d.riskMode ?? 'usd';
              const riskValue = d.riskValue ?? 100;
              const accountBalance = d.accountBalance ?? 10000;
              const riskDollars =
                riskMode === 'percent' ? (accountBalance * riskValue) / 100 : riskValue;
              const safePts = Math.max(symbolSpec.tickSize * 0.25, absPoints);
              const rawRecQty = absPoints > 1e-9 ? riskDollars / (safePts * pointValue) : 0;
              const recText = symbolSpec.isIntegerOnly
                ? `${symbolSpec.unitLabel}: ${Math.max(0, Math.round(rawRecQty))}`
                : `Qty: ${
                    rawRecQty >= 100
                      ? rawRecQty.toFixed(1)
                      : rawRecQty >= 1
                      ? rawRecQty.toFixed(2)
                      : rawRecQty.toFixed(4)
                  }`;
              line1 = `${formatPrice(absPoints)} pts · Risk: $${riskDollars.toFixed(2)}`;
              line2 = recText;
            }

            const hasGear = d.type === 'contractRuler' && !isDraft && interactive;
            const badgeW = Math.max(
              152,
              Math.max(line1.length, line2.length) * 6.8 + (hasGear ? 38 : 18)
            );
            const badgeX = Math.min(
              Math.max(6, left + w / 2 - badgeW / 2),
              Math.max(6, plotW - badgeW - 6)
            );
            const badgeY =
              top > 48 ? top - 44 : Math.min(plotH - 42, top + h + 6);

            return (
              <g key={d.id} opacity={opacity}>
                <rect
                  x={left}
                  y={top}
                  width={w}
                  height={h}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={24}
                  {...hitProps}
                />
                <rect
                  x={left}
                  y={top}
                  width={w}
                  height={h}
                  fill={d.type === 'rectangle' || d.fillColor ? shapeFillRgba : `${accent}24`}
                  stroke={accent}
                  strokeWidth={d.lineWidth}
                  strokeDasharray={dash}
                  {...hitProps}
                />
                {showBadge && (
                  <>
                    <line x1={left} y1={top + h / 2} x2={left + w} y2={top + h / 2} stroke={accent} strokeWidth={1} strokeDasharray="3 3" className="pointer-events-none" />
                    <line x1={left + w / 2} y1={top} x2={left + w / 2} y2={top + h} stroke={accent} strokeWidth={1} strokeDasharray="3 3" className="pointer-events-none" />
                    <g transform={`translate(${badgeX}, ${badgeY})`}>
                      <rect width={badgeW} height={38} rx={6} fill={accent} {...hitProps} />
                      <text
                        x={(badgeW - (hasGear ? 20 : 0)) / 2}
                        y={15}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize={10.5}
                        fontWeight={700}
                        fontFamily="'JetBrains Mono', monospace"
                        className="pointer-events-none"
                      >
                        {line1}
                      </text>
                      <text
                        x={(badgeW - (hasGear ? 20 : 0)) / 2}
                        y={30}
                        textAnchor="middle"
                        fill="rgba(255,255,255,0.95)"
                        fontSize={10}
                        fontWeight={700}
                        fontFamily="'JetBrains Mono', monospace"
                        className="pointer-events-none"
                      >
                        {line2}
                      </text>
                      {hasGear && (
                        <g
                          className="pointer-events-auto cursor-pointer"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelectDrawing(d.id);
                            setCalcModalDrawingId(
                              calcModalDrawingId === d.id ? null : d.id
                            );
                          }}
                        >
                          <rect
                            x={badgeW - 24}
                            y={7}
                            width={20}
                            height={24}
                            rx={4}
                            fill="rgba(255,255,255,0.22)"
                          />
                          <text
                            x={badgeW - 14}
                            y={23}
                            textAnchor="middle"
                            fill="#ffffff"
                            fontSize={12}
                            fontWeight={700}
                          >
                            ⚙
                          </text>
                        </g>
                      )}
                    </g>
                  </>
                )}
                {d.label && (
                  <text
                    x={left + w / 2}
                    y={top + 16}
                    textAnchor="middle"
                    fill={accent}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && (
                  <>
                    {renderHandle(d.id, 'p1', c1.x, c1.y, accent)}
                    {renderHandle(d.id, 'p2', c2.x, c2.y, accent)}
                  </>
                )}
              </g>
            );
          }

          // 14. BARS PATTERN (ghost mini candlestick projection)
          if (d.type === 'barsPattern') {
            const c1 = toXY(d.p1);
            const c2 = toXY(d.p2);
            if (!c1 || !c2) return null;

            const offsets = d.barsOffsets ?? [];
            return (
              <g key={d.id} opacity={opacity}>
                <rect
                  x={Math.min(c1.x, c2.x)}
                  y={Math.min(c1.y, c2.y)}
                  width={Math.max(12, Math.abs(c2.x - c1.x))}
                  height={Math.max(12, Math.abs(c2.y - c1.y))}
                  fill={d.fillColor ? shapeFillRgba : 'rgba(41, 98, 255, 0.08)'}
                  stroke={d.color}
                  strokeWidth={d.lineWidth}
                  strokeDasharray={dash ?? '4 4'}
                  {...hitProps}
                />
                {offsets.map((bar, idx) => {
                  const bx = resolveTimeX(
                    chart,
                    candles,
                    timeframeSeconds,
                    (Number(d.p2.time) + bar.dt) as UTCTimestamp
                  );
                  const yo = series.priceToCoordinate(d.p2.price + bar.dOpen);
                  const yh = series.priceToCoordinate(d.p2.price + bar.dHigh);
                  const yl = series.priceToCoordinate(d.p2.price + bar.dLow);
                  const yc = series.priceToCoordinate(d.p2.price + bar.dClose);
                  if (bx === null || yo === null || yh === null || yl === null || yc === null) {
                    return null;
                  }
                  const bull = bar.dClose >= bar.dOpen;
                  const col = bull ? '#2962ff' : '#f23645';
                  return (
                    <g key={idx} opacity={0.7}>
                      <line x1={bx} y1={yh} x2={bx} y2={yl} stroke={col} strokeWidth={1.2} />
                      <rect
                        x={bx - 3}
                        y={Math.min(yo, yc)}
                        width={6}
                        height={Math.max(2, Math.abs(yc - yo))}
                        fill={col}
                      />
                    </g>
                  );
                })}
                {isSelected && (
                  <>
                    {renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
                    {renderHandle(d.id, 'p2', c2.x, c2.y, d.color)}
                  </>
                )}
              </g>
            );
          }

          // 15. ELLIPSE / CIRCLE
          if (d.type === 'ellipse') {
            const c1 = toXY(d.p1);
            const c2 = toXY(d.p2);
            if (!c1 || !c2) return null;
            const cx = (c1.x + c2.x) / 2;
            const cy = (c1.y + c2.y) / 2;
            const rx = Math.max(4, Math.abs(c2.x - c1.x) / 2);
            const ry = Math.max(4, Math.abs(c2.y - c1.y) / 2);
            return (
              <g key={d.id} opacity={opacity}>
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={rx}
                  ry={ry}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={24}
                  {...hitProps}
                />
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={rx}
                  ry={ry}
                  fill={shapeFillRgba}
                  stroke={d.color}
                  strokeWidth={d.lineWidth}
                  strokeDasharray={dash}
                  {...hitProps}
                />
                {d.label && (
                  <text
                    x={cx}
                    y={cy + 4}
                    textAnchor="middle"
                    fill={d.color}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && (
                  <>
                    {renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
                    {renderHandle(d.id, 'p2', c2.x, c2.y, d.color)}
                  </>
                )}
              </g>
            );
          }

          // 16. TRIANGLE (3 points)
          if (d.type === 'triangle') {
            const c1 = toXY(d.p1);
            const c2 = toXY(d.p2);
            const c3 = toXY(d.p3);
            if (!c1 || !c2 || !c3) return null;
            return (
              <g key={d.id} opacity={opacity}>
                <polygon
                  points={`${c1.x},${c1.y} ${c2.x},${c2.y} ${c3.x},${c3.y}`}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={24}
                  {...hitProps}
                />
                <polygon
                  points={`${c1.x},${c1.y} ${c2.x},${c2.y} ${c3.x},${c3.y}`}
                  fill={shapeFillRgba}
                  stroke={d.color}
                  strokeWidth={d.lineWidth}
                  strokeDasharray={dash}
                  {...hitProps}
                />
                {d.label && (
                  <text
                    x={(c1.x + c2.x + c3.x) / 3}
                    y={(c1.y + c2.y + c3.y) / 3 + 4}
                    textAnchor="middle"
                    fill={d.color}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && (
                  <>
                    {renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
                    {renderHandle(d.id, 'p2', c2.x, c2.y, d.color)}
                    {renderHandle(d.id, 'p3', c3.x, c3.y, d.color)}
                  </>
                )}
              </g>
            );
          }

          // 17. ROTATED RECTANGLE (3 points)
          if (d.type === 'rotatedRectangle') {
            const c1 = toXY(d.p1);
            const c2 = toXY(d.p2);
            const c3 = toXY(d.p3);
            if (!c1 || !c2 || !c3) return null;

            const vx = c2.x - c1.x;
            const vy = c2.y - c1.y;
            const len = Math.max(1, Math.hypot(vx, vy));
            const nx = -vy / len;
            const ny = vx / len;
            const proj = (c3.x - c1.x) * nx + (c3.y - c1.y) * ny;
            const ox = nx * proj;
            const oy = ny * proj;

            const p4x = c1.x + ox;
            const p4y = c1.y + oy;
            const p3x = c2.x + ox;
            const p3y = c2.y + oy;

            return (
              <g key={d.id} opacity={opacity}>
                <polygon
                  points={`${c1.x},${c1.y} ${c2.x},${c2.y} ${p3x},${p3y} ${p4x},${p4y}`}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={24}
                  {...hitProps}
                />
                <polygon
                  points={`${c1.x},${c1.y} ${c2.x},${c2.y} ${p3x},${p3y} ${p4x},${p4y}`}
                  fill={shapeFillRgba}
                  stroke={d.color}
                  strokeWidth={d.lineWidth}
                  strokeDasharray={dash}
                  {...hitProps}
                />
                {d.label && (
                  <text
                    x={(c1.x + c2.x + p3x + p4x) / 4}
                    y={(c1.y + c2.y + p3y + p4y) / 4 + 4}
                    textAnchor="middle"
                    fill={d.color}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && (
                  <>
                    {renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
                    {renderHandle(d.id, 'p2', c2.x, c2.y, d.color)}
                    {renderHandle(d.id, 'p3', c3.x, c3.y, d.color)}
                  </>
                )}
              </g>
            );
          }

          // 18. PARALLEL CHANNEL (3 points)
          if (d.type === 'parallelChannel') {
            const c1 = toXY(d.p1);
            const c2 = toXY(d.p2);
            const c3 = toXY(d.p3);
            if (!c1 || !c2 || !c3) return null;

            const dx = c2.x - c1.x;
            const dy = c2.y - c1.y;
            const t =
              dx * dx + dy * dy > 1
                ? ((c3.x - c1.x) * dx + (c3.y - c1.y) * dy) / (dx * dx + dy * dy)
                : 0;
            const projX = c1.x + t * dx;
            const projY = c1.y + t * dy;
            const offX = c3.x - projX;
            const offY = c3.y - projY;

            const q1x = c1.x + offX;
            const q1y = c1.y + offY;
            const q2x = c2.x + offX;
            const q2y = c2.y + offY;

            return (
              <g key={d.id} opacity={opacity}>
                <polygon
                  points={`${c1.x},${c1.y} ${c2.x},${c2.y} ${q2x},${q2y} ${q1x},${q1y}`}
                  fill={shapeFillRgba}
                  {...hitProps}
                />
                <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} stroke="transparent" strokeWidth={28} {...hitProps} />
                <line x1={q1x} y1={q1y} x2={q2x} y2={q2y} stroke="transparent" strokeWidth={28} {...hitProps} />
                <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} stroke={d.color} strokeWidth={d.lineWidth} strokeDasharray={dash} className="pointer-events-none" />
                <line x1={q1x} y1={q1y} x2={q2x} y2={q2y} stroke={d.color} strokeWidth={d.lineWidth} strokeDasharray={dash} className="pointer-events-none" />
                <line
                  x1={(c1.x + q1x) / 2}
                  y1={(c1.y + q1y) / 2}
                  x2={(c2.x + q2x) / 2}
                  y2={(c2.y + q2y) / 2}
                  stroke={d.color}
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  className="pointer-events-none"
                />
                {d.label && (
                  <text
                    x={(c1.x + c2.x) / 2}
                    y={(c1.y + c2.y) / 2 - 8}
                    textAnchor="middle"
                    fill={d.color}
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="'Plus Jakarta Sans', sans-serif"
                    className="pointer-events-none"
                  >
                    {d.label}
                  </text>
                )}
                {isSelected && (
                  <>
                    {renderHandle(d.id, 'p1', c1.x, c1.y, d.color)}
                    {renderHandle(d.id, 'p2', c2.x, c2.y, d.color)}
                    {renderHandle(d.id, 'p3', c3.x, c3.y, d.color)}
                  </>
                )}
              </g>
            );
          }

          // 19. BRUSH / HIGHLIGHTER
          if (d.type === 'brush' || d.type === 'highlighter') {
            const coords = d.points
              .map((pt) => toXY(pt))
              .filter((pt): pt is { x: number; y: number } => pt !== null);
            if (coords.length < 2) return null;

            const pathD = coords
              .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
              .join(' ');
            const isHi = d.type === 'highlighter';

            return (
              <g key={d.id} opacity={opacity}>
                <path
                  d={pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={30}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  {...hitProps}
                />
                <path
                  d={pathD}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={isHi ? d.lineWidth * 6 : d.lineWidth}
                  strokeOpacity={isHi ? 0.35 : 1}
                  strokeDasharray={dash}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-none"
                />
                {isSelected && (
                  <>
                    <circle
                      cx={coords[0].x}
                      cy={coords[0].y}
                      r={5}
                      fill="#ffffff"
                      stroke="#2962ff"
                      strokeWidth={2}
                      className="pointer-events-none"
                    />
                    <circle
                      cx={coords[coords.length - 1].x}
                      cy={coords[coords.length - 1].y}
                      r={5}
                      fill="#ffffff"
                      stroke="#2962ff"
                      strokeWidth={2}
                      className="pointer-events-none"
                    />
                  </>
                )}
              </g>
            );
          }

          return null;
        })}

        {/* Active Paper Position Entry (Blue), Take Profit (Green), and Stop Loss (Red) Lines */}
        {openPositions.map((pos) => {
          const entryY = series.priceToCoordinate(pos.entryPrice);
          const tpY = pos.tpPrice !== undefined ? series.priceToCoordinate(pos.tpPrice) : null;
          const slY = pos.slPrice !== undefined ? series.priceToCoordinate(pos.slPrice) : null;

          return (
            <g key={`pos-lines-${pos.id}`}>
              {entryY !== null && entryY >= -20 && entryY <= plotH + 20 && (
                <>
                  <line
                    x1={0}
                    y1={entryY}
                    x2={plotW}
                    y2={entryY}
                    stroke="#2962ff"
                    strokeWidth={expandedPosId === pos.id ? 2 : 1.5}
                    strokeDasharray="5 3"
                    className="pointer-events-none"
                  />
                  {interactive && (
                    <line
                      x1={0}
                      y1={entryY}
                      x2={plotW}
                      y2={entryY}
                      stroke="transparent"
                      strokeWidth={20}
                      className="pointer-events-auto cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedPosId((curr) => (curr === pos.id ? null : pos.id));
                      }}
                    />
                  )}
                </>
              )}

              {tpY !== null && tpY >= -20 && tpY <= plotH + 20 && (
                <g>
                  <line
                    x1={0}
                    y1={tpY}
                    x2={plotW}
                    y2={tpY}
                    stroke="#089981"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                    className="pointer-events-none"
                  />
                  {interactive && (
                    <line
                      x1={0}
                      y1={tpY}
                      x2={plotW}
                      y2={tpY}
                      stroke="transparent"
                      strokeWidth={20}
                      className="pointer-events-auto touch-none cursor-ns-resize"
                      onPointerDown={(e) => startPositionLineDrag(e, pos.id, 'tp')}
                      onPointerMove={handleElementPointerMove}
                      onPointerUp={handleElementPointerUp}
                      onPointerCancel={handleElementPointerUp}
                    />
                  )}
                </g>
              )}

              {slY !== null && slY >= -20 && slY <= plotH + 20 && (
                <g>
                  <line
                    x1={0}
                    y1={slY}
                    x2={plotW}
                    y2={slY}
                    stroke="#f23645"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                    className="pointer-events-none"
                  />
                  {interactive && (
                    <line
                      x1={0}
                      y1={slY}
                      x2={plotW}
                      y2={slY}
                      stroke="transparent"
                      strokeWidth={20}
                      className="pointer-events-auto touch-none cursor-ns-resize"
                      onPointerDown={(e) => startPositionLineDrag(e, pos.id, 'sl')}
                      onPointerMove={handleElementPointerMove}
                      onPointerUp={handleElementPointerUp}
                      onPointerCancel={handleElementPointerUp}
                    />
                  )}
                </g>
              )}
            </g>
          );
        })}

        {/* On-Chart Trade Execution History Markers (Buy ▲ Blue / Sell ▼ Red) */}
        {showExecutions &&
          candles.length > 0 &&
          (() => {
            const maxVisibleTime = Number(candles[candles.length - 1].time) + timeframeSeconds;
            interface ExecMarker {
              id: string;
              action: 'buy' | 'sell';
              time: number;
              price: number;
              qty: number;
              tag: string;
            }
            const rawMarkers: ExecMarker[] = [];

            for (const pos of openPositions) {
              if (pos.entryTime <= maxVisibleTime) {
                rawMarkers.push({
                  id: `pos-entry-${pos.id}`,
                  action: pos.side === 'long' ? 'buy' : 'sell',
                  time: pos.entryTime,
                  price: pos.entryPrice,
                  qty: pos.qty,
                  tag: 'Open',
                });
              }
            }
            for (const tr of closedTrades) {
              if (tr.entryTime <= maxVisibleTime) {
                rawMarkers.push({
                  id: `tr-entry-${tr.id}`,
                  action: tr.side === 'long' ? 'buy' : 'sell',
                  time: tr.entryTime,
                  price: tr.entryPrice,
                  qty: tr.qty,
                  tag: 'Entry',
                });
              }
              if (tr.exitTime <= maxVisibleTime) {
                rawMarkers.push({
                  id: `tr-exit-${tr.id}`,
                  action: tr.side === 'long' ? 'sell' : 'buy',
                  time: tr.exitTime,
                  price: tr.exitPrice,
                  qty: tr.qty,
                  tag: tr.exitReason,
                });
              }
            }

            const slotCounts = new Map<string, number>();

            const findNearestCandle = (ts: number): Candle | null => {
              if (candles.length === 0) return null;
              let lo = 0;
              let hi = candles.length - 1;
              while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (Number(candles[mid].time) <= ts) {
                  lo = mid;
                } else {
                  hi = mid - 1;
                }
              }
              return candles[lo];
            };

            return rawMarkers.map((mk) => {
              const bar = findNearestCandle(mk.time);
              if (!bar) return null;
              const x = resolveTimeX(chart, candles, timeframeSeconds, bar.time);
              const anchorY = series.priceToCoordinate(
                mk.action === 'buy' ? bar.low : bar.high
              );
              if (x === null || anchorY === null || x < -20 || x > plotW + 20) return null;

              const slotKey = `${Number(bar.time)}-${mk.action}`;
              const stackIdx = slotCounts.get(slotKey) ?? 0;
              slotCounts.set(slotKey, stackIdx + 1);

              const dirOffset = (14 + stackIdx * 13) * (mk.action === 'buy' ? 1 : -1);
              const tipY = Math.min(Math.max(14, anchorY + dirOffset), plotH - 14);
              const isBuy = mk.action === 'buy';
              const color = isBuy ? '#2962ff' : '#f23645';
              const tooltipText = `${isBuy ? 'Buy' : 'Sell'} ${mk.qty} @ ${formatPrice(mk.price)}`;
              const isHovered = hoveredExecutionId === mk.id;
              const tipW = Math.max(108, tooltipText.length * 6.4 + 16);
              const tipBoxX = Math.min(
                Math.max(6, x - tipW / 2),
                Math.max(6, plotW - tipW - 6)
              );
              const tipBoxY = isBuy
                ? Math.min(plotH - 24, tipY + 11)
                : Math.max(6, tipY - 31);

              const points = isBuy
                ? `${x},${tipY - 6} ${x - 6},${tipY + 5} ${x + 6},${tipY + 5}`
                : `${x},${tipY + 6} ${x - 6},${tipY - 5} ${x + 6},${tipY - 5}`;

              return (
                <g key={mk.id}>
                  <g
                    className="pointer-events-auto cursor-pointer"
                    onPointerEnter={() => setHoveredExecutionId(mk.id)}
                    onPointerLeave={() =>
                      setHoveredExecutionId((curr) => (curr === mk.id ? null : curr))
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setHoveredExecutionId((curr) => (curr === mk.id ? null : mk.id));
                    }}
                  >
                    <title>{tooltipText}</title>
                    <circle cx={x} cy={tipY} r={14} fill="transparent" />
                    <polygon
                      points={points}
                      fill={color}
                      stroke="#ffffff"
                      strokeWidth={1.2}
                    />
                  </g>
                  {isHovered && (
                    <g
                      transform={`translate(${tipBoxX}, ${tipBoxY})`}
                      className="pointer-events-none"
                    >
                      <rect
                        width={tipW}
                        height={20}
                        rx={5}
                        fill={isDark ? '#1e222d' : '#131722'}
                        stroke={color}
                        strokeWidth={1.2}
                      />
                      <text
                        x={tipW / 2}
                        y={13.5}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize={10}
                        fontWeight={700}
                        fontFamily="'JetBrains Mono', monospace"
                      >
                        {tooltipText}
                      </text>
                    </g>
                  )}
                </g>
              );
            });
          })()}

        {/* Bar Replay hover cut-line */}
        {replayHoverTime != null && (() => {
          const rx = resolveTimeX(chart, candles, timeframeSeconds, replayHoverTime);
          if (rx === null) return null;
          const pillW = 88;
          const px = Math.min(Math.max(4, rx - pillW / 2), Math.max(4, plotW - pillW - 4));
          return (
            <g className="pointer-events-none">
              <rect
                x={rx}
                y={0}
                width={Math.max(0, plotW - rx)}
                height={plotH}
                fill="rgba(41, 98, 255, 0.08)"
              />
              <line
                x1={rx}
                y1={0}
                x2={rx}
                y2={plotH}
                stroke="#2962ff"
                strokeWidth={2}
                strokeDasharray="5 4"
              />
              <g transform={`translate(${px}, 10)`}>
                <rect width={pillW} height={22} rx={5} fill="#2962ff" />
                <text
                  x={pillW / 2}
                  y={14.5}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={10.5}
                  fontWeight={600}
                  fontFamily="'Plus Jakarta Sans', sans-serif"
                >
                  Replay Here
                </text>
              </g>
            </g>
          );
        })()}
      </svg>

      {/* Right-Side Interactive Position Tags (Entry PnL + Close, Draggable TP & SL) */}
      {openPositions.length > 0 && (
        <div
          className="pointer-events-none absolute top-0 left-0 z-20 overflow-hidden select-none"
          style={{ width: `${plotW}px`, height: `${plotH}px` }}
        >
          {openPositions.map((pos) => {
            const markPrice = currentPrice > 0 ? currentPrice : pos.entryPrice;
            const liveMetrics = calculatePositionMetrics(pos, markPrice);
            const entryY = series.priceToCoordinate(pos.entryPrice);
            const tpY = pos.tpPrice !== undefined ? series.priceToCoordinate(pos.tpPrice) : null;
            const slY = pos.slPrice !== undefined ? series.priceToCoordinate(pos.slPrice) : null;

            const tpPnl =
              pos.tpPrice !== undefined
                ? calculatePositionMetrics(pos, pos.tpPrice).unrealizedPnl
                : 0;
            const slPnl =
              pos.slPrice !== undefined
                ? calculatePositionMetrics(pos, pos.slPrice).unrealizedPnl
                : 0;

            const refPrice = markPrice > 0 ? markPrice : pos.entryPrice;
            const isExpanded = expandedPosId === pos.id;
            const clampedEntryY =
              entryY !== null ? Math.min(Math.max(18, entryY), plotH - 18) : null;
            const tpHandleTop =
              clampedEntryY !== null
                ? pos.side === 'long'
                  ? Math.max(12, clampedEntryY - 26)
                  : Math.min(plotH - 12, clampedEntryY + 26)
                : null;
            const slHandleTop =
              clampedEntryY !== null
                ? pos.side === 'long'
                  ? Math.min(plotH - 12, clampedEntryY + 26)
                  : Math.max(12, clampedEntryY - 26)
                : null;

            return (
              <div key={`pos-tags-${pos.id}`}>
                {/* Entry Price Tag (Blue): BUY 1 @ 27,927.25 | +$45.00 | × (Tap to spawn TP & SL) */}
                {clampedEntryY !== null && entryY !== null && entryY >= -16 && entryY <= plotH + 16 && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedPosId((curr) => (curr === pos.id ? null : pos.id));
                    }}
                    title="Tap to add & drag Take Profit / Stop Loss"
                    className={`pointer-events-auto absolute right-1.5 flex cursor-pointer items-center gap-1 rounded-md border border-[#2962ff] bg-[#2962ff] px-1.5 py-0.5 text-[10px] font-bold text-white shadow-md transition-shadow ${
                      isExpanded ? 'ring-2 ring-white/80' : ''
                    }`}
                    style={{
                      top: `${clampedEntryY}px`,
                      transform: 'translateY(-50%)',
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <span className="font-mono-tabular uppercase tracking-tight opacity-95">
                      {pos.side === 'long' ? 'BUY' : 'SELL'} {pos.qty} @ {formatPrice(pos.entryPrice)}
                    </span>
                    <span className="opacity-60">|</span>
                    <span
                      className={`rounded px-1 py-px font-mono-tabular text-[10px] font-bold ${
                        liveMetrics.unrealizedPnl >= 0
                          ? 'bg-[#089981] text-white'
                          : 'bg-[#f23645] text-white'
                      }`}
                    >
                      {formatSignedUsd(liveMetrics.unrealizedPnl)}
                    </span>
                    {onClosePosition && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onClosePosition(pos.id);
                        }}
                        aria-label={`Close ${pos.symbol} position`}
                        title="Close position"
                        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded bg-white/20 text-white hover:bg-white/35"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}

                {/* Revealed Attached Draggable +TP Pill Handle when Entry Position is Tapped */}
                {isExpanded &&
                  pos.tpPrice === undefined &&
                  tpHandleTop !== null &&
                  onUpdatePositionTPSL && (
                    <div
                      onPointerDown={(e) => startPositionSpawnDrag(e, pos.id, 'tp')}
                      onPointerMove={handleElementPointerMove}
                      onPointerUp={handleElementPointerUp}
                      onPointerCancel={handleElementPointerUp}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        top: `${tpHandleTop}px`,
                        transform: 'translateY(-50%)',
                        touchAction: 'none',
                      }}
                      title="Drag or tap to place Take Profit line"
                      className="pointer-events-auto absolute right-1.5 flex cursor-ns-resize items-center gap-1 rounded-md border border-white/40 bg-[#089981] px-2 py-0.5 text-[10px] font-bold text-white shadow-lg hover:bg-[#07846f]"
                    >
                      <GripVertical className="h-3 w-3 opacity-85" />
                      <span>+ TP</span>
                    </div>
                  )}

                {/* Revealed Attached Draggable +SL Pill Handle when Entry Position is Tapped */}
                {isExpanded &&
                  pos.slPrice === undefined &&
                  slHandleTop !== null &&
                  onUpdatePositionTPSL && (
                    <div
                      onPointerDown={(e) => startPositionSpawnDrag(e, pos.id, 'sl')}
                      onPointerMove={handleElementPointerMove}
                      onPointerUp={handleElementPointerUp}
                      onPointerCancel={handleElementPointerUp}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        top: `${slHandleTop}px`,
                        transform: 'translateY(-50%)',
                        touchAction: 'none',
                      }}
                      title="Drag or tap to place Stop Loss line"
                      className="pointer-events-auto absolute right-1.5 flex cursor-ns-resize items-center gap-1 rounded-md border border-white/40 bg-[#f23645] px-2 py-0.5 text-[10px] font-bold text-white shadow-lg hover:bg-[#dc2626]"
                    >
                      <GripVertical className="h-3 w-3 opacity-85" />
                      <span>+ SL</span>
                    </div>
                  )}

                {/* Draggable Take Profit Tag (Green) */}
                {pos.tpPrice !== undefined &&
                  tpY !== null &&
                  tpY >= -16 &&
                  tpY <= plotH + 16 && (
                    <div
                      onPointerDown={(e) => startPositionLineDrag(e, pos.id, 'tp')}
                      onPointerMove={handleElementPointerMove}
                      onPointerUp={handleElementPointerUp}
                      onPointerCancel={handleElementPointerUp}
                      style={{
                        top: `${Math.min(Math.max(14, tpY), plotH - 14)}px`,
                        transform: 'translateY(-50%)',
                        touchAction: 'none',
                      }}
                      title="Drag up/down to adjust Take Profit"
                      className="pointer-events-auto absolute right-1.5 flex cursor-ns-resize items-center gap-1 rounded-md border border-[#089981] bg-[#089981] px-1.5 py-0.5 text-[10px] font-bold text-white shadow-md"
                    >
                      <GripVertical className="h-3 w-3 opacity-80" />
                      <span>TP</span>
                      <span className="font-mono-tabular">{formatPrice(pos.tpPrice)}</span>
                      <span className="rounded bg-black/20 px-1 py-px font-mono-tabular">
                        {formatSignedUsd(tpPnl)}
                      </span>
                      {onUpdatePositionTPSL && (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => onUpdatePositionTPSL(pos.id, undefined, pos.slPrice)}
                          aria-label="Remove Take Profit"
                          title="Clear TP"
                          className="ml-0.5 flex h-4 w-4 items-center justify-center rounded bg-white/20 text-white hover:bg-white/35"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}

                {/* Draggable Stop Loss Tag (Red) */}
                {pos.slPrice !== undefined &&
                  slY !== null &&
                  slY >= -16 &&
                  slY <= plotH + 16 && (
                    <div
                      onPointerDown={(e) => startPositionLineDrag(e, pos.id, 'sl')}
                      onPointerMove={handleElementPointerMove}
                      onPointerUp={handleElementPointerUp}
                      onPointerCancel={handleElementPointerUp}
                      style={{
                        top: `${Math.min(Math.max(14, slY), plotH - 14)}px`,
                        transform: 'translateY(-50%)',
                        touchAction: 'none',
                      }}
                      title="Drag up/down to adjust Stop Loss"
                      className="pointer-events-auto absolute right-1.5 flex cursor-ns-resize items-center gap-1 rounded-md border border-[#f23645] bg-[#f23645] px-1.5 py-0.5 text-[10px] font-bold text-white shadow-md"
                    >
                      <GripVertical className="h-3 w-3 opacity-80" />
                      <span>SL</span>
                      <span className="font-mono-tabular">{formatPrice(pos.slPrice)}</span>
                      <span className="rounded bg-black/20 px-1 py-px font-mono-tabular">
                        {formatSignedUsd(slPnl)}
                      </span>
                      {onUpdatePositionTPSL && (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => onUpdatePositionTPSL(pos.id, pos.tpPrice, undefined)}
                          aria-label="Remove Stop Loss"
                          title="Clear SL"
                          className="ml-0.5 flex h-4 w-4 items-center justify-center rounded bg-white/20 text-white hover:bg-white/35"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      )}

      {/* Right-Side Draggable Pending Limit/Stop Order Lines & Tags */}
      {pendingOrders.length > 0 && (
        <div
          className="pointer-events-none absolute top-0 left-0 z-20 overflow-hidden select-none"
          style={{ width: `${plotW}px`, height: `${plotH}px` }}
        >
          {pendingOrders.map((ord) => {
            const targetY = series.priceToCoordinate(ord.targetPrice);
            const tpY = ord.tpPrice !== undefined ? series.priceToCoordinate(ord.tpPrice) : null;
            const slY = ord.slPrice !== undefined ? series.priceToCoordinate(ord.slPrice) : null;
            const isBuy = ord.side === 'long';
            const defaultTpOffset = ord.targetPrice * 0.008;
            const defaultSlOffset = ord.targetPrice * 0.004;

            return (
              <div key={`pending-group-${ord.id}`}>
                {targetY !== null && targetY >= -16 && targetY <= plotH + 16 && (
                  <>
                    {/* Full-width horizontal drag strip along the pending order line */}
                    <div
                      onPointerDown={(e) => startPendingOrderLineDrag(e, ord.id, 'target')}
                      onPointerMove={handleElementPointerMove}
                      onPointerUp={handleElementPointerUp}
                      onPointerCancel={handleElementPointerUp}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        top: `${targetY}px`,
                        transform: 'translateY(-50%)',
                        touchAction: 'none',
                      }}
                      title="Drag up/down to modify order price"
                      className="pointer-events-auto absolute left-0 right-0 h-5 cursor-ns-resize"
                    />

                    {/* Draggable Pending Order Tag */}
                    <div
                      onPointerDown={(e) => startPendingOrderLineDrag(e, ord.id, 'target')}
                      onPointerMove={handleElementPointerMove}
                      onPointerUp={handleElementPointerUp}
                      onPointerCancel={handleElementPointerUp}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        top: `${Math.min(Math.max(14, targetY), plotH - 14)}px`,
                        transform: 'translateY(-50%)',
                        touchAction: 'none',
                      }}
                      title="Drag up/down to move pending order price"
                      className={`pointer-events-auto absolute right-1.5 flex cursor-ns-resize items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold shadow-md ${
                        isBuy
                          ? 'border-[#2962ff] bg-white/95 text-[#2962ff] dark:bg-[#1e222d]/95'
                          : 'border-[#f23645] bg-white/95 text-[#f23645] dark:bg-[#1e222d]/95'
                      }`}
                    >
                      <GripVertical className="h-3 w-3 opacity-80" />
                      <span className="uppercase tracking-tight">
                        {isBuy ? 'BUY' : 'SELL'} {ord.orderType} {ord.qty}
                      </span>
                      <span className="font-mono-tabular opacity-90">
                        @ {formatPrice(ord.targetPrice)}
                      </span>
                      {ord.tpPrice === undefined && onUpdatePendingOrder && (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdatePendingOrder(ord.id, {
                              tpPrice: isBuy
                                ? ord.targetPrice + defaultTpOffset
                                : Math.max(0.0001, ord.targetPrice - defaultTpOffset),
                            });
                          }}
                          className="rounded bg-[#089981] px-1 py-px text-[9px] font-bold text-white hover:bg-[#07846f]"
                          title="Add draggable Take Profit line"
                        >
                          +TP
                        </button>
                      )}
                      {ord.slPrice === undefined && onUpdatePendingOrder && (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdatePendingOrder(ord.id, {
                              slPrice: isBuy
                                ? Math.max(0.0001, ord.targetPrice - defaultSlOffset)
                                : ord.targetPrice + defaultSlOffset,
                            });
                          }}
                          className="rounded bg-[#f23645] px-1 py-px text-[9px] font-bold text-white hover:bg-[#dc2626]"
                          title="Add draggable Stop Loss line"
                        >
                          +SL
                        </button>
                      )}
                      {onCancelPendingOrder && (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onCancelPendingOrder(ord.id);
                          }}
                          aria-label={`Cancel ${ord.symbol} ${ord.orderType} order`}
                          title="Cancel pending order"
                          className={`ml-0.5 flex h-4 w-4 items-center justify-center rounded ${
                            isBuy
                              ? 'bg-[#2962ff]/12 text-[#2962ff] hover:bg-[#2962ff]/25'
                              : 'bg-[#f23645]/12 text-[#f23645] hover:bg-[#f23645]/25'
                          }`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </>
                )}

                {/* Draggable Pending Order Take Profit Tag (Green) */}
                {ord.tpPrice !== undefined && tpY !== null && tpY >= -16 && tpY <= plotH + 16 && (
                  <div
                    onPointerDown={(e) => startPendingOrderLineDrag(e, ord.id, 'tp')}
                    onPointerMove={handleElementPointerMove}
                    onPointerUp={handleElementPointerUp}
                    onPointerCancel={handleElementPointerUp}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      top: `${Math.min(Math.max(14, tpY), plotH - 14)}px`,
                      transform: 'translateY(-50%)',
                      touchAction: 'none',
                    }}
                    title="Drag up/down to adjust pending order Take Profit"
                    className="pointer-events-auto absolute right-1.5 flex cursor-ns-resize items-center gap-1 rounded-md border border-[#089981] bg-[#089981] px-1.5 py-0.5 text-[10px] font-bold text-white shadow-md"
                  >
                    <GripVertical className="h-3 w-3 opacity-80" />
                    <span>TP</span>
                    <span className="font-mono-tabular">{formatPrice(ord.tpPrice)}</span>
                    {onUpdatePendingOrder && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdatePendingOrder(ord.id, { tpPrice: undefined });
                        }}
                        aria-label="Remove pending order Take Profit"
                        title="Clear TP"
                        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded bg-white/20 text-white hover:bg-white/35"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}

                {/* Draggable Pending Order Stop Loss Tag (Red) */}
                {ord.slPrice !== undefined && slY !== null && slY >= -16 && slY <= plotH + 16 && (
                  <div
                    onPointerDown={(e) => startPendingOrderLineDrag(e, ord.id, 'sl')}
                    onPointerMove={handleElementPointerMove}
                    onPointerUp={handleElementPointerUp}
                    onPointerCancel={handleElementPointerUp}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      top: `${Math.min(Math.max(14, slY), plotH - 14)}px`,
                      transform: 'translateY(-50%)',
                      touchAction: 'none',
                    }}
                    title="Drag up/down to adjust pending order Stop Loss"
                    className="pointer-events-auto absolute right-1.5 flex cursor-ns-resize items-center gap-1 rounded-md border border-[#f23645] bg-[#f23645] px-1.5 py-0.5 text-[10px] font-bold text-white shadow-md"
                  >
                    <GripVertical className="h-3 w-3 opacity-80" />
                    <span>SL</span>
                    <span className="font-mono-tabular">{formatPrice(ord.slPrice)}</span>
                    {onUpdatePendingOrder && (
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdatePendingOrder(ord.id, { slPrice: undefined });
                        }}
                        aria-label="Remove pending order Stop Loss"
                        title="Clear SL"
                        className="ml-0.5 flex h-4 w-4 items-center justify-center rounded bg-white/20 text-white hover:bg-white/35"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Draggable Price Alert Lines & Tags */}
      {priceAlerts.length > 0 && (
        <div
          className="pointer-events-none absolute top-0 left-0 z-20 overflow-hidden select-none"
          style={{ width: `${plotW}px`, height: `${plotH}px` }}
        >
          {priceAlerts.map((alert) => {
            const alertY = series.priceToCoordinate(alert.targetPrice);
            if (alertY === null || alertY < -16 || alertY > plotH + 16) return null;
            const condIcon =
              alert.condition === 'crossing_up'
                ? '↑'
                : alert.condition === 'crossing_down'
                ? '↓'
                : '↕';

            return (
              <div key={`alert-group-${alert.id}`}>
                {/* Full-width invisible drag strip right over the dashed amber alert line */}
                <div
                  onPointerDown={(e) => startAlertLineDrag(e, alert.id)}
                  onPointerMove={handleElementPointerMove}
                  onPointerUp={handleElementPointerUp}
                  onPointerCancel={handleElementPointerUp}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    top: `${alertY}px`,
                    transform: 'translateY(-50%)',
                    touchAction: 'none',
                  }}
                  title="Drag up/down to move Price Alert level"
                  className="pointer-events-auto absolute left-0 right-0 h-5 cursor-ns-resize"
                />

                {/* Draggable Amber Alert Tag on the right edge */}
                <div
                  onPointerDown={(e) => startAlertLineDrag(e, alert.id)}
                  onPointerMove={handleElementPointerMove}
                  onPointerUp={handleElementPointerUp}
                  onPointerCancel={handleElementPointerUp}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    top: `${Math.min(Math.max(14, alertY), plotH - 14)}px`,
                    transform: 'translateY(-50%)',
                    touchAction: 'none',
                  }}
                  title="Drag up/down to adjust Price Alert target"
                  className="pointer-events-auto absolute right-1.5 flex cursor-ns-resize items-center gap-1 rounded-md border border-[#f59e0b] bg-[#f59e0b] px-1.5 py-0.5 text-[10px] font-bold text-white shadow-md"
                >
                  <GripVertical className="h-3 w-3 opacity-85" />
                  <BellRing className="h-2.5 w-2.5" />
                  <span className="font-mono-tabular">
                    {condIcon} {formatPrice(alert.targetPrice)}
                  </span>
                  {alert.note && (
                    <span className="max-w-[70px] truncate opacity-90">
                      · {alert.note}
                    </span>
                  )}
                  {onDeletePriceAlert && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeletePriceAlert(alert.id);
                      }}
                      aria-label={`Delete alert on ${alert.symbol}`}
                      title="Delete alert"
                      className="ml-0.5 flex h-4 w-4 items-center justify-center rounded bg-black/20 text-white hover:bg-black/35"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Drawing Floating Contextual Toolbar */}
      {selectedDrawing && !lockedDrawings && interactive && (
        <div
          className="absolute top-12 left-1/2 z-30 flex max-w-[calc(100%-16px)] -translate-x-1/2 flex-col items-center gap-1.5"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex max-w-full items-center gap-1.5 overflow-x-auto rounded-xl border border-[#e0e3eb] bg-white/95 px-2.5 py-1.5 shadow-lg backdrop-blur-md dark:border-[#2a2e39] dark:bg-[#1e222d]/95">
            {/* Border Color & Fill Color Palette Buttons */}
            <div className="flex items-center gap-1 pr-1.5 border-r border-[#e0e3eb] dark:border-[#2a2e39]">
              <button
                type="button"
                onClick={() =>
                  setActiveColorMenu((prev) => (prev === 'stroke' ? null : 'stroke'))
                }
                title="Line / Border Color & Opacity"
                aria-label="Open border color palette"
                className={`flex h-7 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold transition-colors ${
                  activeColorMenu === 'stroke'
                    ? 'border-[#2962ff] bg-[#2962ff]/10 text-[#2962ff]'
                    : 'border-transparent text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#2a2e39]'
                }`}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full border border-black/20 dark:border-white/25"
                  style={{ backgroundColor: selectedDrawing.color }}
                />
                <Pencil className="h-3 w-3 opacity-80" />
              </button>

              {FILLABLE_DRAWING_TYPES.has(selectedDrawing.type) && (
                <button
                  type="button"
                  onClick={() =>
                    setActiveColorMenu((prev) => (prev === 'fill' ? null : 'fill'))
                  }
                  title="Fill / Background Color & Opacity"
                  aria-label="Open fill color palette"
                  className={`flex h-7 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold transition-colors ${
                    activeColorMenu === 'fill'
                      ? 'border-[#2962ff] bg-[#2962ff]/10 text-[#2962ff]'
                      : 'border-transparent text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#2a2e39]'
                  }`}
                >
                  <span
                    className="h-3.5 w-3.5 rounded-sm border border-black/20 dark:border-white/25"
                    style={{
                      backgroundColor: selectedDrawing.fillColor ?? selectedDrawing.color,
                      opacity: Math.max(0.25, selectedDrawing.opacity ?? 0.4),
                    }}
                  />
                  <PaintBucket className="h-3 w-3 opacity-80" />
                </button>
              )}
            </div>

          {/* Line Thickness */}
          <div className="flex items-center gap-0.5 pr-1.5 border-r border-[#e0e3eb] dark:border-[#2a2e39]">
            {WIDTH_OPTIONS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => onUpdateDrawing({ ...selectedDrawing, lineWidth: w })}
                className={`flex h-7 w-7 items-center justify-center rounded-md font-mono-tabular text-[11px] font-bold transition-colors ${
                  selectedDrawing.lineWidth === w
                    ? 'bg-[#2962ff] text-white'
                    : 'text-[#787b86] hover:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]'
                }`}
                title={`${w}px stroke`}
              >
                {w}px
              </button>
            ))}
          </div>

          {/* Line Style (Solid / Dashed / Dotted) */}
          <div className="flex items-center gap-0.5 pr-1.5 border-r border-[#e0e3eb] dark:border-[#2a2e39]">
            {LINE_STYLE_OPTIONS.map((styleOpt) => {
              const active = (selectedDrawing.lineStyle ?? 'solid') === styleOpt.id;
              return (
                <button
                  key={styleOpt.id}
                  type="button"
                  onClick={() =>
                    onUpdateDrawing({ ...selectedDrawing, lineStyle: styleOpt.id })
                  }
                  title={`${styleOpt.label} line style`}
                  aria-label={`${styleOpt.label} line style`}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    active
                      ? 'bg-[#2962ff] text-white'
                      : 'text-[#787b86] hover:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]'
                  }`}
                >
                  <svg width="16" height="6" viewBox="0 0 16 6" aria-hidden="true">
                    <line
                      x1="1"
                      y1="3"
                      x2="15"
                      y2="3"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeDasharray={
                        styleOpt.id === 'dashed'
                          ? '4 2.5'
                          : styleOpt.id === 'dotted'
                          ? '1.5 2.5'
                          : undefined
                      }
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              );
            })}
          </div>

          {/* Edit Text / Custom Label button */}
          <button
            type="button"
            onClick={() => {
              const initial =
                selectedDrawing.type === 'text' || selectedDrawing.type === 'callout'
                  ? selectedDrawing.text
                  : selectedDrawing.label ?? '';
              setEditingTextId(selectedDrawing.id);
              setTextDraft(initial);
            }}
            className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold whitespace-nowrap ${
              editingTextId === selectedDrawing.id
                ? 'bg-[#2962ff] text-white'
                : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#2a2e39]'
            }`}
            title="Edit text label"
          >
            <Pencil className="h-3.5 w-3.5" />
            <span>
              {selectedDrawing.type === 'text' || selectedDrawing.type === 'callout'
                ? 'Edit'
                : selectedDrawing.label
                ? 'Label'
                : 'Text'}
            </span>
          </button>

          {/* Position Calculator Gear & Execute Order buttons when Long/Short or ContractRuler selected */}
          {(selectedDrawing.type === 'long' ||
            selectedDrawing.type === 'short' ||
            selectedDrawing.type === 'contractRuler') && (
            <>
              <button
                type="button"
                onClick={() =>
                  setCalcModalDrawingId(
                    calcModalDrawingId === selectedDrawing.id ? null : selectedDrawing.id
                  )
                }
                className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold whitespace-nowrap ${
                  calcModalDrawingId === selectedDrawing.id
                    ? 'bg-[#2962ff] text-white'
                    : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#2a2e39]'
                }`}
                title="Position Risk & Contract Calculator"
              >
                <Settings className="h-3.5 w-3.5" />
                <span>Risk</span>
              </button>

              {(selectedDrawing.type === 'long' || selectedDrawing.type === 'short') &&
                onExecuteOrder && (
                  <button
                    type="button"
                    onClick={() => {
                      const spec = getSymbolContractSpec(symbol, selectedDrawing.entryPrice);
                      const riskMode = selectedDrawing.riskMode ?? 'usd';
                      const riskValue = selectedDrawing.riskValue ?? 100;
                      const accountBalance = selectedDrawing.accountBalance ?? 10000;
                      const pointValue = Math.max(
                        0.0001,
                        selectedDrawing.pointValue ?? spec.pointValue
                      );
                      const slDist = Math.max(
                        1e-9,
                        Math.abs(selectedDrawing.entryPrice - selectedDrawing.slPrice)
                      );
                      const riskDollars =
                        riskMode === 'percent' ? (accountBalance * riskValue) / 100 : riskValue;
                      const rawQty = riskDollars / (slDist * pointValue);
                      const qty = sanitizeOrderQty(symbol, rawQty, selectedDrawing.entryPrice);
                      onExecuteOrder({
                        side: selectedDrawing.type,
                        qty,
                        entryPrice: selectedDrawing.entryPrice,
                        tpPrice: selectedDrawing.tpPrice,
                        slPrice: selectedDrawing.slPrice,
                        pointValue,
                      });
                      setCalcModalDrawingId(null);
                    }}
                    className={`flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-bold text-white whitespace-nowrap shadow-xs ${
                      selectedDrawing.type === 'long'
                        ? 'bg-[#089981] hover:bg-[#07846f]'
                        : 'bg-[#f23645] hover:bg-[#dc2626]'
                    }`}
                  >
                    <Play className="h-3 w-3 fill-current" />
                    <span>Execute Order</span>
                  </button>
                )}
            </>
          )}

          {/* Delete */}
          <button
            type="button"
            onClick={() => {
              onDeleteDrawing(selectedDrawing.id);
              onSelectDrawing(null);
              setCalcModalDrawingId(null);
            }}
            aria-label="Delete selected drawing"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#f23645] hover:bg-[#f23645]/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>

            {/* Deselect */}
            <button
              type="button"
              onClick={() => {
                onSelectDrawing(null);
                setCalcModalDrawingId(null);
                setActiveColorMenu(null);
              }}
              aria-label="Close drawing toolbar"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[#787b86] hover:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Expanded Border / Fill Color Palette + Opacity Slider Popover */}
          {activeColorMenu && (
            <div className="w-[274px] max-w-full rounded-2xl border border-[#e0e3eb] bg-white/95 p-3 shadow-2xl backdrop-blur-md dark:border-[#2a2e39] dark:bg-[#1e222d]/95">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-[#131722] dark:text-[#d1d4dc]">
                  {activeColorMenu === 'fill'
                    ? 'Background / Fill Color'
                    : 'Border / Line Color'}
                </span>
                <div className="flex items-center gap-1">
                  {activeColorMenu === 'fill' && selectedDrawing.fillColor && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...selectedDrawing };
                        delete next.fillColor;
                        onUpdateDrawing(next);
                      }}
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white"
                    >
                      Auto
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveColorMenu(null)}
                    aria-label="Close color palette"
                    className="flex h-5 w-5 items-center justify-center rounded text-[#787b86] hover:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-8 gap-1.5">
                {TV_PALETTE_40.map((hex) => {
                  const activeHex =
                    activeColorMenu === 'fill'
                      ? (selectedDrawing.fillColor ?? selectedDrawing.color).toLowerCase()
                      : selectedDrawing.color.toLowerCase();
                  const isCurrent = activeHex === hex.toLowerCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() =>
                        onUpdateDrawing(
                          activeColorMenu === 'fill'
                            ? { ...selectedDrawing, fillColor: hex }
                            : { ...selectedDrawing, color: hex }
                        )
                      }
                      aria-label={`Select color ${hex}`}
                      className={`relative flex h-6 w-6 items-center justify-center rounded-md border transition-transform hover:scale-110 ${
                        isCurrent
                          ? 'border-[#2962ff] ring-2 ring-[#2962ff]/50'
                          : 'border-black/15 dark:border-white/20'
                      }`}
                      style={{ backgroundColor: hex }}
                    >
                      {isCurrent && (
                        <Check
                          className={`h-3 w-3 stroke-[3] ${
                            hex.toLowerCase() === '#ffffff' ||
                            hex.toLowerCase() === '#fff9c4' ||
                            hex.toLowerCase() === '#fff176' ||
                            hex.toLowerCase() === '#ffeb3b'
                              ? 'text-[#131722]'
                              : 'text-white'
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-[#e0e3eb] pt-2.5 dark:border-[#2a2e39]">
                <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  <input
                    type="color"
                    aria-label="Custom color picker"
                    value={
                      activeColorMenu === 'fill'
                        ? selectedDrawing.fillColor ?? selectedDrawing.color
                        : selectedDrawing.color
                    }
                    onChange={(e) =>
                      onUpdateDrawing(
                        activeColorMenu === 'fill'
                          ? { ...selectedDrawing, fillColor: e.target.value }
                          : { ...selectedDrawing, color: e.target.value }
                      )
                    }
                    className="h-6 w-8 cursor-pointer rounded border border-[#e0e3eb] bg-transparent p-0 dark:border-[#2a2e39]"
                  />
                  <span>Custom Hex</span>
                </label>
                <span className="font-mono-tabular text-[11px] font-semibold text-[#787b86]">
                  {(activeColorMenu === 'fill'
                    ? selectedDrawing.fillColor ?? selectedDrawing.color
                    : selectedDrawing.color
                  ).toUpperCase()}
                </span>
              </div>

              <div className="mt-2.5 space-y-1 border-t border-[#e0e3eb] pt-2.5 dark:border-[#2a2e39]">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-[#787b86]">Opacity</span>
                  <span className="font-mono-tabular font-bold text-[#131722] dark:text-[#d1d4dc]">
                    {Math.round((selectedDrawing.opacity ?? 1) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  aria-label="Drawing opacity"
                  value={Math.round((selectedDrawing.opacity ?? 1) * 100)}
                  onChange={(e) =>
                    onUpdateDrawing({
                      ...selectedDrawing,
                      opacity: Math.max(0, Math.min(1, Number(e.target.value) / 100)),
                    })
                  }
                  className="h-1.5 w-full cursor-pointer accent-[#2962ff]"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Long/Short & Contract Size Ruler Calculator Popover */}
      {(() => {
        const calcDrawing = drawings.find(
          (d) =>
            d.id === calcModalDrawingId &&
            (d.type === 'long' || d.type === 'short' || d.type === 'contractRuler')
        );
        if (
          !calcDrawing ||
          (calcDrawing.type !== 'long' &&
            calcDrawing.type !== 'short' &&
            calcDrawing.type !== 'contractRuler')
        ) {
          return null;
        }
        const refPrice =
          calcDrawing.type === 'contractRuler'
            ? calcDrawing.p1.price
            : calcDrawing.entryPrice;
        const symbolSpec = getSymbolContractSpec(symbol, refPrice);
        const riskMode = calcDrawing.riskMode ?? 'usd';
        const riskValue = calcDrawing.riskValue ?? 100;
        const accountBalance = calcDrawing.accountBalance ?? 10000;
        const pointValue = calcDrawing.pointValue ?? symbolSpec.pointValue;
        const tickSize =
          calcDrawing.type === 'contractRuler'
            ? symbolSpec.tickSize
            : calcDrawing.tickSize ?? symbolSpec.tickSize;
        const slDist =
          calcDrawing.type === 'contractRuler'
            ? Math.max(1e-9, Math.abs(calcDrawing.p2.price - calcDrawing.p1.price))
            : Math.max(1e-9, Math.abs(calcDrawing.entryPrice - calcDrawing.slPrice));
        const riskDollars =
          riskMode === 'percent' ? (accountBalance * riskValue) / 100 : riskValue;
        const rawQty = riskDollars / (slDist * Math.max(0.0001, pointValue));
        const displaySize = symbolSpec.isIntegerOnly
          ? `${Math.max(0, Math.round(rawQty))} ${symbolSpec.unitLabel}`
          : `${rawQty.toFixed(2)} Qty`;

        return (
          <div
            className="absolute top-24 left-1/2 z-40 w-72 max-w-[calc(100%-16px)] -translate-x-1/2 rounded-2xl border border-[#e0e3eb] bg-white p-3.5 shadow-2xl dark:border-[#2a2e39] dark:bg-[#1e222d]"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-bold text-[#131722] dark:text-[#d1d4dc]">
                {calcDrawing.type === 'contractRuler'
                  ? 'Contract Size Calculator'
                  : 'Position & Contract Calculator'}
              </span>
              <button
                type="button"
                onClick={() => setCalcModalDrawingId(null)}
                className="flex h-6 w-6 items-center justify-center rounded text-[#787b86] hover:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]"
                aria-label="Close calculator"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#f0f3fa] p-0.5 dark:bg-[#131722]">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateDrawing({
                      ...calcDrawing,
                      riskMode: 'usd',
                      riskValue: riskMode === 'percent' ? 100 : riskValue,
                    })
                  }
                  className={`h-7 rounded-md font-semibold ${
                    riskMode === 'usd'
                      ? 'bg-white text-[#2962ff] shadow-xs dark:bg-[#2a2e39] dark:text-white'
                      : 'text-[#787b86]'
                  }`}
                >
                  Risk ($ USD)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateDrawing({
                      ...calcDrawing,
                      riskMode: 'percent',
                      riskValue: riskMode === 'usd' ? 1 : riskValue,
                    })
                  }
                  className={`h-7 rounded-md font-semibold ${
                    riskMode === 'percent'
                      ? 'bg-white text-[#2962ff] shadow-xs dark:bg-[#2a2e39] dark:text-white'
                      : 'text-[#787b86]'
                  }`}
                >
                  Risk (% Acct)
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="block text-[11px] font-medium text-[#787b86]">
                    {riskMode === 'usd' ? 'Risk Amount ($)' : 'Risk (%)'}
                  </span>
                  <input
                    type="number"
                    min="0.1"
                    step={riskMode === 'usd' ? '10' : '0.25'}
                    value={riskValue}
                    onChange={(e) =>
                      onUpdateDrawing({
                        ...calcDrawing,
                        riskValue: Math.max(0.01, parseFloat(e.target.value) || 0),
                      })
                    }
                    className="h-8 w-full rounded-lg border border-[#e0e3eb] bg-[#f8fafd] px-2 font-mono-tabular text-xs font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
                  />
                </label>

                {riskMode === 'percent' ? (
                  <label className="space-y-1">
                    <span className="block text-[11px] font-medium text-[#787b86]">
                      Account ($)
                    </span>
                    <input
                      type="number"
                      min="100"
                      step="500"
                      value={accountBalance}
                      onChange={(e) =>
                        onUpdateDrawing({
                          ...calcDrawing,
                          accountBalance: Math.max(1, parseFloat(e.target.value) || 0),
                        })
                      }
                      className="h-8 w-full rounded-lg border border-[#e0e3eb] bg-[#f8fafd] px-2 font-mono-tabular text-xs font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
                    />
                  </label>
                ) : (
                  <label className="space-y-1">
                    <span className="block text-[11px] font-medium text-[#787b86]">
                      Point Value ($)
                    </span>
                    <input
                      type="number"
                      min="0.01"
                      step="1"
                      value={pointValue}
                      onChange={(e) =>
                        onUpdateDrawing({
                          ...calcDrawing,
                          pointValue: Math.max(0.0001, parseFloat(e.target.value) || 1),
                        })
                      }
                      className="h-8 w-full rounded-lg border border-[#e0e3eb] bg-[#f8fafd] px-2 font-mono-tabular text-xs font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
                    />
                  </label>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {riskMode === 'percent' && (
                  <label className="space-y-1">
                    <span className="block text-[11px] font-medium text-[#787b86]">
                      Point Value ($)
                    </span>
                    <input
                      type="number"
                      min="0.01"
                      step="1"
                      value={pointValue}
                      onChange={(e) =>
                        onUpdateDrawing({
                          ...calcDrawing,
                          pointValue: Math.max(0.0001, parseFloat(e.target.value) || 1),
                        })
                      }
                      className="h-8 w-full rounded-lg border border-[#e0e3eb] bg-[#f8fafd] px-2 font-mono-tabular text-xs font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
                    />
                  </label>
                )}

                {calcDrawing.type !== 'contractRuler' && (
                  <label className="space-y-1">
                    <span className="block text-[11px] font-medium text-[#787b86]">
                      Tick Size
                    </span>
                    <input
                      type="number"
                      min="0.00001"
                      step="0.01"
                      value={tickSize}
                      onChange={(e) =>
                        onUpdateDrawing({
                          ...calcDrawing,
                          tickSize: Math.max(0.00001, parseFloat(e.target.value) || 0.01),
                        })
                      }
                      className="h-8 w-full rounded-lg border border-[#e0e3eb] bg-[#f8fafd] px-2 font-mono-tabular text-xs font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
                    />
                  </label>
                )}
              </div>

              <div className="flex items-center justify-between rounded-lg bg-[#f0f3fa] px-2.5 py-2 font-mono-tabular text-[11px] dark:bg-[#131722]">
                <span className="text-[#787b86]">Recommended Size</span>
                <span className="font-bold text-[#2962ff]">
                  {displaySize} (${riskDollars.toFixed(2)})
                </span>
              </div>

              {(calcDrawing.type === 'long' || calcDrawing.type === 'short') && onExecuteOrder && (
                <button
                  type="button"
                  onClick={() => {
                    onExecuteOrder({
                      side: calcDrawing.type as 'long' | 'short',
                      qty: sanitizeOrderQty(symbol, rawQty, calcDrawing.entryPrice),
                      entryPrice: calcDrawing.entryPrice,
                      tpPrice: calcDrawing.tpPrice,
                      slPrice: calcDrawing.slPrice,
                      pointValue: Math.max(0.0001, pointValue),
                    });
                    setCalcModalDrawingId(null);
                  }}
                  className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-bold text-white transition-colors ${
                    calcDrawing.type === 'long'
                      ? 'bg-[#089981] hover:bg-[#07846f]'
                      : 'bg-[#f23645] hover:bg-[#dc2626]'
                  }`}
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>
                    Execute {calcDrawing.type === 'long' ? 'Long (Buy)' : 'Short (Sell)'} Order
                  </span>
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Inline Text / Label Editor Popover */}
      {editingTextId && selectedDrawing && (
        <div
          className="absolute top-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-[#2962ff] bg-white p-2 shadow-xl dark:bg-[#1e222d]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            autoFocus
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (selectedDrawing.type === 'text' || selectedDrawing.type === 'callout') {
                  onUpdateDrawing({ ...selectedDrawing, text: textDraft.trim() || 'Note' });
                } else {
                  onUpdateDrawing({
                    ...selectedDrawing,
                    label: textDraft.trim() || undefined,
                  });
                }
                setEditingTextId(null);
              }
              if (e.key === 'Escape') {
                setEditingTextId(null);
              }
            }}
            placeholder={
              selectedDrawing.type === 'text' || selectedDrawing.type === 'callout'
                ? 'Enter note text...'
                : 'Optional label (leave empty to clear)...'
            }
            className="h-8 w-48 rounded-lg border border-[#e0e3eb] bg-[#f8fafd] px-2.5 text-xs font-medium text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
          />
          <button
            type="button"
            onClick={() => {
              if (selectedDrawing.type === 'text' || selectedDrawing.type === 'callout') {
                onUpdateDrawing({ ...selectedDrawing, text: textDraft.trim() || 'Note' });
              } else {
                onUpdateDrawing({
                  ...selectedDrawing,
                  label: textDraft.trim() || undefined,
                });
              }
              setEditingTextId(null);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2962ff] text-white"
            aria-label="Save text"
          >
            <Check className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}
