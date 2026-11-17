import { ChevronDown, ChevronUp, ClipboardList, X } from 'lucide-react';
import { useState } from 'react';
import { formatPrice } from '../services/binance';
import type { PendingOrderType } from '../types/trading';
import { getSymbolContractSpec, sanitizeOrderQty } from '../utils/paperTrading';

interface CrosshairQuickActionSheetProps {
  symbol: string;
  qty: number;
  crosshairPrice: number;
  currentPrice: number;
  isReplay: boolean;
  onAddAlert: () => void;
  onPlaceBuyPending: () => void;
  onPlaceSellPending: () => void;
  onOpenOrderTicket: () => void;
  onDrawHorizontalLine: () => void;
  onClose: () => void;
}

function ClockPlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="12" r="8" />
      <polyline points="11 8 11 12 13.5 13.5" />
      <path d="M19 5v4" />
      <path d="M17 7h4" />
    </svg>
  );
}

function HorizontalLineIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <line x1="3" y1="12" x2="9.5" y2="12" />
      <circle cx="12" cy="12" r="2.2" />
      <line x1="14.5" y1="12" x2="21" y2="12" />
    </svg>
  );
}

export function getCrosshairBuyOrderType(
  crosshairPrice: number,
  currentPrice: number
): PendingOrderType {
  if (currentPrice <= 0) return 'limit';
  return crosshairPrice <= currentPrice ? 'limit' : 'stop';
}

export function getCrosshairSellOrderType(
  crosshairPrice: number,
  currentPrice: number
): PendingOrderType {
  if (currentPrice <= 0) return 'limit';
  return crosshairPrice < currentPrice ? 'stop' : 'limit';
}

