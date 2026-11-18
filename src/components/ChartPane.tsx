import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  ChevronsRight,
  GripVertical,
  Plus,
} from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  fetchHistoricalCandles,
  fetchHistoricalCandlesAround,
  fetchTicker24h,
  formatPrice,
  getDecimalsForPrice,
  getDefaultHistoryCount,
  sanitizeCandleSeries,
  subscribeMarketStream,
} from '../services/binance';
import {
  DRAWING_TOOLS_CATALOG,
  TIMEFRAME_SECONDS,
  type BaseDrawing,
  type Candle,
  type ChartAppearance,
  type ChartPoint,
  type DrawingObject,
  type DrawingTool,
  type DrawingToolPresetsMap,
  type IndicatorId,
  type PaneConfig,
  type PendingOrderType,
  type PendingPaperOrder,
  type PriceAlert,
  type PriceAlertCondition,
  type ReplayState,
  type SymbolContractOverride,
  type Ticker24h,
  type Timeframe,
} from '../types/trading';
import {
  calculateBollingerBands,
  calculateEMA,
  calculateRSI,
  calculateSMA,
} from '../utils/indicators';
import { getMarketStatus, getSymbolCategory } from '../utils/marketHours';
import {
  getDefaultOrderQty,
  getSpreadForPrice,
  getSymbolContractSpec,
  sanitizeOrderQty,
  stepOrderQty,
} from '../utils/paperTrading';
import type { PaperPosition, PaperTrade } from '../types/trading';
import {
  buildForwardDeltaCandle,
  resolveReplaySliceAtTimestamp,
  stepReplayTimestampForward,
  type StepReplayResult,
} from '../utils/replayEngine';
import type { ReplayJumpRequest } from './ReplayBar';
import {
  CrosshairOrderTicketModal,
  CrosshairQuickActionSheet,
  getCrosshairBuyOrderType,
  getCrosshairSellOrderType,
} from './CrosshairQuickMenu';
import {
  DrawingLayer,
  hitTestDrawings,
  resolveTimeX,
  resolveXTime,
  snapPointToMagnet,
  type PositionOrderPayload,
} from './DrawingLayer';

export interface ChartPaneHandle {
  fitContent: () => void;
  resize: () => void;
  takeScreenshot: () => Promise<string | null>;
  goToDate: (targetTimeSec: number) => Promise<boolean>;
  syncCrosshair: (timeSec: UTCTimestamp | null, price: number | null) => void;
  syncTimeRange: (
    mode: 'dateRange' | 'time',
    range: { from: UTCTimestamp; to: UTCTimestamp } | null,
    centerTime: number | null
  ) => void;
  advanceReplayStep: (
    stepSec: number,
    subBarMode: boolean,
    currentReplayTs: number | undefined,
    currentIndex: number
  ) => StepReplayResult | null;
  jumpReplayForward: (req: ReplayJumpRequest) => {
    skippedCandles: Candle[];
    targetIndex: number;
    targetTime: number;
    targetReplayTs: number;
    totalCandles: number;
  } | null;
}

export interface PlacePaperOrderRequest {
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  entryPrice: number;
  candleTime: number;
  tpPrice?: number;
  slPrice?: number;
  pointValue?: number;
}

export interface PlacePendingOrderRequest {
  symbol: string;
  side: 'long' | 'short';
  orderType: PendingOrderType;
  qty: number;
  targetPrice: number;
  candleTime: number;
  tpPrice?: number;
  slPrice?: number;
  pointValue?: number;
}

interface ChartPaneProps {
  pane: PaneConfig;
  isActive: boolean;
  multiLayout: boolean;
  appearance: ChartAppearance;
  activeTool: DrawingTool;
  replay: ReplayState;
  openPositions: PaperPosition[];
  closedTrades?: PaperTrade[];
  pendingOrders?: PendingPaperOrder[];
  priceAlerts?: PriceAlert[];
  showExecutions?: boolean;
  showBuySellPanel?: boolean;
  drawingToolPresets?: DrawingToolPresetsMap;
  contractOverridesBySymbol?: Record<string, SymbolContractOverride>;
  onSelectPane: (paneId: string) => void;
  onAddDrawing: (paneId: string, drawing: DrawingObject) => void;
  onUpdateDrawing: (paneId: string, drawing: DrawingObject) => void;
  onDeleteDrawing: (paneId: string, drawingId: string) => void;
  onPlacementHintChange: (hint: string | null) => void;
  onToolComplete: () => void;
  onPickReplayIndex: (
    index: number,
    total: number,
    timeSec?: number,
    replayTimestampSec?: number
  ) => void;
  onSyncReplay?: (
    index: number,
    total: number,
    timeSec?: number,
    replayTimestampSec?: number
  ) => void;
  onReplayTotalChange: (total: number) => void;
  onOpenSymbolModal: () => void;
  onOpenTimeframeModal: () => void;
  onOpenGoToDate: () => void;
  onMarketTick: (symbol: string, candle: Candle, isReplay: boolean) => void;
  onCrosshairSync?: (
    sourcePaneId: string,
    time: UTCTimestamp | null,
    price: number | null
  ) => void;
  onTimeRangeSync?: (
    sourcePaneId: string,
    range: { from: UTCTimestamp; to: UTCTimestamp } | null,
    centerTime: number | null
  ) => void;
  onPlaceOrder: (order: PlacePaperOrderRequest) => void;
  onPlacePendingOrder?: (order: PlacePendingOrderRequest) => void;
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
  onClosePosition: (positionId: string) => void;
  onUpdatePositionTPSL: (
    positionId: string,
    tpPrice?: number,
    slPrice?: number,
    silent?: boolean
  ) => void;
  onCreatePriceAlert?: (input: {
    symbol: string;
    targetPrice: number;
    condition: PriceAlertCondition;
    repeat: boolean;
    note?: string;
  }) => void;
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

function isColorDark(hex: string): boolean {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance < 0.5;
}

function formatAxisTime(time: Time, tf: Timeframe): string {
  const ts = typeof time === 'number' ? time : 0;
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (tf === '1d' || tf === '1w' || tf === '1M') {
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: tf === '1M' ? '2-digit' : undefined,
    });
  }
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const showSeconds = ['1s', '5s', '15s', '30s', '1m'].includes(tf);
  return showSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

