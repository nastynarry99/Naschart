import type { UTCTimestamp } from 'lightweight-charts';

export type Timeframe =
  | '1s'
  | '5s'
  | '15s'
  | '30s'
  | '1m'
  | '2m'
  | '3m'
  | '4m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '3h'
  | '4h'
  | '1d'
  | '1w'
  | '1M';

export const TIMEFRAMES: Timeframe[] = [
  '1s',
  '5s',
  '15s',
  '30s',
  '1m',
  '2m',
  '3m',
  '4m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '3h',
  '4h',
  '1d',
  '1w',
  '1M',
];

export const TIMEFRAME_GROUPS: Array<{
  label: string;
  items: Timeframe[];
}> = [
  { label: 'Seconds', items: ['1s', '5s', '15s', '30s'] },
  { label: 'Minutes', items: ['1m', '2m', '3m', '4m', '5m', '15m', '30m'] },
  { label: 'Hours', items: ['1h', '2h', '3h', '4h'] },
  { label: 'Days / Weeks / Months', items: ['1d', '1w', '1M'] },
];

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1s': 1,
  '5s': 5,
  '15s': 15,
  '30s': 30,
  '1m': 60,
  '2m': 120,
  '3m': 180,
  '4m': 240,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '2h': 7200,
  '3h': 10800,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
  '1M': 2592000,
};

export interface Candle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  priceChange: number;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
}

export type ThemeMode = 'light' | 'dark';

export interface ChartAppearance {
  theme: ThemeMode;
  upColor: string;
  downColor: string;
  upWickColor: string;
  downWickColor: string;
  backgroundColor: string;
  finnhubApiKey?: string;
  showExecutions?: boolean;
}

export const DEFAULT_LIGHT_APPEARANCE: ChartAppearance = {
  theme: 'light',
  upColor: '#5b9cf6',
  downColor: '#0c3299',
  upWickColor: '#5b9cf6',
  downWickColor: '#0c3299',
  backgroundColor: '#ffffff',
  finnhubApiKey: '',
  showExecutions: true,
};

export const DEFAULT_DARK_APPEARANCE: ChartAppearance = {
  theme: 'dark',
  upColor: '#5b9cf6',
  downColor: '#0c3299',
  upWickColor: '#5b9cf6',
  downWickColor: '#0c3299',
  backgroundColor: '#131722',
  finnhubApiKey: '',
  showExecutions: true,
};

export type LayoutCount = 1 | 2 | 3 | 4;

export type LayoutPresetId =
  | '1-single'
  | '2-vertical'
  | '2-horizontal'
  | '3-cols'
  | '3-rows'
  | '3-left1-right2'
  | '3-left2-right1'
  | '3-top1-bottom2'
  | '3-top2-bottom1'
  | '4-grid'
  | '4-rows'
  | '4-cols'
  | '4-left1-right3'
  | '4-left3-right1'
  | '4-top1-bottom3'
  | '4-top3-bottom1'
  | '4-1-1-2'
  | '4-2-1-1'
  | '4-top2-bottom2';

export interface LayoutSyncOptions {
  symbol: boolean;
  interval: boolean;
  crosshair: boolean;
  time: boolean;
  dateRange: boolean;
}

export const DEFAULT_LAYOUT_SYNC: LayoutSyncOptions = {
  symbol: false,
  interval: false,
  crosshair: false,
  time: false,
  dateRange: false,
};

export interface LayoutPresetMeta {
  id: LayoutPresetId;
  count: LayoutCount;
  label: string;
  gridClass: string;
  paneClasses: string[];
  /** Normalized cells [x, y, w, h] out of 100 for miniature wireframe SVG icon */
  cells: Array<[number, number, number, number]>;
}

