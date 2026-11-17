import type { UTCTimestamp } from 'lightweight-charts';
import {
  ArrowLeftRight,
  Bell,
  BellRing,
  BookOpen,
  History,
  Settings,
  Wallet,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomBar, type ActiveSheet } from './components/BottomBar';
import {
  ChartPane,
  type ChartPaneHandle,
  type PlacePaperOrderRequest,
  type PlacePendingOrderRequest,
} from './components/ChartPane';
import { DrawingDock } from './components/DrawingDock';
import { DrawingToolsDrawer } from './components/DrawingToolsDrawer';
import { LayoutPreviewIcon, LayoutSheetModal } from './components/LayoutSheetModal';
import {
  GoToDateModal,
  IndicatorsModal,
  MenuModal,
  SettingsModal,
  SymbolSearchModal,
  TimeframeModal,
  WatchlistModal,
} from './components/Modals';
import { PaperTradingModal } from './components/PaperTradingModal';
import { PriceAlertsModal } from './components/PriceAlertsModal';
import { ReplayBar, type ReplayJumpRequest } from './components/ReplayBar';
import { ResizableLayoutGrid } from './components/ResizableLayoutGrid';
import { TradingJournalModal } from './components/TradingJournalModal';
import {
  ALERT_SOUND_OPTIONS,
  DEFAULT_LAYOUT_SYNC,
  DEFAULT_LIGHT_APPEARANCE,
  DEFAULT_PINNED_TOOLS,
  DEFAULT_STARTING_BALANCE,
  DEFAULT_WATCHLIST,
  getLayoutPresetMeta,
  normalizeLegacyLayoutPreset,
  type AlertSoundOption,
  type Candle,
  type ChartAppearance,
  type DrawingObject,
  type DrawingTool,
  type DrawingToolPreset,
  type DrawingToolPresetsMap,
  type IndicatorId,
  type LayoutCount,
  type LayoutPresetId,
  type LayoutSyncOptions,
  type LivePaperAccountsState,
  type NamedPaperAccount,
  type PaneConfig,
  type PaperAccountState,
  type PaperPosition,
  type PaperTrade,
  type PendingOrderType,
  type PendingPaperOrder,
  type PriceAlert,
  type PriceAlertCondition,
  type ReplaySpeed,
  type ReplayState,
  type SymbolContractOverride,
  type Timeframe,
  type TradeMode,
} from './types/trading';
import { formatPrice, syncLiveApiCredentials } from './services/binance';
import { bindAudioUnlockListeners, playAlertSound, unlockAlertAudio } from './utils/alertSound';
import {
  DEFAULT_PAPER_LEVERAGE,
  calculateAccountOverview,
  calculatePositionMetrics,
  calculateRequiredNettingMargin,
  executeNettingOrderFill,
  formatSignedUsd,
  formatUsd,
  getSymbolContractSpec,
  sanitizeOrderQty,
  type NettingFillInput,
  type NettingFillResult,
} from './utils/paperTrading';

const STORAGE_KEYS = {
  appearance: 'tv_mobile_appearance_v2',
  layout: 'tv_mobile_layout_v2',
  layoutSync: 'tv_mobile_layout_sync_v1',
  showBuySellPanel: 'tv_mobile_show_buysell_v1',
  showFavoritesToolbar: 'tv_mobile_show_favbar_v1',
  panes: 'tv_mobile_panes_v2',
  drawingsBySymbol: 'tv_mobile_drawings_by_symbol_v1',
  drawingToolPresets: 'tv_mobile_drawing_tool_presets_v1',
  contractOverridesBySymbol: 'tv_mobile_contract_overrides_v1',
  watchlist: 'tv_mobile_watchlist_v2',
  pinnedTools: 'tv_mobile_pinned_tools_v2',
  livePaperAccount: 'tv_live_paper_account_v1',
  livePaperAccounts: 'tv_live_paper_accounts_v2',
  replayPaperAccount: 'tv_replay_paper_account_v1',
  priceAlerts: 'tv_mobile_price_alerts_v1',
  alertSound: 'tv_mobile_alert_sound_v1',
};

const createFreshPaperAccount = (startingBalance = DEFAULT_STARTING_BALANCE): PaperAccountState => ({
  startingBalance,
  balance: startingBalance,
  positions: [],
  closedTrades: [],
  pendingOrders: [],
});

const DEFAULT_PAPER_ACCOUNT: PaperAccountState = createFreshPaperAccount(DEFAULT_STARTING_BALANCE);

const DEFAULT_PANES: PaneConfig[] = [
  { id: 'pane-1', symbol: 'BTCUSDT', timeframe: '1s', indicators: ['volume'], drawings: [] },
  { id: 'pane-2', symbol: 'NQ1!', timeframe: '5m', indicators: ['volume'], drawings: [] },
  { id: 'pane-3', symbol: 'NVDA', timeframe: '15m', indicators: ['volume'], drawings: [] },
  { id: 'pane-4', symbol: 'ES1!', timeframe: '1h', indicators: ['volume'], drawings: [] },
];

const REMOVED_INDEX_REPLACEMENTS: Record<string, string> = {
  NAS100: 'NQ1!',
  SPX500: 'ES1!',
  US30: 'YM1!',
  UK100: 'CL1!',
};

const QUICK_DESKTOP_TIMEFRAMES: Timeframe[] = [
  '1s',
  '5s',
  '15s',
  '1m',
  '5m',
  '15m',
  '1h',
  '4h',
  '1d',
  '1w',
  '1M',
];

