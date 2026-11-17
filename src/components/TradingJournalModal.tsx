import {
  BookOpen,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Tag,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatPrice } from '../services/binance';
import {
  STRATEGY_TAG_PRESETS,
  type PaperAccountState,
  type PaperTrade,
  type TradeMode,
} from '../types/trading';
import {
  calculateJournalMetrics,
  formatSignedUsd,
  formatTradeTimestamp,
  formatUsd,
  groupTradesByDate,
  toLocalDateKey,
} from '../utils/paperTrading';

interface TradingJournalModalProps {
  liveAccountName?: string;
  liveAccount: PaperAccountState;
  replayAccount: PaperAccountState;
  initialMode: TradeMode;
  onUpdateTrade: (
    tradeId: string,
    patch: { notes?: string; tags?: string[] },
    mode: TradeMode
  ) => void;
  onClose: () => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function TradingJournalModal({
  liveAccountName,
  liveAccount,
  replayAccount,
  initialMode,
  onUpdateTrade,
  onClose,
}: TradingJournalModalProps) {
  const [viewMode, setViewMode] = useState<TradeMode>(initialMode);
  const activeAccount = viewMode === 'Replay' ? replayAccount : liveAccount;
  const trades = activeAccount.closedTrades;
  const startingBalance = activeAccount.startingBalance;

  const latestTradeDate = useMemo(() => {
    if (trades.length === 0) return new Date();
    const maxExit = Math.max(...trades.map((t) => t.exitTime));
    return new Date(maxExit * 1000);
  }, [trades]);

  const [viewMonth, setViewMonth] = useState<{ year: number; month: number }>(() => ({
    year: latestTradeDate.getFullYear(),
    month: latestTradeDate.getMonth(),
  }));
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [customTagInputs, setCustomTagInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    setSelectedDateKey(null);
    setViewMonth({
      year: latestTradeDate.getFullYear(),
      month: latestTradeDate.getMonth(),
    });
  }, [viewMode, latestTradeDate]);

  const metrics = useMemo(
    () => calculateJournalMetrics(trades, startingBalance),
    [trades, startingBalance]
  );

  const dayMap = useMemo(() => groupTradesByDate(trades), [trades]);

  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(viewMonth.year, viewMonth.month, 1);
    const startWeekday = firstDayOfMonth.getDay();
    const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();

    const cells: Array<{
      dateKey: string | null;
      dayNum: number | null;
    }> = [];

    for (let i = 0; i < startWeekday; i++) {
      cells.push({ dateKey: null, dayNum: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const mStr = String(viewMonth.month + 1).padStart(2, '0');
      const dStr = String(d).padStart(2, '0');
      cells.push({
        dateKey: `${viewMonth.year}-${mStr}-${dStr}`,
        dayNum: d,
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ dateKey: null, dayNum: null });
    }
    return cells;
  }, [viewMonth]);

  const monthTitle = new Date(viewMonth.year, viewMonth.month, 1).toLocaleDateString(
    'en-US',
    { month: 'long', year: 'numeric' }
  );

  const monthPnl = useMemo(() => {
    const prefix = `${viewMonth.year}-${String(viewMonth.month + 1).padStart(2, '0')}-`;
    let sum = 0;
    let count = 0;
    for (const [key, val] of Object.entries(dayMap)) {
      if (key.startsWith(prefix)) {
        sum += val.pnl;
        count += val.count;
      }
    }
    return { sum, count };
  }, [dayMap, viewMonth]);

