import { SYMBOL_CATALOG, type AssetCategory } from '../types/trading';

export interface MarketStatus {
  category: AssetCategory;
  isOpen: boolean;
  isWeekend: boolean;
  label: string;
}

function getZonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { weekday, minutesOfDay: hour * 60 + minute };
}

export function getSymbolCategory(symbol: string): AssetCategory {
  const upper = symbol.toUpperCase();
  const meta = SYMBOL_CATALOG.find((s) => s.symbol === upper);
  if (meta) return meta.category;
  if (upper.endsWith('USDT') || upper.endsWith('USDC') || upper.endsWith('BTC')) {
    return 'Crypto';
  }
  if (upper.endsWith('1!')) return 'Futures';
  return 'Stocks';
}

export function getMarketStatus(symbol: string, now = new Date()): MarketStatus {
  const upper = symbol.toUpperCase();
  const category = getSymbolCategory(upper);

  if (category === 'Crypto') {
    return { category, isOpen: true, isWeekend: false, label: '24/7 Live' };
  }

  const ny = getZonedParts(now, 'America/New_York');

  if (category === 'Stocks') {
    const isWeekend = ny.weekday === 'Sat' || ny.weekday === 'Sun';
    const inRegular = ny.minutesOfDay >= 9 * 60 + 30 && ny.minutesOfDay < 16 * 60;
    const inPreMarket = ny.minutesOfDay >= 4 * 60 && ny.minutesOfDay < 9 * 60 + 30;
    const inAfterHours = ny.minutesOfDay >= 16 * 60 && ny.minutesOfDay < 20 * 60;
    const isOpen = !isWeekend && (inRegular || inPreMarket || inAfterHours);
    return {
      category,
      isOpen,
      isWeekend,
      label: isWeekend
        ? 'Market Closed (Reopens Mon 04:00 ET)'
        : inRegular
        ? 'Market Open'
        : inPreMarket
        ? 'Pre-Market Live'
        : inAfterHours
        ? 'After-Hours Live'
        : 'Market Closed',
    };
  }

  // Futures (NQ1!, ES1!, YM1!, CL1!):
  // Weekend closure: Fri 17:00 ET -> Sun 18:00 ET (Reopens Sun 11:00 PM WAT)
  const isWeekendWindow =
    ny.weekday === 'Sat' ||
    (ny.weekday === 'Sun' && ny.minutesOfDay < 18 * 60) ||
    (ny.weekday === 'Fri' && ny.minutesOfDay >= 17 * 60);

  if (isWeekendWindow) {
    return {
      category,
      isOpen: false,
      isWeekend: true,
      label: 'Market Closed (Reopens Sun 11:00 PM WAT)',
    };
  }

  // Mon-Thu daily maintenance break 17:00 - 18:00 ET
  const inBreak = ny.minutesOfDay >= 17 * 60 && ny.minutesOfDay < 18 * 60;
  return {
    category,
    isOpen: !inBreak,
    isWeekend: false,
    label: inBreak ? 'Market Closed' : 'Market Open',
  };
}