export const LAYOUT_GROUPS: Array<{
  count: LayoutCount;
  items: LayoutPresetMeta[];
}> = [
  {
    count: 1,
    items: [
      {
        id: '1-single',
        count: 1,
        label: 'Single chart',
        gridClass: 'grid-cols-1 grid-rows-1',
        paneClasses: [''],
        cells: [[0, 0, 100, 100]],
      },
    ],
  },
  {
    count: 2,
    items: [
      {
        id: '2-vertical',
        count: 2,
        label: '2 Vertical side-by-side',
        gridClass: 'grid-cols-2 grid-rows-1',
        paneClasses: ['', ''],
        cells: [
          [0, 0, 50, 100],
          [50, 0, 50, 100],
        ],
      },
      {
        id: '2-horizontal',
        count: 2,
        label: '2 Horizontal stacked',
        gridClass: 'grid-cols-1 grid-rows-2',
        paneClasses: ['', ''],
        cells: [
          [0, 0, 100, 50],
          [0, 50, 100, 50],
        ],
      },
    ],
  },
  {
    count: 3,
    items: [
      {
        id: '3-cols',
        count: 3,
        label: '3 Vertical columns',
        gridClass: 'grid-cols-3 grid-rows-1',
        paneClasses: ['', '', ''],
        cells: [
          [0, 0, 33.33, 100],
          [33.33, 0, 33.34, 100],
          [66.67, 0, 33.33, 100],
        ],
      },
      {
        id: '3-rows',
        count: 3,
        label: '3 Horizontal rows',
        gridClass: 'grid-cols-1 grid-rows-3',
        paneClasses: ['', '', ''],
        cells: [
          [0, 0, 100, 33.33],
          [0, 33.33, 100, 33.34],
          [0, 66.67, 100, 33.33],
        ],
      },
      {
        id: '3-left1-right2',
        count: 3,
        label: '1 Left + 2 Right',
        gridClass: 'grid-cols-2 grid-rows-2',
        paneClasses: [
          'col-start-1 row-start-1 row-span-2',
          'col-start-2 row-start-1',
          'col-start-2 row-start-2',
        ],
        cells: [
          [0, 0, 50, 100],
          [50, 0, 50, 50],
          [50, 50, 50, 50],
        ],
      },
      {
        id: '3-left2-right1',
        count: 3,
        label: '2 Left + 1 Right',
        gridClass: 'grid-cols-2 grid-rows-2',
        paneClasses: [
          'col-start-1 row-start-1',
          'col-start-1 row-start-2',
          'col-start-2 row-start-1 row-span-2',
        ],
        cells: [
          [0, 0, 50, 50],
          [0, 50, 50, 50],
          [50, 0, 50, 100],
        ],
      },
      {
        id: '3-top1-bottom2',
        count: 3,
        label: '1 Top + 2 Bottom',
        gridClass: 'grid-cols-2 grid-rows-2',
        paneClasses: [
          'col-start-1 col-span-2 row-start-1',
          'col-start-1 row-start-2',
          'col-start-2 row-start-2',
        ],
        cells: [
          [0, 0, 100, 50],
          [0, 50, 50, 50],
          [50, 50, 50, 50],
        ],
      },
      {
        id: '3-top2-bottom1',
        count: 3,
        label: '2 Top + 1 Bottom',
        gridClass: 'grid-cols-2 grid-rows-2',
        paneClasses: [
          'col-start-1 row-start-1',
          'col-start-2 row-start-1',
          'col-start-1 col-span-2 row-start-2',
        ],
        cells: [
          [0, 0, 50, 50],
          [50, 0, 50, 50],
          [0, 50, 100, 50],
        ],
      },
    ],
  },
  {
    count: 4,
    items: [
      {
        id: '4-grid',
        count: 4,
        label: '2×2 Grid',
        gridClass: 'grid-cols-2 grid-rows-2',
        paneClasses: [
          'col-start-1 row-start-1',
          'col-start-2 row-start-1',
          'col-start-1 row-start-2',
          'col-start-2 row-start-2',
        ],
        cells: [
          [0, 0, 50, 50],
          [50, 0, 50, 50],
          [0, 50, 50, 50],
          [50, 50, 50, 50],
        ],
      },
      {
        id: '4-rows',
        count: 4,
        label: '4 Horizontal rows',
        gridClass: 'grid-cols-1 grid-rows-4',
        paneClasses: ['', '', '', ''],
        cells: [
          [0, 0, 100, 25],
          [0, 25, 100, 25],
          [0, 50, 100, 25],
          [0, 75, 100, 25],
        ],
      },
      {
        id: '4-cols',
        count: 4,
        label: '4 Vertical columns',
        gridClass: 'grid-cols-4 grid-rows-1',
        paneClasses: ['', '', '', ''],
        cells: [
          [0, 0, 25, 100],
          [25, 0, 25, 100],
          [50, 0, 25, 100],
          [75, 0, 25, 100],
        ],
      },
      {
        id: '4-left1-right3',
        count: 4,
        label: '1 Left + 3 Right',
        gridClass: 'grid-cols-2 grid-rows-3',
        paneClasses: [
          'col-start-1 row-start-1 row-span-3',
          'col-start-2 row-start-1',
          'col-start-2 row-start-2',
          'col-start-2 row-start-3',
        ],
        cells: [
          [0, 0, 50, 100],
          [50, 0, 50, 33.33],
          [50, 33.33, 50, 33.34],
          [50, 66.67, 50, 33.33],
        ],
      },
      {
        id: '4-left3-right1',
        count: 4,
        label: '3 Left + 1 Right',
        gridClass: 'grid-cols-2 grid-rows-3',
        paneClasses: [
          'col-start-1 row-start-1',
          'col-start-1 row-start-2',
          'col-start-1 row-start-3',
          'col-start-2 row-start-1 row-span-3',
        ],
        cells: [
          [0, 0, 50, 33.33],
          [0, 33.33, 50, 33.34],
          [0, 66.67, 50, 33.33],
          [50, 0, 50, 100],
        ],
      },
      {
        id: '4-top1-bottom3',
        count: 4,
        label: '1 Top + 3 Bottom',
        gridClass: 'grid-cols-3 grid-rows-2',
        paneClasses: [
          'col-start-1 col-span-3 row-start-1',
          'col-start-1 row-start-2',
          'col-start-2 row-start-2',
          'col-start-3 row-start-2',
        ],
        cells: [
          [0, 0, 100, 50],
          [0, 50, 33.33, 50],
          [33.33, 50, 33.34, 50],
          [66.67, 50, 33.33, 50],
        ],
      },
      {
        id: '4-top3-bottom1',
        count: 4,
        label: '3 Top + 1 Bottom',
        gridClass: 'grid-cols-3 grid-rows-2',
        paneClasses: [
          'col-start-1 row-start-1',
          'col-start-2 row-start-1',
          'col-start-3 row-start-1',
          'col-start-1 col-span-3 row-start-2',
        ],
        cells: [
          [0, 0, 33.33, 50],
          [33.33, 0, 33.34, 50],
          [66.67, 0, 33.33, 50],
          [0, 50, 100, 50],
        ],
      },
      {
        id: '4-1-1-2',
        count: 4,
        label: '1 Left + 1 Middle + 2 Right',
        gridClass: 'grid-cols-3 grid-rows-2',
        paneClasses: [
          'col-start-1 row-start-1 row-span-2',
          'col-start-2 row-start-1 row-span-2',
          'col-start-3 row-start-1',
          'col-start-3 row-start-2',
        ],
        cells: [
          [0, 0, 33.33, 100],
          [33.33, 0, 33.34, 100],
          [66.67, 0, 33.33, 50],
          [66.67, 50, 33.33, 50],
        ],
      },
      {
        id: '4-2-1-1',
        count: 4,
        label: '2 Left + 1 Middle + 1 Right',
        gridClass: 'grid-cols-3 grid-rows-2',
        paneClasses: [
          'col-start-1 row-start-1',
          'col-start-1 row-start-2',
          'col-start-2 row-start-1 row-span-2',
          'col-start-3 row-start-1 row-span-2',
        ],
        cells: [
          [0, 0, 33.33, 50],
          [0, 50, 33.33, 50],
          [33.33, 0, 33.34, 100],
          [66.67, 0, 33.33, 100],
        ],
      },
      {
        id: '4-top2-bottom2',
        count: 4,
        label: '2 Top + 2 Bottom split',
        gridClass: 'grid-cols-12 grid-rows-2',
        paneClasses: [
          'col-start-1 col-span-7 row-start-1',
          'col-start-8 col-span-5 row-start-1',
          'col-start-1 col-span-5 row-start-2',
          'col-start-6 col-span-7 row-start-2',
        ],
        cells: [
          [0, 0, 58, 50],
          [58, 0, 42, 50],
          [0, 50, 42, 50],
          [42, 50, 58, 50],
        ],
      },
    ],
  },
];