function applyCandleToAccount(
  account: PaperAccountState,
  symbol: string,
  candle: Candle,
  isReplay: boolean
): {
  nextAccount: PaperAccountState;
  filledCount: number;
  closedCount: number;
  lastNotice: { text: string; tone: 'green' | 'red' | 'blue' } | null;
} {
  const mode: TradeMode = isReplay ? 'Replay' : 'Live';
  const candleTime = Number(candle.time);
  const execTime = isReplay ? candleTime : Math.floor(Date.now() / 1000);
  let working: PaperAccountState = account;
  let filledCount = 0;
  let closedCount = 0;
  let lastNotice: { text: string; tone: 'green' | 'red' | 'blue' } | null = null;

  const pendingList = working.pendingOrders ?? [];
  const filledIds = new Set<string>();
  for (const ord of pendingList) {
    if (ord.symbol !== symbol || ord.mode !== mode) continue;
    const isSubsequentBar = candleTime > ord.createdAtCandleTime;
    if (isReplay && !isSubsequentBar) continue;

    const checkHigh = isSubsequentBar ? candle.high : candle.close;
    const checkLow = isSubsequentBar ? candle.low : candle.close;

    const triggered =
      ord.side === 'long'
        ? ord.orderType === 'limit'
          ? checkLow <= ord.targetPrice
          : checkHigh >= ord.targetPrice
        : ord.orderType === 'limit'
        ? checkHigh >= ord.targetPrice
        : checkLow <= ord.targetPrice;

    if (triggered) {
      filledIds.add(ord.id);
    }
  }

  if (filledIds.size > 0) {
    const ordersToFill = pendingList.filter((o) => filledIds.has(o.id));
    working = {
      ...working,
      pendingOrders: pendingList.filter((o) => !filledIds.has(o.id)),
    };

    for (const ord of ordersToFill) {
      const res = executeNettingOrderFill(working, {
        symbol: ord.symbol,
        side: ord.side,
        qty: ord.qty,
        price: ord.targetPrice,
        fillTime: execTime,
        candleTime,
        tpPrice: ord.tpPrice,
        slPrice: ord.slPrice,
        pointValue: ord.pointValue,
        leverage: ord.leverage,
        mode: ord.mode,
      });
      working = res.nextAccount;
      filledCount += 1;

      const sideLabel = ord.side === 'long' ? 'BUY' : 'SELL';
      if (res.action === 'partial_closed') {
        lastNotice = {
          text: `${ord.mode} ${ord.orderType.toUpperCase()} Partial Close ${res.closedQty} ${ord.symbol} (${formatSignedUsd(res.realizedPnl)})`,
          tone: res.realizedPnl >= 0 ? 'green' : 'red',
        };
      } else if (res.action === 'closed') {
        lastNotice = {
          text: `${ord.mode} ${ord.orderType.toUpperCase()} Closed ${ord.symbol} (${formatSignedUsd(res.realizedPnl)})`,
          tone: res.realizedPnl >= 0 ? 'green' : 'red',
        };
      } else if (res.action === 'reversed') {
        lastNotice = {
          text: `${ord.mode} ${ord.orderType.toUpperCase()} Reversed ${ord.symbol} (${formatSignedUsd(res.realizedPnl)}) -> ${sideLabel} ${res.resultingPos?.qty ?? ord.qty}`,
          tone: ord.side === 'long' ? 'blue' : 'red',
        };
      } else if (res.action === 'added') {
        lastNotice = {
          text: `${ord.mode} ${ord.orderType.toUpperCase()} Added ${ord.qty} ${ord.symbol} @ Avg ${formatPrice(res.resultingPos?.entryPrice ?? ord.targetPrice)}`,
          tone: ord.side === 'long' ? 'blue' : 'red',
        };
      } else {
        lastNotice = {
          text: `${ord.mode} ${sideLabel} ${ord.orderType.toUpperCase()} Filled @ ${formatPrice(ord.targetPrice)}`,
          tone: ord.side === 'long' ? 'blue' : 'red',
        };
      }
    }
  }

  if (working.positions.length > 0) {
    let nextBalance = working.balance;
    const remaining: PaperPosition[] = [];
    const newlyClosed: PaperTrade[] = [];

    for (const pos of working.positions) {
      if (pos.symbol !== symbol || pos.mode !== mode) {
        remaining.push(pos);
        continue;
      }

      const isSubsequentBar = candleTime > pos.openedAtCandleTime;
      if (isReplay && !isSubsequentBar) {
        remaining.push(pos);
        continue;
      }

      const checkHigh = isSubsequentBar ? candle.high : candle.close;
      const checkLow = isSubsequentBar ? candle.low : candle.close;

      let exitPrice: number | null = null;
      let exitReason: 'TP' | 'SL' | null = null;

      if (pos.side === 'long') {
        if (pos.slPrice !== undefined && checkLow <= pos.slPrice) {
          exitPrice = pos.slPrice;
          exitReason = 'SL';
        } else if (pos.tpPrice !== undefined && checkHigh >= pos.tpPrice) {
          exitPrice = pos.tpPrice;
          exitReason = 'TP';
        }
      } else {
        if (pos.slPrice !== undefined && checkHigh >= pos.slPrice) {
          exitPrice = pos.slPrice;
          exitReason = 'SL';
        } else if (pos.tpPrice !== undefined && checkLow <= pos.tpPrice) {
          exitPrice = pos.tpPrice;
          exitReason = 'TP';
        }
      }

      if (exitPrice !== null && exitReason !== null) {
        const metrics = calculatePositionMetrics(pos, exitPrice);
        nextBalance += metrics.unrealizedPnl;
        closedCount += 1;
        newlyClosed.push({
          id: `trd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          symbol: pos.symbol,
          side: pos.side,
          qty: pos.qty,
          entryPrice: pos.entryPrice,
          exitPrice,
          entryTime: pos.entryTime,
          exitTime: execTime,
          realizedPnl: metrics.unrealizedPnl,
          realizedPnlPct: metrics.unrealizedPct,
          pointValue: pos.pointValue,
          mode: pos.mode,
          exitReason,
        });
        lastNotice = {
          text: `${pos.mode} ${exitReason} Hit! ${pos.side.toUpperCase()} ${pos.symbol} (${formatSignedUsd(metrics.unrealizedPnl)})`,
          tone: metrics.unrealizedPnl >= 0 ? 'green' : 'red',
        };
      } else {
        remaining.push(pos);
      }
    }

    if (newlyClosed.length > 0) {
      working = {
        ...working,
        balance: nextBalance,
        positions: remaining,
        closedTrades: [...newlyClosed, ...working.closedTrades],
      };
    }
  }

  return { nextAccount: working, filledCount, closedCount, lastNotice };
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadIsolatedAccount(key: string, mode: TradeMode): PaperAccountState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as PaperAccountState;
      return {
        ...parsed,
        positions: parsed.positions ?? [],
        closedTrades: parsed.closedTrades ?? [],
        pendingOrders: parsed.pendingOrders ?? [],
      };
    }
    // One-time migration from legacy combined key if present
    const legacyRaw = localStorage.getItem('tv_paper_account_v1');
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as PaperAccountState;
      const positions = (legacy.positions ?? []).filter((p) => p.mode === mode);
      const closedTrades = (legacy.closedTrades ?? []).filter((t) => t.mode === mode);
      const startingBalance = legacy.startingBalance || DEFAULT_STARTING_BALANCE;
      const realizedSum = closedTrades.reduce((acc, t) => acc + t.realizedPnl, 0);
      return {
        startingBalance,
        balance: startingBalance + realizedSum,
        positions,
        closedTrades,
        pendingOrders: [],
      };
    }
  } catch {
    // Ignore corrupt storage
  }
  return DEFAULT_PAPER_ACCOUNT;
}

function loadLivePaperAccounts(): LivePaperAccountsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.livePaperAccounts);
    if (raw) {
      const parsed = JSON.parse(raw) as LivePaperAccountsState;
      if (Array.isArray(parsed?.accounts) && parsed.accounts.length > 0) {
        const sanitized = parsed.accounts.map((acc) => ({
          ...acc,
          account: {
            ...acc.account,
            positions: acc.account?.positions ?? [],
            closedTrades: acc.account?.closedTrades ?? [],
            pendingOrders: acc.account?.pendingOrders ?? [],
          },
        }));
        const activeId = sanitized.some((a) => a.id === parsed.activeAccountId)
          ? parsed.activeAccountId
          : sanitized[0].id;
        return { activeAccountId: activeId, accounts: sanitized };
      }
    }

    const legacyLiveRaw = localStorage.getItem(STORAGE_KEYS.livePaperAccount);
    if (legacyLiveRaw) {
      const migrated = loadIsolatedAccount(STORAGE_KEYS.livePaperAccount, 'Live');
      return {
        activeAccountId: 'acc-main-100k',
        accounts: [
          {
            id: 'acc-main-100k',
            name: 'Main $100k Account',
            createdAt: Date.now(),
            account: migrated,
          },
          {
            id: 'acc-funded-50k',
            name: 'Funded Challenge $50k',
            createdAt: Date.now() + 1,
            account: createFreshPaperAccount(50000),
          },
        ],
      };
    }
  } catch {
    // Ignore corrupt storage
  }

  return {
    activeAccountId: 'acc-main-100k',
    accounts: [
      {
        id: 'acc-main-100k',
        name: 'Main $100k Account',
        createdAt: Date.now(),
        account: createFreshPaperAccount(100000),
      },
      {
        id: 'acc-funded-50k',
        name: 'Funded Challenge $50k',
        createdAt: Date.now() + 1,
        account: createFreshPaperAccount(50000),
      },
    ],
  };
}

function loadAlertSound(): AlertSoundOption {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.alertSound);
    if (!raw) return 'classic_bell';
    const parsed = JSON.parse(raw);
    if (parsed === false) return 'silent';
    if (parsed === true) return 'classic_bell';
    if (
      typeof parsed === 'string' &&
      ALERT_SOUND_OPTIONS.some((opt) => opt.id === parsed)
    ) {
      return parsed as AlertSoundOption;
    }
  } catch {
    // Ignore corrupt value
  }
  return 'classic_bell';
}

function sanitizeLoadedPanes(rawPanes: PaneConfig[]): PaneConfig[] {
  if (!Array.isArray(rawPanes) || rawPanes.length !== 4) return DEFAULT_PANES;
  return rawPanes.map((p, idx) => {
    const replacement = REMOVED_INDEX_REPLACEMENTS[p.symbol?.toUpperCase?.() ?? ''];
    if (replacement) {
      return {
        ...p,
        symbol: replacement,
        drawings: [],
      };
    }
    return {
      ...DEFAULT_PANES[idx],
      ...p,
    };
  });
}

function sanitizeLoadedWatchlist(rawList: string[]): string[] {
  if (!Array.isArray(rawList) || rawList.length === 0) return DEFAULT_WATCHLIST;
  const cleaned = rawList.filter((sym) => !(sym.toUpperCase() in REMOVED_INDEX_REPLACEMENTS));
  const merged = Array.from(new Set([...cleaned, ...DEFAULT_WATCHLIST.filter((s) => !cleaned.includes(s))]));
  return cleaned.length > 0 ? cleaned : merged;
}

export default function App() {
  const [appearance, setAppearance] = useState<ChartAppearance>(() => {
    const saved = loadJson(STORAGE_KEYS.appearance, DEFAULT_LIGHT_APPEARANCE);
    if (
      saved.upColor?.toLowerCase() === '#2962ff' &&
      saved.downColor?.toLowerCase() === '#0c3299'
    ) {
      return {
        ...saved,
        upColor: '#5b9cf6',
        upWickColor:
          saved.upWickColor?.toLowerCase() === '#2962ff' ? '#5b9cf6' : saved.upWickColor,
      };
    }
    return saved;
  });
  const [layoutPreset, setLayoutPreset] = useState<LayoutPresetId>(() =>
    normalizeLegacyLayoutPreset(loadJson<unknown>(STORAGE_KEYS.layout, '1-single'))
  );
  const layoutMeta = useMemo(() => getLayoutPresetMeta(layoutPreset), [layoutPreset]);
  const layout: LayoutCount = layoutMeta.count;
  const setLayout = useCallback((count: LayoutCount) => {
    setLayoutPreset(normalizeLegacyLayoutPreset(count));
  }, []);

  const [layoutSync, setLayoutSync] = useState<LayoutSyncOptions>(() => ({
    ...DEFAULT_LAYOUT_SYNC,
    ...loadJson<Partial<LayoutSyncOptions>>(STORAGE_KEYS.layoutSync, DEFAULT_LAYOUT_SYNC),
  }));
  const [showBuySellPanel, setShowBuySellPanel] = useState<boolean>(() =>
    loadJson<boolean>(STORAGE_KEYS.showBuySellPanel, true)
  );
  const [showFavoritesToolbar, setShowFavoritesToolbar] = useState<boolean>(() =>
    loadJson<boolean>(STORAGE_KEYS.showFavoritesToolbar, true)
  );

  const [initialDrawingState] = useState<{
    panes: PaneConfig[];
    drawingsBySymbol: Record<string, DrawingObject[]>;
  }>(() => {
    const sanitizedPanes = sanitizeLoadedPanes(
      loadJson<PaneConfig[]>(STORAGE_KEYS.panes, DEFAULT_PANES)
    );
    const savedBySymbol = loadJson<Record<string, DrawingObject[]>>(
      STORAGE_KEYS.drawingsBySymbol,
      {}
    );
    const mergedBySymbol: Record<string, DrawingObject[]> =
      savedBySymbol && typeof savedBySymbol === 'object' ? { ...savedBySymbol } : {};

    // Migrate any existing pane drawings that aren't in drawingsBySymbol yet
    for (const p of sanitizedPanes) {
      if (Array.isArray(p.drawings) && p.drawings.length > 0 && !mergedBySymbol[p.symbol]) {
        mergedBySymbol[p.symbol] = p.drawings;
      }
    }

    const hydratedPanes = sanitizedPanes.map((p) => ({
      ...p,
      drawings: mergedBySymbol[p.symbol] ?? p.drawings ?? [],
    }));

    return { panes: hydratedPanes, drawingsBySymbol: mergedBySymbol };
  });

  const [panes, setPanes] = useState<PaneConfig[]>(initialDrawingState.panes);
  const [drawingsBySymbol, setDrawingsBySymbol] = useState<
    Record<string, DrawingObject[]>
  >(initialDrawingState.drawingsBySymbol);
  const [drawingToolPresets, setDrawingToolPresets] = useState<DrawingToolPresetsMap>(() =>
    loadJson<DrawingToolPresetsMap>(STORAGE_KEYS.drawingToolPresets, {})
  );
  const [contractOverridesBySymbol, setContractOverridesBySymbol] = useState<
    Record<string, SymbolContractOverride>
  >(() =>
    loadJson<Record<string, SymbolContractOverride>>(
      STORAGE_KEYS.contractOverridesBySymbol,
      {}
    )
  );
  const [watchlist, setWatchlist] = useState<string[]>(() =>
    sanitizeLoadedWatchlist(loadJson<string[]>(STORAGE_KEYS.watchlist, DEFAULT_WATCHLIST))
  );
  const [pinnedTools, setPinnedTools] = useState<DrawingTool[]>(() => {
    const loaded = loadJson<DrawingTool[]>(STORAGE_KEYS.pinnedTools, DEFAULT_PINNED_TOOLS);
    const migKey = 'tv_mobile_pinned_contract_ruler_v1';
    if (!localStorage.getItem(migKey)) {
      localStorage.setItem(migKey, '1');
      if (!loaded.includes('contractRuler')) {
        const idx = loaded.indexOf('measure');
        const next = [...loaded];
        if (idx >= 0) next.splice(idx + 1, 0, 'contractRuler');
        else next.push('contractRuler');
        return next;
      }
    }
    return loaded;
  });

  const [activePaneId, setActivePaneId] = useState<string>('pane-1');
  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const [placementHint, setPlacementHint] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null);
  const [journalInitialMode, setJournalInitialMode] = useState<TradeMode | null>(null);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);

  const [replay, setReplay] = useState<ReplayState>({
    active: false,
    selectingStart: false,
    playing: false,
    speed: 1,
    currentIndex: 0,
    totalCandles: 0,
    timeframeSync: true,
  });

  const [livePaperAccountsState, setLivePaperAccountsState] =
    useState<LivePaperAccountsState>(() => loadLivePaperAccounts());
  const activeNamedLiveAccount = useMemo(
    () =>
      livePaperAccountsState.accounts.find(
        (a) => a.id === livePaperAccountsState.activeAccountId
      ) ?? livePaperAccountsState.accounts[0],
    [livePaperAccountsState]
  );
  const livePaperAccount = activeNamedLiveAccount.account;

  const [replayPaperAccount, setReplayPaperAccount] = useState<PaperAccountState>(() =>
    loadIsolatedAccount(STORAGE_KEYS.replayPaperAccount, 'Replay')
  );
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>(() =>
    loadJson<PriceAlert[]>(STORAGE_KEYS.priceAlerts, [])
  );
  const [alertSound, setAlertSound] = useState<AlertSoundOption>(() => loadAlertSound());
  const [alertNotifications, setAlertNotifications] = useState<
    Array<{
      uid: string;
      alertId: string;
      symbol: string;
      targetPrice: number;
      triggeredPrice: number;
      condition: PriceAlertCondition;
      note?: string;
      triggeredAt: number;
    }>
  >([]);
  const [orderNotice, setOrderNotice] = useState<{
    id: number;
    text: string;
    tone: 'blue' | 'green' | 'red';
  } | null>(null);

  const paneRefs = useRef<Record<string, ChartPaneHandle | null>>({});
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const drawingsBySymbolRef = useRef(drawingsBySymbol);
  drawingsBySymbolRef.current = drawingsBySymbol;
  const livePricesRef = useRef<Record<string, number>>({});
  const prevAlertPricesRef = useRef<Record<string, number>>({});
  const latestCandleTimesRef = useRef<Record<string, number>>({});
  const latestReplayTimeRef = useRef<number | undefined>(undefined);
  const replayRef = useRef(replay);
  replayRef.current = replay;
  const activePaneSymbolRef = useRef<string>('BTCUSDT');
  const livePaperRef = useRef(livePaperAccount);
  livePaperRef.current = livePaperAccount;
  const replayPaperRef = useRef(replayPaperAccount);
  replayPaperRef.current = replayPaperAccount;
  const priceAlertsRef = useRef(priceAlerts);
  priceAlertsRef.current = priceAlerts;
  const alertSoundRef = useRef(alertSound);
  alertSoundRef.current = alertSound;
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = useCallback((text: string, tone: 'blue' | 'green' | 'red') => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setOrderNotice({ id: Date.now(), text, tone });
    noticeTimerRef.current = window.setTimeout(() => {
      setOrderNotice(null);
    }, 3600);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', appearance.theme === 'dark');
    try {
      localStorage.setItem(STORAGE_KEYS.appearance, JSON.stringify(appearance));
    } catch {
      // Ignore quota errors
    }
  }, [appearance]);

  useEffect(() => {
    syncLiveApiCredentials(appearance.finnhubApiKey);
  }, [appearance.finnhubApiKey]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.layout, JSON.stringify(layoutPreset));
    } catch {
      // Ignore
    }
  }, [layoutPreset]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.layoutSync, JSON.stringify(layoutSync));
    } catch {
      // Ignore
    }
  }, [layoutSync]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.showBuySellPanel,
        JSON.stringify(showBuySellPanel)
      );
    } catch {
      // Ignore
    }
  }, [showBuySellPanel]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.showFavoritesToolbar,
        JSON.stringify(showFavoritesToolbar)
      );
    } catch {
      // Ignore
    }
  }, [showFavoritesToolbar]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.panes, JSON.stringify(panes));
    } catch {
      // Ignore
    }
  }, [panes]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.drawingsBySymbol,
        JSON.stringify(drawingsBySymbol)
      );
    } catch {
      // Ignore
    }
  }, [drawingsBySymbol]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.drawingToolPresets,
        JSON.stringify(drawingToolPresets)
      );
    } catch {
      // Ignore
    }
  }, [drawingToolPresets]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.contractOverridesBySymbol,
        JSON.stringify(contractOverridesBySymbol)
      );
    } catch {
      // Ignore
    }
  }, [contractOverridesBySymbol]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.watchlist, JSON.stringify(watchlist));
    } catch {
      // Ignore
    }
  }, [watchlist]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.pinnedTools, JSON.stringify(pinnedTools));
    } catch {
      // Ignore
    }
  }, [pinnedTools]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.livePaperAccounts,
        JSON.stringify(livePaperAccountsState)
      );
    } catch {
      // Ignore
    }
  }, [livePaperAccountsState]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.priceAlerts, JSON.stringify(priceAlerts));
    } catch {
      // Ignore
    }
  }, [priceAlerts]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.alertSound, JSON.stringify(alertSound));
    } catch {
      // Ignore
    }
  }, [alertSound]);

  useEffect(() => {
    return bindAudioUnlockListeners();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.replayPaperAccount,
        JSON.stringify(replayPaperAccount)
      );
    } catch {
      // Ignore
    }
  }, [replayPaperAccount]);

  const visiblePanes = useMemo(() => panes.slice(0, layout), [panes, layout]);

  useEffect(() => {
    if (!visiblePanes.some((p) => p.id === activePaneId)) {
      setActivePaneId(visiblePanes[0].id);
    }
  }, [visiblePanes, activePaneId]);

  const activePane = useMemo(
    () => panes.find((p) => p.id === activePaneId) ?? panes[0],
    [panes, activePaneId]
  );
  activePaneSymbolRef.current = activePane.symbol;

  // Bar Replay playback timer
  useEffect(() => {
    if (!replay.active || replay.selectingStart || !replay.playing || replay.syncing) return;

    const intervalMs =
      replay.speed === 0.5
        ? 1600
        : replay.speed === 1
        ? 900
        : replay.speed === 2
        ? 450
        : 180;

    const timer = window.setInterval(() => {
      setReplay((prev) => {
        if (!prev.active || !prev.playing || prev.syncing) return prev;
        if (prev.currentIndex >= prev.totalCandles - 1) {
          return { ...prev, playing: false };
        }
        return { ...prev, currentIndex: prev.currentIndex + 1 };
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [replay.active, replay.selectingStart, replay.playing, replay.speed, replay.syncing]);

  const handleSelectPane = useCallback((paneId: string) => {
    setActivePaneId(paneId);
  }, []);

  const updateActivePane = useCallback(
    (updater: (pane: PaneConfig) => PaneConfig) => {
      setPanes((prev) =>
        prev.map((p) => (p.id === activePaneId ? updater(p) : p))
      );
    },
    [activePaneId]
  );

  const handleChangeSymbol = useCallback(
    (symbol: string) => {
      latestReplayTimeRef.current = undefined;
      setReplay((prev) => ({
        ...prev,
        active: false,
        selectingStart: false,
        playing: false,
        currentTime: undefined,
        syncing: false,
      }));
      const symbolDrawings = drawingsBySymbolRef.current[symbol] ?? [];
      if (layoutSync.symbol) {
        setPanes((prev) =>
          prev.map((p) =>
            p.id === activePaneId || p.symbol !== symbol
              ? { ...p, symbol, drawings: symbolDrawings }
              : p
          )
        );
      } else {
        updateActivePane((p) => ({ ...p, symbol, drawings: symbolDrawings }));
      }
    },
    [activePaneId, layoutSync.symbol, updateActivePane]
  );

  const handleChangeTimeframe = useCallback(
    (timeframe: Timeframe) => {
      if (
        replayRef.current.active &&
        !replayRef.current.selectingStart &&
        !replayRef.current.timeframeSync
      ) {
        showNotice('Replay interval is locked — toggle Sync ON to switch timeframes', 'blue');
        return;
      }
      if (activePane.timeframe === timeframe && !layoutSync.interval) return;
      setReplay((prev) => {
        if (!prev.active) return prev;
        if (prev.selectingStart) {
          return { ...prev, currentTime: undefined, syncing: false };
        }
        const anchoredTime = latestReplayTimeRef.current ?? prev.currentTime;
        return {
          ...prev,
          currentTime: anchoredTime,
          syncing: true,
        };
      });
      if (layoutSync.interval) {
        setPanes((prev) => prev.map((p) => ({ ...p, timeframe })));
      } else {
        updateActivePane((p) => ({ ...p, timeframe }));
      }
    },
    [activePane.timeframe, layoutSync.interval, showNotice, updateActivePane]
  );

  const handleToggleLayoutSyncOption = useCallback(
    (key: keyof LayoutSyncOptions) => {
      setLayoutSync((prev) => {
        const nextVal = !prev[key];
        if (nextVal && key === 'symbol') {
          const symbolDrawings = drawingsBySymbolRef.current[activePane.symbol] ?? [];
          setPanes((all) =>
            all.map((p) =>
              p.symbol === activePane.symbol
                ? p
                : { ...p, symbol: activePane.symbol, drawings: symbolDrawings }
            )
          );
        }
        if (nextVal && key === 'interval') {
          setPanes((all) =>
            all.map((p) =>
              p.timeframe === activePane.timeframe
                ? p
                : { ...p, timeframe: activePane.timeframe }
            )
          );
        }
        return { ...prev, [key]: nextVal };
      });
    },
    [activePane.symbol, activePane.timeframe]
  );

  const syncRangeDriverRef = useRef<{ paneId: string; untilMs: number }>({
    paneId: '',
    untilMs: 0,
  });

  const handlePaneCrosshairSync = useCallback(
    (sourcePaneId: string, time: UTCTimestamp | null, price: number | null) => {
      if (!layoutSync.crosshair || layout <= 1) return;
      for (const p of visiblePanes) {
        if (p.id !== sourcePaneId) {
          paneRefs.current[p.id]?.syncCrosshair(time, price);
        }
      }
    },
    [layout, layoutSync.crosshair, visiblePanes]
  );

  const handlePaneTimeRangeSync = useCallback(
    (
      sourcePaneId: string,
      range: { from: UTCTimestamp; to: UTCTimestamp } | null,
      centerTime: number | null
    ) => {
      if ((!layoutSync.dateRange && !layoutSync.time) || layout <= 1) return;
      const now = performance.now();
      if (
        now < syncRangeDriverRef.current.untilMs &&
        syncRangeDriverRef.current.paneId !== sourcePaneId
      ) {
        return;
      }
      syncRangeDriverRef.current = { paneId: sourcePaneId, untilMs: now + 120 };
      const mode = layoutSync.dateRange ? 'dateRange' : 'time';
      for (const p of visiblePanes) {
        if (p.id !== sourcePaneId) {
          paneRefs.current[p.id]?.syncTimeRange(mode, range, centerTime);
        }
      }
    },
    [layout, layoutSync.dateRange, layoutSync.time, visiblePanes]
  );

  const handleToggleIndicator = useCallback(
    (id: IndicatorId) => {
      updateActivePane((p) => {
        const exists = p.indicators.includes(id);
        return {
          ...p,
          indicators: exists
            ? p.indicators.filter((i) => i !== id)
            : [...p.indicators, id],
        };
      });
    },
    [updateActivePane]
  );

  const handleAddDrawing = useCallback(
    (paneId: string, drawing: DrawingObject) => {
      const targetPane = panesRef.current.find((p) => p.id === paneId);
      const targetSymbol = targetPane?.symbol;
      if (!targetSymbol) {
        setPanes((prev) =>
          prev.map((p) =>
            p.id === paneId ? { ...p, drawings: [...p.drawings, drawing] } : p
          )
        );
        return;
      }

      const prevList =
        drawingsBySymbolRef.current[targetSymbol] ?? targetPane?.drawings ?? [];
      const nextList = [...prevList, drawing];

      setDrawingsBySymbol((prev) => ({
        ...prev,
        [targetSymbol]: nextList,
      }));
      setPanes((prev) =>
        prev.map((p) =>
          p.symbol === targetSymbol ? { ...p, drawings: nextList } : p
        )
      );
    },
    []
  );

  const handleUpdateDrawing = useCallback(
    (paneId: string, drawing: DrawingObject) => {
      const targetPane = panesRef.current.find((p) => p.id === paneId);
      const targetSymbol = targetPane?.symbol;
      const existingList = targetSymbol
        ? drawingsBySymbolRef.current[targetSymbol] ?? targetPane?.drawings ?? []
        : targetPane?.drawings ?? [];
      const prevDrawing = existingList.find((d) => d.id === drawing.id);

      if (prevDrawing) {
        const presetPatch: DrawingToolPreset = {};
        let hasPresetChange = false;

        if (drawing.color !== prevDrawing.color) {
          presetPatch.color = drawing.color;
          hasPresetChange = true;
        }
        if (drawing.fillColor !== prevDrawing.fillColor) {
          if (drawing.fillColor) {
            presetPatch.fillColor = drawing.fillColor;
            presetPatch.hasCustomFillColor = true;
          } else {
            presetPatch.fillColor = undefined;
            presetPatch.hasCustomFillColor = false;
          }
          hasPresetChange = true;
        }
        if (drawing.opacity !== prevDrawing.opacity) {
          presetPatch.opacity = drawing.opacity;
          hasPresetChange = true;
        }
        if (drawing.lineWidth !== prevDrawing.lineWidth) {
          presetPatch.lineWidth = drawing.lineWidth;
          hasPresetChange = true;
        }
        if (drawing.lineStyle !== prevDrawing.lineStyle) {
          presetPatch.lineStyle = drawing.lineStyle;
          hasPresetChange = true;
        }

        if (
          (drawing.type === 'long' ||
            drawing.type === 'short' ||
            drawing.type === 'contractRuler') &&
          prevDrawing.type === drawing.type
        ) {
          if (drawing.riskMode !== prevDrawing.riskMode) {
            presetPatch.riskMode = drawing.riskMode;
            hasPresetChange = true;
          }
          if (drawing.riskValue !== prevDrawing.riskValue) {
            presetPatch.riskValue = drawing.riskValue;
            hasPresetChange = true;
          }
          if (drawing.accountBalance !== prevDrawing.accountBalance) {
            presetPatch.accountBalance = drawing.accountBalance;
            hasPresetChange = true;
          }

          if (targetSymbol) {
            const specPatch: SymbolContractOverride = {};
            let hasSpecChange = false;
            if (drawing.pointValue !== prevDrawing.pointValue) {
              specPatch.pointValue = drawing.pointValue;
              hasSpecChange = true;
            }
            if (
              (drawing.type === 'long' || drawing.type === 'short') &&
              (prevDrawing.type === 'long' || prevDrawing.type === 'short') &&
              drawing.tickSize !== prevDrawing.tickSize
            ) {
              specPatch.tickSize = drawing.tickSize;
              hasSpecChange = true;
            }
            if (hasSpecChange) {
              setContractOverridesBySymbol((prev) => ({
                ...prev,
                [targetSymbol]: {
                  ...prev[targetSymbol],
                  ...specPatch,
                },
              }));
            }
          }
        }

        if (hasPresetChange) {
          setDrawingToolPresets((prev) => {
            const current = prev[drawing.type] ?? {};
            const nextPreset: DrawingToolPreset = {
              ...current,
              ...presetPatch,
            };
            if (presetPatch.hasCustomFillColor === false) {
              delete nextPreset.fillColor;
            }
            return {
              ...prev,
              [drawing.type]: nextPreset,
            };
          });
        }
      }

      if (!targetSymbol) {
        setPanes((prev) =>
          prev.map((p) =>
            p.id === paneId
              ? {
                  ...p,
                  drawings: p.drawings.map((d) => (d.id === drawing.id ? drawing : d)),
                }
              : p
          )
        );
        return;
      }

      const nextList = existingList.map((d) => (d.id === drawing.id ? drawing : d));
      setDrawingsBySymbol((prev) => ({
        ...prev,
        [targetSymbol]: nextList,
      }));
      setPanes((prev) =>
        prev.map((p) =>
          p.symbol === targetSymbol ? { ...p, drawings: nextList } : p
        )
      );
    },
    []
  );

  const handleDeleteDrawing = useCallback(
    (paneId: string, drawingId: string) => {
      const targetPane = panesRef.current.find((p) => p.id === paneId);
      const targetSymbol = targetPane?.symbol;
      if (!targetSymbol) {
        setPanes((prev) =>
          prev.map((p) =>
            p.id === paneId
              ? {
                  ...p,
                  drawings: p.drawings.filter((d) => d.id !== drawingId),
                }
              : p
          )
        );
        return;
      }

      const prevList =
        drawingsBySymbolRef.current[targetSymbol] ?? targetPane?.drawings ?? [];
      const nextList = prevList.filter((d) => d.id !== drawingId);
      setDrawingsBySymbol((prev) => ({
        ...prev,
        [targetSymbol]: nextList,
      }));
      setPanes((prev) =>
        prev.map((p) =>
          p.symbol === targetSymbol ? { ...p, drawings: nextList } : p
        )
      );
    },
    []
  );

  const handleClearDrawings = useCallback(() => {
    setPlacementHint(null);
    setActiveTool('cursor');
    const targetSymbol = activePane.symbol;
    setDrawingsBySymbol((prev) => ({
      ...prev,
      [targetSymbol]: [],
    }));
    setPanes((prev) =>
      prev.map((p) =>
        p.symbol === targetSymbol ? { ...p, drawings: [] } : p
      )
    );
  }, [activePane.symbol]);

  const handleTogglePinTool = useCallback((tool: DrawingTool) => {
    setPinnedTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  }, []);

  const handleToolComplete = useCallback(() => {
    setActiveTool('cursor');
    setPlacementHint(null);
  }, []);

  const handleStartReplay = useCallback(() => {
    setActiveTool('cursor');
    setPlacementHint(null);
    latestReplayTimeRef.current = undefined;
    setReplay((prev) => {
      if (prev.active && prev.selectingStart) {
        return {
          ...prev,
          active: false,
          selectingStart: false,
          playing: false,
          currentTime: undefined,
          syncing: false,
        };
      }
      return {
        ...prev,
        active: true,
        selectingStart: true,
        playing: false,
        currentTime: undefined,
        syncing: false,
      };
    });
  }, []);

  const handlePickReplayIndex = useCallback((index: number, total: number, timeSec?: number) => {
    if (timeSec !== undefined) {
      latestReplayTimeRef.current = timeSec;
    }
    setReplay((prev) => ({
      ...prev,
      active: true,
      selectingStart: false,
      playing: false,
      currentIndex: index,
      totalCandles: total,
      currentTime: timeSec ?? prev.currentTime,
      syncing: false,
    }));
  }, []);

  const handleSyncReplay = useCallback((index: number, total: number, timeSec?: number) => {
    const preservedAnchor = replayRef.current.currentTime ?? timeSec;
    if (preservedAnchor !== undefined) {
      latestReplayTimeRef.current = preservedAnchor;
    }
    setReplay((prev) => {
      if (!prev.active) return prev;
      return {
        ...prev,
        currentIndex: index,
        totalCandles: total,
        currentTime: prev.currentTime ?? timeSec,
        syncing: false,
      };
    });
  }, []);

  const handleReplayTotalChange = useCallback((total: number) => {
    setReplay((prev) => ({ ...prev, totalCandles: total }));
  }, []);

  const handleToggleReplayPlay = useCallback(() => {
    setReplay((prev) => {
      if (prev.syncing) return prev;
      if (prev.currentIndex >= prev.totalCandles - 1) {
        return { ...prev, playing: false };
      }
      return { ...prev, playing: !prev.playing };
    });
  }, []);

  const handleStepForward = useCallback(() => {
    setReplay((prev) => {
      if (prev.syncing) return prev;
      return {
        ...prev,
        playing: false,
        currentIndex: Math.min(prev.currentIndex + 1, Math.max(0, prev.totalCandles - 1)),
      };
    });
  }, []);

  const handleJumpForwardReplay = useCallback(
    (req: ReplayJumpRequest) => {
      if (replayRef.current.syncing || replayRef.current.selectingStart) return;
      const res = paneRefs.current[activePaneId]?.jumpReplayForward(req);
      if (!res) {
        showNotice('Already at latest loaded candle', 'blue');
        return;
      }

      latestReplayTimeRef.current = res.targetTime;
      const targetSymbol = activePane.symbol;

      let totalFills = 0;
      let totalClosed = 0;
      let simWorking = replayPaperRef.current;
      for (const bar of res.skippedCandles) {
        const evalRes = applyCandleToAccount(simWorking, targetSymbol, bar, true);
        simWorking = evalRes.nextAccount;
        totalFills += evalRes.filledCount;
        totalClosed += evalRes.closedCount;
      }

      if (totalFills > 0 || totalClosed > 0) {
        setReplayPaperAccount((prev) => {
          let working = prev;
          for (const bar of res.skippedCandles) {
            working = applyCandleToAccount(working, targetSymbol, bar, true).nextAccount;
          }
          return working;
        });
      }

      setReplay((prev) => ({
        ...prev,
        playing: false,
        currentIndex: res.targetIndex,
        totalCandles: res.totalCandles,
        currentTime: res.targetTime,
        syncing: false,
      }));

      const dtLabel = new Date(res.targetTime * 1000).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const events: string[] = [];
      if (totalFills > 0) events.push(`${totalFills} filled`);
      if (totalClosed > 0) events.push(`${totalClosed} closed`);
      const suffix = events.length > 0 ? ` (${events.join(', ')})` : '';
      showNotice(`Forwarded ${res.skippedCandles.length} bars -> ${dtLabel}${suffix}`, 'blue');
    },
    [activePaneId, activePane.symbol, showNotice]
  );

  const handleChangeReplaySpeed = useCallback((speed: ReplaySpeed) => {
    setReplay((prev) => ({ ...prev, speed }));
  }, []);

  const handleToggleReplayTimeframeSync = useCallback(() => {
    setReplay((prev) => {
      const nextSync = !prev.timeframeSync;
      showNotice(
        nextSync
          ? 'Replay timeframe sync ON — interval changes resample at current bar'
          : 'Replay timeframe locked — current step interval preserved',
        'blue'
      );
      return { ...prev, timeframeSync: nextSync };
    });
  }, [showNotice]);

  const handleExitReplay = useCallback(() => {
    latestReplayTimeRef.current = undefined;
    for (const key of Object.keys(prevAlertPricesRef.current)) {
      if (key.startsWith('replay:')) {
        delete prevAlertPricesRef.current[key];
      }
    }
    setReplay((prev) => ({
      ...prev,
      active: false,
      selectingStart: false,
      playing: false,
      currentTime: undefined,
      syncing: false,
    }));
  }, []);

  const handleAddWatchlistSymbol = useCallback((sym: string) => {
    setWatchlist((prev) => (prev.includes(sym) ? prev : [sym, ...prev]));
  }, []);

  const handleRemoveWatchlistSymbol = useCallback((sym: string) => {
    setWatchlist((prev) => prev.filter((s) => s !== sym));
  }, []);

  const handleFitChart = useCallback(() => {
    paneRefs.current[activePaneId]?.fitContent();
  }, [activePaneId]);

  const handleScreenshot = useCallback(async () => {
    const dataUrl = await paneRefs.current[activePaneId]?.takeScreenshot();
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.download = `${activePane.symbol}_${activePane.timeframe}_chart.png`;
    link.href = dataUrl;
    link.click();
    showNotice('Saved full chart PNG screenshot', 'green');
  }, [activePaneId, activePane.symbol, activePane.timeframe, showNotice]);

  const handleJumpToDate = useCallback(
    async (targetTimeSec: number) => {
      const ok = await paneRefs.current[activePaneId]?.goToDate(targetTimeSec);
      if (ok) {
        const dtLabel = new Date(targetTimeSec * 1000).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        showNotice(`Jumped to ${dtLabel}`, 'blue');
      } else {
        showNotice('Unable to load candles for selected date', 'red');
      }
    },
    [activePaneId, showNotice]
  );

  // Helper to update only the currently active Live Paper Account (Replay remains completely isolated)
  const setLivePaperAccount = useCallback(
    (
      updater:
        | PaperAccountState
        | ((prev: PaperAccountState) => PaperAccountState)
    ) => {
      setLivePaperAccountsState((prevState) => ({
        ...prevState,
        accounts: prevState.accounts.map((acc) => {
          if (acc.id !== prevState.activeAccountId) return acc;
          const nextAcc =
            typeof updater === 'function' ? updater(acc.account) : updater;
          return { ...acc, account: nextAcc };
        }),
      }));
    },
    []
  );

  const handleSwitchLiveAccount = useCallback(
    (accountId: string) => {
      setLivePaperAccountsState((prev) => {
        const target = prev.accounts.find((a) => a.id === accountId);
        if (!target || target.id === prev.activeAccountId) return prev;
        showNotice(`Switched to ${target.name}`, 'blue');
        return { ...prev, activeAccountId: accountId };
      });
    },
    [showNotice]
  );

  const handleCreateLiveAccount = useCallback(
    (name: string, startingBalance: number) => {
      const id = `acc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newAcc: NamedPaperAccount = {
        id,
        name,
        createdAt: Date.now(),
        account: createFreshPaperAccount(startingBalance),
      };
      setLivePaperAccountsState((prev) => ({
        activeAccountId: id,
        accounts: [...prev.accounts, newAcc],
      }));
      showNotice(`Created "${name}" (${formatUsd(startingBalance)})`, 'green');
    },
    [showNotice]
  );

  const handleDeleteLiveAccount = useCallback(
    (accountId: string) => {
      setLivePaperAccountsState((prev) => {
        if (prev.accounts.length <= 1) return prev;
        const removed = prev.accounts.find((a) => a.id === accountId);
        const remaining = prev.accounts.filter((a) => a.id !== accountId);
        const nextActiveId =
          prev.activeAccountId === accountId ? remaining[0].id : prev.activeAccountId;
        if (removed) {
          showNotice(`Deleted "${removed.name}"`, 'blue');
        }
        return { activeAccountId: nextActiveId, accounts: remaining };
      });
    },
    [showNotice]
  );

  // Completely Isolated Paper Trading Handlers (Live Accounts vs Bar Replay Account)
  const handlePlaceOrder = useCallback(
    (req: PlacePaperOrderRequest) => {
      const inReplay = replayRef.current.active && !replayRef.current.selectingStart;
      const mode: TradeMode = inReplay ? 'Replay' : 'Live';
      const targetAccount = inReplay ? replayPaperRef.current : livePaperRef.current;
      const setTargetAccount = inReplay ? setReplayPaperAccount : setLivePaperAccount;

      const entryTime = inReplay ? req.candleTime : Math.floor(Date.now() / 1000);
      const spec = getSymbolContractSpec(req.symbol, req.entryPrice);
      const safeQty = sanitizeOrderQty(req.symbol, req.qty, req.entryPrice);
      const pointValue = Math.max(0.0001, req.pointValue ?? spec.pointValue);
      const leverage = DEFAULT_PAPER_LEVERAGE;
      const requiredMargin = calculateRequiredNettingMargin(targetAccount, {
        symbol: req.symbol,
        side: req.side,
        qty: safeQty,
        price: req.entryPrice,
        pointValue,
        leverage,
        mode,
      });

      const currentOverview = calculateAccountOverview(
        targetAccount,
        livePricesRef.current
      );
      if (requiredMargin > currentOverview.availableMargin) {
        showNotice(`Insufficient ${mode} available margin`, 'red');
        return;
      }

      const fillInput: NettingFillInput = {
        symbol: req.symbol,
        side: req.side,
        qty: safeQty,
        price: req.entryPrice,
        fillTime: entryTime,
        candleTime: req.candleTime,
        tpPrice: req.tpPrice,
        slPrice: req.slPrice,
        pointValue,
        leverage,
        mode,
      };

      const preview = executeNettingOrderFill(targetAccount, fillInput);
      setTargetAccount((prev) => executeNettingOrderFill(prev, fillInput).nextAccount);

      const sideLabel = req.side === 'long' ? 'BUY' : 'SELL';
      if (preview.action === 'partial_closed') {
        showNotice(
          `${mode} Partial Close ${preview.closedQty} ${req.symbol} (${formatSignedUsd(preview.realizedPnl)}) · Rem ${preview.resultingPos?.qty ?? 0}`,
          preview.realizedPnl >= 0 ? 'green' : 'red'
        );
      } else if (preview.action === 'closed') {
        showNotice(
          `${mode} Closed ${preview.closedQty} ${req.symbol} (${formatSignedUsd(preview.realizedPnl)})`,
          preview.realizedPnl >= 0 ? 'green' : 'red'
        );
      } else if (preview.action === 'reversed') {
        showNotice(
          `${mode} Reversed ${req.symbol} (${formatSignedUsd(preview.realizedPnl)}) -> ${sideLabel} ${preview.resultingPos?.qty ?? safeQty}`,
          req.side === 'long' ? 'blue' : 'red'
        );
      } else if (preview.action === 'added') {
        showNotice(
          `${mode} Added ${safeQty} ${req.symbol} -> ${preview.resultingPos?.qty ?? safeQty} @ Avg ${formatPrice(preview.resultingPos?.entryPrice ?? req.entryPrice)}`,
          req.side === 'long' ? 'blue' : 'red'
        );
      } else {
        showNotice(
          `${mode} ${sideLabel} ${safeQty} ${req.symbol} @ ${formatPrice(req.entryPrice)}`,
          req.side === 'long' ? 'blue' : 'red'
        );
      }
    },
    [setLivePaperAccount, showNotice]
  );

  const handlePlacePendingOrder = useCallback(
    (req: PlacePendingOrderRequest) => {
      const inReplay = replayRef.current.active && !replayRef.current.selectingStart;
      const mode: TradeMode = inReplay ? 'Replay' : 'Live';
      const targetAccount = inReplay ? replayPaperRef.current : livePaperRef.current;
      const setTargetAccount = inReplay ? setReplayPaperAccount : setLivePaperAccount;

      const spec = getSymbolContractSpec(req.symbol, req.targetPrice);
      const safeQty = sanitizeOrderQty(req.symbol, req.qty, req.targetPrice);
      const pointValue = Math.max(0.0001, req.pointValue ?? spec.pointValue);
      const leverage = DEFAULT_PAPER_LEVERAGE;
      const requiredMargin = calculateRequiredNettingMargin(targetAccount, {
        symbol: req.symbol,
        side: req.side,
        qty: safeQty,
        price: req.targetPrice,
        pointValue,
        leverage,
        mode,
      });

      const currentOverview = calculateAccountOverview(
        targetAccount,
        livePricesRef.current
      );
      if (requiredMargin > currentOverview.availableMargin) {
        showNotice(`Insufficient ${mode} available margin`, 'red');
        return;
      }

      const newOrder: PendingPaperOrder = {
        id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        symbol: req.symbol,
        side: req.side,
        orderType: req.orderType,
        qty: safeQty,
        targetPrice: req.targetPrice,
        createdAtCandleTime: req.candleTime,
        tpPrice: req.tpPrice,
        slPrice: req.slPrice,
        pointValue,
        leverage,
        mode,
        createdAt: Date.now(),
      };

      setTargetAccount((prev) => ({
        ...prev,
        pendingOrders: [newOrder, ...(prev.pendingOrders ?? [])],
      }));

      showNotice(
        `${mode} ${req.side === 'long' ? 'BUY' : 'SELL'} ${req.orderType.toUpperCase()} ${safeQty} ${req.symbol} @ ${formatPrice(req.targetPrice)}`,
        req.side === 'long' ? 'blue' : 'red'
      );
    },
    [setLivePaperAccount, showNotice]
  );

  const handleUpdatePendingOrder = useCallback(
    (
      orderId: string,
      patch: {
        targetPrice?: number;
        orderType?: PendingOrderType;
        tpPrice?: number;
        slPrice?: number;
      },
      silent = false,
      modeOverride?: TradeMode
    ) => {
      const mode: TradeMode =
        modeOverride ??
        ((replayPaperRef.current.pendingOrders ?? []).some((o) => o.id === orderId)
          ? 'Replay'
          : 'Live');
      const setTargetAccount =
        mode === 'Replay' ? setReplayPaperAccount : setLivePaperAccount;

      setTargetAccount((prev) => ({
        ...prev,
        pendingOrders: (prev.pendingOrders ?? []).map((o) =>
          o.id === orderId ? { ...o, ...patch } : o
        ),
      }));
      if (!silent) {
        showNotice(`Updated ${mode} pending order`, 'blue');
      }
    },
    [setLivePaperAccount, showNotice]
  );

  const handleCancelPendingOrder = useCallback(
    (orderId: string, modeOverride?: TradeMode) => {
      const mode: TradeMode =
        modeOverride ??
        ((replayPaperRef.current.pendingOrders ?? []).some((o) => o.id === orderId)
          ? 'Replay'
          : 'Live');
      const setTargetAccount =
        mode === 'Replay' ? setReplayPaperAccount : setLivePaperAccount;

      setTargetAccount((prev) => ({
        ...prev,
        pendingOrders: (prev.pendingOrders ?? []).filter((o) => o.id !== orderId),
      }));
      showNotice(`Cancelled ${mode} pending order`, 'blue');
    },
    [setLivePaperAccount, showNotice]
  );

  const handleClosePosition = useCallback(
    (positionId: string, modeOverride?: TradeMode) => {
      const mode: TradeMode =
        modeOverride ?? (replayRef.current.active ? 'Replay' : 'Live');
      const targetSnapshot =
        mode === 'Replay' ? replayPaperRef.current : livePaperRef.current;
      const setTargetAccount =
        mode === 'Replay' ? setReplayPaperAccount : setLivePaperAccount;

      const pos = targetSnapshot.positions.find((p) => p.id === positionId);
      if (!pos) return;

      const exitPrice = livePricesRef.current[pos.symbol] ?? pos.entryPrice;
      const exitTime =
        pos.mode === 'Replay'
          ? latestCandleTimesRef.current[pos.symbol] ?? Math.floor(Date.now() / 1000)
          : Math.floor(Date.now() / 1000);
      const metrics = calculatePositionMetrics(pos, exitPrice);
      const trade: PaperTrade = {
        id: `trd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        symbol: pos.symbol,
        side: pos.side,
        qty: pos.qty,
        entryPrice: pos.entryPrice,
        exitPrice,
        entryTime: pos.entryTime,
        exitTime,
        realizedPnl: metrics.unrealizedPnl,
        realizedPnlPct: metrics.unrealizedPct,
        pointValue: pos.pointValue,
        mode: pos.mode,
        exitReason: 'Manual',
      };

      setTargetAccount((prev) => ({
        ...prev,
        balance: prev.balance + metrics.unrealizedPnl,
        positions: prev.positions.filter((p) => p.id !== positionId),
        closedTrades: [trade, ...prev.closedTrades],
      }));

      showNotice(
        `Closed ${mode} ${pos.symbol} (${formatSignedUsd(metrics.unrealizedPnl)})`,
        metrics.unrealizedPnl >= 0 ? 'green' : 'red'
      );
    },
    [setLivePaperAccount, showNotice]
  );

  const handleUpdatePositionTPSL = useCallback(
    (
      positionId: string,
      tpPrice?: number,
      slPrice?: number,
      silent = false,
      modeOverride?: TradeMode
    ) => {
      const mode: TradeMode =
        modeOverride ??
        (replayPaperRef.current.positions.some((p) => p.id === positionId)
          ? 'Replay'
          : 'Live');
      const setTargetAccount =
        mode === 'Replay' ? setReplayPaperAccount : setLivePaperAccount;

      setTargetAccount((prev) => ({
        ...prev,
        positions: prev.positions.map((p) =>
          p.id === positionId ? { ...p, tpPrice, slPrice } : p
        ),
      }));
      if (!silent) {
        showNotice(`Updated ${mode} TP/SL levels`, 'blue');
      }
    },
    [setLivePaperAccount, showNotice]
  );

  const handleResetPaperAccount = useCallback(
    (newStartingBalance: number, mode: TradeMode) => {
      const setTargetAccount =
        mode === 'Replay' ? setReplayPaperAccount : setLivePaperAccount;
      setTargetAccount({
        startingBalance: newStartingBalance,
        balance: newStartingBalance,
        positions: [],
        closedTrades: [],
        pendingOrders: [],
      });
      showNotice(
        `${mode} paper account reset to ${formatUsd(newStartingBalance)}`,
        'blue'
      );
    },
    [setLivePaperAccount, showNotice]
  );

  const handleUpdateTradeJournal = useCallback(
    (tradeId: string, patch: { notes?: string; tags?: string[] }, mode: TradeMode) => {
      const setTargetAccount =
        mode === 'Replay' ? setReplayPaperAccount : setLivePaperAccount;
      setTargetAccount((prev) => ({
        ...prev,
        closedTrades: prev.closedTrades.map((t) =>
          t.id === tradeId ? { ...t, ...patch } : t
        ),
      }));
    },
    [setLivePaperAccount]
  );

  const playAlertChime = useCallback(() => {
    playAlertSound(alertSoundRef.current);
  }, []);

  const handleCreatePriceAlert = useCallback(
    (input: {
      symbol: string;
      targetPrice: number;
      condition: PriceAlertCondition;
      repeat: boolean;
      note?: string;
    }) => {
      unlockAlertAudio();
      const newAlert: PriceAlert = {
        id: `alt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        symbol: input.symbol.toUpperCase(),
        targetPrice: input.targetPrice,
        condition: input.condition,
        repeat: input.repeat,
        note: input.note,
        active: true,
        createdAt: Date.now(),
      };
      setPriceAlerts((prev) => [newAlert, ...prev]);
      showNotice(
        `Alert set: ${newAlert.symbol} @ ${formatPrice(newAlert.targetPrice)}`,
        'blue'
      );
    },
    [showNotice]
  );

  const handleUpdatePriceAlert = useCallback(
    (
      alertId: string,
      patch: {
        targetPrice?: number;
        condition?: PriceAlertCondition;
        note?: string;
      },
      silent = false
    ) => {
      setPriceAlerts((prev) =>
        prev.map((a) => (a.id === alertId ? { ...a, ...patch } : a))
      );
      if (!silent && patch.targetPrice !== undefined) {
        showNotice(`Moved Alert @ ${formatPrice(patch.targetPrice)}`, 'blue');
      }
    },
    [showNotice]
  );

  const handleTogglePriceAlert = useCallback((id: string) => {
    setPriceAlerts((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              active: !a.active,
            }
          : a
      )
    );
  }, []);

  const handleDeletePriceAlert = useCallback((id: string) => {
    setPriceAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleClearTriggeredAlerts = useCallback(() => {
    setPriceAlerts((prev) => prev.filter((a) => a.active || !a.triggeredAt));
  }, []);

  const handleMarketTick = useCallback(
    (symbol: string, candle: Candle, isReplay: boolean) => {
      livePricesRef.current[symbol] = candle.close;
      latestCandleTimesRef.current[symbol] = Number(candle.time);
      if (isReplay && symbol === activePaneSymbolRef.current && !replayRef.current.syncing) {
        latestReplayTimeRef.current = Number(candle.time);
      }
      setLivePrices((prev) =>
        prev[symbol] === candle.close ? prev : { ...prev, [symbol]: candle.close }
      );

      // Evaluate Price Alerts in both Live and Bar Replay modes using isolated baselines
      const alertKey = isReplay ? `replay:${symbol}` : symbol;
      const prevPrice = prevAlertPricesRef.current[alertKey];
      const currPrice = candle.close;
      prevAlertPricesRef.current[alertKey] = currPrice;

      if (prevPrice !== undefined && (prevPrice !== currPrice || candle.high !== candle.low)) {
        const nowMs = Date.now();
        const activeForSymbol = priceAlertsRef.current.filter(
          (a) => a.active && a.symbol === symbol
        );
        const fired: PriceAlert[] = [];

        for (const alert of activeForSymbol) {
          if (alert.repeat && alert.triggeredAt && nowMs - alert.triggeredAt < 8000) {
            continue;
          }
          const barHi = Math.max(currPrice, candle.high);
          const barLo = Math.min(currPrice, candle.low);
          const crossedUp =
            prevPrice < alert.targetPrice && barHi >= alert.targetPrice;
          const crossedDown =
            prevPrice > alert.targetPrice && barLo <= alert.targetPrice;

          const triggered =
            alert.condition === 'crossing_up'
              ? crossedUp
              : alert.condition === 'crossing_down'
              ? crossedDown
              : crossedUp || crossedDown;

          if (triggered) {
            fired.push(alert);
          }
        }

        if (fired.length > 0) {
          const firedIds = new Set(fired.map((f) => f.id));
          setPriceAlerts((prev) =>
            prev.map((a) =>
              firedIds.has(a.id)
                ? {
                    ...a,
                    triggeredAt: nowMs,
                    triggeredPrice: currPrice,
                    active: a.repeat ? true : false,
                  }
                : a
            )
          );

          const newToasts = fired.map((f) => ({
            uid: `${f.id}-${nowMs}-${Math.random().toString(36).slice(2, 5)}`,
            alertId: f.id,
            symbol: f.symbol,
            targetPrice: f.targetPrice,
            triggeredPrice: currPrice,
            condition: f.condition,
            note: f.note
              ? `${isReplay ? '[Replay] ' : ''}${f.note}`
              : isReplay
              ? 'Triggered in Bar Replay'
              : undefined,
            triggeredAt: nowMs,
          }));

          setAlertNotifications((prev) => [...newToasts, ...prev].slice(0, 3));
          playAlertChime();

          for (const toast of newToasts) {
            window.setTimeout(() => {
              setAlertNotifications((prev) =>
                prev.filter((item) => item.uid !== toast.uid)
              );
            }, 8500);
          }
        }
      }

      const snapshot = isReplay ? replayPaperRef.current : livePaperRef.current;
      const setTargetAccount = isReplay ? setReplayPaperAccount : setLivePaperAccount;
      const evalPreview = applyCandleToAccount(snapshot, symbol, candle, isReplay);

      if (evalPreview.filledCount > 0 || evalPreview.closedCount > 0) {
        setTargetAccount((prev) => applyCandleToAccount(prev, symbol, candle, isReplay).nextAccount);
        if (evalPreview.lastNotice) {
          showNotice(evalPreview.lastNotice.text, evalPreview.lastNotice.tone);
        }
      }
    },
    [playAlertChime, setLivePaperAccount, showNotice]
  );

  const activeAlertCount = useMemo(
    () => priceAlerts.filter((a) => a.active).length,
    [priceAlerts]
  );

  const activeAccountMode: TradeMode = replay.active ? 'Replay' : 'Live';
  const activePaperAccount = replay.active ? replayPaperAccount : livePaperAccount;

  const accountOverview = useMemo(
    () => calculateAccountOverview(activePaperAccount, livePrices),
    [activePaperAccount, livePrices]
  );

  const handleResizeAllVisiblePanes = useCallback(() => {
    for (const p of visiblePanes) {
      paneRefs.current[p.id]?.resize();
    }
  }, [visiblePanes]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-white text-[#131722] dark:bg-[#131722] dark:text-[#d1d4dc]">
      {/* Compact Top NasChart Header (44px) */}
      <header className="relative z-30 flex h-11 shrink-0 items-center justify-between gap-1.5 border-b border-[#f0f3fa] bg-white px-2 sm:px-3.5 dark:border-[#2a2e39] dark:bg-[#131722]">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <svg
              viewBox="0 0 32 32"
              className="h-6 w-6 shrink-0 rounded-md"
              fill="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="naschart-header-bg" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#3b76ff" />
                  <stop offset="55%" stopColor="#2962ff" />
                  <stop offset="100%" stopColor="#1444cc" />
                </linearGradient>
              </defs>
              <rect width="32" height="32" rx="7.5" fill="url(#naschart-header-bg)" />
              <line x1="9.5" y1="14.5" x2="9.5" y2="24" stroke="#dbeafe" strokeWidth="1.5" strokeLinecap="round" />
              <rect x="7.5" y="16.5" width="4" height="5.5" rx="1" fill="#dbeafe" />
              <line x1="16" y1="10.5" x2="16" y2="22" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
              <rect x="14" y="13" width="4" height="6.5" rx="1" fill="#ffffff" />
              <line x1="22.5" y1="7" x2="22.5" y2="18.5" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
              <rect x="20.5" y="9" width="4" height="7" rx="1" fill="#ffffff" />
            </svg>
            <span className="text-sm font-bold tracking-tight whitespace-nowrap text-[#131722] dark:text-white">
              NasChart
            </span>
          </div>

          {/* Desktop inline timeframe strip + All 18 intervals trigger */}
          <div className="hidden items-center gap-0.5 border-l border-[#f0f3fa] pl-3 lg:flex dark:border-[#2a2e39]">
            {QUICK_DESKTOP_TIMEFRAMES.map((tf) => {
              const active = activePane.timeframe === tf;
              return (
                <button
                  key={tf}
                  type="button"
                  onClick={() => handleChangeTimeframe(tf)}
                  className={`min-h-[30px] rounded-md px-2 font-mono-tabular text-xs font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#2962ff]/12 text-[#2962ff]'
                      : 'text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#1e222d] dark:hover:text-white'
                  }`}
                >
                  {tf}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setActiveSheet('timeframe')}
              className="min-h-[30px] rounded-md px-2 text-xs font-semibold text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#1e222d] dark:hover:text-white"
              title="All 18 timeframes"
            >
              More
            </button>
          </div>
        </div>

        {/* Right Controls: Paper Equity, Journal, Replay, Clean-Chart Toggles (Buy/Sell & ★✎), Layout Sheet, Alerts, Settings */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            onClick={() =>
              setActiveSheet((prev) => (prev === 'paper' ? null : 'paper'))
            }
            className={`hidden min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors whitespace-nowrap sm:flex ${
              activeSheet === 'paper'
                ? 'bg-[#2962ff] text-white'
                : 'bg-[#f0f3fa] text-[#131722] hover:bg-[#e0e3eb] dark:bg-[#1e222d] dark:text-[#d1d4dc] dark:hover:bg-[#2a2e39]'
            }`}
            title={`Open ${activeAccountMode} Paper Trading Account`}
          >
            <Wallet
              className={`h-3.5 w-3.5 shrink-0 ${
                activeSheet === 'paper' ? 'text-white' : 'text-[#2962ff]'
              }`}
            />
            {replay.active && (
              <span
                className={`rounded px-1 py-px text-[9px] font-bold uppercase ${
                  activeSheet === 'paper'
                    ? 'bg-white/20 text-white'
                    : 'bg-[#2962ff]/15 text-[#2962ff]'
                }`}
              >
                RPL
              </span>
            )}
            <span className="font-mono-tabular font-bold">
              {formatUsd(accountOverview.equity)}
            </span>
            {activePaperAccount.positions.length > 0 && (
              <span
                className={`font-mono-tabular text-[11px] font-bold ${
                  activeSheet === 'paper'
                    ? 'text-white/90'
                    : accountOverview.unrealizedPnl >= 0
                    ? 'text-[#089981]'
                    : 'text-[#f23645]'
                }`}
              >
                {formatSignedUsd(accountOverview.unrealizedPnl, true)}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setJournalInitialMode(null);
              setActiveSheet((prev) => (prev === 'journal' ? null : 'journal'));
            }}
            className={`hidden min-h-[34px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors whitespace-nowrap md:flex ${
              activeSheet === 'journal'
                ? 'bg-[#2962ff] text-white'
                : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#1e222d]'
            }`}
            title={`${activeAccountMode} Trading Journal & PnL Calendar`}
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            <span>{replay.active ? 'Replay Journal' : 'Journal'}</span>
          </button>

          <button
            type="button"
            onClick={handleStartReplay}
            className={`flex min-h-[34px] min-w-[34px] items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors whitespace-nowrap sm:px-2.5 ${
              replay.active
                ? 'bg-[#2962ff] text-white'
                : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#1e222d]'
            }`}
            title="Bar Replay Mode"
            aria-label="Bar Replay Mode"
          >
            <History className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">Replay</span>
          </button>

          {/* Clean Chart Toggle 1: Buy/Sell Quick-Order Panel */}
          <button
            type="button"
            onClick={() => setShowBuySellPanel((prev) => !prev)}
            aria-pressed={showBuySellPanel}
            aria-label={showBuySellPanel ? 'Hide Buy & Sell Panel' : 'Show Buy & Sell Panel'}
            title={showBuySellPanel ? 'Hide Buy & Sell Panel' : 'Show Buy & Sell Panel'}
            className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg transition-colors ${
              showBuySellPanel
                ? 'bg-[#2962ff]/12 text-[#2962ff] hover:bg-[#2962ff]/20'
                : 'text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#1e222d] dark:hover:text-[#d1d4dc]'
            }`}
          >
            <ArrowLeftRight className="h-[17px] w-[17px]" />
          </button>

          {/* Clean Chart Toggle 2: Favorites Drawing Toolbar (★✎) */}
          <button
            type="button"
            onClick={() => setShowFavoritesToolbar((prev) => !prev)}
            aria-pressed={showFavoritesToolbar}
            aria-label={
              showFavoritesToolbar ? 'Hide Favorites Toolbar' : 'Show Favorites Toolbar'
            }
            title={
              showFavoritesToolbar ? 'Hide Favorites Toolbar' : 'Show Favorites Toolbar'
            }
            className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg transition-colors ${
              showFavoritesToolbar
                ? 'bg-[#2962ff]/12 text-[#2962ff] hover:bg-[#2962ff]/20'
                : 'text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#1e222d] dark:hover:text-[#d1d4dc]'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-[18px] w-[18px]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {/* Small filled 5-point Star at top-left */}
              <path
                d="M6.5 2.5L7.6 5.1L10.4 5.3L8.2 7.1L8.9 9.8L6.5 8.3L4.1 9.8L4.8 7.1L2.6 5.3L5.4 5.1Z"
                fill="currentColor"
                stroke="none"
              />
              {/* Diagonal Pencil */}
              <path d="M18.6 4.4a1.8 1.8 0 0 1 2.5 2.5L11.5 16.5l-3.6.9.9-3.6L18.6 4.4z" />
              <path d="M16.8 6.2l2.5 2.5" />
            </svg>
          </button>

          {/* TradingView Multi-Chart Layout Bottom Sheet Trigger */}
          <button
            type="button"
            onClick={() => setLayoutMenuOpen(true)}
            aria-label="Select multi-chart layout"
            title={`Chart layout: ${layoutMeta.label}`}
            className={`flex min-h-[34px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold transition-colors ${
              layoutMenuOpen || layout > 1
                ? 'bg-[#f0f3fa] text-[#131722] dark:bg-[#1e222d] dark:text-white'
                : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#1e222d]'
            }`}
          >
            <LayoutPreviewIcon preset={layoutMeta} className="h-[17px] w-[21px]" strokeWidth={1.65} />
            {layout > 1 && (
              <span className="font-mono-tabular text-[11px] font-bold text-[#2962ff]">
                {layout}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveSheet((prev) => (prev === 'alerts' ? null : 'alerts'))
            }
            aria-label="Price Alerts"
            title="Price Alerts"
            className={`relative flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center rounded-lg px-1.5 text-xs font-semibold transition-colors ${
              activeSheet === 'alerts'
                ? 'bg-[#f59e0b] text-white'
                : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#1e222d]'
            }`}
          >
            <Bell className="h-[17px] w-[17px]" />
            {activeAlertCount > 0 && (
              <span
                className={`ml-0.5 rounded-full px-1.5 py-px font-mono-tabular text-[10px] font-bold ${
                  activeSheet === 'alerts'
                    ? 'bg-white/25 text-white'
                    : 'bg-[#f59e0b]/15 text-[#d97706] dark:text-[#fbbf24]'
                }`}
              >
                {activeAlertCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveSheet('settings')}
            aria-label="Chart settings"
            title="Custom Chart Colors, Theme & Finnhub API Key"
            className="flex min-h-[34px] min-w-[34px] shrink-0 items-center justify-center rounded-lg text-[#131722] transition-colors hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#1e222d]"
          >
            <Settings className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      {/* Main Chart Grid Stage */}
      <main className="relative flex-1 overflow-hidden">
        <ResizableLayoutGrid
          presetId={layoutPreset}
          paneCount={visiblePanes.length}
          onPanesResized={handleResizeAllVisiblePanes}
          renderPane={(idx) => {
            const pane = visiblePanes[idx];
            if (!pane) return null;
            return (
              <ChartPane
                key={pane.id}
                ref={(handle) => {
                  paneRefs.current[pane.id] = handle;
                }}
                pane={pane}
                isActive={pane.id === activePaneId}
                multiLayout={layout > 1}
                appearance={appearance}
                activeTool={activeTool}
                replay={replay}
                openPositions={activePaperAccount.positions}
                closedTrades={activePaperAccount.closedTrades}
                pendingOrders={activePaperAccount.pendingOrders ?? []}
                priceAlerts={priceAlerts}
                showExecutions={appearance.showExecutions ?? true}
                showBuySellPanel={showBuySellPanel}
                drawingToolPresets={drawingToolPresets}
                contractOverridesBySymbol={contractOverridesBySymbol}
                onSelectPane={handleSelectPane}
                onAddDrawing={handleAddDrawing}
                onUpdateDrawing={handleUpdateDrawing}
                onDeleteDrawing={handleDeleteDrawing}
                onPlacementHintChange={setPlacementHint}
                onToolComplete={handleToolComplete}
                onPickReplayIndex={handlePickReplayIndex}
                onSyncReplay={handleSyncReplay}
                onReplayTotalChange={handleReplayTotalChange}
                onOpenSymbolModal={() => setActiveSheet('symbol')}
                onOpenTimeframeModal={() => setActiveSheet('timeframe')}
                onOpenGoToDate={() => setActiveSheet('goto')}
                onMarketTick={handleMarketTick}
                onCrosshairSync={handlePaneCrosshairSync}
                onTimeRangeSync={handlePaneTimeRangeSync}
                onPlaceOrder={handlePlaceOrder}
                onPlacePendingOrder={handlePlacePendingOrder}
                onUpdatePendingOrder={(id, patch, silent) =>
                  handleUpdatePendingOrder(id, patch, silent, activeAccountMode)
                }
                onCancelPendingOrder={(id) =>
                  handleCancelPendingOrder(id, activeAccountMode)
                }
                onClosePosition={(id) => handleClosePosition(id, activeAccountMode)}
                onUpdatePositionTPSL={(id, tp, sl, silent) =>
                  handleUpdatePositionTPSL(id, tp, sl, silent, activeAccountMode)
                }
                onCreatePriceAlert={handleCreatePriceAlert}
                onUpdatePriceAlert={handleUpdatePriceAlert}
                onDeletePriceAlert={handleDeletePriceAlert}
              />
            );
          }}
        />

        {/* Visual Price Alert Crossed Notifications */}
        {alertNotifications.length > 0 && (
          <div className="pointer-events-none absolute top-3 left-1/2 z-40 flex w-[calc(100%-24px)] max-w-sm -translate-x-1/2 flex-col gap-2">
            {alertNotifications.map((notif) => (
              <div
                key={notif.uid}
                role="alert"
                className="pointer-events-auto flex items-start justify-between gap-2.5 rounded-2xl border border-[#f59e0b]/40 bg-white/95 p-3 shadow-2xl backdrop-blur-md dark:border-[#f59e0b]/50 dark:bg-[#1e222d]/95"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#f59e0b]/15 text-[#d97706] dark:text-[#fbbf24]">
                    <BellRing className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-bold text-[#131722] dark:text-white">
                        {notif.symbol} Alert Triggered
                      </span>
                      <span className="rounded bg-[#f59e0b]/15 px-1.5 py-px font-mono-tabular text-[10px] font-bold text-[#d97706] dark:text-[#fbbf24]">
                        {formatPrice(notif.targetPrice)}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono-tabular text-[11px] text-[#787b86]">
                      Crossed live at{' '}
                      <span className="font-semibold text-[#131722] dark:text-[#d1d4dc]">
                        {formatPrice(notif.triggeredPrice)}
                      </span>
                    </div>
                    {notif.note && (
                      <div className="mt-0.5 truncate text-[11px] font-medium text-[#131722]/85 dark:text-[#d1d4dc]/85">
                        {notif.note}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {notif.symbol !== activePane.symbol && (
                    <button
                      type="button"
                      onClick={() => {
                        handleChangeSymbol(notif.symbol);
                        setAlertNotifications((prev) =>
                          prev.filter((item) => item.uid !== notif.uid)
                        );
                      }}
                      className="rounded-lg bg-[#2962ff]/10 px-2 py-1 text-[11px] font-bold text-[#2962ff] hover:bg-[#2962ff]/20"
                    >
                      Chart
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setAlertNotifications((prev) =>
                        prev.filter((item) => item.uid !== notif.uid)
                      )
                    }
                    aria-label="Dismiss alert notification"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Non-intrusive Order Fill / TP-SL Trigger Notice */}
        {orderNotice && (
          <div
            className={`pointer-events-none absolute top-3 right-16 z-30 rounded-lg px-3 py-1.5 text-xs font-bold text-white shadow-lg ${
              orderNotice.tone === 'green'
                ? 'bg-[#089981]'
                : orderNotice.tone === 'red'
                ? 'bg-[#f23645]'
                : 'bg-[#2962ff]'
            }`}
          >
            {orderNotice.text}
          </div>
        )}

        {/* Floating Draggable Bar Replay Control Bar (Live Parity) */}
        {replay.active && (
          <div
            className={`pointer-events-none absolute right-0 left-0 z-30 flex justify-center px-2 ${
              showFavoritesToolbar ? 'bottom-[88px]' : 'bottom-8'
            }`}
          >
            <ReplayBar
              replay={replay}
              activeTimeframe={activePane.timeframe}
              onTogglePlay={handleToggleReplayPlay}
              onStepForward={handleStepForward}
              onJumpForward={handleJumpForwardReplay}
              onChangeSpeed={handleChangeReplaySpeed}
              onChangeTimeframe={handleChangeTimeframe}
              onToggleTimeframeSync={handleToggleReplayTimeframeSync}
              onExitReplay={handleExitReplay}
            />
          </div>
        )}

        {/* Floating Favorites Drawing Toolbar (Always Active in Both Live & Bar Replay when toggled ON) */}
        {showFavoritesToolbar && (
          <div className="pointer-events-none absolute right-0 bottom-8 left-0 z-30 flex justify-center px-2">
            <DrawingDock
              activeTool={activeTool}
              pinnedTools={pinnedTools}
              placementHint={placementHint}
              magnetMode={Boolean(activePane.magnetMode)}
              lockedDrawings={Boolean(activePane.lockedDrawings)}
              hiddenDrawings={Boolean(activePane.hiddenDrawings)}
              drawingCount={activePane.drawings.length}
              onSelectTool={(tool) => {
                setPlacementHint(null);
                setActiveTool(tool);
              }}
              onOpenDrawer={() => setActiveSheet('drawings')}
              onToggleMagnet={() =>
                updateActivePane((p) => ({ ...p, magnetMode: !p.magnetMode }))
              }
              onToggleLock={() =>
                updateActivePane((p) => ({
                  ...p,
                  lockedDrawings: !p.lockedDrawings,
                }))
              }
              onToggleHide={() =>
                updateActivePane((p) => ({
                  ...p,
                  hiddenDrawings: !p.hiddenDrawings,
                }))
              }
              onCancelPending={() => {
                setPlacementHint(null);
                setActiveTool('cursor');
              }}
              onClearAll={handleClearDrawings}
            />
          </div>
        )}
      </main>

      {/* Bottom TradingView Mobile Bar */}
      <BottomBar
        activeTimeframe={activePane.timeframe}
        activeSheet={activeSheet}
        openPositionCount={activePaperAccount.positions.length}
        onOpenSheet={(sheet) => {
          if (sheet === 'journal') setJournalInitialMode(null);
          setActiveSheet(sheet);
        }}
      />

      {/* Modals & Categorized Drawing Tools Drawer */}
      {activeSheet === 'symbol' && (
        <SymbolSearchModal
          activeSymbol={activePane.symbol}
          onSelectSymbol={handleChangeSymbol}
          onClose={() => setActiveSheet(null)}
        />
      )}

      {activeSheet === 'timeframe' && (
        <TimeframeModal
          activeTimeframe={activePane.timeframe}
          onSelectTimeframe={handleChangeTimeframe}
          onClose={() => setActiveSheet(null)}
        />
      )}

      {activeSheet === 'drawings' && (
        <DrawingToolsDrawer
          activeTool={activeTool}
          pinnedTools={pinnedTools}
          magnetMode={Boolean(activePane.magnetMode)}
          lockedDrawings={Boolean(activePane.lockedDrawings)}
          hiddenDrawings={Boolean(activePane.hiddenDrawings)}
          drawingCount={activePane.drawings.length}
          onSelectTool={(tool) => {
            setPlacementHint(null);
            setActiveTool(tool);
          }}
          onTogglePin={handleTogglePinTool}
          onToggleMagnet={() =>
            updateActivePane((p) => ({ ...p, magnetMode: !p.magnetMode }))
          }
          onToggleLock={() =>
            updateActivePane((p) => ({ ...p, lockedDrawings: !p.lockedDrawings }))
          }
          onToggleHide={() =>
            updateActivePane((p) => ({ ...p, hiddenDrawings: !p.hiddenDrawings }))
          }
          onClearAll={handleClearDrawings}
          onClose={() => setActiveSheet(null)}
        />
      )}

      {activeSheet === 'indicators' && (
        <IndicatorsModal
          activeIndicators={activePane.indicators}
          onToggleIndicator={handleToggleIndicator}
          onClose={() => setActiveSheet(null)}
        />
      )}

      {activeSheet === 'settings' && (
        <SettingsModal
          appearance={appearance}
          onChangeAppearance={setAppearance}
          alertSound={alertSound}
          onChangeAlertSound={(sound) => {
            unlockAlertAudio();
            setAlertSound(sound);
          }}
          onPreviewAlertSound={(sound) => {
            unlockAlertAudio();
            playAlertSound(sound);
          }}
          onClose={() => setActiveSheet(null)}
        />
      )}

      {activeSheet === 'watchlist' && (
        <WatchlistModal
          watchlist={watchlist}
          activeSymbol={activePane.symbol}
          onSelectSymbol={handleChangeSymbol}
          onAddSymbol={handleAddWatchlistSymbol}
          onRemoveSymbol={handleRemoveWatchlistSymbol}
          onClose={() => setActiveSheet(null)}
        />
      )}

      {activeSheet === 'paper' && (
        <PaperTradingModal
          liveAccounts={livePaperAccountsState.accounts}
          activeLiveAccountId={livePaperAccountsState.activeAccountId}
          liveAccount={livePaperAccount}
          replayAccount={replayPaperAccount}
          livePrices={livePrices}
          replayActive={replay.active}
          onSwitchLiveAccount={handleSwitchLiveAccount}
          onCreateLiveAccount={handleCreateLiveAccount}
          onDeleteLiveAccount={handleDeleteLiveAccount}
          onClosePosition={handleClosePosition}
          onCancelPendingOrder={handleCancelPendingOrder}
          onUpdatePositionTPSL={handleUpdatePositionTPSL}
          onResetAccount={handleResetPaperAccount}
          onOpenJournal={(mode) => {
            setJournalInitialMode(mode);
            setActiveSheet('journal');
          }}
          onClose={() => setActiveSheet(null)}
        />
      )}

      {activeSheet === 'journal' && (
        <TradingJournalModal
          liveAccountName={activeNamedLiveAccount.name}
          liveAccount={livePaperAccount}
          replayAccount={replayPaperAccount}
          initialMode={journalInitialMode ?? activeAccountMode}
          onUpdateTrade={handleUpdateTradeJournal}
          onClose={() => {
            setJournalInitialMode(null);
            setActiveSheet(null);
          }}
        />
      )}

      {activeSheet === 'alerts' && (
        <PriceAlertsModal
          activeSymbol={activePane.symbol}
          watchlist={watchlist}
          alerts={priceAlerts}
          livePrices={livePrices}
          onCreateAlert={handleCreatePriceAlert}
          onToggleAlert={handleTogglePriceAlert}
          onDeleteAlert={handleDeletePriceAlert}
          onClearTriggered={handleClearTriggeredAlerts}
          onSelectSymbol={handleChangeSymbol}
          selectedSound={alertSound}
          onChangeSound={(sound) => {
            unlockAlertAudio();
            setAlertSound(sound);
          }}
          onPreviewSound={(sound) => {
            unlockAlertAudio();
            playAlertSound(sound);
          }}
          onClose={() => setActiveSheet(null)}
        />
      )}

      {activeSheet === 'menu' && (
        <MenuModal
          layout={layout}
          layoutPresetId={layoutPreset}
          replayActive={replay.active}
          activeAlertCount={activeAlertCount}
          showExecutions={appearance.showExecutions ?? true}
          onToggleShowExecutions={() =>
            setAppearance((prev) => ({
              ...prev,
              showExecutions: !(prev.showExecutions ?? true),
            }))
          }
          onChangeLayout={setLayout}
          onOpenLayoutSheet={() => setLayoutMenuOpen(true)}
          onStartReplay={handleStartReplay}
          onOpenIndicators={() => setActiveSheet('indicators')}
          onOpenDrawingTools={() => setActiveSheet('drawings')}
          onOpenPriceAlerts={() => setActiveSheet('alerts')}
          onOpenGoToDate={() => setActiveSheet('goto')}
          onOpenSettings={() => setActiveSheet('settings')}
          onFitChart={handleFitChart}
          onScreenshot={handleScreenshot}
          onClose={() => setActiveSheet(null)}
        />
      )}

      {activeSheet === 'goto' && (
        <GoToDateModal
          symbol={activePane.symbol}
          timeframe={activePane.timeframe}
          onJumpToDate={handleJumpToDate}
          onClose={() => setActiveSheet(null)}
        />
      )}

      {layoutMenuOpen && (
        <LayoutSheetModal
          activePresetId={layoutPreset}
          syncOptions={layoutSync}
          onSelectPreset={setLayoutPreset}
          onToggleSyncOption={handleToggleLayoutSyncOption}
          onClose={() => setLayoutMenuOpen(false)}
        />
      )}
    </div>
  );
}