export function CrosshairQuickActionSheet({
  symbol,
  qty,
  crosshairPrice,
  currentPrice,
  isReplay,
  onAddAlert,
  onPlaceBuyPending,
  onPlaceSellPending,
  onOpenOrderTicket,
  onDrawHorizontalLine,
  onClose,
}: CrosshairQuickActionSheetProps) {
  const formattedPrice = formatPrice(crosshairPrice);
  const buyType = getCrosshairBuyOrderType(crosshairPrice, currentPrice);
  const sellType = getCrosshairSellOrderType(crosshairPrice, currentPrice);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-[1px]"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-t-3xl border border-[#e0e3eb] bg-white pb-safe shadow-2xl dark:border-[#2a2e39] dark:bg-[#1e222d]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#e0e3eb] dark:bg-[#363a45]" />

        <div className="flex items-center justify-between border-b border-[#f0f3fa] px-4 py-2.5 dark:border-[#2a2e39]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tracking-wide text-[#787b86] uppercase">
              {symbol}
            </span>
            <span className="rounded bg-[#131722] px-2 py-0.5 font-mono-tabular text-xs font-bold text-white dark:bg-[#2a2e39]">
              {formattedPrice}
            </span>
            {isReplay && (
              <span className="rounded bg-[#2962ff]/12 px-1.5 py-0.5 text-[10px] font-bold text-[#2962ff]">
                Replay
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick action menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="divide-y divide-[#f0f3fa] py-1 dark:divide-[#2a2e39]">
          {/* 1. Clock+ : Add alert */}
          <button
            type="button"
            onClick={() => {
              onAddAlert();
              onClose();
            }}
            className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-[#f8fafd] active:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]/60 dark:active:bg-[#2a2e39]"
          >
            <ClockPlusIcon className="h-5 w-5 shrink-0 text-[#131722] dark:text-[#d1d4dc]" />
            <span className="text-[14px] font-medium text-[#131722] dark:text-[#d1d4dc]">
              Add alert on <span className="font-bold">{symbol}</span> at{' '}
              <span className="font-mono-tabular font-bold">{formattedPrice}</span>
            </span>
          </button>

          {/* 2. Up-Chevron : Buy Limit/Stop */}
          <button
            type="button"
            onClick={() => {
              onPlaceBuyPending();
              onClose();
            }}
            className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-[#f8fafd] active:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]/60 dark:active:bg-[#2a2e39]"
          >
            <ChevronUp className="h-5 w-5 shrink-0 text-[#2962ff]" />
            <span className="text-[14px] font-medium text-[#131722] dark:text-[#d1d4dc]">
              <span className="font-bold text-[#2962ff]">Buy</span>{' '}
              <span className="font-mono-tabular font-semibold">{qty}</span>{' '}
              <span className="font-bold">{symbol}</span> @{' '}
              <span className="font-mono-tabular font-bold">{formattedPrice}</span>{' '}
              <span className="text-[#787b86]">{buyType}</span>
            </span>
          </button>

          {/* 3. Down-Chevron : Sell Stop/Limit */}
          <button
            type="button"
            onClick={() => {
              onPlaceSellPending();
              onClose();
            }}
            className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-[#f8fafd] active:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]/60 dark:active:bg-[#2a2e39]"
          >
            <ChevronDown className="h-5 w-5 shrink-0 text-[#f23645]" />
            <span className="text-[14px] font-medium text-[#131722] dark:text-[#d1d4dc]">
              <span className="font-bold text-[#f23645]">Sell</span>{' '}
              <span className="font-mono-tabular font-semibold">{qty}</span>{' '}
              <span className="font-bold">{symbol}</span> @{' '}
              <span className="font-mono-tabular font-bold">{formattedPrice}</span>{' '}
              <span className="text-[#787b86]">{sellType}</span>
            </span>
          </button>

          {/* 4. Order Ticket : Add order on SYMBOL at PRICE... */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenOrderTicket();
            }}
            className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-[#f8fafd] active:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]/60 dark:active:bg-[#2a2e39]"
          >
            <ClipboardList className="h-5 w-5 shrink-0 text-[#131722] dark:text-[#d1d4dc]" />
            <span className="text-[14px] font-medium text-[#131722] dark:text-[#d1d4dc]">
              Add order on <span className="font-bold">{symbol}</span> at{' '}
              <span className="font-mono-tabular font-bold">{formattedPrice}</span>...
            </span>
          </button>

          {/* 5. Horizontal Line */}
          <button
            type="button"
            onClick={() => {
              onDrawHorizontalLine();
              onClose();
            }}
            className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-[#f8fafd] active:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]/60 dark:active:bg-[#2a2e39]"
          >
            <HorizontalLineIcon className="h-5 w-5 shrink-0 text-[#131722] dark:text-[#d1d4dc]" />
            <span className="text-[14px] font-medium text-[#131722] dark:text-[#d1d4dc]">
              Draw horizontal line at{' '}
              <span className="font-mono-tabular font-bold">{formattedPrice}</span>
            </span>
          </button>
        </div>

        <div className="border-t border-[#f0f3fa] px-4 py-2.5 dark:border-[#2a2e39]">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-[#f0f3fa] py-2.5 text-xs font-bold text-[#131722] hover:bg-[#e0e3eb] dark:bg-[#131722] dark:text-[#d1d4dc] dark:hover:bg-[#2a2e39]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

interface CrosshairOrderTicketModalProps {
  symbol: string;
  initialPrice: number;
  currentPrice: number;
  initialQty: number;
  isReplay: boolean;
  onSubmitOrder: (order: {
    side: 'long' | 'short';
    orderType: PendingOrderType;
    targetPrice: number;
    qty: number;
    tpPrice?: number;
    slPrice?: number;
  }) => void;
  onClose: () => void;
}

export function CrosshairOrderTicketModal({
  symbol,
  initialPrice,
  currentPrice,
  initialQty,
  isReplay,
  onSubmitOrder,
  onClose,
}: CrosshairOrderTicketModalProps) {
  const spec = getSymbolContractSpec(symbol, currentPrice);
  const defaultSide: 'long' | 'short' =
    currentPrice > 0 && initialPrice > currentPrice ? 'short' : 'long';
  const [side, setSide] = useState<'long' | 'short'>(defaultSide);
  const [priceStr, setPriceStr] = useState<string>(String(initialPrice));
  const [qtyStr, setQtyStr] = useState<string>(
    String(sanitizeOrderQty(symbol, initialQty, currentPrice))
  );
  const [tpStr, setTpStr] = useState<string>('');
  const [slStr, setSlStr] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const parsedPrice = parseFloat(priceStr);
  const validPrice = !Number.isNaN(parsedPrice) && parsedPrice > 0 ? parsedPrice : initialPrice;
  const derivedOrderType: PendingOrderType =
    side === 'long'
      ? getCrosshairBuyOrderType(validPrice, currentPrice)
      : getCrosshairSellOrderType(validPrice, currentPrice);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetPrice = parseFloat(priceStr);
    const rawQty = parseFloat(qtyStr);
    const tp = tpStr.trim() ? parseFloat(tpStr) : undefined;
    const sl = slStr.trim() ? parseFloat(slStr) : undefined;

    if (Number.isNaN(targetPrice) || targetPrice <= 0) {
      setErrorMsg('Enter a valid order price.');
      return;
    }
    if (Number.isNaN(rawQty) || rawQty < spec.minQty) {
      setErrorMsg(`Minimum ${spec.unitLabel.toLowerCase()} is ${spec.minQty}.`);
      return;
    }
    if (spec.isIntegerOnly && !Number.isInteger(rawQty)) {
      setErrorMsg(`${symbol} ${spec.unitLabel.toLowerCase()} must be whole integers (1, 2, 3...).`);
      return;
    }
    const qty = sanitizeOrderQty(symbol, rawQty, targetPrice);
    if (tp !== undefined && !Number.isNaN(tp)) {
      if (side === 'long' && tp <= targetPrice) {
        setErrorMsg('Long Take Profit must be above entry price.');
        return;
      }
      if (side === 'short' && tp >= targetPrice) {
        setErrorMsg('Short Take Profit must be below entry price.');
        return;
      }
    }
    if (sl !== undefined && !Number.isNaN(sl)) {
      if (side === 'long' && sl >= targetPrice) {
        setErrorMsg('Long Stop Loss must be below entry price.');
        return;
      }
      if (side === 'short' && sl <= targetPrice) {
        setErrorMsg('Short Stop Loss must be above entry price.');
        return;
      }
    }

    onSubmitOrder({
      side,
      orderType: derivedOrderType,
      targetPrice,
      qty,
      tpPrice: tp !== undefined && !Number.isNaN(tp) ? tp : undefined,
      slPrice: sl !== undefined && !Number.isNaN(sl) ? sl : undefined,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-t-3xl border border-[#e0e3eb] bg-white shadow-2xl sm:rounded-2xl dark:border-[#2a2e39] dark:bg-[#1e222d]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#f0f3fa] px-4 py-3 dark:border-[#2a2e39]">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4.5 w-4.5 text-[#2962ff]" />
            <div>
              <h3 className="text-sm font-bold text-[#131722] dark:text-white">
                Order Ticket · {symbol}
              </h3>
              <p className="text-[11px] text-[#787b86]">
                {isReplay ? 'Replay Paper Account' : 'Live Paper Account'} · Current{' '}
                <span className="font-mono-tabular font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  {formatPrice(currentPrice)}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close order ticket"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#787b86] hover:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 p-4">
          {/* Buy / Sell Segmented Toggle */}
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#f0f3fa] p-1 dark:bg-[#131722]">
            <button
              type="button"
              onClick={() => {
                setSide('long');
                setErrorMsg(null);
              }}
              className={`rounded-lg py-2 text-xs font-bold transition-colors ${
                side === 'long'
                  ? 'bg-[#2962ff] text-white shadow-xs'
                  : 'text-[#787b86] hover:text-[#131722] dark:hover:text-white'
              }`}
            >
              BUY {side === 'long' ? `(${derivedOrderType.toUpperCase()})` : ''}
            </button>
            <button
              type="button"
              onClick={() => {
                setSide('short');
                setErrorMsg(null);
              }}
              className={`rounded-lg py-2 text-xs font-bold transition-colors ${
                side === 'short'
                  ? 'bg-[#f23645] text-white shadow-xs'
                  : 'text-[#787b86] hover:text-[#131722] dark:hover:text-white'
              }`}
            >
              SELL {side === 'short' ? `(${derivedOrderType.toUpperCase()})` : ''}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="block text-[11px] font-semibold text-[#787b86]">
                Order Price ({derivedOrderType})
              </span>
              <input
                type="number"
                step="any"
                required
                value={priceStr}
                onChange={(e) => {
                  setPriceStr(e.target.value);
                  setErrorMsg(null);
                }}
                className="h-10 w-full rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3 font-mono-tabular text-sm font-bold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-white"
              />
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] font-semibold text-[#787b86]">
                Quantity ({spec.unitLabel})
              </span>
              <input
                type="number"
                step={spec.qtyStep}
                min={spec.minQty}
                required
                value={qtyStr}
                onChange={(e) => {
                  setQtyStr(e.target.value);
                  setErrorMsg(null);
                }}
                onBlur={() => {
                  const parsed = parseFloat(qtyStr);
                  if (!Number.isNaN(parsed)) {
                    setQtyStr(String(sanitizeOrderQty(symbol, parsed, currentPrice)));
                  }
                }}
                className="h-10 w-full rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3 font-mono-tabular text-sm font-bold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-white"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="block text-[11px] font-semibold text-[#089981]">
                Take Profit (TP)
              </span>
              <input
                type="number"
                step="any"
                value={tpStr}
                onChange={(e) => {
                  setTpStr(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="Optional"
                className="h-10 w-full rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3 font-mono-tabular text-sm font-semibold text-[#131722] outline-none focus:border-[#089981] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-white"
              />
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] font-semibold text-[#f23645]">
                Stop Loss (SL)
              </span>
              <input
                type="number"
                step="any"
                value={slStr}
                onChange={(e) => {
                  setSlStr(e.target.value);
                  setErrorMsg(null);
                }}
                placeholder="Optional"
                className="h-10 w-full rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-3 font-mono-tabular text-sm font-semibold text-[#131722] outline-none focus:border-[#f23645] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-white"
              />
            </label>
          </div>

          {errorMsg && (
            <div className="rounded-lg bg-[#f23645]/10 px-3 py-2 text-xs font-semibold text-[#f23645]">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-[#e0e3eb] py-2.5 text-xs font-bold text-[#787b86] hover:bg-[#f0f3fa] dark:border-[#2a2e39] dark:hover:bg-[#2a2e39]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`flex-[2] rounded-xl py-2.5 text-xs font-bold text-white shadow-sm transition-colors ${
                side === 'long'
                  ? 'bg-[#2962ff] hover:bg-[#1e53e5]'
                  : 'bg-[#f23645] hover:bg-[#dc2626]'
              }`}
            >
              {side === 'long' ? 'Buy' : 'Sell'} {qtyStr || '0'} {symbol} @{' '}
              {formatPrice(validPrice)} {derivedOrderType}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
