import {
  Activity,
  Bell,
  CalendarClock,
  Camera,
  Check,
  Eye,
  EyeOff,
  History,
  KeyRound,
  LayoutGrid,
  MapPin,
  Maximize2,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sun,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import {
  fetchBatchTickers,
  formatPrice,
  getLiveApiStatus,
  subscribeLiveApiStatus,
  type LiveApiConnectionStatus,
} from '../services/binance';
import {
  ALERT_SOUND_OPTIONS,
  ASSET_CATEGORIES,
  DEFAULT_DARK_APPEARANCE,
  DEFAULT_LIGHT_APPEARANCE,
  SYMBOL_CATALOG,
  TIMEFRAME_GROUPS,
  getLayoutPresetMeta,
  type AlertSoundOption,
  type AssetCategory,
  type ChartAppearance,
  type IndicatorId,
  type LayoutCount,
  type LayoutPresetId,
  type Ticker24h,
  type Timeframe,
} from '../types/trading';
import { getMarketStatus, getSymbolCategory } from '../utils/marketHours';

function SheetContainer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[84vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-[#e0e3eb] bg-white shadow-2xl sm:rounded-2xl dark:border-[#2a2e39] dark:bg-[#1e222d]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#e0e3eb] sm:hidden dark:bg-[#363a45]" />
        <div className="flex items-center justify-between border-b border-[#f0f3fa] px-5 py-3.5 dark:border-[#2a2e39]">
          <h2 className="text-base font-bold text-[#131722] dark:text-[#d1d4dc]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}

/* 1. SYMBOL SEARCH MODAL (Futures, Stocks, Crypto) */
export function SymbolSearchModal({
  activeSymbol,
  onSelectSymbol,
  onClose,
}: {
  activeSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<AssetCategory>(() =>
    getSymbolCategory(activeSymbol)
  );
  const cleaned = query.trim().toUpperCase();

  const filtered = SYMBOL_CATALOG.filter((item) => {
    const matchesSearch =
      cleaned === '' ||
      item.symbol.includes(cleaned) ||
      item.displayName.toUpperCase().includes(cleaned);
    if (cleaned !== '') return matchesSearch;
    return item.category === activeTab;
  });

  const customValid =
    cleaned.length >= 2 && !SYMBOL_CATALOG.some((s) => s.symbol === cleaned);

  return (
    <SheetContainer title="Symbol Search" onClose={onClose}>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[#787b86]" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Futures, Stocks, Crypto..."
          className="h-11 w-full rounded-xl border border-[#e0e3eb] bg-[#f8fafd] pr-4 pl-10 text-sm font-medium text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
        />
      </div>

      {/* Strictly 3 Category Tabs: Futures, Stocks, Crypto */}
      {cleaned === '' && (
        <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-[#f0f3fa] p-1 dark:bg-[#131722]">
          {ASSET_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveTab(cat)}
              className={`min-h-[34px] rounded-lg px-2 text-xs font-semibold transition-colors ${
                activeTab === cat
                  ? 'bg-white text-[#2962ff] shadow-xs dark:bg-[#2a2e39] dark:text-white'
                  : 'text-[#787b86] hover:text-[#131722] dark:hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {customValid && (
        <button
          type="button"
          onClick={() => {
            onSelectSymbol(cleaned);
            onClose();
          }}
          className="mb-3 flex min-h-[48px] w-full items-center justify-between rounded-xl border border-[#2962ff]/30 bg-[#2962ff]/5 px-4 py-2.5 text-left hover:bg-[#2962ff]/10"
        >
          <div>
            <div className="text-sm font-bold text-[#2962ff]">{cleaned}</div>
            <div className="text-xs text-[#787b86]">Load symbol directly</div>
          </div>
          <span className="text-xs font-semibold text-[#2962ff]">Load</span>
        </button>
      )}

      <div className="divide-y divide-[#f0f3fa] dark:divide-[#2a2e39]">
        {filtered.map((item) => {
          const isSelected = item.symbol === activeSymbol;
          const mkt = getMarketStatus(item.symbol);
          return (
            <button
              key={item.symbol}
              type="button"
              onClick={() => {
                onSelectSymbol(item.symbol);
                onClose();
              }}
              className="flex min-h-[54px] w-full items-center justify-between px-2 py-2.5 text-left transition-colors hover:bg-[#f8fafd] dark:hover:bg-[#131722]/60"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f0f3fa] text-[11px] font-bold text-[#131722] dark:bg-[#2a2e39] dark:text-[#d1d4dc]">
                  {item.symbol.slice(0, 3)}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-[#131722] dark:text-[#d1d4dc]">
                      {item.symbol}
                    </span>
                    {!mkt.isOpen && (
                      <span className="rounded bg-[#f59e0b]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#d97706] dark:text-[#fbbf24]">
                        {mkt.label}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-[#787b86]">{item.displayName}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-[#787b86]">
                <span>{item.exchange}</span>
                {isSelected && <Check className="h-4 w-4 text-[#2962ff]" />}
              </div>
            </button>
          );
        })}
      </div>
    </SheetContainer>
  );
}

/* 2. TIMEFRAME MODAL (All 18 intervals grouped by category) */
export function TimeframeModal({
  activeTimeframe,
  onSelectTimeframe,
  onClose,
}: {
  activeTimeframe: Timeframe;
  onSelectTimeframe: (tf: Timeframe) => void;
  onClose: () => void;
}) {
  return (
    <SheetContainer title="Time Interval (18 Timeframes)" onClose={onClose}>
      <div className="space-y-4">
        {TIMEFRAME_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="mb-2 text-xs font-bold text-[#787b86]">
              {group.label}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {group.items.map((tf) => {
                const active = tf === activeTimeframe;
                return (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => {
                      onSelectTimeframe(tf);
                      onClose();
                    }}
                    className={`flex min-h-[42px] items-center justify-center rounded-xl border font-mono-tabular text-xs font-bold transition-colors ${
                      active
                        ? 'border-[#2962ff] bg-[#2962ff] text-white'
                        : 'border-[#e0e3eb] bg-[#f8fafd] text-[#131722] hover:border-[#2962ff]/50 dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]'
                    }`}
                  >
                    {tf}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </SheetContainer>
  );
}

/* 3. INDICATORS (fx) MODAL */
const INDICATOR_META: Array<{
  id: IndicatorId;
  name: string;
  desc: string;
  color: string;
}> = [
  {
    id: 'volume',
    name: 'Volume',
    desc: 'Histogram bars scaled at the bottom of the price pane',
    color: '#2962ff',
  },
  {
    id: 'ema20',
    name: 'EMA 20',
    desc: '20-period Exponential Moving Average',
    color: '#f59e0b',
  },
  {
    id: 'ema50',
    name: 'EMA 50',
    desc: '50-period Exponential Moving Average',
    color: '#8b5cf6',
  },
  {
    id: 'sma20',
    name: 'SMA 20',
    desc: '20-period Simple Moving Average',
    color: '#089981',
  },
  {
    id: 'bb',
    name: 'Bollinger Bands (20, 2)',
    desc: 'Upper, middle, and lower 2-sigma volatility bands',
    color: '#0ea5e9',
  },
  {
    id: 'rsi14',
    name: 'RSI (14)',
    desc: 'Relative Strength Index oscillator in dedicated lower pane',
    color: '#7e57c2',
  },
];

export function IndicatorsModal({
  activeIndicators,
  onToggleIndicator,
  onClose,
}: {
  activeIndicators: IndicatorId[];
  onToggleIndicator: (id: IndicatorId) => void;
  onClose: () => void;
}) {
  return (
    <SheetContainer title="Indicators & Studies" onClose={onClose}>
      <div className="divide-y divide-[#f0f3fa] dark:divide-[#2a2e39]">
        {INDICATOR_META.map((ind) => {
          const active = activeIndicators.includes(ind.id);
          return (
            <button
              key={ind.id}
              type="button"
              onClick={() => onToggleIndicator(ind.id)}
              className="flex min-h-[60px] w-full items-center justify-between gap-3 px-2 py-3 text-left transition-colors hover:bg-[#f8fafd] dark:hover:bg-[#131722]/60"
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: ind.color }}
                />
                <div>
                  <div className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                    {ind.name}
                  </div>
                  <div className="text-xs text-[#787b86]">{ind.desc}</div>
                </div>
              </div>
              <span
                className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  active ? 'bg-[#2962ff]' : 'bg-[#e0e3eb] dark:bg-[#363a45]'
                }`}
              >
                <span
                  className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    active ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </span>
            </button>
          );
        })}
      </div>
    </SheetContainer>
  );
}

/* 4. SETTINGS GEAR MODAL (Colors, Theme & Finnhub API Key) */
const CANDLE_COLOR_PRESETS = [
  { name: 'NasChart Blue', up: '#2962ff', down: '#0c3299' },
  { name: 'Classic Emerald / Red', up: '#089981', down: '#f23645' },
  { name: 'Monochrome Slate', up: '#131722', down: '#9598a1' },
  { name: 'Violet / Amber', up: '#7e57c2', down: '#f59e0b' },
];

export function SettingsModal({
  appearance,
  onChangeAppearance,
  alertSound,
  onChangeAlertSound,
  onPreviewAlertSound,
  onClose,
}: {
  appearance: ChartAppearance;
  onChangeAppearance: (next: ChartAppearance) => void;
  alertSound: AlertSoundOption;
  onChangeAlertSound: (sound: AlertSoundOption) => void;
  onPreviewAlertSound: (sound: AlertSoundOption) => void;
  onClose: () => void;
}) {
  const [showFinnhubKey, setShowFinnhubKey] = useState(false);
  const [apiStatus, setApiStatus] = useState<LiveApiConnectionStatus>(() =>
    getLiveApiStatus()
  );
  const selectedSoundMeta =
    ALERT_SOUND_OPTIONS.find((s) => s.id === alertSound) ?? ALERT_SOUND_OPTIONS[0];

  useEffect(() => {
    return subscribeLiveApiStatus(setApiStatus);
  }, []);

  const handleThemeSwitch = (theme: 'light' | 'dark') => {
    const defaultBg = theme === 'light' ? '#ffffff' : '#131722';
    const currentIsDefaultBg =
      appearance.backgroundColor.toLowerCase() === '#ffffff' ||
      appearance.backgroundColor.toLowerCase() === '#131722';

    onChangeAppearance({
      ...appearance,
      theme,
      backgroundColor: currentIsDefaultBg ? defaultBg : appearance.backgroundColor,
    });
  };

  return (
    <SheetContainer title="Chart Settings & Data Feeds" onClose={onClose}>
      <div className="space-y-5">
        {/* Theme Mode */}
        <div>
          <div className="mb-2 text-xs font-semibold text-[#787b86]">
            Theme Mode
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => handleThemeSwitch('light')}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors ${
                appearance.theme === 'light'
                  ? 'border-[#2962ff] bg-[#2962ff] text-white'
                  : 'border-[#e0e3eb] bg-[#f8fafd] text-[#131722] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]'
              }`}
            >
              <Sun className="h-4 w-4" />
              <span>Light Mode</span>
            </button>
            <button
              type="button"
              onClick={() => handleThemeSwitch('dark')}
              className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors ${
                appearance.theme === 'dark'
                  ? 'border-[#2962ff] bg-[#2962ff] text-white'
                  : 'border-[#e0e3eb] bg-[#f8fafd] text-[#131722] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]'
              }`}
            >
              <Moon className="h-4 w-4" />
              <span>Dark Mode</span>
            </button>
          </div>
        </div>

        {/* Live Market Data API Key (Finnhub) */}
        <div className="space-y-3 rounded-xl border border-[#e0e3eb] bg-[#f8fafd] p-3.5 dark:border-[#2a2e39] dark:bg-[#131722]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-[#131722] dark:text-[#d1d4dc]">
              <KeyRound className="h-3.5 w-3.5 text-[#2962ff]" />
              <span>Finnhub Live Data Feed (Stocks & Futures)</span>
            </div>

            {apiStatus.state === 'connected' && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-[#089981]/15 px-2.5 py-0.5 text-[11px] font-bold text-[#089981] dark:bg-[#089981]/20 dark:text-[#22c55e]"
                title="Subscribed via Finnhub WebSocket"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#089981] dark:bg-[#22c55e]" />
                <span>Connected — Live Finnhub WS</span>
              </span>
            )}
            {apiStatus.state === 'connecting' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2962ff]/12 px-2.5 py-0.5 text-[11px] font-semibold text-[#2962ff]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2962ff]" />
                <span>Connecting Finnhub WS...</span>
              </span>
            )}
            {apiStatus.state === 'error' && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-[#f23645]/12 px-2.5 py-0.5 text-[11px] font-semibold text-[#f23645]"
                title={apiStatus.errorMessage}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#f23645]" />
                <span>{apiStatus.errorMessage || 'Check Finnhub Key'}</span>
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-[#787b86]">
            Crypto streams 24/7 via Binance WebSocket. Paste your Finnhub API key below for real-time WebSocket streaming & quotes across Stocks (AAPL, NVDA, TSLA, MSFT, AMZN) and Futures (QQQ→NQ1!, SPY→ES1!, DIA→YM1!, USO→CL1!).
          </p>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-[#131722] dark:text-[#d1d4dc]">
              Finnhub API Key
            </label>
            <div className="flex items-center gap-2">
              <input
                type={showFinnhubKey ? 'text' : 'password'}
                value={appearance.finnhubApiKey ?? ''}
                onChange={(e) =>
                  onChangeAppearance({
                    ...appearance,
                    finnhubApiKey: e.target.value,
                  })
                }
                placeholder="Paste Finnhub API key..."
                className="h-9 flex-1 rounded-lg border border-[#e0e3eb] bg-white px-3 font-mono-tabular text-xs text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
              />
              <button
                type="button"
                onClick={() => setShowFinnhubKey((v) => !v)}
                aria-label={showFinnhubKey ? 'Hide Finnhub API key' : 'Show Finnhub API key'}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#e0e3eb] bg-white text-[#787b86] hover:text-[#131722] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:hover:text-white"
              >
                {showFinnhubKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        {/* Price Alert Sound Selector */}
        <div className="space-y-2.5 rounded-xl border border-[#e0e3eb] bg-[#f8fafd] p-3.5 dark:border-[#2a2e39] dark:bg-[#131722]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-[#131722] dark:text-[#d1d4dc]">
              <Volume2 className="h-3.5 w-3.5 text-[#f59e0b]" />
              <span>Price Alert Sound</span>
            </div>
            <span className="text-[11px] text-[#787b86]">
              {selectedSoundMeta.description}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={alertSound}
              onChange={(e) => onChangeAlertSound(e.target.value as AlertSoundOption)}
              aria-label="Select alert sound"
              className="h-9 flex-1 rounded-lg border border-[#e0e3eb] bg-white px-3 text-xs font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
            >
              {ALERT_SOUND_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onPreviewAlertSound(alertSound)}
              disabled={alertSound === 'silent'}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#e0e3eb] bg-white px-3 text-xs font-semibold text-[#131722] transition-colors hover:border-[#2962ff] hover:text-[#2962ff] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
            >
              <Volume2 className="h-3.5 w-3.5 text-[#f59e0b]" />
              <span>Preview Sound</span>
            </button>
          </div>
        </div>

        {/* On-Chart Trade Execution Markers Toggle */}
        <button
          type="button"
          onClick={() =>
            onChangeAppearance({
              ...appearance,
              showExecutions: !(appearance.showExecutions ?? true),
            })
          }
          className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3.5 py-2.5 text-left dark:border-[#2a2e39] dark:bg-[#131722]"
        >
          <div className="flex items-center gap-2.5">
            <MapPin className="h-4 w-4 shrink-0 text-[#2962ff]" />
            <div>
              <div className="text-xs font-bold text-[#131722] dark:text-[#d1d4dc]">
                Show Executions / Trade History Marks
              </div>
              <div className="text-[11px] text-[#787b86]">
                Display Buy (▲) &amp; Sell (▼) execution arrows directly on candlesticks
              </div>
            </div>
          </div>
          <span
            className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
              (appearance.showExecutions ?? true)
                ? 'bg-[#2962ff]'
                : 'bg-[#e0e3eb] dark:bg-[#363a45]'
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                (appearance.showExecutions ?? true) ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </span>
        </button>

        {/* Presets */}
        <div>
          <div className="mb-2 text-xs font-semibold text-[#787b86]">
            Quick Candle Presets
          </div>
          <div className="grid grid-cols-2 gap-2">
            {CANDLE_COLOR_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() =>
                  onChangeAppearance({
                    ...appearance,
                    upColor: preset.up,
                    upWickColor: preset.up,
                    downColor: preset.down,
                    downWickColor: preset.down,
                  })
                }
                className="flex min-h-[42px] items-center gap-2.5 rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3 py-2 text-left text-xs font-semibold text-[#131722] hover:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
              >
                <span className="flex items-center gap-1">
                  <span
                    className="h-3.5 w-2 rounded-[2px]"
                    style={{ backgroundColor: preset.up }}
                  />
                  <span
                    className="h-3.5 w-2 rounded-[2px]"
                    style={{ backgroundColor: preset.down }}
                  />
                </span>
                <span className="truncate">{preset.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Individual Color Pickers */}
        <div className="space-y-3 border-t border-[#f0f3fa] pt-4 dark:border-[#2a2e39]">
          <div className="text-xs font-semibold text-[#787b86]">
            Custom Candle & Background Colors
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex min-h-[46px] items-center justify-between rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3.5 py-2 dark:border-[#2a2e39] dark:bg-[#131722]">
              <span className="text-xs font-semibold text-[#131722] dark:text-[#d1d4dc]">
                Up Body
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono-tabular text-[11px] text-[#787b86]">
                  {appearance.upColor}
                </span>
                <input
                  type="color"
                  value={appearance.upColor}
                  onChange={(e) =>
                    onChangeAppearance({ ...appearance, upColor: e.target.value })
                  }
                  className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </span>
            </label>

            <label className="flex min-h-[46px] items-center justify-between rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3.5 py-2 dark:border-[#2a2e39] dark:bg-[#131722]">
              <span className="text-xs font-semibold text-[#131722] dark:text-[#d1d4dc]">
                Down Body
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono-tabular text-[11px] text-[#787b86]">
                  {appearance.downColor}
                </span>
                <input
                  type="color"
                  value={appearance.downColor}
                  onChange={(e) =>
                    onChangeAppearance({ ...appearance, downColor: e.target.value })
                  }
                  className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </span>
            </label>

            <label className="flex min-h-[46px] items-center justify-between rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3.5 py-2 dark:border-[#2a2e39] dark:bg-[#131722]">
              <span className="text-xs font-semibold text-[#131722] dark:text-[#d1d4dc]">
                Up Wick
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono-tabular text-[11px] text-[#787b86]">
                  {appearance.upWickColor}
                </span>
                <input
                  type="color"
                  value={appearance.upWickColor}
                  onChange={(e) =>
                    onChangeAppearance({
                      ...appearance,
                      upWickColor: e.target.value,
                    })
                  }
                  className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </span>
            </label>

            <label className="flex min-h-[46px] items-center justify-between rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3.5 py-2 dark:border-[#2a2e39] dark:bg-[#131722]">
              <span className="text-xs font-semibold text-[#131722] dark:text-[#d1d4dc]">
                Down Wick
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono-tabular text-[11px] text-[#787b86]">
                  {appearance.downWickColor}
                </span>
                <input
                  type="color"
                  value={appearance.downWickColor}
                  onChange={(e) =>
                    onChangeAppearance({
                      ...appearance,
                      downWickColor: e.target.value,
                    })
                  }
                  className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </span>
            </label>
          </div>

          <label className="flex min-h-[46px] items-center justify-between rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3.5 py-2 dark:border-[#2a2e39] dark:bg-[#131722]">
            <span className="text-xs font-semibold text-[#131722] dark:text-[#d1d4dc]">
              Chart Background
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono-tabular text-[11px] text-[#787b86]">
                {appearance.backgroundColor}
              </span>
              <input
                type="color"
                value={appearance.backgroundColor}
                onChange={(e) =>
                  onChangeAppearance({
                    ...appearance,
                    backgroundColor: e.target.value,
                  })
                }
                className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
              />
            </span>
          </label>
        </div>

        {/* Reset */}
        <button
          type="button"
          onClick={() =>
            onChangeAppearance({
              ...(appearance.theme === 'dark'
                ? DEFAULT_DARK_APPEARANCE
                : DEFAULT_LIGHT_APPEARANCE),
              finnhubApiKey: appearance.finnhubApiKey,
            })
          }
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-[#e0e3eb] text-xs font-semibold text-[#787b86] hover:bg-[#f8fafd] hover:text-[#131722] dark:border-[#2a2e39] dark:hover:bg-[#131722] dark:hover:text-white"
        >
          <RotateCcw className="h-4 w-4" />
          <span>Reset to NasChart Mobile Defaults</span>
        </button>
      </div>
    </SheetContainer>
  );
}

/* 5. WATCHLIST MODAL (Organized into Futures, Stocks, Crypto) */
export function WatchlistModal({
  watchlist,
  activeSymbol,
  onSelectSymbol,
  onAddSymbol,
  onRemoveSymbol,
  onClose,
}: {
  watchlist: string[];
  activeSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  onAddSymbol: (symbol: string) => void;
  onRemoveSymbol: (symbol: string) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<AssetCategory>(() =>
    getSymbolCategory(activeSymbol)
  );
  const [tickers, setTickers] = useState<Record<string, Ticker24h>>({});
  const [newSym, setNewSym] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (watchlist.length === 0) return;
      const data = await fetchBatchTickers(watchlist);
      if (!cancelled) setTickers(data);
    };
    load();
    const id = window.setInterval(load, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [watchlist]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newSym.trim().toUpperCase();
    if (!cleaned) return;
    onAddSymbol(cleaned);
    setActiveTab(getSymbolCategory(cleaned));
    setNewSym('');
  };

  const tabSymbols = watchlist.filter(
    (sym) => getSymbolCategory(sym) === activeTab
  );

  return (
    <SheetContainer title="Watchlist" onClose={onClose}>
      {/* Strictly 3 Tabs: Futures, Stocks, Crypto */}
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl bg-[#f0f3fa] p-1 dark:bg-[#131722]">
        {ASSET_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActiveTab(cat)}
            className={`min-h-[34px] rounded-lg px-2 text-xs font-semibold transition-colors ${
              activeTab === cat
                ? 'bg-white text-[#2962ff] shadow-xs dark:bg-[#2a2e39] dark:text-white'
                : 'text-[#787b86] hover:text-[#131722] dark:hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <form onSubmit={handleAdd} className="mb-3 flex gap-2">
        <input
          type="text"
          value={newSym}
          onChange={(e) => setNewSym(e.target.value)}
          placeholder="Add symbol (e.g. AAPL, BTCUSDT)"
          className="h-10 flex-1 rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3 text-sm font-medium text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
        />
        <button
          type="submit"
          className="flex h-10 items-center gap-1 rounded-xl bg-[#2962ff] px-3.5 text-xs font-semibold text-white hover:bg-[#1e53e5]"
        >
          <Plus className="h-4 w-4" />
          <span>Add</span>
        </button>
      </form>

      <div className="divide-y divide-[#f0f3fa] dark:divide-[#2a2e39]">
        {tabSymbols.length === 0 && (
          <div className="py-8 text-center text-xs text-[#787b86]">
            No symbols saved in {activeTab} yet.
          </div>
        )}
        {tabSymbols.map((sym) => {
          const meta = SYMBOL_CATALOG.find((s) => s.symbol === sym);
          const t = tickers[sym];
          const pct = t?.priceChangePercent ?? 0;
          const pos = pct >= 0;
          const isCurrent = sym === activeSymbol;
          const mkt = getMarketStatus(sym);

          return (
            <div
              key={sym}
              className={`flex min-h-[58px] items-center justify-between gap-2 px-2 py-2 ${
                isCurrent ? 'bg-[#2962ff]/5' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  onSelectSymbol(sym);
                  onClose();
                }}
                className="flex flex-1 items-center justify-between text-left"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-[#131722] dark:text-[#d1d4dc]">
                      {sym}
                    </span>
                    {!mkt.isOpen && (
                      <span className="rounded bg-[#f59e0b]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#d97706] dark:text-[#fbbf24]">
                        {mkt.label}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#787b86]">
                    {meta?.displayName ?? activeTab}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono-tabular text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                    {t ? formatPrice(t.lastPrice) : '—'}
                  </div>
                  <div
                    className={`font-mono-tabular text-xs font-semibold ${
                      pos ? 'text-[#089981]' : 'text-[#f23645]'
                    }`}
                  >
                    {t ? `${pos ? '+' : ''}${pct.toFixed(2)}%` : '—'}
                  </div>
                </div>
              </button>

              {watchlist.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemoveSymbol(sym)}
                  aria-label={`Remove ${sym}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#787b86] hover:bg-[#f23645]/10 hover:text-[#f23645]"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </SheetContainer>
  );
}

/* 6. MENU MODAL */
export function MenuModal({
  layout,
  layoutPresetId,
  replayActive,
  activeAlertCount = 0,
  showExecutions = true,
  onToggleShowExecutions,
  onChangeLayout,
  onOpenLayoutSheet,
  onStartReplay,
  onOpenIndicators,
  onOpenDrawingTools,
  onOpenPriceAlerts,
  onOpenGoToDate,
  onOpenSettings,
  onFitChart,
  onScreenshot,
  onClose,
}: {
  layout: LayoutCount;
  layoutPresetId: LayoutPresetId;
  replayActive: boolean;
  activeAlertCount?: number;
  showExecutions?: boolean;
  onToggleShowExecutions: () => void;
  onChangeLayout: (layout: LayoutCount) => void;
  onOpenLayoutSheet: () => void;
  onStartReplay: () => void;
  onOpenIndicators: () => void;
  onOpenDrawingTools: () => void;
  onOpenPriceAlerts: () => void;
  onOpenGoToDate: () => void;
  onOpenSettings: () => void;
  onFitChart: () => void;
  onScreenshot: () => void;
  onClose: () => void;
}) {
  const activePresetMeta = getLayoutPresetMeta(layoutPresetId);

  return (
    <SheetContainer title="Chart Tools & Workspace" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[#787b86]">
            <div className="flex items-center gap-1.5">
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Multi-Chart Grid Layout</span>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenLayoutSheet();
              }}
              className="text-xs font-bold text-[#2962ff] hover:underline"
            >
              {activePresetMeta.label} ›
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {([1, 2, 3, 4] as LayoutCount[]).map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => {
                  onChangeLayout(count);
                  onClose();
                }}
                className={`flex min-h-[46px] flex-col items-center justify-center rounded-xl border text-xs font-bold transition-colors ${
                  layout === count
                    ? 'border-[#2962ff] bg-[#2962ff] text-white'
                    : 'border-[#e0e3eb] bg-[#f8fafd] text-[#131722] hover:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]'
                }`}
              >
                {count} {count === 1 ? 'Pane' : 'Panes'}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-[#f0f3fa] rounded-xl border border-[#e0e3eb] dark:divide-[#2a2e39] dark:border-[#2a2e39]">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenIndicators();
            }}
            className="flex min-h-[52px] w-full items-center justify-between px-4 text-left hover:bg-[#f8fafd] dark:hover:bg-[#131722]/60"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#2962ff]/12 font-mono-tabular text-xs font-extrabold text-[#2962ff]">
                fx
              </div>
              <div>
                <div className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  Indicators
                </div>
                <div className="text-xs text-[#787b86]">
                  Add EMA, SMA, Bollinger Bands, Volume &amp; RSI
                </div>
              </div>
            </div>
            <Activity className="h-4 w-4 text-[#787b86]" />
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenDrawingTools();
            }}
            className="flex min-h-[52px] w-full items-center justify-between px-4 text-left hover:bg-[#f8fafd] dark:hover:bg-[#131722]/60"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#2962ff]/12 text-[#2962ff]">
                <Pencil className="h-3.5 w-3.5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  Drawing Tools
                </div>
                <div className="text-xs text-[#787b86]">
                  Trendlines, Fibs, Long/Short Boxes, Rulers &amp; Shapes
                </div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onStartReplay();
            }}
            className="flex min-h-[52px] w-full items-center justify-between px-4 text-left hover:bg-[#f8fafd] dark:hover:bg-[#131722]/60"
          >
            <div className="flex items-center gap-3">
              <History className="h-5 w-5 text-[#2962ff]" />
              <div>
                <div className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  {replayActive ? 'Restart Bar Replay' : 'Bar Replay Mode'}
                </div>
                <div className="text-xs text-[#787b86]">
                  Slice history at any candle and step bar-by-bar
                </div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenPriceAlerts();
            }}
            className="flex min-h-[52px] w-full items-center justify-between px-4 text-left hover:bg-[#f8fafd] dark:hover:bg-[#131722]/60"
          >
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-[#f59e0b]" />
              <div>
                <div className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  Price Alerts
                </div>
                <div className="text-xs text-[#787b86]">
                  Notify when live market feed crosses target prices
                </div>
              </div>
            </div>
            {activeAlertCount > 0 && (
              <span className="rounded-full bg-[#f59e0b]/15 px-2 py-0.5 font-mono-tabular text-xs font-bold text-[#d97706] dark:text-[#fbbf24]">
                {activeAlertCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenGoToDate();
            }}
            className="flex min-h-[52px] w-full items-center justify-between px-4 text-left hover:bg-[#f8fafd] dark:hover:bg-[#131722]/60"
          >
            <div className="flex items-center gap-3">
              <CalendarClock className="h-5 w-5 text-[#2962ff]" />
              <div>
                <div className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  Go to Date...
                </div>
                <div className="text-xs text-[#787b86]">
                  Jump & center chart on any date/time (or long-press time axis)
                </div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onToggleShowExecutions}
            className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 text-left hover:bg-[#f8fafd] dark:hover:bg-[#131722]/60"
          >
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-[#2962ff]" />
              <div>
                <div className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  Show Executions / Trade History Marks
                </div>
                <div className="text-xs text-[#787b86]">
                  Toggle Buy (▲) &amp; Sell (▼) execution markers on the chart
                </div>
              </div>
            </div>
            <span
              className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                showExecutions ? 'bg-[#2962ff]' : 'bg-[#e0e3eb] dark:bg-[#363a45]'
              }`}
            >
              <span
                className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  showExecutions ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
            className="flex min-h-[52px] w-full items-center justify-between px-4 text-left hover:bg-[#f8fafd] dark:hover:bg-[#131722]/60"
          >
            <div className="flex items-center gap-3">
              <Settings className="h-5 w-5 text-[#787b86]" />
              <div>
                <div className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  Chart Colors, Theme &amp; API Key
                </div>
                <div className="text-xs text-[#787b86]">
                  Customize candles, background, Light/Dark, Finnhub API key
                </div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              onFitChart();
              onClose();
            }}
            className="flex min-h-[52px] w-full items-center justify-between px-4 text-left hover:bg-[#f8fafd] dark:hover:bg-[#131722]/60"
          >
            <div className="flex items-center gap-3">
              <Maximize2 className="h-5 w-5 text-[#787b86]" />
              <div>
                <div className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  Reset & Fit Chart Scale
                </div>
                <div className="text-xs text-[#787b86]">
                  Auto-fit visible candles on active pane
                </div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              onScreenshot();
              onClose();
            }}
            className="flex min-h-[52px] w-full items-center justify-between px-4 text-left hover:bg-[#f8fafd] dark:hover:bg-[#131722]/60"
          >
            <div className="flex items-center gap-3">
              <Camera className="h-5 w-5 text-[#787b86]" />
              <div>
                <div className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  Save Chart Snapshot
                </div>
                <div className="text-xs text-[#787b86]">
                  Download PNG image of the active chart pane
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>
    </SheetContainer>
  );
}

/* 7. GO TO DATE & TIME MODAL */
function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toTimeInputValue(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function GoToDateModal({
  symbol,
  timeframe,
  onJumpToDate,
  onClose,
}: {
  symbol: string;
  timeframe: Timeframe;
  onJumpToDate: (targetTimeSec: number) => void;
  onClose: () => void;
}) {
  const now = new Date();
  const [dateStr, setDateStr] = useState(() => {
    const yesterday = new Date(now.getTime() - 86400 * 1000);
    return toDateInputValue(yesterday);
  });
  const [timeStr, setTimeStr] = useState(() => toTimeInputValue(now));

  const applyDaysAgo = (days: number) => {
    const d = new Date(Date.now() - days * 86400 * 1000);
    setDateStr(toDateInputValue(d));
    setTimeStr(toTimeInputValue(d));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dateStr) return;
    const combined = new Date(`${dateStr}T${timeStr || '00:00'}:00`);
    const ts = Math.floor(combined.getTime() / 1000);
    if (!Number.isNaN(ts)) {
      onJumpToDate(ts);
      onClose();
    }
  };

  return (
    <SheetContainer title="Go to Date & Time" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3.5 py-2.5 text-xs text-[#787b86] dark:border-[#2a2e39] dark:bg-[#131722]">
          Jump & center <span className="font-bold text-[#131722] dark:text-white">{symbol}</span> ({timeframe}) onto any date and time within the last 30+ days of price action.
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-[#787b86]">
            Quick Presets
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              { label: '1d ago', days: 1 },
              { label: '7d ago', days: 7 },
              { label: '14d ago', days: 14 },
              { label: '29d ago', days: 29 },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyDaysAgo(p.days)}
                className="min-h-[36px] rounded-lg border border-[#e0e3eb] bg-[#f8fafd] px-2 font-mono-tabular text-xs font-semibold text-[#131722] hover:border-[#2962ff] hover:text-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="block text-xs font-semibold text-[#787b86]">
              Target Date
            </span>
            <input
              type="date"
              required
              max={toDateInputValue(now)}
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="h-11 w-full rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3 font-mono-tabular text-sm font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
            />
          </label>

          <label className="space-y-1.5">
            <span className="block text-xs font-semibold text-[#787b86]">
              Target Time (Local)
            </span>
            <input
              type="time"
              required
              value={timeStr}
              onChange={(e) => setTimeStr(e.target.value)}
              className="h-11 w-full rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3 font-mono-tabular text-sm font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
            />
          </label>
        </div>

        <button
          type="submit"
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#2962ff] text-sm font-bold text-white transition-colors hover:bg-[#1e53e5]"
        >
          <CalendarClock className="h-4 w-4" />
          <span>Go to Selected Date & Time</span>
        </button>
      </form>
    </SheetContainer>
  );
}
