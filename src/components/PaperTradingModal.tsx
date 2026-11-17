import {
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  Check,
  Edit3,
  History,
  Plus,
  RotateCcw,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatPrice } from '../services/binance';
import {
  PRESET_ACCOUNT_BALANCES,
  type NamedPaperAccount,
  type PaperAccountState,
  type PaperPosition,
  type TradeMode,
} from '../types/trading';
import {
  calculateAccountOverview,
  calculatePositionMetrics,
  formatSignedUsd,
  formatTradeTimestamp,
  formatUsd,
} from '../utils/paperTrading';

interface PaperTradingModalProps {
  liveAccounts: NamedPaperAccount[];
  activeLiveAccountId: string;
  liveAccount: PaperAccountState;
  replayAccount: PaperAccountState;
  livePrices: Record<string, number>;
  replayActive: boolean;
  onSwitchLiveAccount: (accountId: string) => void;
  onCreateLiveAccount: (name: string, startingBalance: number) => void;
  onDeleteLiveAccount: (accountId: string) => void;
  onClosePosition: (positionId: string, mode: TradeMode) => void;
  onCancelPendingOrder: (orderId: string, mode: TradeMode) => void;
  onUpdatePositionTPSL: (
    positionId: string,
    tpPrice?: number,
    slPrice?: number,
    silent?: boolean,
    mode?: TradeMode
  ) => void;
  onResetAccount: (newStartingBalance: number, mode: TradeMode) => void;
  onOpenJournal: (mode: TradeMode) => void;
  onClose: () => void;
}

