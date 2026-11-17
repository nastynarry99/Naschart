import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowUpDown,
  Bell,
  BellOff,
  BellRing,
  Plus,
  RotateCcw,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BASE_PRICES, formatPrice, getDecimalsForPrice } from '../services/binance';
import {
  ALERT_SOUND_OPTIONS,
  SYMBOL_CATALOG,
  type AlertSoundOption,
  type PriceAlert,
  type PriceAlertCondition,
} from '../types/trading';

interface PriceAlertsModalProps {
  activeSymbol: string;
  watchlist: string[];
  alerts: PriceAlert[];
  livePrices: Record<string, number>;
  onCreateAlert: (alert: {
    symbol: string;
    targetPrice: number;
    condition: PriceAlertCondition;
    repeat: boolean;
    note?: string;
  }) => void;
  onToggleAlert: (id: string) => void;
  onDeleteAlert: (id: string) => void;
  onClearTriggered: () => void;
  onSelectSymbol: (symbol: string) => void;
  selectedSound: AlertSoundOption;
  onChangeSound: (sound: AlertSoundOption) => void;
  onPreviewSound: (sound: AlertSoundOption) => void;
  onClose: () => void;
}

type AlertTab = 'active' | 'triggered' | 'all';

function formatAlertTime(tsMs: number): string {
  return new Date(tsMs).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function getConditionMeta(condition: PriceAlertCondition): {
  label: string;
  shortLabel: string;
  colorClass: string;
} {
  if (condition === 'crossing_up') {
    return {
      label: 'Crossing Up',
      shortLabel: 'Cross ↑',
      colorClass: 'bg-[#089981]/12 text-[#089981]',
    };
  }
  if (condition === 'crossing_down') {
    return {
      label: 'Crossing Down',
      shortLabel: 'Cross ↓',
      colorClass: 'bg-[#f23645]/12 text-[#f23645]',
    };
  }
  return {
    label: 'Crossing',
    shortLabel: 'Cross ↕',
    colorClass: 'bg-[#2962ff]/12 text-[#2962ff]',
  };
}

export function PriceAlertsModal({
  activeSymbol,
  watchlist,
  alerts,
  livePrices,
  onCreateAlert,
  onToggleAlert,
  onDeleteAlert,
  onClearTriggered,
  onSelectSymbol,
  selectedSound,
  onChangeSound,
  onPreviewSound,
  onClose,
}: PriceAlertsModalProps) {
  const symbolOptions = useMemo(() => {
    const set = new Set<string>([
      activeSymbol,
      ...watchlist,
      ...SYMBOL_CATALOG.map((s) => s.symbol),
    ]);
    return Array.from(set);
  }, [activeSymbol, watchlist]);

  const [selectedSymbol, setSelectedSymbol] = useState(activeSymbol);
  const currentRefPrice =
    livePrices[selectedSymbol] ?? BASE_PRICES[selectedSymbol] ?? 100;

  const [targetInput, setTargetInput] = useState(() => {
    const decimals = getDecimalsForPrice(currentRefPrice);
    return currentRefPrice.toFixed(decimals);
  });
  const [condition, setCondition] = useState<PriceAlertCondition>('crossing');
  const [repeat, setRepeat] = useState(false);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [tab, setTab] = useState<AlertTab>('active');

  useEffect(() => {
    const px = livePrices[selectedSymbol] ?? BASE_PRICES[selectedSymbol] ?? 100;
    const decimals = getDecimalsForPrice(px);
    setTargetInput(px.toFixed(decimals));
    setCondition('crossing');
    setFormError(null);
  }, [selectedSymbol]); // intentionally reset input only when symbol changes

  const applyPresetOffset = (pctOffset: number) => {
    const basePx = livePrices[selectedSymbol] ?? BASE_PRICES[selectedSymbol] ?? 100;
    const nextPx = basePx * (1 + pctOffset);
    const decimals = getDecimalsForPrice(basePx);
    setTargetInput(nextPx.toFixed(decimals));
    if (pctOffset > 0) setCondition('crossing_up');
    else if (pctOffset < 0) setCondition('crossing_down');
    else setCondition('crossing');
    setFormError(null);
  };

  const handleTargetChange = (val: string) => {
    setTargetInput(val);
    setFormError(null);
    const parsed = parseFloat(val);
    const livePx = livePrices[selectedSymbol];
    if (Number.isFinite(parsed) && livePx !== undefined && livePx > 0) {
      if (parsed > livePx * 1.0001) setCondition('crossing_up');
      else if (parsed < livePx * 0.9999) setCondition('crossing_down');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetPrice = parseFloat(targetInput);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
      setFormError('Enter a valid target price above 0');
      return;
    }

    onCreateAlert({
      symbol: selectedSymbol,
      targetPrice,
      condition,
      repeat,
      note: note.trim() || undefined,
    });
    setNote('');
    setTab('active');
    setFormError(null);
  };

  const activeAlerts = alerts.filter((a) => a.active);
  const triggeredAlerts = alerts.filter((a) => a.triggeredAt !== undefined);
  const displayedAlerts =
    tab === 'active'
      ? activeAlerts
      : tab === 'triggered'
      ? triggeredAlerts
      : alerts;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-[#e0e3eb] bg-white shadow-2xl sm:rounded-2xl dark:border-[#2a2e39] dark:bg-[#1e222d]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#e0e3eb] sm:hidden dark:bg-[#363a45]" />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f0f3fa] px-5 py-3.5 dark:border-[#2a2e39]">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f59e0b]/15 text-[#d97706] dark:text-[#fbbf24]">
              <BellRing className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#131722] dark:text-[#d1d4dc]">
                Price Alerts
              </h2>
              <p className="text-[11px] text-[#787b86]">
                Real-time notifications when live feed crosses target
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onPreviewSound(selectedSound)}
              disabled={selectedSound === 'silent'}
              title="Preview selected alert chime"
              className="flex h-8 items-center gap-1 rounded-lg border border-[#e0e3eb] px-2 text-[11px] font-semibold text-[#131722] hover:bg-[#f0f3fa] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#2a2e39] dark:text-[#d1d4dc] dark:hover:bg-[#2a2e39]"
            >
              <Volume2 className="h-3.5 w-3.5 text-[#f59e0b]" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onChangeSound(selectedSound === 'silent' ? 'classic_bell' : 'silent')
              }
              title={selectedSound !== 'silent' ? 'Mute alert sound' : 'Enable alert sound'}
              aria-label={selectedSound !== 'silent' ? 'Mute alert sound' : 'Enable alert sound'}
              className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition-colors ${
                selectedSound !== 'silent'
                  ? 'border-[#089981]/30 bg-[#089981]/10 text-[#089981]'
                  : 'border-[#e0e3eb] bg-[#f8fafd] text-[#787b86] dark:border-[#2a2e39] dark:bg-[#131722]'
              }`}
            >
              {selectedSound !== 'silent' ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" />
              )}
              <span>
                {ALERT_SOUND_OPTIONS.find((s) => s.id === selectedSound)?.label ?? 'Classic Bell'}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Price Alerts"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
          {/* Create Alert Card */}
          <form
            onSubmit={handleSubmit}
            className="space-y-3.5 rounded-2xl border border-[#e0e3eb] bg-[#f8fafd] p-4 dark:border-[#2a2e39] dark:bg-[#131722]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold tracking-wide text-[#131722] uppercase dark:text-[#d1d4dc]">
                New Alert
              </span>
              <span className="font-mono-tabular text-xs text-[#787b86]">
                {livePrices[selectedSymbol] !== undefined ? (
                  <>
                    Live:{' '}
                    <span className="font-bold text-[#131722] dark:text-white">
                      {formatPrice(livePrices[selectedSymbol])}
                    </span>
                  </>
                ) : (
                  <>
                    Ref:{' '}
                    <span className="font-semibold">
                      {formatPrice(currentRefPrice)}
                    </span>
                  </>
                )}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Symbol Select */}
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-[#787b86]">
                  Symbol
                </span>
                <select
                  value={selectedSymbol}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[#e0e3eb] bg-white px-3 text-sm font-bold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
                >
                  {symbolOptions.map((sym) => (
                    <option key={sym} value={sym}>
                      {sym}
                    </option>
                  ))}
                </select>
              </label>

              {/* Target Price */}
              <label className="space-y-1">
                <span className="block text-[11px] font-semibold text-[#787b86]">
                  Target Price
                </span>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  required
                  value={targetInput}
                  onChange={(e) => handleTargetChange(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[#e0e3eb] bg-white px-3 font-mono-tabular text-sm font-bold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
                />
              </label>
            </div>

            {/* Quick Offset Presets */}
            <div className="grid grid-cols-5 gap-1.5">
              {[
                { label: '-1%', offset: -0.01 },
                { label: '-0.5%', offset: -0.005 },
                { label: 'Last', offset: 0 },
                { label: '+0.5%', offset: 0.005 },
                { label: '+1%', offset: 0.01 },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPresetOffset(p.offset)}
                  className="min-h-[32px] rounded-lg border border-[#e0e3eb] bg-white px-1 font-mono-tabular text-[11px] font-semibold text-[#131722] hover:border-[#2962ff] hover:text-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Crossing Condition */}
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold text-[#787b86]">
                Condition
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => setCondition('crossing')}
                  className={`flex min-h-[36px] items-center justify-center gap-1 rounded-xl border px-2 text-xs font-semibold transition-colors ${
                    condition === 'crossing'
                      ? 'border-[#2962ff] bg-[#2962ff] text-white'
                      : 'border-[#e0e3eb] bg-white text-[#131722] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]'
                  }`}
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  <span>Crossing</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCondition('crossing_up')}
                  className={`flex min-h-[36px] items-center justify-center gap-1 rounded-xl border px-2 text-xs font-semibold transition-colors ${
                    condition === 'crossing_up'
                      ? 'border-[#089981] bg-[#089981] text-white'
                      : 'border-[#e0e3eb] bg-white text-[#131722] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]'
                  }`}
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  <span>Cross Up</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCondition('crossing_down')}
                  className={`flex min-h-[36px] items-center justify-center gap-1 rounded-xl border px-2 text-xs font-semibold transition-colors ${
                    condition === 'crossing_down'
                      ? 'border-[#f23645] bg-[#f23645] text-white'
                      : 'border-[#e0e3eb] bg-white text-[#131722] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]'
                  }`}
                >
                  <ArrowDownRight className="h-3.5 w-3.5" />
                  <span>Cross Down</span>
                </button>
              </div>
            </div>

            {/* Frequency & Optional Message */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[140px_1fr]">
              <div className="flex rounded-xl border border-[#e0e3eb] bg-white p-0.5 dark:border-[#2a2e39] dark:bg-[#1e222d]">
                <button
                  type="button"
                  onClick={() => setRepeat(false)}
                  className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold transition-colors ${
                    !repeat
                      ? 'bg-[#2962ff] text-white'
                      : 'text-[#787b86] hover:text-[#131722] dark:hover:text-white'
                  }`}
                >
                  Once
                </button>
                <button
                  type="button"
                  onClick={() => setRepeat(true)}
                  className={`flex-1 rounded-lg py-1.5 text-[11px] font-bold transition-colors ${
                    repeat
                      ? 'bg-[#2962ff] text-white'
                      : 'text-[#787b86] hover:text-[#131722] dark:hover:text-white'
                  }`}
                >
                  Every Time
                </button>
              </div>

              <input
                type="text"
                maxLength={80}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Alert note (optional, e.g. Key breakout)"
                className="h-9 rounded-xl border border-[#e0e3eb] bg-white px-3 text-xs text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
              />
            </div>

            {/* Alert Sound Selector + Preview */}
            <div>
              <span className="mb-1.5 block text-[11px] font-semibold text-[#787b86]">
                Alert Sound
              </span>
              <div className="flex items-center gap-2">
                <select
                  value={selectedSound}
                  onChange={(e) => onChangeSound(e.target.value as AlertSoundOption)}
                  aria-label="Alert notification sound"
                  className="h-9 flex-1 rounded-xl border border-[#e0e3eb] bg-white px-3 text-xs font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
                >
                  {ALERT_SOUND_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label} — {opt.description}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onPreviewSound(selectedSound)}
                  disabled={selectedSound === 'silent'}
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-[#e0e3eb] bg-white px-3 text-xs font-semibold text-[#131722] transition-colors hover:border-[#2962ff] hover:text-[#2962ff] disabled:cursor-not-allowed disabled:opacity-45 dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
                >
                  <Volume2 className="h-3.5 w-3.5 text-[#f59e0b]" />
                  <span>Preview Sound</span>
                </button>
              </div>
            </div>

            {formError && (
              <div className="text-xs font-semibold text-[#f23645]">{formError}</div>
            )}

            <button
              type="submit"
              className="flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-xl bg-[#2962ff] text-sm font-bold text-white transition-colors hover:bg-[#1e53e5]"
            >
              <Plus className="h-4 w-4" />
              <span>Create Price Alert</span>
            </button>
          </form>

          {/* Manage Existing Alerts */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex rounded-xl bg-[#f0f3fa] p-1 dark:bg-[#131722]">
                {(
                  [
                    { id: 'active', label: `Active (${activeAlerts.length})` },
                    { id: 'triggered', label: `Triggered (${triggeredAlerts.length})` },
                    { id: 'all', label: `All (${alerts.length})` },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                      tab === t.id
                        ? 'bg-white text-[#2962ff] shadow-xs dark:bg-[#2a2e39] dark:text-white'
                        : 'text-[#787b86] hover:text-[#131722] dark:hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {triggeredAlerts.length > 0 && (
                <button
                  type="button"
                  onClick={onClearTriggered}
                  className="text-xs font-semibold text-[#787b86] hover:text-[#f23645]"
                >
                  Clear Triggered
                </button>
              )}
            </div>

            {displayedAlerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#e0e3eb] px-4 py-8 text-center dark:border-[#2a2e39]">
                <Bell className="mb-2 h-7 w-7 text-[#787b86]/60" />
                <div className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  {tab === 'active'
                    ? 'No active price alerts'
                    : tab === 'triggered'
                    ? 'No alerts triggered yet'
                    : 'No price alerts created'}
                </div>
                <p className="mt-1 text-xs text-[#787b86]">
                  Set a target price above to get notified when the live feed crosses it.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#f0f3fa] rounded-2xl border border-[#e0e3eb] bg-white dark:divide-[#2a2e39] dark:border-[#2a2e39] dark:bg-[#131722]">
                {displayedAlerts.map((alert) => {
                  const meta = getConditionMeta(alert.condition);
                  const livePx = livePrices[alert.symbol];
                  const distPct =
                    livePx && livePx > 0
                      ? ((alert.targetPrice - livePx) / livePx) * 100
                      : null;

                  return (
                    <div
                      key={alert.id}
                      className="flex items-center justify-between gap-3 px-3.5 py-3"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectSymbol(alert.symbol);
                              onClose();
                            }}
                            className="text-sm font-bold text-[#131722] hover:text-[#2962ff] dark:text-white"
                          >
                            {alert.symbol}
                          </button>

                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${meta.colorClass}`}
                          >
                            {meta.shortLabel}
                          </span>

                          <span className="font-mono-tabular text-sm font-bold text-[#131722] dark:text-[#d1d4dc]">
                            {formatPrice(alert.targetPrice)}
                          </span>

                          {alert.repeat && (
                            <span className="rounded bg-[#f0f3fa] px-1.5 py-0.5 text-[10px] font-semibold text-[#787b86] dark:bg-[#1e222d]">
                              Repeat
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[#787b86]">
                          {alert.active ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-[#089981]">
                              <span className="h-1.5 w-1.5 rounded-full bg-[#089981]" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-semibold text-[#787b86]">
                              {alert.triggeredAt ? 'Triggered' : 'Paused'}
                            </span>
                          )}

                          {distPct !== null && alert.active && (
                            <span className="font-mono-tabular">
                              {distPct >= 0 ? '+' : ''}
                              {distPct.toFixed(2)}% from live
                            </span>
                          )}

                          {alert.triggeredAt && (
                            <span className="font-mono-tabular text-[#d97706] dark:text-[#fbbf24]">
                              Hit{' '}
                              {alert.triggeredPrice !== undefined
                                ? `@ ${formatPrice(alert.triggeredPrice)}`
                                : ''}{' '}
                              · {formatAlertTime(alert.triggeredAt)}
                            </span>
                          )}
                        </div>

                        {alert.note && (
                          <div className="truncate text-xs text-[#131722]/80 dark:text-[#d1d4dc]/80">
                            {alert.note}
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onToggleAlert(alert.id)}
                          title={
                            alert.active
                              ? 'Pause alert'
                              : alert.triggeredAt
                              ? 'Re-arm alert'
                              : 'Resume alert'
                          }
                          aria-label={alert.active ? 'Pause alert' : 'Activate alert'}
                          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                            alert.active
                              ? 'bg-[#2962ff]/10 text-[#2962ff] hover:bg-[#2962ff]/20'
                              : 'bg-[#f0f3fa] text-[#787b86] hover:text-[#131722] dark:bg-[#1e222d] dark:hover:text-white'
                          }`}
                        >
                          {alert.active ? (
                            <BellOff className="h-4 w-4" />
                          ) : alert.triggeredAt ? (
                            <RotateCcw className="h-4 w-4" />
                          ) : (
                            <Bell className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteAlert(alert.id)}
                          title="Delete alert"
                          aria-label="Delete alert"
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-[#787b86] hover:bg-[#f23645]/10 hover:text-[#f23645]"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