export const ALL_LAYOUT_PRESETS: LayoutPresetMeta[] = LAYOUT_GROUPS.flatMap((g) => g.items);

export function getLayoutPresetMeta(id: LayoutPresetId): LayoutPresetMeta {
  return ALL_LAYOUT_PRESETS.find((item) => item.id === id) ?? LAYOUT_GROUPS[0].items[0];
}

export function normalizeLegacyLayoutPreset(raw: unknown): LayoutPresetId {
  if (typeof raw === 'string' && ALL_LAYOUT_PRESETS.some((p) => p.id === raw)) {
    return raw as LayoutPresetId;
  }
  if (raw === 2) return '2-vertical';
  if (raw === 3) return '3-left1-right2';
  if (raw === 4) return '4-grid';
  return '1-single';
}

export type IndicatorId = 'volume' | 'ema20' | 'ema50' | 'sma20' | 'bb' | 'rsi14';

export type DrawingTool =
  | 'cursor'
  // Lines
  | 'trendline'
  | 'ray'
  | 'infoLine'
  | 'extendedLine'
  | 'horizontal'
  | 'horizontalRay'
  | 'vertical'
  | 'crossLine'
  // Fib & Gann
  | 'fibRetracement'
  | 'fibChannel'
  | 'pitchfork'
  // Projection & Risk/Reward
  | 'long'
  | 'short'
  | 'priceRange'
  | 'datePriceRange'
  | 'barsPattern'
  // Geometric Shapes
  | 'rectangle'
  | 'rotatedRectangle'
  | 'ellipse'
  | 'triangle'
  | 'parallelChannel'
  // Annotation & Brushes
  | 'brush'
  | 'highlighter'
  | 'arrow'
  | 'text'
  | 'priceLabel'
  | 'callout'
  // Measurement
  | 'measure'
  | 'contractRuler';