export function PaperTradingModal({
  liveAccounts,
  activeLiveAccountId,
  liveAccount,
  replayAccount,
  livePrices,
  replayActive,
  onSwitchLiveAccount,
  onCreateLiveAccount,
  onDeleteLiveAccount,
  onClosePosition,
  onCancelPendingOrder,
  onUpdatePositionTPSL,
  onResetAccount,
  onOpenJournal,
  onClose,
}: PaperTradingModalProps) {
  const [viewMode, setViewMode] = useState<TradeMode>(replayActive ? 'Replay' : 'Live');
  const account = viewMode === 'Replay' ? replayAccount : liveAccount;
  const activeNamedLiveAccount =
    liveAccounts.find((a) => a.id === activeLiveAccountId) ?? liveAccounts[0];
  const pendingOrders = account.pendingOrders ?? [];

  const [activeTab, setActiveTab] = useState<'positions' | 'pending' | 'history'>('positions');
  const [showBalanceSettings, setShowBalanceSettings] = useState(false);
  const [showNewAccountForm, setShowNewAccountForm] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountBalance, setNewAccountBalance] = useState('50000');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [customBalanceInput, setCustomBalanceInput] = useState(
    String(account.startingBalance)
  );
  const [editingPosId, setEditingPosId] = useState<string | null>(null);
  const [tpInput, setTpInput] = useState('');
  const [slInput, setSlInput] = useState('');

  useEffect(() => {
    setCustomBalanceInput(String(account.startingBalance));
    setEditingPosId(null);
    setConfirmDeleteId(null);
  }, [viewMode, activeLiveAccountId, account.startingBalance]);

  const handleCreateAccountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedName = newAccountName.trim() || `Paper Account ${liveAccounts.length + 1}`;
    const parsedBal = parseFloat(newAccountBalance);
    const startingBalance =
      Number.isFinite(parsedBal) && parsedBal >= 100
        ? Math.round(parsedBal * 100) / 100
        : 50000;
    onCreateLiveAccount(cleanedName, startingBalance);
    setNewAccountName('');
    setNewAccountBalance('50000');
    setShowNewAccountForm(false);
  };

  const overview = calculateAccountOverview(account, livePrices);

  const startEditTPSL = (pos: PaperPosition) => {
    setEditingPosId(pos.id);
    setTpInput(pos.tpPrice !== undefined ? String(pos.tpPrice) : '');
    setSlInput(pos.slPrice !== undefined ? String(pos.slPrice) : '');
  };

  const saveEditTPSL = (pos: PaperPosition) => {
    const tpVal = tpInput.trim() ? parseFloat(tpInput) : undefined;
    const slVal = slInput.trim() ? parseFloat(slInput) : undefined;
    onUpdatePositionTPSL(
      pos.id,
      tpVal && !Number.isNaN(tpVal) ? tpVal : undefined,
      slVal && !Number.isNaN(slVal) ? slVal : undefined,
      false,
      viewMode
    );
    setEditingPosId(null);
  };

  const handleApplyReset = (amount: number) => {
    const clean = Math.max(100, Math.round(amount * 100) / 100);
    setCustomBalanceInput(String(clean));
    onResetAccount(clean, viewMode);
    setShowBalanceSettings(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-[#e0e3eb] bg-white shadow-2xl dark:border-[#2a2e39] dark:bg-[#1e222d]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#e0e3eb] sm:hidden dark:bg-[#363a45]" />

        {/* Drawer Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f0f3fa] px-4 py-3 sm:px-5 dark:border-[#2a2e39]">
          <div className="flex flex-wrap items-center gap-2.5">
            <Wallet className="h-5 w-5 text-[#2962ff]" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-[#131722] dark:text-[#d1d4dc]">
                  {viewMode === 'Replay'
                    ? 'Replay Paper Account'
                    : activeNamedLiveAccount?.name ?? 'Live Paper Account'}
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
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-[#787b86]">
                {viewMode === 'Replay'
                  ? 'Isolated Bar Replay account · Never affects Live Paper Accounts or Live Journal'
                  : 'Switchable Live Paper Accounts · Instant Bid/Ask simulation'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowBalanceSettings((v) => !v)}
              className={`flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                showBalanceSettings
                  ? 'border-[#2962ff] bg-[#2962ff] text-white'
                  : 'border-[#e0e3eb] text-[#131722] hover:bg-[#f0f3fa] dark:border-[#2a2e39] dark:text-[#d1d4dc] dark:hover:bg-[#2a2e39]'
              }`}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Balance / Reset</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenJournal(viewMode);
              }}
              className="flex min-h-[36px] items-center gap-1.5 rounded-lg bg-[#2962ff]/10 px-2.5 text-xs font-semibold text-[#2962ff] hover:bg-[#2962ff]/15"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>{viewMode} Journal</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close paper trading panel"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Live Paper Account Switcher & + Add New Account Bar (Bar Replay stays isolated) */}
        {viewMode === 'Live' && (
          <div className="border-b border-[#f0f3fa] bg-[#f8fafd] px-4 py-2.5 sm:px-5 dark:border-[#2a2e39] dark:bg-[#131722]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#787b86]">
                  Account
                </span>
                <select
                  value={activeLiveAccountId}
                  onChange={(e) => {
                    onSwitchLiveAccount(e.target.value);
                    setConfirmDeleteId(null);
                  }}
                  aria-label="Switch Live Paper Trading Account"
                  className="h-9 min-w-[200px] max-w-full flex-1 rounded-lg border border-[#e0e3eb] bg-white px-2.5 text-xs font-bold text-[#131722] outline-none focus:border-[#2962ff] sm:max-w-xs dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
                >
                  {liveAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatUsd(acc.account.balance)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowNewAccountForm((v) => !v)}
                  className={`flex h-9 items-center gap-1 rounded-lg border px-2.5 text-xs font-bold transition-colors ${
                    showNewAccountForm
                      ? 'border-[#2962ff] bg-[#2962ff] text-white'
                      : 'border-[#2962ff]/40 bg-[#2962ff]/10 text-[#2962ff] hover:bg-[#2962ff]/15'
                  }`}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>+ Add New Account</span>
                </button>

                {liveAccounts.length > 1 &&
                  activeNamedLiveAccount &&
                  (confirmDeleteId === activeNamedLiveAccount.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteLiveAccount(activeNamedLiveAccount.id);
                          setConfirmDeleteId(null);
                        }}
                        className="h-9 rounded-lg bg-[#f23645] px-2.5 text-xs font-bold text-white hover:bg-[#dc2626]"
                      >
                        Confirm Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="h-9 rounded-lg border border-[#e0e3eb] bg-white px-2 text-xs font-semibold text-[#787b86] dark:border-[#2a2e39] dark:bg-[#1e222d]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(activeNamedLiveAccount.id)}
                      title={`Delete ${activeNamedLiveAccount.name}`}
                      aria-label={`Delete ${activeNamedLiveAccount.name}`}
                      className="flex h-9 items-center gap-1 rounded-lg border border-[#e0e3eb] bg-white px-2.5 text-xs font-semibold text-[#787b86] hover:border-[#f23645]/40 hover:bg-[#f23645]/10 hover:text-[#f23645] dark:border-[#2a2e39] dark:bg-[#1e222d]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Delete</span>
                    </button>
                  ))}
              </div>
            </div>

            {showNewAccountForm && (
              <form
                onSubmit={handleCreateAccountSubmit}
                className="mt-2.5 flex flex-wrap items-end gap-2 border-t border-[#e0e3eb] pt-2.5 dark:border-[#2a2e39]"
              >
                <label className="min-w-[160px] flex-1 space-y-1">
                  <span className="block text-[10px] font-semibold text-[#787b86]">
                    Account Name
                  </span>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    placeholder="e.g. Apex $25k Evaluation"
                    className="h-9 w-full rounded-lg border border-[#e0e3eb] bg-white px-2.5 text-xs font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
                  />
                </label>

                <label className="w-32 space-y-1">
                  <span className="block text-[10px] font-semibold text-[#787b86]">
                    Starting Balance ($)
                  </span>
                  <input
                    type="number"
                    min="100"
                    step="100"
                    required
                    value={newAccountBalance}
                    onChange={(e) => setNewAccountBalance(e.target.value)}
                    className="h-9 w-full rounded-lg border border-[#e0e3eb] bg-white px-2.5 font-mono-tabular text-xs font-bold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
                  />
                </label>

                <div className="flex flex-wrap items-center gap-1">
                  {PRESET_ACCOUNT_BALANCES.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setNewAccountBalance(String(amt))}
                      className={`h-9 rounded-lg border px-2 font-mono-tabular text-[11px] font-bold ${
                        Number(newAccountBalance) === amt
                          ? 'border-[#2962ff] bg-[#2962ff]/12 text-[#2962ff]'
                          : 'border-[#e0e3eb] bg-white text-[#787b86] hover:text-[#131722] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:hover:text-white'
                      }`}
                    >
                      ${amt / 1000}k
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="submit"
                    className="h-9 rounded-lg bg-[#2962ff] px-3 text-xs font-bold text-white hover:bg-[#1e53e5]"
                  >
                    Create Account
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewAccountForm(false)}
                    className="h-9 rounded-lg border border-[#e0e3eb] bg-white px-2.5 text-xs font-semibold text-[#787b86] dark:border-[#2a2e39] dark:bg-[#1e222d]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Starting Account Balance / Reset Panel */}
        {showBalanceSettings && (
          <div className="border-b border-[#f0f3fa] bg-[#f8fafd] px-4 py-3 sm:px-5 dark:border-[#2a2e39] dark:bg-[#131722]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-[#131722] dark:text-[#d1d4dc]">
                  Set or Reset{' '}
                  {viewMode === 'Live'
                    ? activeNamedLiveAccount?.name ?? 'Live'
                    : 'Replay'}{' '}
                  Starting Balance
                </div>
                <div className="text-[11px] text-[#787b86]">
                  Resets only this {viewMode === 'Live' ? 'selected Live' : 'isolated Replay'} account&apos;s balance, positions, and order history.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {PRESET_ACCOUNT_BALANCES.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => handleApplyReset(amt)}
                    className={`min-h-[34px] rounded-lg border px-2.5 font-mono-tabular text-xs font-bold transition-colors ${
                      account.startingBalance === amt
                        ? 'border-[#2962ff] bg-[#2962ff] text-white'
                        : 'border-[#e0e3eb] bg-white text-[#131722] hover:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]'
                    }`}
                  >
                    ${amt.toLocaleString('en-US')}
                  </button>
                ))}

                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="100"
                    step="500"
                    value={customBalanceInput}
                    onChange={(e) => setCustomBalanceInput(e.target.value)}
                    aria-label="Custom starting balance"
                    className="h-[34px] w-28 rounded-lg border border-[#e0e3eb] bg-white px-2.5 font-mono-tabular text-xs font-bold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const val = parseFloat(customBalanceInput);
                      if (!Number.isNaN(val) && val >= 100) {
                        handleApplyReset(val);
                      }
                    }}
                    className="h-[34px] rounded-lg bg-[#2962ff] px-3 text-xs font-bold text-white hover:bg-[#1e53e5]"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Real-Time Account Summary Strip */}
        <div className="grid grid-cols-2 gap-px border-b border-[#f0f3fa] bg-[#f0f3fa] sm:grid-cols-4 dark:border-[#2a2e39] dark:bg-[#2a2e39]">
          <div className="bg-white px-4 py-2.5 dark:bg-[#1e222d]">
            <div className="text-[11px] font-medium text-[#787b86]">Account Balance</div>
            <div className="mt-0.5 font-mono-tabular text-sm font-bold text-[#131722] sm:text-base dark:text-white">
              {formatUsd(overview.balance)}
            </div>
          </div>

          <div className="bg-white px-4 py-2.5 dark:bg-[#1e222d]">
            <div className="text-[11px] font-medium text-[#787b86]">Equity</div>
            <div className="mt-0.5 font-mono-tabular text-sm font-bold text-[#131722] sm:text-base dark:text-white">
              {formatUsd(overview.equity)}
            </div>
          </div>

          <div className="bg-white px-4 py-2.5 dark:bg-[#1e222d]">
            <div className="text-[11px] font-medium text-[#787b86]">Unrealized PnL</div>
            <div
              className={`mt-0.5 font-mono-tabular text-sm font-bold sm:text-base ${
                overview.unrealizedPnl > 0
                  ? 'text-[#089981]'
                  : overview.unrealizedPnl < 0
                  ? 'text-[#f23645]'
                  : 'text-[#131722] dark:text-[#d1d4dc]'
              }`}
            >
              {formatSignedUsd(overview.unrealizedPnl)}
            </div>
          </div>

          <div className="bg-white px-4 py-2.5 dark:bg-[#1e222d]">
            <div className="text-[11px] font-medium text-[#787b86]">Available Margin</div>
            <div className="mt-0.5 font-mono-tabular text-sm font-bold text-[#131722] sm:text-base dark:text-white">
              {formatUsd(overview.availableMargin)}
            </div>
          </div>
        </div>

        {/* Sub-Tabs: Open Positions, Pending Orders & Order History */}
        <div className="flex flex-wrap items-center gap-1 border-b border-[#f0f3fa] px-4 py-2 dark:border-[#2a2e39]">
          <button
            type="button"
            onClick={() => setActiveTab('positions')}
            className={`min-h-[36px] rounded-lg px-3 text-xs font-bold transition-colors ${
              activeTab === 'positions'
                ? 'bg-[#2962ff] text-white'
                : 'text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#131722] dark:hover:text-white'
            }`}
          >
            Open Positions ({account.positions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`min-h-[36px] rounded-lg px-3 text-xs font-bold transition-colors ${
              activeTab === 'pending'
                ? 'bg-[#2962ff] text-white'
                : 'text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#131722] dark:hover:text-white'
            }`}
          >
            Pending Orders ({pendingOrders.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-colors ${
              activeTab === 'history'
                ? 'bg-[#2962ff] text-white'
                : 'text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#131722] dark:hover:text-white'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>Order History ({account.closedTrades.length})</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          {activeTab === 'positions' && (
            <>
              {account.positions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Wallet className="mb-2 h-8 w-8 text-[#787b86]/60" />
                  <p className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                    No open paper positions
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-[#787b86]">
                    Tap the red SELL or blue BUY buttons on the chart, or place a Long/Short Position tool and click Execute Order.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {account.positions.map((pos) => {
                    const markPrice = livePrices[pos.symbol] ?? pos.entryPrice;
                    const metrics = calculatePositionMetrics(pos, markPrice);
                    const isProfit = metrics.unrealizedPnl >= 0;
                    const isEditing = editingPosId === pos.id;

                    return (
                      <div
                        key={pos.id}
                        className="rounded-xl border border-[#e0e3eb] bg-[#f8fafd] p-3 dark:border-[#2a2e39] dark:bg-[#131722]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${
                                pos.side === 'long'
                                  ? 'bg-[#2962ff]/12 text-[#2962ff]'
                                  : 'bg-[#f23645]/12 text-[#f23645]'
                              }`}
                            >
                              {pos.side === 'long' ? (
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowDownRight className="h-3.5 w-3.5" />
                              )}
                              {pos.side}
                            </span>

                            <span className="text-sm font-bold text-[#131722] dark:text-white">
                              {pos.symbol}
                            </span>

                            <span className="font-mono-tabular text-xs font-semibold text-[#787b86]">
                              {pos.qty} contracts · {pos.mode}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <div
                              className={`text-right font-mono-tabular text-sm font-bold ${
                                isProfit ? 'text-[#089981]' : 'text-[#f23645]'
                              }`}
                            >
                              {formatSignedUsd(metrics.unrealizedPnl)}{' '}
                              <span className="text-xs font-semibold">
                                ({metrics.unrealizedPct >= 0 ? '+' : ''}
                                {metrics.unrealizedPct.toFixed(2)}%)
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => onClosePosition(pos.id, viewMode)}
                              className="min-h-[34px] rounded-lg bg-[#f23645] px-3 text-xs font-bold text-white transition-colors hover:bg-[#dc2626]"
                            >
                              Close Position
                            </button>
                          </div>
                        </div>

                        <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-[#e0e3eb] pt-2 font-mono-tabular text-xs sm:grid-cols-4 dark:border-[#2a2e39]">
                          <div>
                            <span className="block text-[10px] text-[#787b86]">Entry Price</span>
                            <span className="font-semibold text-[#131722] dark:text-[#d1d4dc]">
                              {formatPrice(pos.entryPrice)}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-[#787b86]">
                              {pos.mode === 'Replay' ? 'Replay Price' : 'Live Price'}
                            </span>
                            <span className="font-semibold text-[#131722] dark:text-[#d1d4dc]">
                              {formatPrice(markPrice)}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-[#787b86]">Take Profit (TP)</span>
                            <span className="font-semibold text-[#089981]">
                              {pos.tpPrice !== undefined ? formatPrice(pos.tpPrice) : '—'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-1">
                            <div>
                              <span className="block text-[10px] text-[#787b86]">Stop Loss (SL)</span>
                              <span className="font-semibold text-[#f23645]">
                                {pos.slPrice !== undefined ? formatPrice(pos.slPrice) : '—'}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                isEditing ? setEditingPosId(null) : startEditTPSL(pos)
                              }
                              className="flex h-7 items-center gap-1 rounded-md border border-[#e0e3eb] bg-white px-2 text-[10px] font-semibold text-[#787b86] hover:text-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d]"
                              title="Edit TP/SL levels"
                            >
                              <Edit3 className="h-3 w-3" />
                              <span>TP/SL</span>
                            </button>
                          </div>
                        </div>

                        {isEditing && (
                          <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-[#e0e3eb] pt-2 dark:border-[#2a2e39]">
                            <label className="space-y-0.5">
                              <span className="block text-[10px] font-semibold text-[#089981]">
                                Take Profit
                              </span>
                              <input
                                type="number"
                                step="any"
                                value={tpInput}
                                onChange={(e) => setTpInput(e.target.value)}
                                placeholder="Optional TP"
                                className="h-8 w-32 rounded-lg border border-[#e0e3eb] bg-white px-2 font-mono-tabular text-xs font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
                              />
                            </label>
                            <label className="space-y-0.5">
                              <span className="block text-[10px] font-semibold text-[#f23645]">
                                Stop Loss
                              </span>
                              <input
                                type="number"
                                step="any"
                                value={slInput}
                                onChange={(e) => setSlInput(e.target.value)}
                                placeholder="Optional SL"
                                className="h-8 w-32 rounded-lg border border-[#e0e3eb] bg-white px-2 font-mono-tabular text-xs font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#1e222d] dark:text-[#d1d4dc]"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => saveEditTPSL(pos)}
                              className="flex h-8 items-center gap-1 rounded-lg bg-[#2962ff] px-3 text-xs font-bold text-white"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>Save</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeTab === 'pending' && (
            <>
              {pendingOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <Wallet className="mb-2 h-8 w-8 text-[#787b86]/60" />
                  <p className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                    No pending limit or stop orders
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-[#787b86]">
                    Move the crosshair on the chart and tap the (+) button on the price scale to place a Buy/Sell Limit or Stop order.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingOrders.map((ord) => {
                    const markPrice = livePrices[ord.symbol] ?? ord.targetPrice;
                    const isBuy = ord.side === 'long';
                    return (
                      <div
                        key={ord.id}
                        className="rounded-xl border border-[#e0e3eb] bg-[#f8fafd] p-3 dark:border-[#2a2e39] dark:bg-[#131722]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${
                                isBuy
                                  ? 'bg-[#2962ff]/12 text-[#2962ff]'
                                  : 'bg-[#f23645]/12 text-[#f23645]'
                              }`}
                            >
                              {isBuy ? (
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowDownRight className="h-3.5 w-3.5" />
                              )}
                              {isBuy ? 'Buy' : 'Sell'} {ord.orderType}
                            </span>
                            <span className="text-sm font-bold text-[#131722] dark:text-white">
                              {ord.symbol}
                            </span>
                            <span className="font-mono-tabular text-xs font-semibold text-[#787b86]">
                              {ord.qty} units · {ord.mode}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => onCancelPendingOrder(ord.id, viewMode)}
                            className="min-h-[32px] rounded-lg border border-[#f23645]/40 bg-[#f23645]/10 px-3 text-xs font-bold text-[#f23645] transition-colors hover:bg-[#f23645] hover:text-white"
                          >
                            Cancel Order
                          </button>
                        </div>

                        <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-[#e0e3eb] pt-2 font-mono-tabular text-xs sm:grid-cols-4 dark:border-[#2a2e39]">
                          <div>
                            <span className="block text-[10px] text-[#787b86]">Order Price</span>
                            <span className="font-semibold text-[#131722] dark:text-[#d1d4dc]">
                              {formatPrice(ord.targetPrice)}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-[#787b86]">Current Price</span>
                            <span className="font-semibold text-[#131722] dark:text-[#d1d4dc]">
                              {formatPrice(markPrice)}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-[#787b86]">Take Profit</span>
                            <span className="font-semibold text-[#089981]">
                              {ord.tpPrice !== undefined ? formatPrice(ord.tpPrice) : '—'}
                            </span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-[#787b86]">Stop Loss</span>
                            <span className="font-semibold text-[#f23645]">
                              {ord.slPrice !== undefined ? formatPrice(ord.slPrice) : '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeTab === 'history' && (
            <>
              {account.closedTrades.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <History className="mb-2 h-8 w-8 text-[#787b86]/60" />
                  <p className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                    No closed orders yet
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-[#787b86]">
                    Closed positions (manual close, TP hit, or SL hit) appear here with Entry/Exit prices and realized PnL.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#e0e3eb] text-[11px] font-semibold text-[#787b86] dark:border-[#2a2e39]">
                        <th className="py-2 pr-3">Symbol</th>
                        <th className="py-2 pr-3">Side</th>
                        <th className="py-2 pr-3">Mode</th>
                        <th className="py-2 pr-3 text-right">Contracts</th>
                        <th className="py-2 pr-3 text-right">Entry</th>
                        <th className="py-2 pr-3 text-right">Exit</th>
                        <th className="py-2 pr-3">Entry Time</th>
                        <th className="py-2 pr-3">Exit Time</th>
                        <th className="py-2 text-right">Realized PnL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f0f3fa] font-mono-tabular dark:divide-[#2a2e39]">
                      {[...account.closedTrades]
                        .sort((a, b) => b.exitTime - a.exitTime)
                        .map((t) => {
                          const win = t.realizedPnl >= 0;
                          return (
                            <tr
                              key={t.id}
                              className="hover:bg-[#f8fafd] dark:hover:bg-[#131722]/60"
                            >
                              <td className="py-2.5 pr-3 font-sans font-bold text-[#131722] dark:text-white">
                                {t.symbol}
                              </td>
                              <td className="py-2.5 pr-3 font-sans">
                                <span
                                  className={`font-bold uppercase ${
                                    t.side === 'long' ? 'text-[#2962ff]' : 'text-[#f23645]'
                                  }`}
                                >
                                  {t.side}
                                </span>
                              </td>
                              <td className="py-2.5 pr-3 font-sans text-[#787b86]">
                                {t.mode} · {t.exitReason}
                              </td>
                              <td className="py-2.5 pr-3 text-right text-[#131722] dark:text-[#d1d4dc]">
                                {t.qty}
                              </td>
                              <td className="py-2.5 pr-3 text-right text-[#131722] dark:text-[#d1d4dc]">
                                {formatPrice(t.entryPrice)}
                              </td>
                              <td className="py-2.5 pr-3 text-right text-[#131722] dark:text-[#d1d4dc]">
                                {formatPrice(t.exitPrice)}
                              </td>
                              <td className="py-2.5 pr-3 text-[11px] text-[#787b86]">
                                {formatTradeTimestamp(t.entryTime)}
                              </td>
                              <td className="py-2.5 pr-3 text-[11px] text-[#787b86]">
                                {formatTradeTimestamp(t.exitTime)}
                              </td>
                              <td
                                className={`py-2.5 text-right font-bold ${
                                  win ? 'text-[#089981]' : 'text-[#f23645]'
                                }`}
                              >
                                {formatSignedUsd(t.realizedPnl)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
