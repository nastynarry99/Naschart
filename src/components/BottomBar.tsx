import {
  BookOpen,
  Bookmark,
  Clock,
  Menu,
  Wallet,
} from 'lucide-react';
import type { Timeframe } from '../types/trading';

export type ActiveSheet =
  | null
  | 'symbol'
  | 'timeframe'
  | 'drawings'
  | 'indicators'
  | 'paper'
  | 'journal'
  | 'watchlist'
  | 'alerts'
  | 'menu'
  | 'goto'
  | 'settings';

interface BottomBarProps {
  activeTimeframe: Timeframe;
  activeSheet: ActiveSheet;
  openPositionCount: number;
  onOpenSheet: (sheet: ActiveSheet) => void;
}

export function BottomBar({
  activeTimeframe,
  activeSheet,
  openPositionCount,
  onOpenSheet,
}: BottomBarProps) {
  return (
    <nav
      aria-label="NasChart bottom toolbar"
      className="z-30 grid h-14 shrink-0 grid-cols-5 items-center border-t border-[#f0f3fa] bg-white px-1 sm:px-2 dark:border-[#2a2e39] dark:bg-[#131722]"
    >
      {/* Timeframe Selector */}
      <button
        type="button"
        onClick={() => onOpenSheet(activeSheet === 'timeframe' ? null : 'timeframe')}
        className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 transition-colors ${
          activeSheet === 'timeframe'
            ? 'text-[#2962ff]'
            : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#1e222d]'
        }`}
      >
        <Clock className="h-[17px] w-[17px]" />
        <span className="font-mono-tabular text-[9.5px] font-semibold whitespace-nowrap">
          {activeTimeframe}
        </span>
      </button>

      {/* Paper Trading Account */}
      <button
        type="button"
        onClick={() => onOpenSheet(activeSheet === 'paper' ? null : 'paper')}
        className={`relative flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 transition-colors ${
          activeSheet === 'paper'
            ? 'bg-[#2962ff]/10 text-[#2962ff]'
            : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#1e222d]'
        }`}
      >
        <Wallet className="h-[17px] w-[17px]" />
        <span className="text-[9.5px] font-semibold whitespace-nowrap">
          Paper{openPositionCount > 0 ? `(${openPositionCount})` : ''}
        </span>
      </button>

      {/* Trading Journal & PnL Calendar */}
      <button
        type="button"
        onClick={() => onOpenSheet(activeSheet === 'journal' ? null : 'journal')}
        className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 transition-colors ${
          activeSheet === 'journal'
            ? 'bg-[#2962ff]/10 text-[#2962ff]'
            : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#1e222d]'
        }`}
      >
        <BookOpen className="h-[17px] w-[17px]" />
        <span className="text-[9.5px] font-semibold whitespace-nowrap">Journal</span>
      </button>

      {/* Watchlist */}
      <button
        type="button"
        onClick={() => onOpenSheet(activeSheet === 'watchlist' ? null : 'watchlist')}
        className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 transition-colors ${
          activeSheet === 'watchlist'
            ? 'text-[#2962ff]'
            : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#1e222d]'
        }`}
      >
        <Bookmark className="h-[17px] w-[17px]" />
        <span className="text-[9.5px] font-semibold whitespace-nowrap">Watch</span>
      </button>

      {/* Menu */}
      <button
        type="button"
        onClick={() => onOpenSheet(activeSheet === 'menu' ? null : 'menu')}
        className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 transition-colors ${
          activeSheet === 'menu'
            ? 'text-[#2962ff]'
            : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#1e222d]'
        }`}
      >
        <Menu className="h-[17px] w-[17px]" />
        <span className="text-[9.5px] font-semibold whitespace-nowrap">Menu</span>
      </button>
    </nav>
  );
}