export type DrawingCategory =
  | 'Lines'
  | 'Fib & Gann'
  | 'Projection & Risk/Reward'
  | 'Geometric Shapes'
  | 'Annotation & Brushes'
  | 'Measurement';

export interface DrawingToolMeta {
  id: DrawingTool;
  name: string;
  shortName: string;
  category: DrawingCategory;
  pointsNeeded: 1 | 2 | 3 | 'freehand';
}

export const DRAWING_TOOLS_CATALOG: DrawingToolMeta[] = [
  // Lines
  { id: 'trendline', name: 'Trendline', shortName: 'Trend', category: 'Lines', pointsNeeded: 2 },
  { id: 'ray', name: 'Ray', shortName: 'Ray', category: 'Lines', pointsNeeded: 2 },
  { id: 'infoLine', name: 'Info Line', shortName: 'Info', category: 'Lines', pointsNeeded: 2 },
  { id: 'extendedLine', name: 'Extended Line', shortName: 'Ext', category: 'Lines', pointsNeeded: 2 },
  { id: 'horizontal', name: 'Horizontal Line', shortName: 'H-Line', category: 'Lines', pointsNeeded: 1 },
  { id: 'horizontalRay', name: 'Horizontal Ray', shortName: 'H-Ray', category: 'Lines', pointsNeeded: 1 },
  { id: 'vertical', name: 'Vertical Line', shortName: 'V-Line', category: 'Lines', pointsNeeded: 1 },
  { id: 'crossLine', name: 'Cross Line', shortName: 'Cross', category: 'Lines', pointsNeeded: 1 },

  // Fib & Gann
  { id: 'fibRetracement', name: 'Fib Retracement', shortName: 'Fib', category: 'Fib & Gann', pointsNeeded: 2 },
  { id: 'fibChannel', name: 'Fib Channel', shortName: 'Fib Ch', category: 'Fib & Gann', pointsNeeded: 2 },
  { id: 'pitchfork', name: "Andrews' Pitchfork", shortName: 'Pitchfork', category: 'Fib & Gann', pointsNeeded: 3 },

  // Projection & Risk/Reward
  { id: 'long', name: 'Long Position', shortName: 'Long', category: 'Projection & Risk/Reward', pointsNeeded: 2 },
  { id: 'short', name: 'Short Position', shortName: 'Short', category: 'Projection & Risk/Reward', pointsNeeded: 2 },
  { id: 'priceRange', name: 'Price Range', shortName: 'P-Range', category: 'Projection & Risk/Reward', pointsNeeded: 2 },
  { id: 'datePriceRange', name: 'Date & Price Range', shortName: 'D&P', category: 'Projection & Risk/Reward', pointsNeeded: 2 },
  { id: 'barsPattern', name: 'Bars Pattern', shortName: 'Bars', category: 'Projection & Risk/Reward', pointsNeeded: 2 },

  // Geometric Shapes
  { id: 'rectangle', name: 'Rectangle', shortName: 'Rect', category: 'Geometric Shapes', pointsNeeded: 2 },
  { id: 'rotatedRectangle', name: 'Rotated Rectangle', shortName: 'Rot Rect', category: 'Geometric Shapes', pointsNeeded: 3 },
  { id: 'ellipse', name: 'Circle / Ellipse', shortName: 'Ellipse', category: 'Geometric Shapes', pointsNeeded: 2 },
  { id: 'triangle', name: 'Triangle', shortName: 'Triangle', category: 'Geometric Shapes', pointsNeeded: 3 },
  { id: 'parallelChannel', name: 'Parallel Channel', shortName: 'Channel', category: 'Geometric Shapes', pointsNeeded: 3 },

  // Annotation & Brushes
  { id: 'brush', name: 'Brush', shortName: 'Brush', category: 'Annotation & Brushes', pointsNeeded: 'freehand' },
  { id: 'highlighter', name: 'Highlighter', shortName: 'Highlt', category: 'Annotation & Brushes', pointsNeeded: 'freehand' },
  { id: 'arrow', name: 'Arrow Marker', shortName: 'Arrow', category: 'Annotation & Brushes', pointsNeeded: 2 },
  { id: 'text', name: 'Text Note', shortName: 'Text', category: 'Annotation & Brushes', pointsNeeded: 1 },
  { id: 'priceLabel', name: 'Price Label', shortName: 'P-Label', category: 'Annotation & Brushes', pointsNeeded: 1 },
  { id: 'callout', name: 'Callout', shortName: 'Callout', category: 'Annotation & Brushes', pointsNeeded: 2 },

  // Measurement
  { id: 'measure', name: 'Measure Ruler', shortName: 'Ruler', category: 'Measurement', pointsNeeded: 2 },
  { id: 'contractRuler', name: 'Contract Size Ruler', shortName: 'Lot Size', category: 'Measurement', pointsNeeded: 2 },
];