function formatCrosshairTime(ts: number, tf: Timeframe): string {
  if (!ts || !Number.isFinite(ts)) return '';
  const d = new Date(ts * 1000);
  if (tf === '1d' || tf === '1w' || tf === '1M') {
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  const datePart = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const showSeconds = ['1s', '5s', '15s', '30s'].includes(tf);
  return showSeconds ? `${datePart} ${hh}:${mm}:${ss}` : `${datePart} ${hh}:${mm}`;
}

function formatCountdown(remainingSec: number): string {
  const s = Math.max(0, Math.floor(remainingSec));
  const totalHours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (totalHours > 0) {
    return `${String(totalHours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getLiveCountdownSeconds(tf: Timeframe, candleTimeSec?: number): number {
  const nowMs = Date.now();
  const nowSec = nowMs / 1000;
  if (tf === '1M') {
    const d = new Date(nowMs);
    const nextMonthMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0);
    return Math.max(0, Math.floor((nextMonthMs - nowMs) / 1000));
  }
  const step = TIMEFRAME_SECONDS[tf];
  let nextCloseSec: number;
  if (tf === '1w' && candleTimeSec && candleTimeSec + step > nowSec) {
    nextCloseSec = candleTimeSec + step;
  } else {
    nextCloseSec = (Math.floor(nowSec / step) + 1) * step;
  }
  const rem = Math.max(0, nextCloseSec - nowSec);
  return step === 1 ? Math.max(1, Math.ceil(rem)) : Math.floor(rem);
}

export const ChartPane = forwardRef<ChartPaneHandle, ChartPaneProps>(function ChartPane(
  {
    pane,
    isActive,
    multiLayout,
    appearance,
    activeTool,
    replay,
    openPositions,
    closedTrades = [],
    pendingOrders = [],
    priceAlerts = [],
    showExecutions,
    showBuySellPanel = true,
    drawingToolPresets,
    contractOverridesBySymbol,
    onSelectPane,
    onAddDrawing,
    onUpdateDrawing,
    onDeleteDrawing,
    onPlacementHintChange,
    onToolComplete,
    onPickReplayIndex,
    onSyncReplay,
    onReplayTotalChange,
    onOpenSymbolModal,
    onOpenTimeframeModal,
    onOpenGoToDate,
    onMarketTick,
    onCrosshairSync,
    onTimeRangeSync,
    onPlaceOrder,
    onPlacePendingOrder,
    onUpdatePendingOrder,
    onCancelPendingOrder,
    onClosePosition,
    onUpdatePositionTPSL,
    onCreatePriceAlert,
    onUpdatePriceAlert,
    onDeletePriceAlert,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const chartDisposedRef = useRef(true);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const sma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const positionPriceLinesRef = useRef<
    Array<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>>
  >([]);
  const pendingOrderPriceLinesRef = useRef<
    Array<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>>
  >([]);
  const alertPriceLinesRef = useRef<
    Array<ReturnType<ISeriesApi<'Candlestick'>['createPriceLine']>>
  >([]);

  const fullCandlesRef = useRef<Candle[]>([]);
  const loadedSeriesKeyRef = useRef<string>('');
  const pendingPointsRef = useRef<ChartPoint[]>([]);
  const freehandPointsRef = useRef<ChartPoint[]>([]);
  const isDrawingFreehandRef = useRef(false);

  const [chartReady, setChartReady] = useState(false);
  const [renderedCandles, setRenderedCandles] = useState<Candle[]>([]);
  const renderedCandlesRef = useRef<Candle[]>([]);
  renderedCandlesRef.current = renderedCandles;
  const [draftDrawing, setDraftDrawing] = useState<DrawingObject | null>(null);
  const [pendingPoints, setPendingPoints] = useState<ChartPoint[]>([]);
  const [crosshairPixel, setCrosshairPixel] = useState<{ x: number; y: number } | null>(null);
  const [cursorCrosshair, setCursorCrosshair] = useState<{
    x: number;
    y: number;
    price: number;
    time: UTCTimestamp;
  } | null>(null);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [orderTicketOpen, setOrderTicketOpen] = useState(false);
  const [pinnedQuickData, setPinnedQuickData] = useState<{
    price: number;
    time: UTCTimestamp;
    y: number;
  } | null>(null);
  const quickMenuOpenRef = useRef(false);
  quickMenuOpenRef.current = quickMenuOpen || orderTicketOpen;
  const nativeCrosshairActiveRef = useRef(false);
  const hoveringPlusBtnRef = useRef(false);
  const plotWrapperRef = useRef<HTMLDivElement | null>(null);
  const drawingSvgRef = useRef<SVGSVGElement | null>(null);
  const crosshairOverlayRef = useRef<HTMLDivElement | null>(null);
  const [orderPanelOffset, setOrderPanelOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const orderPanelDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const crosshairPixelRef = useRef<{ x: number; y: number } | null>(null);
  crosshairPixelRef.current = crosshairPixel;
  const crosshairDragRef = useRef<{
    pointerId: number;
    downX: number;
    downY: number;
    startCrossX: number;
    startCrossY: number;
    moved: boolean;
  } | null>(null);
  const mouseLockedAfterDragRef = useRef(false);
  const [replayHoverTime, setReplayHoverTime] = useState<UTCTimestamp | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [pendingTextPrompt, setPendingTextPrompt] = useState<{
    type: 'text' | 'callout';
    points: ChartPoint[];
  } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');

  const [loading, setLoading] = useState(true);
  const [simulated, setSimulated] = useState(false);
  const [marketStatus, setMarketStatus] = useState(() => getMarketStatus(pane.symbol));
  const [ticker, setTicker] = useState<Ticker24h | null>(null);
  const [liveCandle, setLiveCandle] = useState<Candle | null>(null);
  const [hoverCandle, setHoverCandle] = useState<Candle | null>(null);
  const [orderQty, setOrderQty] = useState<string>('1');
  const customQtyEditedRef = useRef(false);
  const [countdownText, setCountdownText] = useState<string>('');
  const [countdownAnchor, setCountdownAnchor] = useState<{
    top: number;
    width: number;
  } | null>(null);
  const [showScrollToEnd, setShowScrollToEnd] = useState(false);
  const [scrollBtnOffsets, setScrollBtnOffsets] = useState<{
    right: number;
    bottom: number;
  }>({ right: 66, bottom: 38 });

  const liveCandleRef = useRef<Candle | null>(null);
  liveCandleRef.current = liveCandle;
  const targetLiveCandleRef = useRef<Candle | null>(null);
  const displayLiveCandleRef = useRef<Candle | null>(null);
  const candleAnimRafRef = useRef<number | null>(null);
  const candleAnimLastMsRef = useRef<number>(0);
  const lastReactTickSyncMsRef = useRef<number>(0);
  const lastSeriesTimeRef = useRef<number>(0);
  const onMarketTickRef = useRef(onMarketTick);
  onMarketTickRef.current = onMarketTick;
  const replayProgressRef = useRef<{
    index: number;
    elapsedFraction: number;
    lastTickMs: number;
  }>({ index: -1, elapsedFraction: 0, lastTickMs: 0 });

  // Refs for latest props inside event listeners
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const replayRef = useRef(replay);
  replayRef.current = replay;
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const appearanceRef = useRef(appearance);
  appearanceRef.current = appearance;
  const drawingToolPresetsRef = useRef(drawingToolPresets);
  drawingToolPresetsRef.current = drawingToolPresets;
  const contractOverridesRef = useRef(contractOverridesBySymbol);
  contractOverridesRef.current = contractOverridesBySymbol;
  const onSyncReplayRef = useRef(onSyncReplay);
  onSyncReplayRef.current = onSyncReplay;

  const onOpenGoToDateRef = useRef(onOpenGoToDate);
  onOpenGoToDateRef.current = onOpenGoToDate;
  const onCrosshairSyncRef = useRef(onCrosshairSync);
  onCrosshairSyncRef.current = onCrosshairSync;
  const onTimeRangeSyncRef = useRef(onTimeRangeSync);
  onTimeRangeSyncRef.current = onTimeRangeSync;
  const applyingExternalSyncRef = useRef(false);
  const applyingExternalRangeSyncRef = useRef(false);

  const centerChartOnTimestamp = useCallback((candles: Candle[], targetTimeSec: number) => {
    const chart = chartRef.current;
    if (chartDisposedRef.current || !chart || candles.length === 0) return;

    let bestIdx = 0;
    let bestDiff = Math.abs(Number(candles[0].time) - targetTimeSec);
    for (let i = 1; i < candles.length; i++) {
      const diff = Math.abs(Number(candles[i].time) - targetTimeSec);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    try {
      const currentRange = chart.timeScale().getVisibleLogicalRange();
      const currentSpan = currentRange
        ? Math.max(24, Math.min(180, currentRange.to - currentRange.from))
        : 72;
      const half = currentSpan / 2;

      chart.timeScale().setVisibleLogicalRange({
        from: bestIdx - half,
        to: bestIdx + half,
      });
      chart.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: { top: 0.15, bottom: 0.15 },
      });
    } catch {
      // Ignore if chart disposed mid-transition
    }
  }, []);

  useImperativeHandle(ref, () => ({
    fitContent: () => {
      if (chartDisposedRef.current || !chartRef.current) return;
      try {
        chartRef.current.priceScale('right').applyOptions({
          autoScale: true,
          scaleMargins: { top: 0.15, bottom: 0.15 },
        });
        chartRef.current.timeScale().fitContent();
      } catch {
        // Ignore if chart disposed
      }
    },
    resize: () => {
      const chart = chartRef.current;
      const el = containerRef.current;
      if (chartDisposedRef.current || !chart || !el) return;
      try {
        const w = el.clientWidth;
        const h = el.clientHeight;
        const isAutoSized =
          typeof chart.autoSizeActive === 'function' ? chart.autoSizeActive() : false;
        if (!isAutoSized && w > 0 && h > 0) {
          chart.resize(w, h);
        }
        syncCountdownPosition();
      } catch {
        // Ignore if chart disposed
      }
    },
    takeScreenshot: async () => {
      if (chartDisposedRef.current || !chartRef.current) return null;
      const baseCanvas = chartRef.current.takeScreenshot();
      const outCanvas = document.createElement('canvas');
      outCanvas.width = baseCanvas.width;
      outCanvas.height = baseCanvas.height;
      const ctx = outCanvas.getContext('2d');
      if (!ctx) return baseCanvas.toDataURL('image/png');

      ctx.fillStyle = appearanceRef.current.backgroundColor;
      ctx.fillRect(0, 0, outCanvas.width, outCanvas.height);
      ctx.drawImage(baseCanvas, 0, 0);

      const containerEl = containerRef.current;
      const svgEl = drawingSvgRef.current;
      const dprX =
        containerEl && containerEl.clientWidth > 0
          ? outCanvas.width / containerEl.clientWidth
          : 1;
      const dprY =
        containerEl && containerEl.clientHeight > 0
          ? outCanvas.height / containerEl.clientHeight
          : 1;

      if (svgEl) {
        try {
          const clone = svgEl.cloneNode(true) as SVGSVGElement;
          clone.querySelectorAll('[data-export-ignore="true"]').forEach((n) => n.remove());
          const svgW = svgEl.clientWidth || Number(svgEl.getAttribute('width')) || 0;
          const svgH = svgEl.clientHeight || Number(svgEl.getAttribute('height')) || 0;
          if (svgW > 0 && svgH > 0) {
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            clone.setAttribute('width', String(svgW));
            clone.setAttribute('height', String(svgH));
            const xml = new XMLSerializer().serializeToString(clone);
            const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            try {
              await new Promise<void>((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                  ctx.drawImage(img, 0, 0, svgW * dprX, svgH * dprY);
                  resolve();
                };
                img.onerror = () => reject(new Error('SVG export decode failed'));
                img.src = url;
              });
            } finally {
              URL.revokeObjectURL(url);
            }
          }
        } catch {
          // Keep candlestick canvas even if SVG overlay rasterization fails
        }
      }

      // Stamp clean top-left chart header metadata onto exported PNG
      const lastBar = liveCandleRef.current;
      if (lastBar) {
        ctx.save();
        ctx.scale(dprX, dprY);
        const darkBg = isColorDark(appearanceRef.current.backgroundColor);
        const labelText = `${paneRef.current.symbol} · ${paneRef.current.timeframe}   O ${formatPrice(
          lastBar.open
        )}  H ${formatPrice(lastBar.high)}  L ${formatPrice(lastBar.low)}  C ${formatPrice(
          lastBar.close
        )}`;
        ctx.font = '600 12px "Plus Jakarta Sans", system-ui, sans-serif';
        const metrics = ctx.measureText(labelText);
        const boxW = Math.min(metrics.width + 20, (containerEl?.clientWidth ?? 600) - 24);
        ctx.fillStyle = darkBg ? 'rgba(19, 23, 34, 0.82)' : 'rgba(255, 255, 255, 0.86)';
        ctx.fillRect(10, 10, boxW, 24);
        ctx.fillStyle = darkBg ? '#d1d4dc' : '#131722';
        ctx.fillText(labelText, 20, 26);
        ctx.restore();
      }

      return outCanvas.toDataURL('image/png');
    },
    advanceReplayStep: (
      stepSec: number,
      subBarMode: boolean,
      currentReplayTs: number | undefined,
      currentIndex: number
    ) => {
      const buffer = fullCandlesRef.current;
      if (buffer.length === 0) return null;
      const barStepSec = TIMEFRAME_SECONDS[paneRef.current.timeframe];
      const res = stepReplayTimestampForward(
        buffer,
        barStepSec,
        currentIndex,
        currentReplayTs,
        stepSec,
        subBarMode
      );
      if (!res) return null;
      if (res.nextIndex > currentIndex) {
        requestAnimationFrame(() => {
          if (!chartDisposedRef.current) {
            try {
              chartRef.current?.timeScale().scrollToRealTime();
            } catch {
              // Ignore if chart disposed
            }
          }
        });
      }
      return res;
    },
    jumpReplayForward: (req: ReplayJumpRequest) => {
      const buffer = fullCandlesRef.current;
      if (buffer.length === 0) return null;
      const barStepSec = TIMEFRAME_SECONDS[paneRef.current.timeframe];
      const resolved = resolveReplaySliceAtTimestamp(
        buffer,
        barStepSec,
        replayRef.current.currentIndex,
        replayRef.current.replayTimestamp
      );
      const currIdx = resolved ? resolved.index : replayRef.current.currentIndex;
      const currIncomplete = resolved ? !resolved.isBarComplete : false;
      if (currIdx >= buffer.length - 1 && !currIncomplete) return null;

      let targetIdx = currIdx + 1;
      if (req.deltaBars !== undefined) {
        const barsCount = Math.max(1, Math.round(req.deltaBars));
        targetIdx = currIncomplete ? currIdx + barsCount - 1 : currIdx + barsCount;
      } else {
        const baseTs =
          replayRef.current.replayTimestamp ??
          Number(buffer[currIdx].time) + barStepSec;
        const targetTs =
          req.targetTimeSec !== undefined
            ? req.targetTimeSec
            : baseTs + Math.max(1, req.deltaSeconds ?? 0);
        const foundIdx = buffer.findIndex(
          (bar, idx) =>
            idx >= (currIncomplete ? currIdx : currIdx + 1) && Number(bar.time) >= targetTs
        );
        targetIdx = foundIdx === -1 ? buffer.length - 1 : foundIdx;
      }

      targetIdx = Math.min(
        buffer.length - 1,
        Math.max(currIncomplete ? currIdx : currIdx + 1, targetIdx)
      );
      const skippedCandles: Candle[] = [];
      if (currIncomplete && resolved) {
        skippedCandles.push(buildForwardDeltaCandle(buffer[currIdx], resolved.fraction, 1));
      }
      for (let i = currIdx + 1; i <= targetIdx; i++) {
        skippedCandles.push({ ...buffer[i] });
      }
      const targetBarTime = Number(buffer[targetIdx].time);
      const targetReplayTs = targetBarTime + barStepSec;

      requestAnimationFrame(() => {
        if (!chartDisposedRef.current) {
          try {
            chartRef.current?.timeScale().scrollToRealTime();
          } catch {
            // Ignore if chart disposed
          }
        }
      });

      return {
        skippedCandles,
        targetIndex: targetIdx,
        targetTime: targetBarTime,
        targetReplayTs,
        totalCandles: buffer.length,
      };
    },
    goToDate: async (targetTimeSec: number) => {
      const candles = fullCandlesRef.current;
      const inReplay =
        isActiveRef.current && replayRef.current.active && !replayRef.current.selectingStart;

      if (inReplay) {
        const slice = resolveReplaySliceAtTimestamp(
          candles,
          TIMEFRAME_SECONDS[paneRef.current.timeframe],
          replayRef.current.currentIndex,
          replayRef.current.replayTimestamp
        );
        if (!slice) return false;
        const sliced = [...candles.slice(0, slice.index), slice.displayCandle];
        centerChartOnTimestamp(sliced, targetTimeSec);
        return true;
      }

      const stepSec = TIMEFRAME_SECONDS[paneRef.current.timeframe];
      const earliest = candles.length > 0 ? Number(candles[0].time) : Infinity;

      if (candles.length === 0 || targetTimeSec < earliest - stepSec * 2) {
        setLoading(true);
        const aroundRes = await fetchHistoricalCandlesAround(
          paneRef.current.symbol,
          paneRef.current.timeframe,
          targetTimeSec,
          appearanceRef.current.finnhubApiKey
        );
        setLoading(false);

        const windowCandles = sanitizeCandleSeries(aroundRes.candles);
        if (!chartDisposedRef.current && windowCandles.length > 0 && candleSeriesRef.current) {
          fullCandlesRef.current = windowCandles;
          setSimulated(aroundRes.simulated);
          lastSeriesTimeRef.current = Number(windowCandles[windowCandles.length - 1].time);
          candleSeriesRef.current.setData(windowCandles);
          setRenderedCandles([...windowCandles]);
          syncIndicatorsData(windowCandles);
          const lastBar = windowCandles[windowCandles.length - 1];
          targetLiveCandleRef.current = lastBar ? { ...lastBar } : null;
          displayLiveCandleRef.current = lastBar ? { ...lastBar } : null;
          setLiveCandle(lastBar);
          if (isActiveRef.current) {
            onReplayTotalChange(windowCandles.length);
          }
          requestAnimationFrame(() => centerChartOnTimestamp(windowCandles, targetTimeSec));
          return true;
        }
        return false;
      }

      centerChartOnTimestamp(candles, targetTimeSec);
      return true;
    },
    syncCrosshair: (timeSec: UTCTimestamp | null, price: number | null) => {
      const chart = chartRef.current;
      const series = candleSeriesRef.current;
      if (chartDisposedRef.current || !chart || !series) return;
      applyingExternalSyncRef.current = true;
      try {
        if (timeSec === null || price === null) {
          chart.clearCrosshairPosition();
        } else {
          const candles = fullCandlesRef.current;
          let targetTime: UTCTimestamp = timeSec;
          let targetPrice = price;
          if (candles.length > 0) {
            let closest = candles[0];
            let minDiff = Math.abs(Number(candles[0].time) - Number(timeSec));
            for (let i = 1; i < candles.length; i++) {
              const diff = Math.abs(Number(candles[i].time) - Number(timeSec));
              if (diff < minDiff) {
                minDiff = diff;
                closest = candles[i];
              }
            }
            targetTime = closest.time;
            const recentSlice = candles.slice(-200);
            const lo = Math.min(...recentSlice.map((c) => c.low));
            const hi = Math.max(...recentSlice.map((c) => c.high));
            if (price < lo * 0.75 || price > hi * 1.25) {
              targetPrice = closest.close;
            }
          }
          chart.setCrosshairPosition(targetPrice, targetTime, series);
        }
      } catch {
        // Ignore if target series has no matching range
      } finally {
        requestAnimationFrame(() => {
          applyingExternalSyncRef.current = false;
        });
      }
    },
    syncTimeRange: (
      mode: 'dateRange' | 'time',
      range: { from: UTCTimestamp; to: UTCTimestamp } | null,
      centerTime: number | null
    ) => {
      const chart = chartRef.current;
      if (chartDisposedRef.current || !chart || fullCandlesRef.current.length === 0) return;
      applyingExternalRangeSyncRef.current = true;
      try {
        if (mode === 'dateRange' && range) {
          chart.timeScale().setVisibleRange({
            from: range.from as Time,
            to: range.to as Time,
          });
        } else if (mode === 'time' && centerTime !== null) {
          centerChartOnTimestamp(fullCandlesRef.current, centerTime);
        }
      } catch {
        // Ignore out-of-bounds visible range calls
      } finally {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            applyingExternalRangeSyncRef.current = false;
          });
        });
      }
    },
  }));

  const buildDrawingObject = useCallback(
    (
      tool: DrawingTool,
      pts: ChartPoint[],
      id: string,
      customText?: string
    ): DrawingObject | null => {
      const preset = drawingToolPresetsRef.current?.[tool];
      const defaultColor = tool === 'highlighter' ? '#f59e0b' : '#2962ff';
      const color = preset?.color ?? defaultColor;
      const lineWidth = preset?.lineWidth ?? 2;
      const baseStyle: Omit<BaseDrawing, 'id'> = {
        color,
        lineWidth,
        ...(preset?.fillColor !== undefined ? { fillColor: preset.fillColor } : {}),
        ...(preset?.opacity !== undefined ? { opacity: preset.opacity } : {}),
        ...(preset?.lineStyle !== undefined ? { lineStyle: preset.lineStyle } : {}),
      };
      const tfSec = TIMEFRAME_SECONDS[paneRef.current.timeframe];

      if (tool === 'horizontal' && pts[0]) {
        return { id, type: 'horizontal', p1: pts[0], ...baseStyle };
      }
      if (tool === 'horizontalRay' && pts[0]) {
        return { id, type: 'horizontalRay', p1: pts[0], ...baseStyle };
      }
      if (tool === 'vertical' && pts[0]) {
        return { id, type: 'vertical', p1: pts[0], ...baseStyle };
      }
      if (tool === 'crossLine' && pts[0]) {
        return { id, type: 'crossLine', p1: pts[0], ...baseStyle };
      }
      if (tool === 'priceLabel' && pts[0]) {
        return { id, type: 'priceLabel', p1: pts[0], ...baseStyle };
      }
      if (tool === 'text' && pts[0]) {
        return {
          id,
          type: 'text',
          p1: pts[0],
          text: customText || 'Note',
          ...baseStyle,
        };
      }
      if (tool === 'callout' && pts[0] && pts[1]) {
        return {
          id,
          type: 'callout',
          p1: pts[0],
          p2: pts[1],
          text: customText || 'Callout',
          ...baseStyle,
        };
      }
      if (
        (tool === 'trendline' ||
          tool === 'ray' ||
          tool === 'infoLine' ||
          tool === 'extendedLine' ||
          tool === 'arrow') &&
        pts[0] &&
        pts[1]
      ) {
        return { id, type: tool, p1: pts[0], p2: pts[1], ...baseStyle };
      }
      if (
        (tool === 'fibRetracement' ||
          tool === 'fibChannel' ||
          tool === 'priceRange' ||
          tool === 'datePriceRange' ||
          tool === 'rectangle' ||
          tool === 'ellipse' ||
          tool === 'measure') &&
        pts[0] &&
        pts[1]
      ) {
        return { id, type: tool, p1: pts[0], p2: pts[1], ...baseStyle };
      }
      if (tool === 'contractRuler' && pts[0] && pts[1]) {
        const spec = getSymbolContractSpec(paneRef.current.symbol, pts[0].price);
        const symOverride = contractOverridesRef.current?.[paneRef.current.symbol];
        const riskMode = preset?.riskMode ?? 'usd';
        const riskValue = preset?.riskValue ?? (riskMode === 'percent' ? 1 : 100);
        const accountBalance = preset?.accountBalance ?? 10000;
        const pointValue = symOverride?.pointValue ?? spec.pointValue;
        return {
          id,
          type: 'contractRuler',
          p1: pts[0],
          p2: pts[1],
          ...baseStyle,
          riskMode,
          riskValue,
          accountBalance,
          pointValue,
        };
      }
      if (tool === 'barsPattern' && pts[0] && pts[1]) {
        const tMin = Math.min(Number(pts[0].time), Number(pts[1].time));
        const tMax = Math.max(Number(pts[0].time), Number(pts[1].time));
        const slice = fullCandlesRef.current.filter(
          (c) => Number(c.time) >= tMin && Number(c.time) <= tMax
        );
        const anchorPrice = pts[0].price;
        const barsOffsets = slice.slice(0, 40).map((c) => ({
          dt: Number(c.time) - tMin,
          dOpen: c.open - anchorPrice,
          dHigh: c.high - anchorPrice,
          dLow: c.low - anchorPrice,
          dClose: c.close - anchorPrice,
        }));
        return {
          id,
          type: 'barsPattern',
          p1: pts[0],
          p2: pts[1],
          barsOffsets,
          ...baseStyle,
        };
      }
      if ((tool === 'long' || tool === 'short') && pts[0] && pts[1]) {
        const entryPrice = pts[0].price;
        const spec = getSymbolContractSpec(paneRef.current.symbol, entryPrice);
        const symOverride = contractOverridesRef.current?.[paneRef.current.symbol];
        const riskMode = preset?.riskMode ?? 'usd';
        const riskValue = preset?.riskValue ?? (riskMode === 'percent' ? 1 : 100);
        const accountBalance = preset?.accountBalance ?? 10000;
        const pointValue = symOverride?.pointValue ?? spec.pointValue;
        const tickSize = symOverride?.tickSize ?? spec.tickSize;
        const rawDiff = Math.abs(pts[1].price - entryPrice);
        const tpDist = Math.max(rawDiff, entryPrice * 0.005);
        const slDist = tpDist * 0.5;
        const tpPrice = tool === 'long' ? entryPrice + tpDist : entryPrice - tpDist;
        const slPrice = tool === 'long' ? entryPrice - slDist : entryPrice + slDist;
        const startTime = Math.min(Number(pts[0].time), Number(pts[1].time)) as UTCTimestamp;
        const endTime = Math.max(
          Number(startTime) + tfSec * 12,
          Math.max(Number(pts[0].time), Number(pts[1].time))
        ) as UTCTimestamp;
        return {
          id,
          type: tool,
          startTime,
          endTime,
          entryPrice,
          tpPrice,
          slPrice,
          ...baseStyle,
          riskMode,
          riskValue,
          accountBalance,
          pointValue,
          tickSize,
        };
      }
      if (
        (tool === 'pitchfork' ||
          tool === 'rotatedRectangle' ||
          tool === 'triangle' ||
          tool === 'parallelChannel') &&
        pts[0] &&
        pts[1] &&
        pts[2]
      ) {
        return {
          id,
          type: tool,
          p1: pts[0],
          p2: pts[1],
          p3: pts[2],
          ...baseStyle,
        };
      }
      return null;
    },
    []
  );

  const syncIndicatorsData = useCallback((candles: Candle[]) => {
    const activeIds = new Set(paneRef.current.indicators);
    const chart = chartRef.current;
    if (chartDisposedRef.current || !chart) return;

    if (activeIds.has('volume')) {
      if (!volumeSeriesRef.current) {
        volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });
      }
      volumeSeriesRef.current.setData(
        candles.map((c) => ({
          time: c.time,
          value: c.volume,
          color:
            c.close >= c.open
              ? 'rgba(41, 98, 255, 0.28)'
              : 'rgba(12, 50, 153, 0.28)',
        }))
      );
    } else if (volumeSeriesRef.current) {
      chart.removeSeries(volumeSeriesRef.current);
      volumeSeriesRef.current = null;
    }

    if (activeIds.has('ema20')) {
      if (!ema20SeriesRef.current) {
        ema20SeriesRef.current = chart.addSeries(LineSeries, {
          color: '#f59e0b',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      ema20SeriesRef.current.setData(calculateEMA(candles, 20));
    } else if (ema20SeriesRef.current) {
      chart.removeSeries(ema20SeriesRef.current);
      ema20SeriesRef.current = null;
    }

    if (activeIds.has('ema50')) {
      if (!ema50SeriesRef.current) {
        ema50SeriesRef.current = chart.addSeries(LineSeries, {
          color: '#8b5cf6',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      ema50SeriesRef.current.setData(calculateEMA(candles, 50));
    } else if (ema50SeriesRef.current) {
      chart.removeSeries(ema50SeriesRef.current);
      ema50SeriesRef.current = null;
    }

    if (activeIds.has('sma20')) {
      if (!sma20SeriesRef.current) {
        sma20SeriesRef.current = chart.addSeries(LineSeries, {
          color: '#089981',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      sma20SeriesRef.current.setData(calculateSMA(candles, 20));
    } else if (sma20SeriesRef.current) {
      chart.removeSeries(sma20SeriesRef.current);
      sma20SeriesRef.current = null;
    }

    if (activeIds.has('bb')) {
      if (!bbUpperRef.current) {
        bbUpperRef.current = chart.addSeries(LineSeries, {
          color: '#0ea5e9',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        bbMidRef.current = chart.addSeries(LineSeries, {
          color: '#0ea5e9',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        bbLowerRef.current = chart.addSeries(LineSeries, {
          color: '#0ea5e9',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      const bb = calculateBollingerBands(candles, 20, 2);
      bbUpperRef.current?.setData(bb.upper);
      bbMidRef.current?.setData(bb.middle);
      bbLowerRef.current?.setData(bb.lower);
    } else if (bbUpperRef.current) {
      chart.removeSeries(bbUpperRef.current);
      if (bbMidRef.current) chart.removeSeries(bbMidRef.current);
      if (bbLowerRef.current) chart.removeSeries(bbLowerRef.current);
      bbUpperRef.current = null;
      bbMidRef.current = null;
      bbLowerRef.current = null;
    }

    if (activeIds.has('rsi14')) {
      if (!rsiSeriesRef.current) {
        rsiSeriesRef.current = chart.addSeries(
          LineSeries,
          {
            color: '#7e57c2',
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
          },
          1
        );
        rsiSeriesRef.current.createPriceLine({
          price: 70,
          color: 'rgba(242, 54, 69, 0.5)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
        });
        rsiSeriesRef.current.createPriceLine({
          price: 30,
          color: 'rgba(8, 153, 129, 0.5)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
        });
        const panes = chart.panes();
        if (panes.length > 1) {
          panes[0].setStretchFactor(1000);
          panes[1].setStretchFactor(280);
        }
      }
      rsiSeriesRef.current.setData(calculateRSI(candles, 14));
    } else if (rsiSeriesRef.current) {
      chart.removeSeries(rsiSeriesRef.current);
      rsiSeriesRef.current = null;
      if (chart.panes().length > 1) {
        chart.removePane(1);
      }
    }
  }, []);

  // Create chart instance once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const bgDark = isColorDark(appearanceRef.current.backgroundColor);

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: appearanceRef.current.backgroundColor },
        textColor: bgDark ? '#d1d4dc' : '#131722',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: {
          color: bgDark ? 'rgba(209, 212, 220, 0.05)' : 'rgba(42, 46, 57, 0.05)',
        },
        horzLines: {
          color: bgDark ? 'rgba(209, 212, 220, 0.05)' : 'rgba(42, 46, 57, 0.05)',
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: bgDark ? '#787b86' : '#9598a1',
          style: LineStyle.Dashed,
          labelBackgroundColor: '#131722',
        },
        horzLine: {
          color: bgDark ? '#787b86' : '#9598a1',
          style: LineStyle.Dashed,
          labelBackgroundColor: '#131722',
        },
      },
      rightPriceScale: {
        autoScale: true,
        borderColor: bgDark ? '#2a2e39' : '#e0e3eb',
        scaleMargins: { top: 0.15, bottom: 0.15 },
      },
      timeScale: {
        borderColor: bgDark ? '#2a2e39' : '#e0e3eb',
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 12,
        barSpacing: 6,
      },
      localization: {
        timeFormatter: (time: Time) => formatAxisTime(time, paneRef.current.timeframe),
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: appearanceRef.current.upColor,
      downColor: appearanceRef.current.downColor,
      wickUpColor: appearanceRef.current.upWickColor,
      wickDownColor: appearanceRef.current.downWickColor,
      borderVisible: true,
      wickVisible: true,
      borderUpColor: appearanceRef.current.upColor,
      borderDownColor: appearanceRef.current.downColor,
      priceLineVisible: true,
      lastValueVisible: true,
      priceLineColor: '#2962ff',
      priceLineStyle: LineStyle.Dotted,
      priceLineWidth: 1,
    });

    chartRef.current = chart;
    chartDisposedRef.current = false;
    candleSeriesRef.current = candleSeries;
    setChartReady(true);

    const resolveChartPoint = (param: MouseEventParams<Time>): ChartPoint | null => {
      if (!param.point || !candleSeriesRef.current || !chartRef.current) return null;
      const price = candleSeriesRef.current.coordinateToPrice(param.point.y);
      if (price === null) return null;

      let time = param.time as UTCTimestamp | undefined;
      if (time === undefined) {
        const resolved = resolveXTime(
          chartRef.current,
          fullCandlesRef.current,
          TIMEFRAME_SECONDS[paneRef.current.timeframe],
          param.point.x
        );
        if (resolved !== null) time = resolved;
      }
      if (time === undefined) return null;

      const rawPt: ChartPoint = { time, price };
      if (paneRef.current.magnetMode) {
        return snapPointToMagnet(
          rawPt,
          fullCandlesRef.current,
          TIMEFRAME_SECONDS[paneRef.current.timeframe]
        );
      }
      return rawPt;
    };

    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      if (param.seriesData && candleSeriesRef.current) {
        const hovered = param.seriesData.get(candleSeriesRef.current) as Candle | undefined;
        setHoverCandle(hovered ?? null);
      } else {
        setHoverCandle(null);
      }

      if (isActiveRef.current && replayRef.current.active && replayRef.current.selectingStart) {
        nativeCrosshairActiveRef.current = false;
        setReplayHoverTime(param.time !== undefined ? (param.time as UTCTimestamp) : null);
        setCursorCrosshair(null);
        return;
      }

      const inCursorMode = activeToolRef.current === 'cursor';
      if (!inCursorMode) {
        nativeCrosshairActiveRef.current = false;
        setCursorCrosshair(null);
        return;
      }

      if (param.point && candleSeriesRef.current && chartRef.current) {
        nativeCrosshairActiveRef.current = true;
        const price = candleSeriesRef.current.coordinateToPrice(param.point.y);
        let time = param.time as UTCTimestamp | undefined;
        if (time === undefined) {
          const resolvedTime = resolveXTime(
            chartRef.current,
            fullCandlesRef.current,
            TIMEFRAME_SECONDS[paneRef.current.timeframe],
            param.point.x
          );
          if (resolvedTime !== null) time = resolvedTime;
        }
        if (!applyingExternalSyncRef.current && price !== null && Number.isFinite(price)) {
          const syncTime =
            time ??
            liveCandleRef.current?.time ??
            (Math.floor(Date.now() / 1000) as UTCTimestamp);
          onCrosshairSyncRef.current?.(paneRef.current.id, syncTime, price);
        }
        if (quickMenuOpenRef.current || hoveringPlusBtnRef.current) {
          return;
        }
        if (price !== null && Number.isFinite(price)) {
          const fallbackTime =
            time ??
            (liveCandleRef.current?.time ??
              (Math.floor(Date.now() / 1000) as UTCTimestamp));
          setCursorCrosshair({
            x: param.point.x,
            y: param.point.y,
            price,
            time: fallbackTime,
          });
        }
      } else {
        nativeCrosshairActiveRef.current = false;
        if (!applyingExternalSyncRef.current) {
          onCrosshairSyncRef.current?.(paneRef.current.id, null, null);
        }
        if (!quickMenuOpenRef.current && !hoveringPlusBtnRef.current) {
          setCursorCrosshair(null);
        }
      }
    };

    const handleClick = (param: MouseEventParams<Time>) => {
      onSelectPane(paneRef.current.id);

      // Bar Replay selection
      if (isActiveRef.current && replayRef.current.active && replayRef.current.selectingStart) {
        if (param.time !== undefined && fullCandlesRef.current.length > 0) {
          const clickedTime = Number(param.time);
          let idx = fullCandlesRef.current.findIndex((c) => Number(c.time) >= clickedTime);
          if (idx === -1) idx = fullCandlesRef.current.length - 1;
          idx = Math.max(5, Math.min(idx, fullCandlesRef.current.length - 1));
          const pickedTime = Number(fullCandlesRef.current[idx].time);
          const initialReplayTs = pickedTime + TIMEFRAME_SECONDS[paneRef.current.timeframe];
          setReplayHoverTime(null);
          onPickReplayIndex(idx, fullCandlesRef.current.length, pickedTime, initialReplayTs);
        }
        return;
      }

      const tool = activeToolRef.current;
      if (!isActiveRef.current || tool === 'cursor') {
        if (
          isActiveRef.current &&
          tool === 'cursor' &&
          !paneRef.current.hiddenDrawings &&
          param.point &&
          candleSeriesRef.current &&
          chartRef.current
        ) {
          const hit = hitTestDrawings(
            paneRef.current.drawings,
            param.point.x,
            param.point.y,
            chartRef.current,
            candleSeriesRef.current,
            fullCandlesRef.current,
            TIMEFRAME_SECONDS[paneRef.current.timeframe]
          );
          setSelectedDrawingId(hit ? hit.id : null);
        } else {
          setSelectedDrawingId(null);
        }
        return;
      }

      // Point-based drawing tools are handled by the precision crosshair overlay
      const meta = DRAWING_TOOLS_CATALOG.find((t) => t.id === tool);
      if (!meta || meta.pointsNeeded === 'freehand') return;
      void resolveChartPoint;
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);
    chart.subscribeClick(handleClick);

    // Time-axis long-press (and right-click) opens "Go to Date & Time"
    let longPressTimer: number | null = null;
    let pressStartX = 0;
    let pressStartY = 0;

    const clearLongPress = () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const handleAxisPointerDown = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (e.clientY < rect.bottom - 34) return;
      pressStartX = e.clientX;
      pressStartY = e.clientY;
      clearLongPress();
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        onSelectPane(paneRef.current.id);
        onOpenGoToDateRef.current();
      }, 450);
    };

    const handleAxisPointerMove = (e: PointerEvent) => {
      if (longPressTimer === null) return;
      if (Math.hypot(e.clientX - pressStartX, e.clientY - pressStartY) > 8) {
        clearLongPress();
      }
    };

    const handleAxisContextMenu = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      if (e.clientY < rect.bottom - 34) return;
      e.preventDefault();
      clearLongPress();
      onSelectPane(paneRef.current.id);
      onOpenGoToDateRef.current();
    };

    el.addEventListener('pointerdown', handleAxisPointerDown, true);
    el.addEventListener('pointermove', handleAxisPointerMove, true);
    el.addEventListener('pointerup', clearLongPress, true);
    el.addEventListener('pointercancel', clearLongPress, true);
    el.addEventListener('contextmenu', handleAxisContextMenu, true);

    return () => {
      clearLongPress();
      el.removeEventListener('pointerdown', handleAxisPointerDown, true);
      el.removeEventListener('pointermove', handleAxisPointerMove, true);
      el.removeEventListener('pointerup', clearLongPress, true);
      el.removeEventListener('pointercancel', clearLongPress, true);
      el.removeEventListener('contextmenu', handleAxisContextMenu, true);
      if (candleAnimRafRef.current !== null) {
        cancelAnimationFrame(candleAnimRafRef.current);
        candleAnimRafRef.current = null;
      }
      targetLiveCandleRef.current = null;
      displayLiveCandleRef.current = null;
      chartDisposedRef.current = true;
      try {
        chart.unsubscribeCrosshairMove(handleCrosshairMove);
        chart.unsubscribeClick(handleClick);
        chart.remove();
      } catch {
        // Ignore if already disposed
      }
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      ema20SeriesRef.current = null;
      ema50SeriesRef.current = null;
      sma20SeriesRef.current = null;
      bbUpperRef.current = null;
      bbMidRef.current = null;
      bbLowerRef.current = null;
      rsiSeriesRef.current = null;
      setChartReady(false);
    };
  }, [
    buildDrawingObject,
    onAddDrawing,
    onPickReplayIndex,
    onPlacementHintChange,
    onSelectPane,
    onToolComplete,
  ]);

  // Reset pending state when switching tool or active pane
  useEffect(() => {
    pendingPointsRef.current = [];
    setPendingPoints([]);
    freehandPointsRef.current = [];
    isDrawingFreehandRef.current = false;
    mouseLockedAfterDragRef.current = false;
    crosshairDragRef.current = null;
    crosshairPixelRef.current = null;
    setCrosshairPixel(null);
    setDraftDrawing(null);
    if (activeTool !== 'cursor' || !isActive) {
      setCursorCrosshair(null);
      setQuickMenuOpen(false);
      setOrderTicketOpen(false);
      hoveringPlusBtnRef.current = false;
    }
    if (activeTool === 'cursor' || !isActive) {
      onPlacementHintChange(null);
    }
  }, [activeTool, isActive, onPlacementHintChange]);

  // Apply custom colors & theme dynamically
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (chartDisposedRef.current || !chart || !candleSeries) return;

    const bgDark = isColorDark(appearance.backgroundColor);

    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: appearance.backgroundColor },
        textColor: bgDark ? '#d1d4dc' : '#131722',
      },
      grid: {
        vertLines: {
          color: bgDark ? 'rgba(209, 212, 220, 0.05)' : 'rgba(42, 46, 57, 0.05)',
        },
        horzLines: {
          color: bgDark ? 'rgba(209, 212, 220, 0.05)' : 'rgba(42, 46, 57, 0.05)',
        },
      },
      rightPriceScale: {
        borderColor: bgDark ? '#2a2e39' : '#e0e3eb',
        scaleMargins: { top: 0.15, bottom: 0.15 },
      },
      timeScale: {
        borderColor: bgDark ? '#2a2e39' : '#e0e3eb',
      },
      crosshair: {
        vertLine: {
          color: bgDark ? '#787b86' : '#9598a1',
          labelBackgroundColor: '#131722',
        },
        horzLine: {
          color: bgDark ? '#787b86' : '#9598a1',
          labelBackgroundColor: '#131722',
        },
      },
    });

    candleSeries.applyOptions({
      upColor: appearance.upColor,
      downColor: appearance.downColor,
      wickUpColor: appearance.upWickColor,
      wickDownColor: appearance.downWickColor,
      borderVisible: true,
      wickVisible: true,
      borderUpColor: appearance.upColor,
      borderDownColor: appearance.downColor,
    });
  }, [appearance]);

  // Fetch historical candles + subscribe live market stream
  useEffect(() => {
    let cancelled = false;
    let unsubscribeStream: (() => void) | null = null;
    const seriesKey = `${pane.symbol}:${pane.timeframe}`;
    loadedSeriesKeyRef.current = '';

    setLoading(true);
    setLiveCandle(null);
    setCursorCrosshair(null);
    setQuickMenuOpen(false);
    setOrderTicketOpen(false);
    setPinnedQuickData(null);
    hoveringPlusBtnRef.current = false;
    setMarketStatus(getMarketStatus(pane.symbol));
    customQtyEditedRef.current = false;

    const load = async () => {
      const activeReplayAtStart =
        isActiveRef.current && replayRef.current.active && !replayRef.current.selectingStart;
      const targetReplayTime =
        replayRef.current.replayTimestamp ?? replayRef.current.currentTime;
      const stepSec = TIMEFRAME_SECONDS[pane.timeframe];
      const approxHistorySpanSec = getDefaultHistoryCount(pane.timeframe) * stepSec;
      const nowSec = Math.floor(Date.now() / 1000);
      const needsWindowAroundTarget =
        activeReplayAtStart &&
        targetReplayTime !== undefined &&
        targetReplayTime < nowSec - approxHistorySpanSec * 0.75;

      const [initialHistRes, t24] = await Promise.all([
        needsWindowAroundTarget && targetReplayTime !== undefined
          ? fetchHistoricalCandlesAround(
              pane.symbol,
              pane.timeframe,
              targetReplayTime,
              appearance.finnhubApiKey
            )
          : fetchHistoricalCandles(
              pane.symbol,
              pane.timeframe,
              appearance.finnhubApiKey
            ),
        fetchTicker24h(pane.symbol, appearance.finnhubApiKey),
      ]);
      if (cancelled || chartDisposedRef.current) return;

      let histRes = initialHistRes;
      let candles = histRes.candles;
      if (
        activeReplayAtStart &&
        targetReplayTime !== undefined &&
        candles.length > 0 &&
        Number(candles[0].time) > targetReplayTime
      ) {
        const aroundRes = await fetchHistoricalCandlesAround(
          pane.symbol,
          pane.timeframe,
          targetReplayTime,
          appearance.finnhubApiKey
        );
        if (cancelled || chartDisposedRef.current) return;
        if (aroundRes.candles.length > 0) {
          histRes = aroundRes;
          candles = aroundRes.candles;
        }
      }

      candles = sanitizeCandleSeries(candles);

      fullCandlesRef.current = candles;
      loadedSeriesKeyRef.current = seriesKey;
      setSimulated(histRes.simulated);

      if (t24) {
        setTicker(t24);
      } else if (candles.length >= 2) {
        const lastBar = candles[candles.length - 1];
        const cutoff24h = Number(lastBar.time) - 86400;
        const recent24h = candles.filter((c) => Number(c.time) >= cutoff24h);
        const refSlice = recent24h.length >= 2 ? recent24h : candles.slice(-24);
        const first = refSlice[0].open;
        const last = lastBar.close;
        const pct = ((last - first) / first) * 100;
        setTicker({
          symbol: pane.symbol,
          lastPrice: last,
          priceChangePercent: pct,
          priceChange: last - first,
          highPrice: Math.max(...refSlice.map((c) => c.high)),
          lowPrice: Math.min(...refSlice.map((c) => c.low)),
          quoteVolume: 0,
        });
      }

      if (candles.length > 0 && !chartDisposedRef.current && candleSeriesRef.current) {
        const lastPrice = candles[candles.length - 1].close;
        if (!customQtyEditedRef.current) {
          setOrderQty(String(getDefaultOrderQty(lastPrice, pane.symbol)));
        }
        const decimals = getDecimalsForPrice(lastPrice);
        candleSeriesRef.current.applyOptions({
          priceFormat: {
            type: 'price',
            precision: decimals,
            minMove: Math.pow(10, -decimals),
          },
        });

        const activeReplay =
          isActiveRef.current && replayRef.current.active && !replayRef.current.selectingStart;
        let effectiveReplayIdx = replayRef.current.currentIndex;
        let displayCandles = candles;
        let effectiveReplayTs = replayRef.current.replayTimestamp;

        if (activeReplay) {
          if (effectiveReplayTs !== undefined) {
            const slice = resolveReplaySliceAtTimestamp(
              candles,
              stepSec,
              replayRef.current.currentIndex,
              effectiveReplayTs
            );
            if (slice) {
              effectiveReplayIdx = slice.index;
              displayCandles = [...candles.slice(0, slice.index), slice.displayCandle];
            } else {
              displayCandles = candles;
            }
          } else {
            const anchorTime = replayRef.current.currentTime;
            if (anchorTime !== undefined) {
              let alignedIdx = -1;
              for (let i = candles.length - 1; i >= 0; i--) {
                if (Number(candles[i].time) <= anchorTime) {
                  alignedIdx = i;
                  break;
                }
              }
              if (alignedIdx === -1) {
                alignedIdx = Math.min(5, candles.length - 1);
              }
              effectiveReplayIdx = alignedIdx;
            } else {
              effectiveReplayIdx = Math.max(
                0,
                Math.min(replayRef.current.currentIndex, candles.length - 1)
              );
            }
            displayCandles = candles.slice(0, Math.min(effectiveReplayIdx + 1, candles.length));
            if (displayCandles.length > 0) {
              effectiveReplayTs = Number(displayCandles[displayCandles.length - 1].time) + stepSec;
            }
          }
        }

        lastSeriesTimeRef.current =
          displayCandles.length > 0
            ? Number(displayCandles[displayCandles.length - 1].time)
            : 0;
        candleSeriesRef.current.setData(displayCandles);
        renderedCandlesRef.current = [...displayCandles];
        setRenderedCandles([...displayCandles]);
        syncIndicatorsData(displayCandles);
        const currentBar = displayCandles[displayCandles.length - 1];
        targetLiveCandleRef.current = currentBar ? { ...currentBar } : null;
        displayLiveCandleRef.current = currentBar ? { ...currentBar } : null;
        setLiveCandle(currentBar);
        if (currentBar) {
          onMarketTickRef.current(pane.symbol, currentBar, activeReplay);
        }

        if (isActiveRef.current) {
          if (activeReplay && onSyncReplayRef.current) {
            onSyncReplayRef.current(
              effectiveReplayIdx,
              candles.length,
              currentBar ? Number(currentBar.time) : targetReplayTime,
              effectiveReplayTs
            );
          } else {
            onReplayTotalChange(candles.length);
          }
        }
      } else if (isActiveRef.current && replayRef.current.active && onSyncReplayRef.current) {
        onSyncReplayRef.current(0, 0, targetReplayTime, replayRef.current.replayTimestamp);
      }

      const isDailyOrHigher = ['1d', '1w', '1M'].includes(pane.timeframe);
      if (!chartDisposedRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          rightPriceScale: {
            autoScale: true,
            scaleMargins: { top: 0.15, bottom: 0.15 },
          },
          timeScale: {
            timeVisible: !isDailyOrHigher,
            secondsVisible: true,
            barSpacing: 6,
            rightOffset: 12,
          },
          localization: {
            timeFormatter: (time: Time) => formatAxisTime(time, pane.timeframe),
          },
        });
        chartRef.current.timeScale().scrollToRealTime();
        setShowScrollToEnd(false);
        chartRef.current.priceScale('right').applyOptions({
          autoScale: true,
          scaleMargins: { top: 0.15, bottom: 0.15 },
        });
      }

      setLoading(false);

      unsubscribeStream = subscribeMarketStream(
        pane.symbol,
        pane.timeframe,
        candles[candles.length - 1],
        {
          onStatusChange: (live) => {
            if (cancelled) return;
            if (live) setSimulated(false);
          },
          onMarketStateChange: () => {
            if (!cancelled) setMarketStatus(getMarketStatus(pane.symbol));
          },
          onCandle: (candle) => {
            if (cancelled || chartDisposedRef.current) return;
            const candleTimeNum = Math.floor(Number(candle.time));
            if (!Number.isFinite(candleTimeNum) || candleTimeNum <= 0 || !Number.isFinite(candle.close) || candle.close <= 0) {
              return;
            }
            const cleanCandle: Candle = { ...candle, time: candleTimeNum as UTCTimestamp };
            const buffer = fullCandlesRef.current;
            let isNewBar = false;
            let closedPrevExact: Candle | null = null;
            if (buffer.length === 0) {
              buffer.push(cleanCandle);
              isNewBar = true;
            } else {
              const last = buffer[buffer.length - 1];
              const lastTimeNum = Number(last.time);
              if (candleTimeNum < lastTimeNum) {
                // Ignore stale out-of-order ticks so Lightweight Charts never receives older timestamps
                return;
              }
              if (candleTimeNum === lastTimeNum) {
                buffer[buffer.length - 1] = cleanCandle;
              } else {
                closedPrevExact = { ...last };
                buffer.push(cleanCandle);
                if (buffer.length > 3500) buffer.shift();
                isNewBar = true;
              }
            }

            if (isActiveRef.current && replayRef.current.active) {
              return;
            }

            if (isNewBar) {
              // Snap finalized prior candle cleanly to its exact OHLC before opening new bar
              if (closedPrevExact && Number(closedPrevExact.time) >= lastSeriesTimeRef.current) {
                try {
                  lastSeriesTimeRef.current = Number(closedPrevExact.time);
                  candleSeriesRef.current?.update(closedPrevExact);
                } catch {
                  // Ignore if series was reset mid-frame
                }
              }
              displayLiveCandleRef.current = {
                time: cleanCandle.time,
                open: cleanCandle.open,
                high: cleanCandle.open,
                low: cleanCandle.open,
                close: cleanCandle.open,
                volume: cleanCandle.volume,
              };
              setRenderedCandles([...buffer]);
              syncIndicatorsData(buffer);
            } else if (
              !displayLiveCandleRef.current ||
              Number(displayLiveCandleRef.current.time) !== candleTimeNum
            ) {
              displayLiveCandleRef.current = { ...cleanCandle };
            }

            targetLiveCandleRef.current = { ...cleanCandle };

            if (candleAnimRafRef.current === null) {
              candleAnimLastMsRef.current = performance.now();
              const stepAnimation = (nowMs: number) => {
                candleAnimRafRef.current = null;
                if (
                  cancelled ||
                  chartDisposedRef.current ||
                  !candleSeriesRef.current ||
                  (isActiveRef.current && replayRef.current.active)
                ) {
                  return;
                }
                const target = targetLiveCandleRef.current;
                const cur = displayLiveCandleRef.current;
                if (!target || !cur) return;

                if (Number(target.time) < lastSeriesTimeRef.current) {
                  return;
                }

                const dtSec = Math.min(
                  0.05,
                  Math.max(0.004, (nowMs - candleAnimLastMsRef.current) / 1000)
                );
                candleAnimLastMsRef.current = nowMs;

                const decimals = getDecimalsForPrice(target.close);
                const snapTol = Math.max(
                  Math.pow(10, -decimals) * 0.35,
                  Math.abs(target.close) * 1e-7
                );
                const diff = target.close - cur.close;
                const alpha = 1 - Math.exp(-24 * dtSec);
                const candidateClose = cur.close + diff * alpha;
                const settled = Math.abs(target.close - candidateClose) <= snapTol;
                const frameClose = settled ? target.close : candidateClose;

                const frameBar: Candle = settled
                  ? { ...target }
                  : {
                      time: target.time,
                      open: target.open,
                      high: Math.max(cur.high, frameClose, target.open),
                      low: Math.min(cur.low, frameClose, target.open),
                      close: frameClose,
                      volume: target.volume,
                    };

                displayLiveCandleRef.current = frameBar;
                try {
                  lastSeriesTimeRef.current = Number(frameBar.time);
                  candleSeriesRef.current.update(frameBar);
                } catch {
                  return;
                }

                const chartInst = chartRef.current;
                if (chartInst) {
                  try {
                    const priceY = candleSeriesRef.current.priceToCoordinate(frameBar.close);
                    const scaleW = chartInst.priceScale('right').width();
                    const paneH = chartInst.paneSize(0).height;
                    if (priceY !== null && paneH > 0 && scaleW > 0) {
                      const top = Math.max(2, Math.min(paneH - 18, priceY + 9));
                      const width = Math.max(54, Math.round(scaleW) - 1);
                      setCountdownAnchor((prev) =>
                        prev && Math.abs(prev.top - top) < 0.5 && prev.width === width
                          ? prev
                          : { top, width }
                      );
                    }
                  } catch {
                    // Ignore transient coordinate read
                  }
                }

                if (settled || nowMs - lastReactTickSyncMsRef.current >= 55) {
                  lastReactTickSyncMsRef.current = nowMs;
                  setLiveCandle(frameBar);
                  onMarketTickRef.current(pane.symbol, target, false);
                  setTicker((prev) =>
                    prev ? { ...prev, lastPrice: frameBar.close } : prev
                  );
                }

                if (!settled) {
                  candleAnimRafRef.current = requestAnimationFrame(stepAnimation);
                }
              };
              candleAnimRafRef.current = requestAnimationFrame(stepAnimation);
            }

            if (isNewBar) {
              lastReactTickSyncMsRef.current = performance.now();
              setLiveCandle(candle);
              onMarketTickRef.current(pane.symbol, candle, false);
              setTicker((prev) =>
                prev ? { ...prev, lastPrice: candle.close } : prev
              );
            }
          },
        },
        appearance.finnhubApiKey
      );
    };

    load();

    return () => {
      cancelled = true;
      if (candleAnimRafRef.current !== null) {
        cancelAnimationFrame(candleAnimRafRef.current);
        candleAnimRafRef.current = null;
      }
      targetLiveCandleRef.current = null;
      displayLiveCandleRef.current = null;
      unsubscribeStream?.();
    };
  }, [
    pane.symbol,
    pane.timeframe,
    appearance.finnhubApiKey,
    onReplayTotalChange,
    syncIndicatorsData,
  ]);

  // Update indicators when toggled
  useEffect(() => {
    const buffer = fullCandlesRef.current;
    if (buffer.length === 0) return;
    const isReplaying = isActive && replay.active && !replay.selectingStart;
    let sliced = buffer;
    if (isReplaying) {
      const slice = resolveReplaySliceAtTimestamp(
        buffer,
        TIMEFRAME_SECONDS[pane.timeframe],
        replay.currentIndex,
        replay.replayTimestamp
      );
      sliced = slice ? [...buffer.slice(0, slice.index), slice.displayCandle] : buffer;
    }
    syncIndicatorsData(sliced);
  }, [
    pane.indicators,
    pane.timeframe,
    isActive,
    replay.active,
    replay.selectingStart,
    replay.currentIndex,
    replay.replayTimestamp,
    syncIndicatorsData,
  ]);

  // Apply Bar Replay slice (including live sub-bar candle building)
  useEffect(() => {
    if (loadedSeriesKeyRef.current !== `${pane.symbol}:${pane.timeframe}`) return;
    if (replay.syncing) return;
    const buffer = fullCandlesRef.current;
    if (chartDisposedRef.current || !candleSeriesRef.current || buffer.length === 0) return;

    if (isActive && replay.active && !replay.selectingStart) {
      if (candleAnimRafRef.current !== null) {
        cancelAnimationFrame(candleAnimRafRef.current);
        candleAnimRafRef.current = null;
      }
      const barStepSec = TIMEFRAME_SECONDS[pane.timeframe];
      const slice = resolveReplaySliceAtTimestamp(
        buffer,
        barStepSec,
        replay.currentIndex,
        replay.replayTimestamp
      );
      if (!slice) return;
      const replayBar = slice.displayCandle;
      const replayBarTime = Number(replayBar.time);
      const sliced = [...buffer.slice(0, slice.index), replayBar];

      const canIncrementalUpdate =
        renderedCandlesRef.current.length === sliced.length &&
        lastSeriesTimeRef.current === replayBarTime;

      if (canIncrementalUpdate) {
        try {
          candleSeriesRef.current.update(replayBar);
        } catch {
          candleSeriesRef.current.setData(sliced);
        }
      } else {
        lastSeriesTimeRef.current = replayBarTime;
        candleSeriesRef.current.setData(sliced);
      }

      renderedCandlesRef.current = sliced;
      setRenderedCandles(sliced);
      syncIndicatorsData(sliced);
      setLiveCandle(replayBar);
      onMarketTickRef.current(pane.symbol, replayBar, true);
    } else if (!replay.active) {
      lastSeriesTimeRef.current =
        buffer.length > 0 ? Number(buffer[buffer.length - 1].time) : 0;
      candleSeriesRef.current.setData(buffer);
      renderedCandlesRef.current = [...buffer];
      setRenderedCandles([...buffer]);
      syncIndicatorsData(buffer);
      const liveBar = buffer[buffer.length - 1];
      targetLiveCandleRef.current = liveBar ? { ...liveBar } : null;
      displayLiveCandleRef.current = liveBar ? { ...liveBar } : null;
      setLiveCandle(liveBar);
      if (liveBar) {
        onMarketTickRef.current(pane.symbol, liveBar, false);
      }
    }
  }, [
    isActive,
    replay.active,
    replay.selectingStart,
    replay.currentIndex,
    replay.replayTimestamp,
    replay.syncing,
    pane.symbol,
    pane.timeframe,
    syncIndicatorsData,
  ]);

  // Render colored right-Y-axis price badges for open position Entry / TP / SL
  // (Interactive horizontal lines, right-side PnL tags, close ×, and smooth TP/SL dragging render in DrawingLayer)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (chartDisposedRef.current || !series) return;

    for (const line of positionPriceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // Ignore already removed lines
      }
    }
    positionPriceLinesRef.current = [];

    const matching = openPositions.filter((p) => p.symbol === pane.symbol);
    for (const pos of matching) {
      const entryLine = series.createPriceLine({
        price: pos.entryPrice,
        color: '#2962ff',
        lineWidth: 1,
        lineVisible: false,
        axisLabelVisible: true,
        title: '',
      });
      positionPriceLinesRef.current.push(entryLine);

      if (pos.tpPrice !== undefined) {
        positionPriceLinesRef.current.push(
          series.createPriceLine({
            price: pos.tpPrice,
            color: '#089981',
            lineWidth: 1,
            lineVisible: false,
            axisLabelVisible: true,
            title: '',
          })
        );
      }
      if (pos.slPrice !== undefined) {
        positionPriceLinesRef.current.push(
          series.createPriceLine({
            price: pos.slPrice,
            color: '#f23645',
            lineWidth: 1,
            lineVisible: false,
            axisLabelVisible: true,
            title: '',
          })
        );
      }
    }
  }, [openPositions, pane.symbol, chartReady]);

  // Render dashed horizontal lines for Pending Limit/Stop orders on this symbol
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (chartDisposedRef.current || !series) return;

    for (const line of pendingOrderPriceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // Ignore already removed lines
      }
    }
    pendingOrderPriceLinesRef.current = [];

    const matchingOrders = pendingOrders.filter((o) => o.symbol === pane.symbol);
    for (const ord of matchingOrders) {
      const color = ord.side === 'long' ? '#2962ff' : '#f23645';
      pendingOrderPriceLinesRef.current.push(
        series.createPriceLine({
          price: ord.targetPrice,
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          lineVisible: true,
          axisLabelVisible: true,
          title: `${ord.side === 'long' ? 'Buy' : 'Sell'} ${ord.orderType}`,
        })
      );
      if (ord.tpPrice !== undefined) {
        pendingOrderPriceLinesRef.current.push(
          series.createPriceLine({
            price: ord.tpPrice,
            color: '#089981',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            lineVisible: true,
            axisLabelVisible: true,
            title: 'TP',
          })
        );
      }
      if (ord.slPrice !== undefined) {
        pendingOrderPriceLinesRef.current.push(
          series.createPriceLine({
            price: ord.slPrice,
            color: '#f23645',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            lineVisible: true,
            axisLabelVisible: true,
            title: 'SL',
          })
        );
      }
    }
  }, [pendingOrders, pane.symbol, chartReady]);

  // Render dashed amber horizontal lines for active Price Alerts on this symbol
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (chartDisposedRef.current || !series) return;

    for (const line of alertPriceLinesRef.current) {
      try {
        series.removePriceLine(line);
      } catch {
        // Ignore already removed lines
      }
    }
    alertPriceLinesRef.current = [];

    const matchingAlerts = priceAlerts.filter(
      (a) => a.active && a.symbol === pane.symbol
    );
    for (const alert of matchingAlerts) {
      alertPriceLinesRef.current.push(
        series.createPriceLine({
          price: alert.targetPrice,
          color: '#f59e0b',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          lineVisible: true,
          axisLabelVisible: true,
          title: alert.note ? `Alert: ${alert.note}` : 'Alert',
        })
      );
    }
  }, [priceAlerts, pane.symbol, chartReady]);

  // Sync Y-axis countdown badge position & TradingView floating "Scroll to the End" (») visibility
  const syncCountdownPosition = useCallback(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (chartDisposedRef.current || !chart || !series) {
      setCountdownAnchor(null);
      setShowScrollToEnd(false);
      return;
    }

    try {
      const scaleW = chart.priceScale('right').width();
      const timeAxisH = chart.timeScale().height();
      const scrollPos = chart.timeScale().scrollPosition();
      const scrolledBack =
        typeof scrollPos === 'number' && Number.isFinite(scrollPos) && scrollPos < -2;

      setShowScrollToEnd(scrolledBack);
      setScrollBtnOffsets({
        right: Math.max(54, Math.round(scaleW)) + 12,
        bottom: Math.max(26, Math.round(timeAxisH)) + 12,
      });

      const lc = liveCandleRef.current;
      if (!lc) {
        setCountdownAnchor(null);
        return;
      }
      const priceY = series.priceToCoordinate(lc.close);
      const paneH = chart.paneSize(0).height;
      if (priceY === null || paneH <= 0 || scaleW <= 0) {
        setCountdownAnchor(null);
        return;
      }
      const badgeH = 16;
      const top = Math.max(2, Math.min(paneH - badgeH - 2, priceY + 9));
      setCountdownAnchor({ top, width: Math.max(54, Math.round(scaleW) - 1) });
    } catch {
      setCountdownAnchor(null);
      setShowScrollToEnd(false);
    }
  }, []);

  useEffect(() => {
    if (!chartReady || chartDisposedRef.current || !chartRef.current) return;
    const chart = chartRef.current;
    let rafId = 0;

    const scheduleSync = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!chartDisposedRef.current && chartRef.current === chart) {
          syncCountdownPosition();
        }
      });
    };

    const handleTimeRangeSync = () => {
      scheduleSync();
      if (
        chartDisposedRef.current ||
        chartRef.current !== chart ||
        applyingExternalRangeSyncRef.current ||
        !onTimeRangeSyncRef.current
      ) {
        return;
      }
      try {
        const visibleRange = chart.timeScale().getVisibleRange();
        if (!visibleRange) {
          onTimeRangeSyncRef.current(paneRef.current.id, null, null);
          return;
        }
        const fromSec = Number(visibleRange.from) as UTCTimestamp;
        const toSec = Number(visibleRange.to) as UTCTimestamp;
        if (!Number.isFinite(fromSec) || !Number.isFinite(toSec)) return;
        onTimeRangeSyncRef.current(
          paneRef.current.id,
          { from: fromSec, to: toSec },
          Math.round((fromSec + toSec) / 2)
        );
      } catch {
        // Ignore if chart disposed
      }
    };

    const ts = chart.timeScale();
    ts.subscribeVisibleLogicalRangeChange(scheduleSync);
    ts.subscribeVisibleTimeRangeChange(handleTimeRangeSync);

    const observer = new ResizeObserver(scheduleSync);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    scheduleSync();

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
      if (!chartDisposedRef.current && chartRef.current === chart) {
        try {
          ts.unsubscribeVisibleLogicalRangeChange(scheduleSync);
          ts.unsubscribeVisibleTimeRangeChange(handleTimeRangeSync);
        } catch {
          // Chart already disposed
        }
      }
    };
  }, [chartReady, syncCountdownPosition]);

  useEffect(() => {
    syncCountdownPosition();
  }, [liveCandle, renderedCandles.length, pane.indicators, syncCountdownPosition]);

  // Reset replay countdown fraction when step index changes
  useEffect(() => {
    replayProgressRef.current = {
      index: replay.currentIndex,
      elapsedFraction: 0,
      lastTickMs: performance.now(),
    };
  }, [replay.currentIndex, replay.active, replay.selectingStart]);

  // Live & Bar Replay candlestick countdown ticker
  useEffect(() => {
    const inReplay = isActive && replay.active && !replay.selectingStart;
    const stepSec = TIMEFRAME_SECONDS[pane.timeframe];
    const isSubBarClockActive =
      inReplay &&
      replay.subBarEnabled &&
      replay.stepTime !== 'match' &&
      replay.replayTimestamp !== undefined;

    const updateTimer = () => {
      if (inReplay) {
        if (isSubBarClockActive) {
          const slice = resolveReplaySliceAtTimestamp(
            fullCandlesRef.current,
            stepSec,
            replay.currentIndex,
            replay.replayTimestamp
          );
          const rem = slice ? slice.remainingSec : 0;
          setCountdownText(formatCountdown(rem));
          return;
        }
        const now = performance.now();
        const prog = replayProgressRef.current;
        if (replay.playing) {
          const intervalMs =
            replay.speed === 0.5
              ? 1600
              : replay.speed === 1
              ? 900
              : replay.speed === 2
              ? 450
              : 180;
          const dt = Math.max(0, now - prog.lastTickMs);
          prog.elapsedFraction = Math.min(0.99, prog.elapsedFraction + dt / intervalMs);
        }
        prog.lastTickMs = now;
        const rem = Math.max(0, Math.round(stepSec * (1 - prog.elapsedFraction)));
        setCountdownText(formatCountdown(rem));
        return;
      }

      if (!marketStatus.isOpen && !simulated) {
        setCountdownText('Closed');
        return;
      }

      const lcTime = liveCandleRef.current ? Number(liveCandleRef.current.time) : undefined;
      setCountdownText(formatCountdown(getLiveCountdownSeconds(pane.timeframe, lcTime)));
    };

    replayProgressRef.current.lastTickMs = performance.now();
    updateTimer();

    const ms = inReplay ? 100 : 250;
    const id = window.setInterval(updateTimer, ms);
    return () => window.clearInterval(id);
  }, [
    isActive,
    replay.active,
    replay.selectingStart,
    replay.playing,
    replay.speed,
    replay.currentIndex,
    replay.replayTimestamp,
    replay.stepTime,
    replay.subBarEnabled,
    pane.timeframe,
    marketStatus.isOpen,
    simulated,
  ]);

  // Precision Crosshair Placement Mode (for all 1-point, 2-point, and 3-point drawing tools)
  const activeToolMeta = DRAWING_TOOLS_CATALOG.find((t) => t.id === activeTool);
  const isPointPlacementActive =
    isActive &&
    chartReady &&
    activeTool !== 'cursor' &&
    activeToolMeta !== undefined &&
    activeToolMeta.pointsNeeded !== 'freehand' &&
    !pendingTextPrompt &&
    !(replay.active && replay.selectingStart);

  const resolvePlotDimensions = useCallback(() => {
    const chart = chartRef.current;
    const el = containerRef.current;
    if (chartDisposedRef.current || !chart || !el) return null;
    try {
      const paneSize = chart.paneSize(0);
      const priceScaleW = chart.priceScale('right').width();
      const rect = el.getBoundingClientRect();
      const plotW = Math.max(
        40,
        paneSize.width > 0 ? paneSize.width : rect.width - priceScaleW
      );
      const plotH = Math.max(40, paneSize.height > 0 ? paneSize.height : rect.height - 28);
      return { plotW, plotH, priceScaleW, rect };
    } catch {
      return null;
    }
  }, []);

  const pixelToChartPoint = useCallback(
    (
      px: number,
      py: number
    ): { point: ChartPoint; snappedPixel: { x: number; y: number } } | null => {
      const chart = chartRef.current;
      const series = candleSeriesRef.current;
      if (chartDisposedRef.current || !chart || !series) return null;

      const price = series.coordinateToPrice(py);
      if (price === null) return null;

      const time = resolveXTime(
        chart,
        fullCandlesRef.current,
        TIMEFRAME_SECONDS[paneRef.current.timeframe],
        px
      );
      if (time === null) return null;

      const rawPt: ChartPoint = { time, price };
      if (paneRef.current.magnetMode) {
        const snapped = snapPointToMagnet(
          rawPt,
          fullCandlesRef.current,
          TIMEFRAME_SECONDS[paneRef.current.timeframe]
        );
        const sx = resolveTimeX(
          chart,
          fullCandlesRef.current,
          TIMEFRAME_SECONDS[paneRef.current.timeframe],
          snapped.time
        );
        const sy = series.priceToCoordinate(snapped.price);
        return {
          point: snapped,
          snappedPixel: {
            x: sx !== null && Number.isFinite(sx) ? sx : px,
            y: sy !== null && Number.isFinite(sy) ? sy : py,
          },
        };
      }
      return { point: rawPt, snappedPixel: { x: px, y: py } };
    },
    []
  );

  const updateDraftForCrosshair = useCallback(
    (px: number, py: number) => {
      const tool = activeToolRef.current;
      const meta = DRAWING_TOOLS_CATALOG.find((t) => t.id === tool);
      if (!isActiveRef.current || tool === 'cursor' || !meta || meta.pointsNeeded === 'freehand') {
        setDraftDrawing(null);
        return;
      }
      const resolved = pixelToChartPoint(px, py);
      if (!resolved) return;

      const pts = pendingPointsRef.current;
      if (meta.pointsNeeded === 1 && pts.length === 0) {
        if (tool !== 'text') {
          setDraftDrawing(buildDrawingObject(tool, [resolved.point], 'draft'));
        }
      } else if (meta.pointsNeeded === 2 && pts.length === 1) {
        setDraftDrawing(buildDrawingObject(tool, [pts[0], resolved.point], 'draft'));
      } else if (meta.pointsNeeded === 3) {
        if (pts.length === 1) {
          setDraftDrawing(buildDrawingObject('trendline', [pts[0], resolved.point], 'draft'));
        } else if (pts.length === 2) {
          setDraftDrawing(buildDrawingObject(tool, [pts[0], pts[1], resolved.point], 'draft'));
        }
      }
    },
    [buildDrawingObject, pixelToChartPoint]
  );

  // Lock chart scroll/scale and show centered crosshair whenever a point drawing tool is active
  useEffect(() => {
    const chart = chartRef.current;
    if (chartDisposedRef.current || !chart) {
      setCrosshairPixel(null);
      return;
    }
    if (!isPointPlacementActive) {
      setCrosshairPixel(null);
      try {
        chart.applyOptions({ handleScroll: true, handleScale: true });
      } catch {
        // Ignore if chart disposed
      }
      return;
    }

    try {
      chart.applyOptions({ handleScroll: false, handleScale: false });
    } catch {
      return;
    }

    const initCenter = () => {
      if (chartDisposedRef.current || chartRef.current !== chart) return;
      const dims = resolvePlotDimensions();
      if (!dims) return;
      const current = crosshairPixelRef.current;
      const next = current
        ? {
            x: Math.max(6, Math.min(dims.plotW - 6, current.x)),
            y: Math.max(6, Math.min(dims.plotH - 6, current.y)),
          }
        : {
            x: Math.round(dims.plotW * 0.5),
            y: Math.round(dims.plotH * 0.5),
          };
      crosshairPixelRef.current = next;
      setCrosshairPixel(next);
      updateDraftForCrosshair(next.x, next.y);
    };

    initCenter();
    const raf = requestAnimationFrame(initCenter);
    const el = containerRef.current;
    const observer = new ResizeObserver(initCenter);
    if (el) observer.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      if (!chartDisposedRef.current && chartRef.current === chart) {
        try {
          chart.applyOptions({ handleScroll: true, handleScale: true });
        } catch {
          // Chart already disposed
        }
      }
    };
  }, [isPointPlacementActive, activeTool, resolvePlotDimensions, updateDraftForCrosshair]);

  const commitCrosshairPoint = useCallback(
    (px: number, py: number) => {
      const tool = activeToolRef.current;
      const meta = DRAWING_TOOLS_CATALOG.find((t) => t.id === tool);
      if (!meta || meta.pointsNeeded === 'freehand') return;

      const resolved = pixelToChartPoint(px, py);
      if (!resolved) return;
      const pt = resolved.point;
      const id = `draw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      if (meta.pointsNeeded === 1) {
        if (tool === 'text') {
          setDraftDrawing(null);
          setCrosshairPixel(null);
          setTextInputValue('');
          setPendingTextPrompt({ type: 'text', points: [pt] });
          return;
        }
        const obj = buildDrawingObject(tool, [pt], id);
        if (obj) {
          onAddDrawing(paneRef.current.id, obj);
          setSelectedDrawingId(null);
        }
        pendingPointsRef.current = [];
        setPendingPoints([]);
        setDraftDrawing(null);
        crosshairPixelRef.current = null;
        setCrosshairPixel(null);
        onPlacementHintChange(null);
        onToolComplete();
        return;
      }

      const nextPts = [...pendingPointsRef.current, pt];
      if (nextPts.length < meta.pointsNeeded) {
        pendingPointsRef.current = nextPts;
        setPendingPoints(nextPts);
        mouseLockedAfterDragRef.current = false;
        onPlacementHintChange(
          `${meta.name}: Drag crosshair, tap point ${nextPts.length + 1} of ${meta.pointsNeeded}`
        );
        updateDraftForCrosshair(px, py);
      } else {
        if (tool === 'callout') {
          pendingPointsRef.current = [];
          setPendingPoints([]);
          setDraftDrawing(null);
          crosshairPixelRef.current = null;
          setCrosshairPixel(null);
          setTextInputValue('');
          setPendingTextPrompt({ type: 'callout', points: nextPts });
          onPlacementHintChange(null);
          return;
        }

        const obj = buildDrawingObject(tool, nextPts, id);
        if (obj) {
          onAddDrawing(paneRef.current.id, obj);
          setSelectedDrawingId(null);
        }
        pendingPointsRef.current = [];
        setPendingPoints([]);
        setDraftDrawing(null);
        crosshairPixelRef.current = null;
        setCrosshairPixel(null);
        mouseLockedAfterDragRef.current = false;
        onPlacementHintChange(null);
        onToolComplete();
      }
    },
    [
      buildDrawingObject,
      onAddDrawing,
      onPlacementHintChange,
      onToolComplete,
      pixelToChartPoint,
      updateDraftForCrosshair,
    ]
  );

  // Persistent window pointer listeners + native touchmove prevention so dragging NEVER drops or gets cancelled
  useEffect(() => {
    if (!isPointPlacementActive) return;

    const applyMove = (clientX: number, clientY: number, pointerType?: string) => {
      const drag = crosshairDragRef.current;
      if (!drag) return;
      const dims = resolvePlotDimensions();
      if (!dims) return;

      const dx = clientX - drag.downX;
      const dy = clientY - drag.downY;
      if (!drag.moved && Math.hypot(dx, dy) >= 5) {
        drag.moved = true;
        if (pointerType === 'mouse') {
          mouseLockedAfterDragRef.current = true;
        }
      }

      // Move crosshair immediately with 1:1 pointer sensitivity
      const nextX = Math.max(6, Math.min(dims.plotW - 6, drag.startCrossX + dx));
      const nextY = Math.max(6, Math.min(dims.plotH - 6, drag.startCrossY + dy));
      const next = { x: nextX, y: nextY };
      crosshairPixelRef.current = next;
      setCrosshairPixel(next);
      updateDraftForCrosshair(nextX, nextY);
    };

    const handleWindowPointerMove = (e: PointerEvent) => {
      const drag = crosshairDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (e.cancelable) e.preventDefault();
      applyMove(e.clientX, e.clientY, e.pointerType);
    };

    const handleWindowPointerUp = (e: PointerEvent) => {
      const drag = crosshairDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const wasMoved = drag.moved;
      crosshairDragRef.current = null;
      if (!wasMoved) {
        const cur = crosshairPixelRef.current;
        if (cur) {
          commitCrosshairPoint(cur.x, cur.y);
        }
      }
    };

    const handleWindowPointerCancel = (e: PointerEvent) => {
      const drag = crosshairDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      crosshairDragRef.current = null;
    };

    const wrapperEl = plotWrapperRef.current;
    const handleNativeTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && e.cancelable) {
        e.preventDefault();
      }
    };

    window.addEventListener('pointermove', handleWindowPointerMove, { passive: false });
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);
    wrapperEl?.addEventListener('touchmove', handleNativeTouchMove, { passive: false });

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
      wrapperEl?.removeEventListener('touchmove', handleNativeTouchMove);
    };
  }, [
    isPointPlacementActive,
    resolvePlotDimensions,
    updateDraftForCrosshair,
    commitCrosshairPoint,
  ]);

  const handleCrosshairPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointPlacementActive) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectPane(pane.id);

    const dims = resolvePlotDimensions();
    if (!dims) return;
    const cur = crosshairPixelRef.current ?? {
      x: Math.round(dims.plotW * 0.5),
      y: Math.round(dims.plotH * 0.5),
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Window listener handles drag even if capture isn't supported
    }

    crosshairDragRef.current = {
      pointerId: e.pointerId,
      downX: e.clientX,
      downY: e.clientY,
      startCrossX: cur.x,
      startCrossY: cur.y,
      moved: false,
    };
  };

  const handleCrosshairHoverMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointPlacementActive) return;
    if (crosshairDragRef.current) return;
    if (
      e.pointerType === 'mouse' &&
      e.buttons === 0 &&
      !mouseLockedAfterDragRef.current
    ) {
      const dims = resolvePlotDimensions();
      if (!dims) return;
      const localX = e.clientX - dims.rect.left;
      const localY = e.clientY - dims.rect.top;
      const nextX = Math.max(6, Math.min(dims.plotW - 6, localX));
      const nextY = Math.max(6, Math.min(dims.plotH - 6, localY));
      const next = { x: nextX, y: nextY };
      crosshairPixelRef.current = next;
      setCrosshairPixel(next);
      updateDraftForCrosshair(nextX, nextY);
    }
  };

  // Freehand Brush / Highlighter handlers
  const isFreehandActive =
    isActive &&
    !replay.selectingStart &&
    (activeTool === 'brush' || activeTool === 'highlighter');

  const pointFromPointerEvent = (e: React.PointerEvent<HTMLDivElement>): ChartPoint | null => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const el = containerRef.current;
    if (chartDisposedRef.current || !chart || !series || !el) return null;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const time = resolveXTime(
      chart,
      fullCandlesRef.current,
      TIMEFRAME_SECONDS[pane.timeframe],
      x
    );
    const price = series.coordinateToPrice(y);
    if (time === null || price === null) return null;
    return { time, price };
  };

  const getFreehandStyle = (tool: 'brush' | 'highlighter') => {
    const preset = drawingToolPresetsRef.current?.[tool];
    return {
      color: preset?.color ?? (tool === 'highlighter' ? '#f59e0b' : '#2962ff'),
      lineWidth: preset?.lineWidth ?? 2,
      ...(preset?.opacity !== undefined ? { opacity: preset.opacity } : {}),
      ...(preset?.lineStyle !== undefined ? { lineStyle: preset.lineStyle } : {}),
    };
  };

  const handleFreehandDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isFreehandActive) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = pointFromPointerEvent(e);
    if (!pt) return;
    isDrawingFreehandRef.current = true;
    freehandPointsRef.current = [pt];
    const kind = activeTool === 'highlighter' ? 'highlighter' : 'brush';
    setDraftDrawing({
      id: 'draft-freehand',
      type: kind,
      points: [pt],
      ...getFreehandStyle(kind),
    });
  };

  const handleFreehandMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isFreehandActive || !isDrawingFreehandRef.current) return;
    const pt = pointFromPointerEvent(e);
    if (!pt) return;
    freehandPointsRef.current.push(pt);
    const kind = activeTool === 'highlighter' ? 'highlighter' : 'brush';
    setDraftDrawing({
      id: 'draft-freehand',
      type: kind,
      points: [...freehandPointsRef.current],
      ...getFreehandStyle(kind),
    });
  };

  const handleFreehandUp = () => {
    if (!isDrawingFreehandRef.current) return;
    isDrawingFreehandRef.current = false;
    const pts = freehandPointsRef.current;
    freehandPointsRef.current = [];
    setDraftDrawing(null);
    if (pts.length >= 2) {
      const id = `draw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const kind = activeTool === 'highlighter' ? 'highlighter' : 'brush';
      onAddDrawing(pane.id, {
        id,
        type: kind,
        points: pts,
        ...getFreehandStyle(kind),
      });
      setSelectedDrawingId(null);
    }
    onToolComplete();
  };

  const submitTextAnnotation = () => {
    if (!pendingTextPrompt) return;
    const id = `draw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const obj = buildDrawingObject(
      pendingTextPrompt.type,
      pendingTextPrompt.points,
      id,
      textInputValue.trim() || (pendingTextPrompt.type === 'callout' ? 'Callout' : 'Note')
    );
    if (obj) {
      onAddDrawing(pane.id, obj);
      setSelectedDrawingId(null);
    }
    setPendingTextPrompt(null);
    setTextInputValue('');
    onToolComplete();
  };

  const displayedCandle = hoverCandle ?? liveCandle;
  const currentPrice = displayedCandle?.close ?? ticker?.lastPrice ?? 0;
  const pctChange = ticker?.priceChangePercent ?? 0;
  const isPositive = pctChange >= 0;
  const bgDark = isColorDark(appearance.backgroundColor);

  const cursorClass =
    isActive && replay.active && replay.selectingStart
      ? 'cursor-col-resize'
      : isActive && activeTool !== 'cursor'
      ? 'cursor-crosshair'
      : 'cursor-default';

  return (
    <div
      onMouseDown={() => onSelectPane(pane.id)}
      onTouchStart={() => onSelectPane(pane.id)}
      className={`relative flex h-full w-full flex-col overflow-hidden transition-shadow ${
        isActive
          ? multiLayout
            ? 'ring-2 ring-[#2962ff] ring-inset'
            : 'ring-1 ring-[#2962ff]/50 ring-inset'
          : 'ring-1 ring-[#f0f3fa] ring-inset dark:ring-[#2a2e39]'
      }`}
      style={{ backgroundColor: appearance.backgroundColor }}
    >
      {/* Top-Left TradingView Mobile Overlay */}
      <div
        className={`pointer-events-none absolute top-2 left-2.5 z-30 flex max-w-[calc(100%-82px)] flex-col gap-0.5 rounded-lg px-2 py-1 backdrop-blur-[2px] ${
          bgDark ? 'bg-[#131722]/75 text-[#d1d4dc]' : 'bg-white/80 text-[#131722]'
        }`}
      >
        <div className="pointer-events-auto flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectPane(pane.id);
              onOpenSymbolModal();
            }}
            className="text-sm font-bold tracking-tight hover:text-[#2962ff] sm:text-[15px]"
          >
            {pane.symbol}
          </button>

          <span className="text-[#787b86]" aria-hidden="true">
            ·
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectPane(pane.id);
              onOpenTimeframeModal();
            }}
            className="font-mono-tabular text-xs font-semibold text-[#787b86] hover:text-[#2962ff]"
          >
            {pane.timeframe}
          </button>

          {currentPrice > 0 && (
            <>
              <span className="font-mono-tabular text-sm font-semibold">
                {formatPrice(currentPrice)}
              </span>
              <span
                className={`font-mono-tabular text-xs font-semibold ${
                  isPositive ? 'text-[#089981]' : 'text-[#f23645]'
                }`}
              >
                {isPositive ? '+' : ''}
                {pctChange.toFixed(2)}%
              </span>
            </>
          )}

          {!marketStatus.isOpen && (
            <span className="rounded bg-[#f59e0b]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#d97706] dark:text-[#fbbf24]">
              {marketStatus.label}
            </span>
          )}

          {isActive && replay.active && (
            <span className="text-[11px] font-semibold text-[#2962ff]">Replay</span>
          )}
        </div>

        {/* Compact OHLC Readout */}
        {displayedCandle && (
          <div className="hidden flex-wrap items-center gap-2 font-mono-tabular text-[11px] text-[#787b86] sm:flex">
            <span>
              O{' '}
              <span className={bgDark ? 'text-[#d1d4dc]' : 'text-[#131722]'}>
                {formatPrice(displayedCandle.open)}
              </span>
            </span>
            <span>
              H{' '}
              <span className={bgDark ? 'text-[#d1d4dc]' : 'text-[#131722]'}>
                {formatPrice(displayedCandle.high)}
              </span>
            </span>
            <span>
              L{' '}
              <span className={bgDark ? 'text-[#d1d4dc]' : 'text-[#131722]'}>
                {formatPrice(displayedCandle.low)}
              </span>
            </span>
            <span>
              C{' '}
              <span className={bgDark ? 'text-[#d1d4dc]' : 'text-[#131722]'}>
                {formatPrice(displayedCandle.close)}
              </span>
            </span>
          </div>
        )}

        {/* TradingView-style Red SELL & Blue BUY Execution Buttons (Live & Bar Replay) */}
        {showBuySellPanel &&
          isActive &&
          !(replay.active && replay.selectingStart) &&
          (liveCandle?.close ?? currentPrice) > 0 &&
          (() => {
            const refCandle = liveCandle;
            const midPrice = refCandle?.close ?? currentPrice;
            const spec = getSymbolContractSpec(pane.symbol, midPrice);
            const spread = getSpreadForPrice(midPrice);
            const bidPrice = Math.max(0.00001, midPrice - spread / 2);
            const askPrice = midPrice + spread / 2;
            const parsedQty = sanitizeOrderQty(
              pane.symbol,
              parseFloat(orderQty) || getDefaultOrderQty(midPrice, pane.symbol),
              midPrice
            );
            const candleTime = Number(refCandle?.time ?? Math.floor(Date.now() / 1000));
            const isReplayMode = replay.active && !replay.selectingStart;

            return (
              <div
                style={{
                  transform: `translate3d(${orderPanelOffset.x}px, ${orderPanelOffset.y}px, 0)`,
                }}
                className="pointer-events-auto mt-1 inline-flex w-fit items-center gap-1 rounded-lg bg-white/85 p-1 shadow-sm ring-1 ring-[#e0e3eb]/80 backdrop-blur-xs dark:bg-[#131722]/85 dark:ring-[#2a2e39]"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  role="button"
                  tabIndex={0}
                  title="Drag Buy/Sell panel anywhere (double-click to reset)"
                  aria-label="Drag Buy/Sell panel"
                  onDoubleClick={() => setOrderPanelOffset({ x: 0, y: 0 })}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    orderPanelDragRef.current = {
                      pointerId: e.pointerId,
                      startX: e.clientX,
                      startY: e.clientY,
                      origX: orderPanelOffset.x,
                      origY: orderPanelOffset.y,
                    };
                  }}
                  onPointerMove={(e) => {
                    const drag = orderPanelDragRef.current;
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    const maxW = Math.max(120, (containerRef.current?.clientWidth ?? 360) - 240);
                    const maxH = Math.max(120, (containerRef.current?.clientHeight ?? 480) - 120);
                    const nextX = Math.max(-10, Math.min(maxW, drag.origX + (e.clientX - drag.startX)));
                    const nextY = Math.max(-44, Math.min(maxH, drag.origY + (e.clientY - drag.startY)));
                    setOrderPanelOffset({ x: nextX, y: nextY });
                  }}
                  onPointerUp={(e) => {
                    if (orderPanelDragRef.current?.pointerId === e.pointerId) {
                      orderPanelDragRef.current = null;
                      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      }
                    }
                  }}
                  onPointerCancel={() => {
                    orderPanelDragRef.current = null;
                  }}
                  className="flex h-8 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] active:cursor-grabbing dark:hover:bg-[#2a2e39] dark:hover:text-white"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onPlaceOrder({
                      symbol: pane.symbol,
                      side: 'short',
                      qty: parsedQty,
                      entryPrice: bidPrice,
                      candleTime,
                      pointValue: spec.pointValue,
                    })
                  }
                  className="flex min-h-[34px] min-w-[74px] flex-col items-center justify-center rounded-md border border-[#f23645] bg-[#f23645] px-2 py-0.5 text-white shadow-xs transition-colors hover:bg-[#dc2626] active:scale-[0.98]"
                  title={`Sell ${parsedQty} ${pane.symbol} at ${formatPrice(bidPrice)}${isReplayMode ? ' (Replay)' : ''}`}
                >
                  <span className="font-mono-tabular text-[11px] font-bold leading-tight">
                    {formatPrice(bidPrice)}
                  </span>
                  <span className="text-[9px] font-bold tracking-wider uppercase opacity-95">
                    SELL
                  </span>
                </button>

                <div className="flex flex-col items-center justify-center rounded-md border border-[#e0e3eb] bg-[#f8fafd]/90 px-1 py-0.5 dark:border-[#2a2e39] dark:bg-[#1e222d]/90">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-label="Decrease order quantity"
                      onClick={() => {
                        customQtyEditedRef.current = true;
                        const next = stepOrderQty(
                          pane.symbol,
                          parsedQty,
                          -1,
                          midPrice
                        );
                        setOrderQty(String(next));
                      }}
                      className="flex h-4 w-4 items-center justify-center rounded text-[11px] font-bold text-[#787b86] hover:bg-[#e0e3eb] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={spec.minQty}
                      step={spec.qtyStep}
                      aria-label="Order quantity"
                      value={orderQty}
                      onChange={(e) => {
                        customQtyEditedRef.current = true;
                        setOrderQty(e.target.value);
                      }}
                      onBlur={() => {
                        const raw = parseFloat(orderQty);
                        setOrderQty(
                          String(
                            sanitizeOrderQty(
                              pane.symbol,
                              Number.isNaN(raw) ? getDefaultOrderQty(midPrice, pane.symbol) : raw,
                              midPrice
                            )
                          )
                        );
                      }}
                      className="h-4 w-10 bg-transparent text-center font-mono-tabular text-[11px] font-bold text-[#131722] outline-none dark:text-white"
                    />
                    <button
                      type="button"
                      aria-label="Increase order quantity"
                      onClick={() => {
                        customQtyEditedRef.current = true;
                        const next = stepOrderQty(
                          pane.symbol,
                          parsedQty,
                          1,
                          midPrice
                        );
                        setOrderQty(String(next));
                      }}
                      className="flex h-4 w-4 items-center justify-center rounded text-[11px] font-bold text-[#787b86] hover:bg-[#e0e3eb] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white"
                    >
                      +
                    </button>
                  </div>
                  <span className="font-mono-tabular text-[8.5px] font-medium text-[#787b86]">
                    {isReplayMode ? 'RPL' : spec.unitLabel}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onPlaceOrder({
                      symbol: pane.symbol,
                      side: 'long',
                      qty: parsedQty,
                      entryPrice: askPrice,
                      candleTime,
                      pointValue: spec.pointValue,
                    })
                  }
                  className="flex min-h-[34px] min-w-[74px] flex-col items-center justify-center rounded-md border border-[#2962ff] bg-[#2962ff] px-2 py-0.5 text-white shadow-xs transition-colors hover:bg-[#1e53e5] active:scale-[0.98]"
                  title={`Buy ${parsedQty} ${pane.symbol} at ${formatPrice(askPrice)}${isReplayMode ? ' (Replay)' : ''}`}
                >
                  <span className="font-mono-tabular text-[11px] font-bold leading-tight">
                    {formatPrice(askPrice)}
                  </span>
                  <span className="text-[9px] font-bold tracking-wider uppercase opacity-95">
                    BUY
                  </span>
                </button>
              </div>
            );
          })()}
      </div>

      {/* Text / Callout Input Modal Overlay */}
      {pendingTextPrompt && (
        <div
          className="absolute top-16 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-[#2962ff] bg-white p-2.5 shadow-xl dark:bg-[#1e222d]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            autoFocus
            value={textInputValue}
            onChange={(e) => setTextInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitTextAnnotation();
              if (e.key === 'Escape') {
                setPendingTextPrompt(null);
                onToolComplete();
              }
            }}
            placeholder={
              pendingTextPrompt.type === 'callout'
                ? 'Callout label...'
                : 'Chart note...'
            }
            className="h-9 w-48 rounded-lg border border-[#e0e3eb] bg-[#f8fafd] px-2.5 text-xs font-medium text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
          />
          <button
            type="button"
            onClick={submitTextAnnotation}
            className="h-9 rounded-lg bg-[#2962ff] px-3 text-xs font-semibold text-white"
          >
            Add
          </button>
        </div>
      )}

      {/* Loading Skeleton Overlay */}
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-white/60 backdrop-blur-[1px] dark:bg-[#131722]/60">
          <div className="flex items-center gap-2 rounded-lg border border-[#e0e3eb] bg-white px-3 py-2 text-xs font-medium text-[#131722] shadow-sm dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#2962ff] border-t-transparent" />
            <span>Loading {pane.symbol}...</span>
          </div>
        </div>
      )}

      {/* Lightweight Charts Canvas + Interactive SVG Drawing Overlay */}
      <div
        ref={plotWrapperRef}
        style={{
          touchAction: isPointPlacementActive || isFreehandActive ? 'none' : undefined,
        }}
        className="relative h-full w-full flex-1"
      >
        <div ref={containerRef} className={`h-full w-full ${cursorClass}`} />

        {/* Candlestick Countdown Timer attached directly underneath live price badge on right Y-axis */}
        {countdownAnchor && countdownText && (
          <div
            className={`pointer-events-none absolute right-0 z-20 flex h-4 items-center justify-center rounded-b-[2px] px-1 font-mono-tabular text-[10px] font-semibold leading-none text-white shadow-xs ${
              !marketStatus.isOpen && !(isActive && replay.active && !replay.selectingStart)
                ? 'bg-[#787b86]'
                : liveCandle && liveCandle.close < liveCandle.open
                ? 'bg-[#0c3299]'
                : 'bg-[#2962ff]'
            }`}
            style={{
              top: `${countdownAnchor.top}px`,
              width: `${countdownAnchor.width}px`,
            }}
          >
            {countdownText}
          </div>
        )}

        {/* TradingView Floating "Scroll to the End" (») Button — strictly display:none unless scrolled backward (< -2 bars) */}
        {chartReady && (
          <button
            type="button"
            aria-label="Scroll to the end"
            title="Scroll to the latest candle"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onSelectPane(pane.id);
              if (!chartDisposedRef.current) {
                try {
                  chartRef.current?.timeScale().scrollToRealTime();
                } catch {
                  // Ignore if chart disposed
                }
              }
              setShowScrollToEnd(false);
            }}
            style={{
              display:
                showScrollToEnd &&
                !isPointPlacementActive &&
                !isFreehandActive &&
                !(isActive && replay.active && replay.selectingStart)
                  ? 'flex'
                  : 'none',
              right: `${scrollBtnOffsets.right}px`,
              bottom: `${scrollBtnOffsets.bottom}px`,
            }}
            className={`absolute z-30 h-9 w-9 items-center justify-center rounded-full border shadow-lg transition-all hover:scale-105 active:scale-95 ${
              bgDark
                ? 'border-[#363a45] bg-[#1e222d]/95 text-[#d1d4dc] hover:border-[#2962ff] hover:text-white'
                : 'border-[#e0e3eb] bg-white/95 text-[#131722] hover:border-[#2962ff] hover:text-[#2962ff]'
            }`}
          >
            <ChevronsRight className="h-4 w-4 stroke-[2.25]" />
          </button>
        )}

        {chartReady && (
          <DrawingLayer
            chart={chartRef.current}
            series={candleSeriesRef.current}
            isChartDisposedRef={chartDisposedRef}
            candles={renderedCandles}
            symbol={pane.symbol}
            timeframeSeconds={TIMEFRAME_SECONDS[pane.timeframe]}
            drawings={pane.drawings}
            draft={isActive ? draftDrawing : null}
            openPositions={openPositions.filter((p) => p.symbol === pane.symbol)}
            closedTrades={closedTrades.filter((t) => t.symbol === pane.symbol)}
            pendingOrders={pendingOrders.filter((o) => o.symbol === pane.symbol)}
            priceAlerts={priceAlerts.filter((a) => a.active && a.symbol === pane.symbol)}
            showExecutions={showExecutions ?? appearance.showExecutions ?? true}
            exportSvgRef={drawingSvgRef}
            currentPrice={liveCandle?.close ?? currentPrice}
            hiddenDrawings={Boolean(pane.hiddenDrawings)}
            lockedDrawings={Boolean(pane.lockedDrawings)}
            magnetMode={Boolean(pane.magnetMode)}
            isDark={bgDark}
            interactive={
              isActive &&
              activeTool === 'cursor' &&
              !(replay.active && replay.selectingStart)
            }
            replayHoverTime={
              isActive && replay.active && replay.selectingStart ? replayHoverTime : null
            }
            selectedId={isActive ? selectedDrawingId : null}
            onSelectDrawing={setSelectedDrawingId}
            onUpdateDrawing={(d) => onUpdateDrawing(pane.id, d)}
            onDeleteDrawing={(id) => onDeleteDrawing(pane.id, id)}
            onClosePosition={onClosePosition}
            onUpdatePositionTPSL={onUpdatePositionTPSL}
            onUpdatePendingOrder={onUpdatePendingOrder}
            onCancelPendingOrder={onCancelPendingOrder}
            onUpdatePriceAlert={onUpdatePriceAlert}
            onDeletePriceAlert={onDeletePriceAlert}
            onExecuteOrder={(order: PositionOrderPayload) => {
              const refCandle = liveCandleRef.current;
              const mid = refCandle?.close ?? currentPrice;
              if (!mid || mid <= 0) return;
              const spread = getSpreadForPrice(mid);
              const execPrice = order.side === 'long' ? mid + spread / 2 : Math.max(0.00001, mid - spread / 2);
              const tpValid =
                order.side === 'long' ? order.tpPrice > execPrice : order.tpPrice < execPrice;
              const slValid =
                order.side === 'long' ? order.slPrice < execPrice : order.slPrice > execPrice;
              const delta = execPrice - order.entryPrice;
              const finalTp = tpValid ? order.tpPrice : order.tpPrice + delta;
              const finalSl = slValid ? order.slPrice : order.slPrice + delta;
              const candleTime = Number(refCandle?.time ?? Math.floor(Date.now() / 1000));

              onPlaceOrder({
                symbol: pane.symbol,
                side: order.side,
                qty: order.qty,
                entryPrice: execPrice,
                candleTime,
                tpPrice: finalTp,
                slPrice: finalSl,
                pointValue: order.pointValue,
              });
            }}
          />
        )}

        {/* Crosshair (+) Quick-Action Button attached strictly to the live crosshair (disappears with it) */}
        {!isPointPlacementActive &&
          !isFreehandActive &&
          !(isActive && replay.active && replay.selectingStart) &&
          chartReady &&
          activeTool === 'cursor' &&
          (cursorCrosshair || ((quickMenuOpen || orderTicketOpen) && pinnedQuickData)) &&
          (() => {
            const dims = resolvePlotDimensions();
            if (!dims || dims.priceScaleW <= 0) return null;
            const activeCross = quickMenuOpen || orderTicketOpen
              ? pinnedQuickData
              : cursorCrosshair;
            if (!activeCross) return null;

            const syncedY =
              candleSeriesRef.current?.priceToCoordinate(activeCross.price) ?? activeCross.y;
            if (syncedY === null || !Number.isFinite(syncedY)) return null;
            const clampedY = Math.max(12, Math.min(dims.plotH - 12, syncedY));
            const pillTop = Math.max(1, Math.min(dims.plotH - 23, Math.round(clampedY) - 11));
            const scaleW = Math.max(54, Math.round(dims.priceScaleW) - 1);
            const showModalReference = quickMenuOpen || orderTicketOpen;

            return (
              <>
                {/* Keep dashed horizontal line + black Y-axis pill aligned while modal drawer is open */}
                {showModalReference && (
                  <>
                    <div
                      className="pointer-events-none absolute left-0 z-20 border-t border-dashed border-[#787b86]/80"
                      style={{
                        top: `${Math.round(clampedY)}px`,
                        width: `${dims.plotW}px`,
                      }}
                    />
                    <div
                      className="pointer-events-none absolute right-0 z-20 flex h-[22px] items-center justify-center bg-[#131722] px-1.5 font-mono-tabular text-[11px] font-semibold text-white"
                      style={{
                        top: `${pillTop}px`,
                        minWidth: `${scaleW}px`,
                      }}
                    >
                      {formatPrice(activeCross.price)}
                    </div>
                  </>
                )}

                <button
                  type="button"
                  aria-label={`Open quick actions at ${formatPrice(activeCross.price)}`}
                  title={`Quick actions @ ${formatPrice(activeCross.price)}`}
                  onMouseEnter={() => {
                    hoveringPlusBtnRef.current = true;
                  }}
                  onMouseLeave={() => {
                    hoveringPlusBtnRef.current = false;
                    if (!nativeCrosshairActiveRef.current && !quickMenuOpenRef.current) {
                      setCursorCrosshair(null);
                    }
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onTouchStart={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectPane(pane.id);
                    setPinnedQuickData({
                      price: activeCross.price,
                      time: activeCross.time,
                      y: clampedY,
                    });
                    setQuickMenuOpen(true);
                  }}
                  style={{
                    top: `${pillTop}px`,
                    right: `${scaleW}px`,
                  }}
                  className="pointer-events-auto absolute z-30 flex h-[22px] w-[26px] items-center justify-center rounded-l-[4px] border border-r-0 border-white/15 bg-[#131722] text-white shadow-md transition-colors hover:bg-[#1e222d] active:scale-95"
                >
                  <span className="absolute -inset-1.5" aria-hidden="true" />
                  <span className="flex h-[15px] w-[15px] items-center justify-center rounded-full border border-white/90">
                    <Plus className="h-2.5 w-2.5 stroke-[2.5] text-white" />
                  </span>
                </button>
              </>
            );
          })()}

        {/* Precision Crosshair Placement Overlay (shows first on tool select, drag to position, tap to drop) */}
        {isPointPlacementActive &&
          crosshairPixel &&
          (() => {
            const dims = resolvePlotDimensions();
            if (!dims) return null;
            const resolved = pixelToChartPoint(crosshairPixel.x, crosshairPixel.y);
            const vx = resolved ? resolved.snappedPixel.x : crosshairPixel.x;
            const vy = resolved ? resolved.snappedPixel.y : crosshairPixel.y;
            const priceLabel = resolved ? formatPrice(resolved.point.price) : '';
            const timeLabel = resolved
              ? formatCrosshairTime(Number(resolved.point.time), pane.timeframe)
              : '';
            const chart = chartRef.current;
            const series = candleSeriesRef.current;

            return (
              <div
                ref={crosshairOverlayRef}
                onPointerDown={handleCrosshairPointerDown}
                onPointerMove={handleCrosshairHoverMove}
                onTouchStart={(e) => e.stopPropagation()}
                style={{ touchAction: 'none', zIndex: 29 }}
                className="absolute inset-0 cursor-crosshair select-none"
              >
                <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden">
                  {/* Horizontal & vertical crosshair guide lines spanning chart plot */}
                  <line
                    x1={0}
                    y1={vy}
                    x2={dims.plotW}
                    y2={vy}
                    stroke="#2962ff"
                    strokeWidth={1.25}
                    strokeOpacity={0.85}
                    strokeDasharray="4 4"
                  />
                  <line
                    x1={vx}
                    y1={0}
                    x2={vx}
                    y2={dims.plotH}
                    stroke="#2962ff"
                    strokeWidth={1.25}
                    strokeOpacity={0.85}
                    strokeDasharray="4 4"
                  />

                  {/* Already locked anchor points for multi-point tools */}
                  {chart &&
                    series &&
                    pendingPoints.map((pt, idx) => {
                      const ax = resolveTimeX(
                        chart,
                        renderedCandles,
                        TIMEFRAME_SECONDS[pane.timeframe],
                        pt.time
                      );
                      const ay = series.priceToCoordinate(pt.price);
                      if (ax === null || ay === null) return null;
                      return (
                        <g key={idx}>
                          <circle
                            cx={ax}
                            cy={ay}
                            r={6}
                            fill="#2962ff"
                            stroke="#ffffff"
                            strokeWidth={2}
                          />
                        </g>
                      );
                    })}

                  {/* Precision sniper reticle at current crosshair intersection */}
                  <circle
                    cx={vx}
                    cy={vy}
                    r={18}
                    fill="rgba(41, 98, 255, 0.12)"
                    stroke="#2962ff"
                    strokeOpacity={0.75}
                    strokeWidth={1.5}
                  />
                  <line
                    x1={vx - 11}
                    y1={vy}
                    x2={vx - 5}
                    y2={vy}
                    stroke="#2962ff"
                    strokeWidth={1.75}
                  />
                  <line
                    x1={vx + 5}
                    y1={vy}
                    x2={vx + 11}
                    y2={vy}
                    stroke="#2962ff"
                    strokeWidth={1.75}
                  />
                  <line
                    x1={vx}
                    y1={vy - 11}
                    x2={vx}
                    y2={vy - 5}
                    stroke="#2962ff"
                    strokeWidth={1.75}
                  />
                  <line
                    x1={vx}
                    y1={vy + 5}
                    x2={vx}
                    y2={vy + 11}
                    stroke="#2962ff"
                    strokeWidth={1.75}
                  />
                  <circle
                    cx={vx}
                    cy={vy}
                    r={3.5}
                    fill="#2962ff"
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                </svg>

                {/* Right Y-axis blue price readout */}
                {priceLabel && (
                  <div
                    className="pointer-events-none absolute right-0 flex h-5 items-center justify-center rounded-l-[3px] bg-[#2962ff] px-1.5 font-mono-tabular text-[10px] font-bold text-white shadow-sm"
                    style={{
                      top: `${Math.max(2, Math.min(dims.plotH - 22, vy - 10))}px`,
                      minWidth: `${Math.max(54, Math.round(dims.priceScaleW) - 1)}px`,
                    }}
                  >
                    {priceLabel}
                  </div>
                )}

                {/* Bottom X-axis timestamp readout */}
                {timeLabel && (
                  <div
                    className="pointer-events-none absolute bottom-0 -translate-x-1/2 rounded bg-[#2962ff] px-2 py-0.5 font-mono-tabular text-[10px] font-semibold whitespace-nowrap text-white shadow-sm"
                    style={{
                      left: `${Math.max(46, Math.min(dims.plotW - 46, vx))}px`,
                    }}
                  >
                    {timeLabel}
                  </div>
                )}
              </div>
            );
          })()}

        {/* Freehand Brush / Highlighter capture surface */}
        {isFreehandActive && (
          <div
            onPointerDown={handleFreehandDown}
            onPointerMove={handleFreehandMove}
            onPointerUp={handleFreehandUp}
            onPointerCancel={handleFreehandUp}
            className="absolute inset-0 z-25 cursor-crosshair touch-none"
          />
        )}
      </div>

      {/* TradingView Quick-Action Bottom Sheet & Pre-Filled Order Ticket */}
      {(() => {
        const refPrice = liveCandle?.close ?? currentPrice;
        const spec = getSymbolContractSpec(pane.symbol, refPrice);
        const quickQty = sanitizeOrderQty(
          pane.symbol,
          parseFloat(orderQty) || getDefaultOrderQty(refPrice, pane.symbol),
          refPrice
        );
        const isReplayMode = replay.active && !replay.selectingStart;
        const candleTime = Number(liveCandle?.time ?? Math.floor(Date.now() / 1000));

        return (
          <>
            {quickMenuOpen && pinnedQuickData && (
              <CrosshairQuickActionSheet
                symbol={pane.symbol}
                qty={quickQty}
                crosshairPrice={pinnedQuickData.price}
                currentPrice={refPrice}
                isReplay={isReplayMode}
                onAddAlert={() => {
                  const target = pinnedQuickData.price;
                  const cond: PriceAlertCondition =
                    refPrice > 0 && target > refPrice
                      ? 'crossing_up'
                      : refPrice > 0 && target < refPrice
                      ? 'crossing_down'
                      : 'crossing';
                  onCreatePriceAlert?.({
                    symbol: pane.symbol,
                    targetPrice: target,
                    condition: cond,
                    repeat: false,
                  });
                }}
                onPlaceBuyPending={() => {
                  const target = pinnedQuickData.price;
                  onPlacePendingOrder?.({
                    symbol: pane.symbol,
                    side: 'long',
                    orderType: getCrosshairBuyOrderType(target, refPrice),
                    qty: quickQty,
                    targetPrice: target,
                    candleTime,
                    pointValue: spec.pointValue,
                  });
                }}
                onPlaceSellPending={() => {
                  const target = pinnedQuickData.price;
                  onPlacePendingOrder?.({
                    symbol: pane.symbol,
                    side: 'short',
                    orderType: getCrosshairSellOrderType(target, refPrice),
                    qty: quickQty,
                    targetPrice: target,
                    candleTime,
                    pointValue: spec.pointValue,
                  });
                }}
                onOpenOrderTicket={() => {
                  setOrderTicketOpen(true);
                }}
                onDrawHorizontalLine={() => {
                  const id = `draw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                  const obj = buildDrawingObject(
                    'horizontal',
                    [{ time: pinnedQuickData.time, price: pinnedQuickData.price }],
                    id
                  );
                  if (obj) {
                    onAddDrawing(pane.id, obj);
                    setSelectedDrawingId(null);
                  }
                }}
                onClose={() => {
                  hoveringPlusBtnRef.current = false;
                  setQuickMenuOpen(false);
                  if (!nativeCrosshairActiveRef.current) {
                    setCursorCrosshair(null);
                  }
                }}
              />
            )}

            {orderTicketOpen && pinnedQuickData && (
              <CrosshairOrderTicketModal
                symbol={pane.symbol}
                initialPrice={pinnedQuickData.price}
                currentPrice={refPrice}
                initialQty={quickQty}
                isReplay={isReplayMode}
                onSubmitOrder={(ord) => {
                  onPlacePendingOrder?.({
                    symbol: pane.symbol,
                    side: ord.side,
                    orderType: ord.orderType,
                    qty: ord.qty,
                    targetPrice: ord.targetPrice,
                    candleTime,
                    tpPrice: ord.tpPrice,
                    slPrice: ord.slPrice,
                    pointValue: spec.pointValue,
                  });
                }}
                onClose={() => {
                  hoveringPlusBtnRef.current = false;
                  setOrderTicketOpen(false);
                  if (!nativeCrosshairActiveRef.current) {
                    setCursorCrosshair(null);
                  }
                }}
              />
            )}
          </>
        );
      })()}
    </div>
  );
});