  const filteredTrades = useMemo(() => {
    const sorted = [...trades].sort((a, b) => b.exitTime - a.exitTime);
    if (!selectedDateKey) return sorted;
    return sorted.filter((t) => toLocalDateKey(t.exitTime) === selectedDateKey);
  }, [trades, selectedDateKey]);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewMonth.year, viewMonth.month + delta, 1);
    setViewMonth({ year: d.getFullYear(), month: d.getMonth() });
  };

  const toggleTag = (trade: PaperTrade, tag: string) => {
    const existing = trade.tags ?? [];
    const next = existing.includes(tag)
      ? existing.filter((t) => t !== tag)
      : [...existing, tag];
    onUpdateTrade(trade.id, { tags: next }, viewMode);
  };

  const addCustomTag = (trade: PaperTrade) => {
    const raw = (customTagInputs[trade.id] ?? '').trim();
    if (!raw) return;
    const existing = trade.tags ?? [];
    if (!existing.includes(raw)) {
      onUpdateTrade(trade.id, { tags: [...existing, raw] }, viewMode);
    }
    setCustomTagInputs((prev) => ({ ...prev, [trade.id]: '' }));
  };

  const winRatioBarPct =
    metrics.avgWin + metrics.avgLoss > 0
      ? (metrics.avgWin / (metrics.avgWin + metrics.avgLoss)) * 100
      : 50;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-3xl border border-[#e0e3eb] bg-white shadow-2xl sm:rounded-2xl dark:border-[#2a2e39] dark:bg-[#1e222d]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#e0e3eb] sm:hidden dark:bg-[#363a45]" />

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f0f3fa] px-4 py-3.5 sm:px-6 dark:border-[#2a2e39]">
          <div className="flex items-center gap-2.5">
            <BookOpen className="h-5 w-5 text-[#2962ff]" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-[#131722] dark:text-[#d1d4dc]">
                  {viewMode === 'Replay' ? 'Replay Journal & PnL Calendar' : 'Live Journal & PnL Calendar'}
                </h2>
                <div className="flex items-center rounded-lg bg-[#f0f3fa] p-0.5 dark:bg-[#131722]">
                  {(['Live', 'Replay'] as TradeMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setViewMode(mode)}
                      className={`min-h-[26px] rounded-md px-2 text-[11px] font-bold transition-colors ${
                        viewMode === mode
                          ? 'bg-[#2962ff] text-white'
                          : 'text-[#787b86] hover:text-[#131722] dark:hover:text-white'
                      }`}
                    >
                      {mode} Journal
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-[#787b86]">
                {viewMode === 'Replay'
                  ? 'Completely isolated Replay history · Bar Replay trades never touch Live Journal'
                  : `${liveAccountName ?? 'Live Paper Account'} · Tap any calendar day to filter & annotate trades`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close trading journal"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* 6 Key Metrics Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-[#e0e3eb] bg-[#f8fafd] p-3.5 dark:border-[#2a2e39] dark:bg-[#131722]">
              <div className="text-[11px] font-medium text-[#787b86]">Net PnL</div>
              <div
                className={`mt-1 font-mono-tabular text-lg font-bold ${
                  metrics.netPnl > 0
                    ? 'text-[#089981]'
                    : metrics.netPnl < 0
                    ? 'text-[#f23645]'
                    : 'text-[#131722] dark:text-white'
                }`}
              >
                {formatSignedUsd(metrics.netPnl)}
              </div>
              <div className="mt-0.5 text-[10px] text-[#787b86]">
                Start {formatUsd(startingBalance)}
              </div>
            </div>

            <div className="rounded-xl border border-[#e0e3eb] bg-[#f8fafd] p-3.5 dark:border-[#2a2e39] dark:bg-[#131722]">
              <div className="text-[11px] font-medium text-[#787b86]">Win Rate</div>
              <div className="mt-1 font-mono-tabular text-lg font-bold text-[#131722] dark:text-white">
                {metrics.winRate.toFixed(1)}%
              </div>
              <div className="mt-0.5 font-mono-tabular text-[10px] text-[#787b86]">
                {metrics.wins}W / {metrics.losses}L
              </div>
            </div>

            <div className="rounded-xl border border-[#e0e3eb] bg-[#f8fafd] p-3.5 dark:border-[#2a2e39] dark:bg-[#131722]">
              <div className="text-[11px] font-medium text-[#787b86]">Profit Factor</div>
              <div className="mt-1 font-mono-tabular text-lg font-bold text-[#131722] dark:text-white">
                {metrics.profitFactor === null
                  ? '—'
                  : metrics.profitFactor === Infinity
                  ? '∞'
                  : metrics.profitFactor.toFixed(2)}
              </div>
              <div className="mt-0.5 text-[10px] text-[#787b86]">Gross Win / Loss</div>
            </div>

            <div className="rounded-xl border border-[#e0e3eb] bg-[#f8fafd] p-3.5 dark:border-[#2a2e39] dark:bg-[#131722]">
              <div className="text-[11px] font-medium text-[#787b86]">Avg Win vs. Loss</div>
              <div className="mt-1 flex items-center justify-between gap-1 font-mono-tabular text-xs font-bold">
                <span className="text-[#089981]">{formatUsd(metrics.avgWin)}</span>
                <span className="text-[#787b86]">/</span>
                <span className="text-[#f23645]">-{formatUsd(metrics.avgLoss)}</span>
              </div>
              <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-[#f23645]/30">
                <div
                  className="h-full bg-[#089981]"
                  style={{ width: `${winRatioBarPct}%` }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-[#e0e3eb] bg-[#f8fafd] p-3.5 dark:border-[#2a2e39] dark:bg-[#131722]">
              <div className="text-[11px] font-medium text-[#787b86]">Max Drawdown</div>
              <div className="mt-1 font-mono-tabular text-lg font-bold text-[#f23645]">
                -{formatUsd(metrics.maxDrawdownUsd)}
              </div>
              <div className="mt-0.5 font-mono-tabular text-[10px] text-[#787b86]">
                -{metrics.maxDrawdownPct.toFixed(2)}% peak
              </div>
            </div>

            <div className="rounded-xl border border-[#e0e3eb] bg-[#f8fafd] p-3.5 dark:border-[#2a2e39] dark:bg-[#131722]">
              <div className="text-[11px] font-medium text-[#787b86]">Total Trades</div>
              <div className="mt-1 font-mono-tabular text-lg font-bold text-[#131722] dark:text-white">
                {metrics.totalTrades}
              </div>
              <div className="mt-0.5 font-mono-tabular text-[10px] text-[#787b86]">
                {viewMode} Mode · {metrics.wins}W / {metrics.losses}L
              </div>
            </div>
          </div>

          {/* Interactive PnL Calendar + Trade Log Split */}
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Monthly PnL Calendar */}
            <div className="rounded-2xl border border-[#e0e3eb] bg-white p-4 lg:col-span-6 dark:border-[#2a2e39] dark:bg-[#131722]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-[#2962ff]" />
                  <h3 className="text-sm font-bold text-[#131722] dark:text-white">
                    {monthTitle}
                  </h3>
                  {monthPnl.count > 0 && (
                    <span
                      className={`font-mono-tabular text-xs font-bold ${
                        monthPnl.sum >= 0 ? 'text-[#089981]' : 'text-[#f23645]'
                      }`}
                    >
                      {formatSignedUsd(monthPnl.sum)} ({monthPnl.count})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => shiftMonth(-1)}
                    aria-label="Previous month"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e0e3eb] text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:border-[#2a2e39] dark:hover:bg-[#1e222d] dark:hover:text-white"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      setViewMonth({ year: now.getFullYear(), month: now.getMonth() });
                    }}
                    className="h-8 rounded-lg border border-[#e0e3eb] px-2.5 text-xs font-semibold text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:border-[#2a2e39] dark:hover:bg-[#1e222d] dark:hover:text-white"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    aria-label="Next month"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e0e3eb] text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:border-[#2a2e39] dark:hover:bg-[#1e222d] dark:hover:text-white"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-[#787b86]">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="py-1">
                    {w}
                  </div>
                ))}
              </div>

              <div className="mt-1 grid grid-cols-7 gap-1">
                {calendarDays.map((cell, idx) => {
                  if (!cell.dateKey || !cell.dayNum) {
                    return <div key={`empty-${idx}`} className="min-h-[56px] sm:min-h-[64px]" />;
                  }
                  const summary = dayMap[cell.dateKey];
                  const isSelected = selectedDateKey === cell.dateKey;
                  const hasTrades = Boolean(summary && summary.count > 0);
                  const isWinDay = summary ? summary.pnl > 0 : false;
                  const isLossDay = summary ? summary.pnl < 0 : false;

                  return (
                    <button
                      key={cell.dateKey}
                      type="button"
                      onClick={() =>
                        setSelectedDateKey(isSelected ? null : cell.dateKey)
                      }
                      className={`flex min-h-[56px] flex-col items-start justify-between rounded-xl border p-1.5 text-left transition-all sm:min-h-[64px] ${
                        isSelected
                          ? 'ring-2 ring-[#2962ff] border-[#2962ff]'
                          : hasTrades && isWinDay
                          ? 'border-[#089981]/35 bg-[#089981]/12 hover:bg-[#089981]/18'
                          : hasTrades && isLossDay
                          ? 'border-[#f23645]/35 bg-[#f23645]/12 hover:bg-[#f23645]/18'
                          : hasTrades
                          ? 'border-[#e0e3eb] bg-[#f8fafd] dark:border-[#2a2e39] dark:bg-[#1e222d]'
                          : 'border-[#f0f3fa] bg-white hover:border-[#e0e3eb] dark:border-[#1e222d] dark:bg-[#131722] dark:hover:border-[#2a2e39]'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="font-mono-tabular text-[11px] font-semibold text-[#787b86]">
                          {cell.dayNum}
                        </span>
                        {hasTrades && (
                          <span className="font-mono-tabular text-[9px] font-medium text-[#787b86]">
                            {summary.count}t
                          </span>
                        )}
                      </div>

                      {hasTrades && (
                        <div
                          className={`w-full truncate font-mono-tabular text-[10px] font-bold sm:text-[11px] ${
                            isWinDay
                              ? 'text-[#089981]'
                              : isLossDay
                              ? 'text-[#f23645]'
                              : 'text-[#787b86]'
                          }`}
                        >
                          {formatSignedUsd(summary.pnl, true)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Filtered Trade Log + Trade Notes & Strategy Tags */}
            <div className="flex flex-col rounded-2xl border border-[#e0e3eb] bg-white p-4 lg:col-span-6 dark:border-[#2a2e39] dark:bg-[#131722]">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-[#131722] dark:text-white">
                    {selectedDateKey
                      ? `Trades on ${selectedDateKey}`
                      : `All Logged Trades (${filteredTrades.length})`}
                  </h3>
                  <p className="text-[11px] text-[#787b86]">
                    Attach strategy tags & execution notes to each closed trade
                  </p>
                </div>

                {selectedDateKey && (
                  <button
                    type="button"
                    onClick={() => setSelectedDateKey(null)}
                    className="rounded-lg bg-[#2962ff]/10 px-2.5 py-1.5 text-xs font-semibold text-[#2962ff] hover:bg-[#2962ff]/15"
                  >
                    Show All Dates
                  </button>
                )}
              </div>

              {filteredTrades.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
                  <BookOpen className="mb-2 h-8 w-8 text-[#787b86]/60" />
                  <p className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                    {selectedDateKey
                      ? `No trades closed on ${selectedDateKey}`
                      : 'No closed trades in your journal yet'}
                  </p>
                  <p className="mt-1 max-w-xs text-xs text-[#787b86]">
                    Execute Buy or Sell paper orders in Live Mode or Bar Replay, then close them (or let TP/SL hit) to populate your calendar and metrics.
                  </p>
                </div>
              ) : (
                <div className="max-h-[440px] space-y-3 overflow-y-auto pr-1">
                  {filteredTrades.map((trade) => {
                    const isWin = trade.realizedPnl >= 0;
                    const activeTags = trade.tags ?? [];
                    const customTagVal = customTagInputs[trade.id] ?? '';

                    return (
                      <div
                        key={trade.id}
                        className="rounded-xl border border-[#e0e3eb] bg-[#f8fafd] p-3 dark:border-[#2a2e39] dark:bg-[#1e222d]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span
                              className={`font-bold uppercase ${
                                trade.side === 'long' ? 'text-[#2962ff]' : 'text-[#f23645]'
                              }`}
                            >
                              {trade.side}
                            </span>
                            <span className="font-bold text-[#131722] dark:text-white">
                              {trade.symbol}
                            </span>
                            <span className="text-[#787b86]">
                              {trade.qty} · {trade.mode} · {trade.exitReason}
                            </span>
                          </div>

                          <div
                            className={`font-mono-tabular text-sm font-bold ${
                              isWin ? 'text-[#089981]' : 'text-[#f23645]'
                            }`}
                          >
                            {formatSignedUsd(trade.realizedPnl)} (
                            {trade.realizedPnlPct >= 0 ? '+' : ''}
                            {trade.realizedPnlPct.toFixed(2)}%)
                          </div>
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono-tabular text-[11px] text-[#787b86]">
                          <span>
                            {formatPrice(trade.entryPrice)} → {formatPrice(trade.exitPrice)}
                          </span>
                          <span>·</span>
                          <span>{formatTradeTimestamp(trade.exitTime)}</span>
                        </div>

                        {/* Strategy Tags */}
                        <div className="mt-2.5">
                          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-[#787b86]">
                            <Tag className="h-3 w-3" />
                            <span>Strategy Tags</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            {Array.from(
                              new Set([...STRATEGY_TAG_PRESETS, ...activeTags])
                            ).map((tag) => {
                              const selected = activeTags.includes(tag);
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => toggleTag(trade, tag)}
                                  className={`rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${
                                    selected
                                      ? 'bg-[#2962ff] text-white'
                                      : 'border border-[#e0e3eb] bg-white text-[#787b86] hover:border-[#2962ff]/50 dark:border-[#2a2e39] dark:bg-[#131722]'
                                  }`}
                                >
                                  {tag}
                                </button>
                              );
                            })}

                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={customTagVal}
                                onChange={(e) =>
                                  setCustomTagInputs((prev) => ({
                                    ...prev,
                                    [trade.id]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    addCustomTag(trade);
                                  }
                                }}
                                placeholder="+ Tag"
                                className="h-6 w-20 rounded-md border border-[#e0e3eb] bg-white px-1.5 text-[10px] font-medium text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
                              />
                              {customTagVal.trim() && (
                                <button
                                  type="button"
                                  onClick={() => addCustomTag(trade)}
                                  aria-label="Add strategy tag"
                                  className="flex h-6 w-6 items-center justify-center rounded-md bg-[#2962ff] text-white"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Trade Notes */}
                        <textarea
                          rows={2}
                          value={trade.notes ?? ''}
                          onChange={(e) =>
                            onUpdateTrade(trade.id, { notes: e.target.value }, viewMode)
                          }
                          placeholder="Write setup thesis, emotions, or lessons learned..."
                          className="mt-2 w-full rounded-lg border border-[#e0e3eb] bg-white px-2.5 py-1.5 text-xs text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