export const DEFAULT_PINNED_TOOLS: DrawingTool[] = [
  'trendline',
  'horizontal',
  'fibRetracement',
  'long',
  'short',
  'rectangle',
  'measure',
  'contractRuler',
];

export interface ChartPoint {
  time: UTCTimestamp;
  price: number;
}

export type DrawingLineStyle = 'solid' | 'dashed' | 'dotted';

export interface BaseDrawing {
  id: string;
  color: string;
  fillColor?: string;
  opacity?: number;
  lineWidth: number;
  lineStyle?: DrawingLineStyle;
  label?: string;
}

export type DrawingObject =
  | (BaseDrawing & {
      type: 'trendline' | 'ray' | 'infoLine' | 'extendedLine' | 'arrow';
      p1: ChartPoint;
      p2: ChartPoint;
    })
  | (BaseDrawing & {
      type: 'horizontal';
      p1: ChartPoint;
    })
  | (BaseDrawing & {
      type: 'horizontalRay' | 'vertical' | 'crossLine' | 'priceLabel';
      p1: ChartPoint;
    })
  | (BaseDrawing & {
      type: 'text';
      p1: ChartPoint;
      text: string;
    })
  | (BaseDrawing & {
      type: 'callout';
      p1: ChartPoint;
      p2: ChartPoint;
      text: string;
    })
  | (BaseDrawing & {
      type: 'fibRetracement' | 'fibChannel' | 'priceRange' | 'datePriceRange' | 'barsPattern' | 'rectangle' | 'ellipse' | 'measure';
      p1: ChartPoint;
      p2: ChartPoint;
      barsOffsets?: Array<{ dt: number; dOpen: number; dHigh: number; dLow: number; dClose: number }>;
    })
  | (BaseDrawing & {
      type: 'pitchfork' | 'rotatedRectangle' | 'triangle' | 'parallelChannel';
      p1: ChartPoint;
      p2: ChartPoint;
      p3: ChartPoint;
    })
  | (BaseDrawing & {
      type: 'long' | 'short';
      startTime: UTCTimestamp;
      endTime: UTCTimestamp;
      entryPrice: number;
      tpPrice: number;
      slPrice: number;
      riskMode?: 'usd' | 'percent';
      riskValue?: number;
      accountBalance?: number;
      pointValue?: number;
      tickSize?: number;
    })
  | (BaseDrawing & {
      type: 'contractRuler';
      p1: ChartPoint;
      p2: ChartPoint;
      riskMode?: 'usd' | 'percent';
      riskValue?: number;
      accountBalance?: number;
      pointValue?: number;
    })
  | (BaseDrawing & {
      type: 'brush' | 'highlighter';
      points: ChartPoint[];
    });

export interface DrawingToolPreset {
  color?: string;
  fillColor?: string;
  hasCustomFillColor?: boolean;
  opacity?: number;
  lineWidth?: number;
  lineStyle?: DrawingLineStyle;
  riskMode?: 'usd' | 'percent';
  riskValue?: number;
  accountBalance?: number;
}

export type DrawingToolPresetsMap = Partial<Record<DrawingTool, DrawingToolPreset>>;

export interface SymbolContractOverride {
  pointValue?: number;
  tickSize?: number;
}

export interface PaneConfig {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  indicators: IndicatorId[];
  drawings: DrawingObject[];
  magnetMode?: boolean;
  lockedDrawings?: boolean;
  hiddenDrawings?: boolean;
}

export type ReplaySpeed = 0.5 | 1 | 2 | 5;

export interface ReplayState {
  active: boolean;
  selectingStart: boolean;
  playing: boolean;
  speed: ReplaySpeed;
  currentIndex: number;
  totalCandles: number;
  currentTime?: number;
  syncing?: boolean;
  timeframeSync: boolean;
}

export type AssetCategory = 'Futures' | 'Stocks' | 'Crypto';

export const ASSET_CATEGORIES: AssetCategory[] = ['Futures', 'Stocks', 'Crypto'];

export interface SymbolMeta {
  symbol: string;
  displayName: string;
  category: AssetCategory;
  exchange: string;
  finnhubSymbol?: string;
}

export const SYMBOL_CATALOG: SymbolMeta[] = [
  // Futures
  { symbol: 'NQ1!', displayName: 'E-Mini Nasdaq Futures', category: 'Futures', exchange: 'CME', finnhubSymbol: 'QQQ' },
  { symbol: 'ES1!', displayName: 'E-Mini S&P 500 Futures', category: 'Futures', exchange: 'CME', finnhubSymbol: 'SPY' },
  { symbol: 'YM1!', displayName: 'Mini Dow Futures', category: 'Futures', exchange: 'CBOT', finnhubSymbol: 'DIA' },
  { symbol: 'CL1!', displayName: 'Crude Oil Futures', category: 'Futures', exchange: 'NYMEX', finnhubSymbol: 'USO' },

  // Stocks
  { symbol: 'AAPL', displayName: 'Apple Inc.', category: 'Stocks', exchange: 'NASDAQ', finnhubSymbol: 'AAPL' },
  { symbol: 'NVDA', displayName: 'NVIDIA Corp.', category: 'Stocks', exchange: 'NASDAQ', finnhubSymbol: 'NVDA' },
  { symbol: 'TSLA', displayName: 'Tesla Inc.', category: 'Stocks', exchange: 'NASDAQ', finnhubSymbol: 'TSLA' },
  { symbol: 'MSFT', displayName: 'Microsoft Corp.', category: 'Stocks', exchange: 'NASDAQ', finnhubSymbol: 'MSFT' },
  { symbol: 'AMZN', displayName: 'Amazon.com Inc.', category: 'Stocks', exchange: 'NASDAQ', finnhubSymbol: 'AMZN' },

  // Crypto
  { symbol: 'BTCUSDT', displayName: 'Bitcoin / TetherUS', category: 'Crypto', exchange: 'BINANCE' },
  { symbol: 'ETHUSDT', displayName: 'Ethereum / TetherUS', category: 'Crypto', exchange: 'BINANCE' },
  { symbol: 'SOLUSDT', displayName: 'Solana / TetherUS', category: 'Crypto', exchange: 'BINANCE' },
  { symbol: 'BNBUSDT', displayName: 'BNB / TetherUS', category: 'Crypto', exchange: 'BINANCE' },
];

export interface SymbolContractSpec {
  category: AssetCategory;
  pointValue: number;
  tickSize: number;
  minQty: number;
  qtyStep: number;
  isIntegerOnly: boolean;
  unitLabel: 'Contracts' | 'Shares' | 'Qty';
}

export const SYMBOL_CONTRACT_SPECS: Record<string, SymbolContractSpec> = {
  'NQ1!': {
    category: 'Futures',
    pointValue: 20,
    tickSize: 0.25,
    minQty: 1,
    qtyStep: 1,
    isIntegerOnly: true,
    unitLabel: 'Contracts',
  },
  'ES1!': {
    category: 'Futures',
    pointValue: 50,
    tickSize: 0.25,
    minQty: 1,
    qtyStep: 1,
    isIntegerOnly: true,
    unitLabel: 'Contracts',
  },
  'YM1!': {
    category: 'Futures',
    pointValue: 5,
    tickSize: 1,
    minQty: 1,
    qtyStep: 1,
    isIntegerOnly: true,
    unitLabel: 'Contracts',
  },
  'CL1!': {
    category: 'Futures',
    pointValue: 1000,
    tickSize: 0.01,
    minQty: 1,
    qtyStep: 1,
    isIntegerOnly: true,
    unitLabel: 'Contracts',
  },
};

export const DEFAULT_WATCHLIST: string[] = [
  'NQ1!',
  'ES1!',
  'YM1!',
  'CL1!',
  'AAPL',
  'NVDA',
  'TSLA',
  'MSFT',
  'AMZN',
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
];

export type TradeMode = 'Live' | 'Replay';
export type OrderExitReason = 'Manual' | 'TP' | 'SL' | 'Partial';
export type PendingOrderType = 'limit' | 'stop';

export interface PendingPaperOrder {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  orderType: PendingOrderType;
  qty: number;
  targetPrice: number;
  createdAtCandleTime: number;
  tpPrice?: number;
  slPrice?: number;
  pointValue: number;
  leverage: number;
  mode: TradeMode;
  createdAt: number;
}

export interface PaperPosition {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  entryPrice: number;
  entryTime: number; // Unix seconds (Replay candle time when in Replay, else wall clock)
  openedAtCandleTime: number; // Candle timestamp at open to avoid instant same-bar TP/SL trigger
  tpPrice?: number;
  slPrice?: number;
  pointValue: number;
  leverage: number;
  mode: TradeMode;
}

export interface PaperTrade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: number; // Unix seconds
  exitTime: number; // Unix seconds
  realizedPnl: number;
  realizedPnlPct: number;
  pointValue: number;
  mode: TradeMode;
  exitReason: OrderExitReason;
  notes?: string;
  tags?: string[];
}

export interface PaperAccountState {
  startingBalance: number;
  balance: number; // startingBalance + sum(realizedPnl)
  positions: PaperPosition[];
  closedTrades: PaperTrade[];
  pendingOrders?: PendingPaperOrder[];
}

export interface NamedPaperAccount {
  id: string;
  name: string;
  createdAt: number;
  account: PaperAccountState;
}

export interface LivePaperAccountsState {
  activeAccountId: string;
  accounts: NamedPaperAccount[];
}

export const DEFAULT_STARTING_BALANCE = 100000;

export const PRESET_ACCOUNT_BALANCES = [10000, 25000, 50000, 100000];

export const STRATEGY_TAG_PRESETS = [
  'Breakout',
  'Pullback',
  'Trend Follow',
  'Liquidity Sweep',
  'Reversal',
  'Scalp',
  'Range',
];

export type AlertSoundOption =
  | 'classic_bell'
  | 'digital_chime'
  | 'sonar_ping'
  | 'double_beep'
  | 'cash_register'
  | 'silent';

export const ALERT_SOUND_OPTIONS: Array<{
  id: AlertSoundOption;
  label: string;
  description: string;
}> = [
  { id: 'classic_bell', label: 'Classic Bell', description: 'Warm harmonic resonance' },
  { id: 'digital_chime', label: 'Digital Chime', description: 'Crisp rising triad' },
  { id: 'sonar_ping', label: 'Sonar Ping', description: 'Clean radar pulse echo' },
  { id: 'double_beep', label: 'Double Beep', description: 'Sharp dual terminal tone' },
  { id: 'cash_register', label: 'Cash Register', description: 'Mechanical bell cha-ching' },
  { id: 'silent', label: 'Silent', description: 'Visual alert banner only' },
];

export type PriceAlertCondition = 'crossing' | 'crossing_up' | 'crossing_down';

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: PriceAlertCondition;
  note?: string;
  active: boolean;
  repeat: boolean;
  createdAt: number;
  triggeredAt?: number;
  triggeredPrice?: number;
}
