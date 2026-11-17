import {
  ChevronDown,
  Clock,
  FastForward,
  GripVertical,
  Lock,
  Pause,
  Play,
  RefreshCw,
  SkipForward,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TIMEFRAME_GROUPS,
  type ReplaySpeed,
  type ReplayState,
  type Timeframe,
} from '../types/trading';

export interface ReplayJumpRequest {
  deltaSeconds?: number;
  deltaBars?: number;
  targetTimeSec?: number;
}

interface ReplayBarProps {
  replay: ReplayState;
  activeTimeframe: Timeframe;
  onTogglePlay: () => void;
  onStepForward: () => void;
  onJumpForward: (req: ReplayJumpRequest) => void;
  onChangeSpeed: (speed: ReplaySpeed) => void;
  onChangeTimeframe: (tf: Timeframe) => void;
  onToggleTimeframeSync: () => void;
  onExitReplay: () => void;
}

const SPEEDS: ReplaySpeed[] = [0.5, 1, 2, 5];

const QUICK_JUMPS: Array<{ label: string; deltaSeconds: number }> = [
  { label: '+5m', deltaSeconds: 5 * 60 },
  { label: '+15m', deltaSeconds: 15 * 60 },
  { label: '+1h', deltaSeconds: 60 * 60 },
  { label: '+4h', deltaSeconds: 4 * 60 * 60 },
  { label: '+1d', deltaSeconds: 24 * 60 * 60 },
];

function formatDateInput(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatTimeInput(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function ReplayBar({
  replay,
  activeTimeframe,
  onTogglePlay,
  onStepForward,
  onJumpForward,
  onChangeSpeed,
  onChangeTimeframe,
  onToggleTimeframeSync,
  onExitReplay,
}: ReplayBarProps) {
  const [jumpOpen, setJumpOpen] = useState(false);
  const [tfOpen, setTfOpen] = useState(false);
  const [customAmount, setCustomAmount] = useState('30');
  const [customUnit, setCustomUnit] = useState<'minutes' | 'hours' | 'bars'>('minutes');
  const [dateStr, setDateStr] = useState(() =>
    formatDateInput((replay.currentTime ?? Math.floor(Date.now() / 1000)) + 3600)
  );
  const [timeStr, setTimeStr] = useState(() =>
    formatTimeInput((replay.currentTime ?? Math.floor(Date.now() / 1000)) + 3600)
  );

  // Free-floating drag state using GPU-accelerated translate3d
  const barRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  const [isDraggingBar, setIsDraggingBar] = useState(false);

  const dragSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    activated: boolean;
    capturedEl: HTMLElement | null;
  } | null>(null);

  const getBounds = useCallback(() => {
    const el = barRef.current;
    if (!el) return null;
    const stageEl = el.closest('main');
    const stageRect = stageEl
      ? stageEl.getBoundingClientRect()
      : {
          left: 0,
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
        };
    const rect = el.getBoundingClientRect();
    const cur = offsetRef.current;
    const untranslatedLeft = rect.left - cur.x;
    const untranslatedTop = rect.top - cur.y;
    const pad = 8;

    const stageW = stageRect.right - stageRect.left;
    let rawMinX = stageRect.left + pad - untranslatedLeft;
    let rawMaxX = stageRect.right - pad - (untranslatedLeft + rect.width);

    if (rawMaxX - rawMinX < 80) {
      const keepVisible = Math.min(rect.width, Math.max(140, stageW * 0.45));
      rawMinX = stageRect.left + keepVisible - (untranslatedLeft + rect.width);
      rawMaxX = stageRect.right - keepVisible - untranslatedLeft;
    }

    const minX = Math.min(rawMinX, rawMaxX);
    const maxX = Math.max(rawMinX, rawMaxX);
    const rawMinY = stageRect.top + pad - untranslatedTop;
    const rawMaxY = stageRect.bottom - pad - (untranslatedTop + rect.height);
    const minY = Math.min(rawMinY, rawMaxY);
    const maxY = Math.max(rawMinY, rawMaxY);

    return { minX, maxX, minY, maxY };
  }, []);

  const applyTransform = useCallback((x: number, y: number) => {
    offsetRef.current = { x, y };
    if (barRef.current) {
      barRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const bounds = getBounds();
      if (!bounds) return;
      const cx = Math.min(bounds.maxX, Math.max(bounds.minX, offsetRef.current.x));
      const cy = Math.min(bounds.maxY, Math.max(bounds.minY, offsetRef.current.y));
      applyTransform(cx, cy);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [getBounds, applyTransform]);

  useEffect(() => {
    const handleWindowPointerMove = (e: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || e.pointerId !== session.pointerId) return;

      const dx = e.clientX - session.startX;
      const dy = e.clientY - session.startY;
      if (!session.activated) {
        if (Math.hypot(dx, dy) < 3) return;
        session.activated = true;
        suppressClickRef.current = true;
        setIsDraggingBar(true);
      }

      const rawX = session.baseX + dx;
      const rawY = session.baseY + dy;
      const clampedX = Math.min(session.maxX, Math.max(session.minX, rawX));
      const clampedY = Math.min(session.maxY, Math.max(session.minY, rawY));
      applyTransform(clampedX, clampedY);
    };

    const handleWindowPointerUp = (e: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || e.pointerId !== session.pointerId) return;
      if (session.capturedEl) {
        try {
          if (session.capturedEl.hasPointerCapture(e.pointerId)) {
            session.capturedEl.releasePointerCapture(e.pointerId);
          }
        } catch {
          // Ignore already released capture
        }
      }
      const wasActivated = session.activated;
      dragSessionRef.current = null;
      setIsDraggingBar(false);
      if (wasActivated) {
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 50);
      }
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, [applyTransform]);

  const startBarDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const bounds = getBounds();
    if (!bounds) return;

    e.preventDefault();
    e.stopPropagation();
    suppressClickRef.current = false;

    let capturedEl: HTMLElement | null = null;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
      capturedEl = e.currentTarget;
    } catch {
      // Fallback to window listener
    }
    setIsDraggingBar(true);

    dragSessionRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: offsetRef.current.x,
      baseY: offsetRef.current.y,
      ...bounds,
      activated: true,
      capturedEl,
    };
  };

  useEffect(() => {
    if (!replay.active || replay.selectingStart) {
      setJumpOpen(false);
      setTfOpen(false);
    }
  }, [replay.active, replay.selectingStart]);

  useEffect(() => {
    if (!replay.timeframeSync) {
      setTfOpen(false);
    }
  }, [replay.timeframeSync]);

  useEffect(() => {
    if (jumpOpen && replay.currentTime) {
      const nextDefault = replay.currentTime + 3600;
      setDateStr(formatDateInput(nextDefault));
      setTimeStr(formatTimeInput(nextDefault));
    }
  }, [jumpOpen, replay.currentTime]);

  if (!replay.active) return null;

  const atEnd = replay.currentIndex >= replay.totalCandles - 1;

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = Math.max(1, Math.floor(Number(customAmount) || 0));
    if (!val) return;
    if (customUnit === 'bars') {
      onJumpForward({ deltaBars: val });
    } else if (customUnit === 'hours') {
      onJumpForward({ deltaSeconds: val * 3600 });
    } else {
      onJumpForward({ deltaSeconds: val * 60 });
    }
    setJumpOpen(false);
  };

  const handleExactTimeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dateStr) return;
    const combined = new Date(`${dateStr}T${timeStr || '00:00'}:00`);
    const ts = Math.floor(combined.getTime() / 1000);
    if (!Number.isNaN(ts)) {
      onJumpForward({ targetTimeSec: ts });
      setJumpOpen(false);
    }
  };

  return (
    <div
      ref={barRef}
      style={{ transform: 'translate3d(0px, 0px, 0)' }}
      className={`pointer-events-auto relative flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-xl border bg-white/95 px-2 py-1.5 shadow-lg backdrop-blur-md will-change-transform dark:bg-[#1e222d]/95 ${
        isDraggingBar
          ? 'border-[#2962ff] ring-2 ring-[#2962ff]/25 shadow-xl'
          : 'border-[#2962ff]/30 dark:border-[#2962ff]/40'
      }`}
    >
      {/* 6-Dot Draggable Grip Handle (Left End) */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drag Bar Replay bar anywhere (double-click to reset)"
        title="Drag Bar Replay bar anywhere (double-click to reset)"
        onDoubleClick={() => applyTransform(0, 0)}
        onPointerDown={startBarDrag}
        className="flex h-8 w-5 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-md text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] active:cursor-grabbing dark:hover:bg-[#2a2e39] dark:hover:text-white"
      >
        <GripVertical className="h-4 w-4" />
      </div>

      {replay.selectingStart ? (
        <div className="flex items-center gap-2 px-1 py-0.5 text-xs font-medium text-[#131722] dark:text-[#d1d4dc]">
          <span className="h-2 w-2 rounded-full bg-[#2962ff]" />
          <span>Tap any candle on the chart to jump to that point</span>
          <button
            type="button"
            onClick={onExitReplay}
            className="ml-1 flex min-h-[32px] items-center gap-1 rounded-lg border border-[#e0e3eb] px-2.5 py-1 text-xs font-medium text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:border-[#2a2e39] dark:hover:bg-[#2a2e39] dark:hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
            <span>Exit</span>
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={atEnd || Boolean(replay.syncing)}
            className="flex min-h-[34px] min-w-[34px] items-center justify-center gap-1.5 rounded-lg bg-[#2962ff] px-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#1e53e5] disabled:opacity-40"
            aria-label={replay.playing ? 'Pause replay' : 'Play replay'}
          >
            {replay.playing ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                <span>Play</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onStepForward}
            disabled={atEnd || Boolean(replay.syncing)}
            title="Step Forward (+1 candle)"
            aria-label="Step Forward one candle"
            className="flex min-h-[34px] items-center gap-1 rounded-lg border border-[#e0e3eb] px-2 text-xs font-medium text-[#131722] transition-colors hover:bg-[#f0f3fa] disabled:opacity-40 dark:border-[#2a2e39] dark:text-[#d1d4dc] dark:hover:bg-[#2a2e39]"
          >
            <SkipForward className="h-3.5 w-3.5" />
            <span>+1</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTfOpen(false);
              setJumpOpen((v) => !v);
            }}
            disabled={atEnd || Boolean(replay.syncing)}
            title="Forward To / Jump Forward"
            aria-label="Forward To / Jump Forward"
            className={`flex min-h-[34px] items-center gap-1 rounded-lg border px-2 text-xs font-semibold transition-colors disabled:opacity-40 ${
              jumpOpen
                ? 'border-[#2962ff] bg-[#2962ff] text-white'
                : 'border-[#e0e3eb] text-[#131722] hover:border-[#2962ff] hover:text-[#2962ff] dark:border-[#2a2e39] dark:text-[#d1d4dc] dark:hover:border-[#2962ff]'
            }`}
          >
            <FastForward className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Forward</span>
          </button>

          {/* Compact Replay Interval Selector (1s through 1M) + Timeframe Lock/Sync Toggle */}
          <div className="relative flex items-center gap-1 rounded-lg border border-[#e0e3eb] bg-[#f8fafd] p-0.5 dark:border-[#2a2e39] dark:bg-[#131722]">
            <button
              type="button"
              onClick={() => {
                if (!replay.timeframeSync) return;
                setJumpOpen(false);
                setTfOpen((v) => !v);
              }}
              disabled={!replay.timeframeSync || Boolean(replay.syncing)}
              title={
                replay.timeframeSync
                  ? 'Switch Replay timeframe (dynamically resamples at current timestamp)'
                  : 'Replay interval locked (toggle Sync ON to switch timeframes)'
              }
              aria-label="Select Replay Timeframe"
              className={`flex min-h-[28px] items-center gap-1 rounded-md px-2 font-mono-tabular text-xs font-bold transition-colors ${
                !replay.timeframeSync
                  ? 'cursor-not-allowed text-[#787b86] opacity-70'
                  : tfOpen
                  ? 'bg-[#2962ff] text-white'
                  : 'bg-white text-[#131722] shadow-2xs hover:text-[#2962ff] dark:bg-[#2a2e39] dark:text-white'
              }`}
            >
              {!replay.timeframeSync && <Lock className="h-3 w-3 text-[#f59e0b]" />}
              <span>{replay.syncing ? '...' : activeTimeframe}</span>
              <ChevronDown className="h-3 w-3 opacity-75" />
            </button>

            <button
              type="button"
              role="switch"
              aria-checked={replay.timeframeSync}
              onClick={onToggleTimeframeSync}
              title={
                replay.timeframeSync
                  ? 'Timeframe Sync ON: switching timeframes resamples candles at current replay time'
                  : 'Timeframe Sync OFF: replay bar interval is locked'
              }
              aria-label={
                replay.timeframeSync ? 'Lock Replay Timeframe' : 'Enable Replay Timeframe Sync'
              }
              className={`flex min-h-[28px] items-center gap-1 rounded-md px-1.5 text-[10px] font-bold transition-colors ${
                replay.timeframeSync
                  ? 'bg-[#2962ff]/12 text-[#2962ff] hover:bg-[#2962ff]/20'
                  : 'text-[#787b86] hover:bg-[#e0e3eb]/60 dark:hover:bg-[#2a2e39]'
              }`}
            >
              <RefreshCw className="h-3 w-3" />
              <span
                className={`relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  replay.timeframeSync ? 'bg-[#2962ff]' : 'bg-[#b2b5be] dark:bg-[#434651]'
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full bg-white shadow transition-transform ${
                    replay.timeframeSync ? 'translate-x-2.5' : 'translate-x-0'
                  }`}
                />
              </span>
              <span className="hidden sm:inline">
                {replay.timeframeSync ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>

          <div className="flex items-center rounded-lg bg-[#f0f3fa] p-0.5 dark:bg-[#131722]">
            {SPEEDS.map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => onChangeSpeed(spd)}
                className={`min-h-[28px] rounded-md px-1.5 text-xs font-medium tabular-nums transition-colors ${
                  replay.speed === spd
                    ? 'bg-white text-[#2962ff] shadow-xs dark:bg-[#2a2e39] dark:text-white'
                    : 'text-[#787b86] hover:text-[#131722] dark:hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          <span className="px-1 font-mono-tabular text-[11px] text-[#787b86]">
            {replay.currentIndex + 1}/{replay.totalCandles}
          </span>

          <button
            type="button"
            onClick={onExitReplay}
            className="flex min-h-[34px] items-center gap-1 rounded-lg border border-[#e0e3eb] px-2 text-xs font-medium text-[#f23645] transition-colors hover:bg-[#f23645]/10 dark:border-[#2a2e39]"
            aria-label="Exit Replay"
          >
            <X className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        </>
      )}

      {/* Replay Interval Selector Popover (All 18 Timeframes: 1s through 1M) */}
      {tfOpen && !replay.selectingStart && replay.timeframeSync && (
        <div
          className="absolute bottom-full left-1/2 z-50 mb-2 w-[310px] max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-2xl border border-[#e0e3eb] bg-white p-3.5 shadow-2xl dark:border-[#2a2e39] dark:bg-[#1e222d]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#131722] dark:text-white">
              <RefreshCw className="h-3.5 w-3.5 text-[#2962ff]" />
              <span>Replay Interval (Resample Live)</span>
            </div>
            <button
              type="button"
              onClick={() => setTfOpen(false)}
              aria-label="Close timeframe selector"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[#787b86] hover:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-2.5">
            {TIMEFRAME_GROUPS.map((grp) => (
              <div key={grp.label}>
                <div className="mb-1 text-[10px] font-bold tracking-wider text-[#787b86] uppercase">
                  {grp.label}
                </div>
                <div className="flex flex-wrap gap-1">
                  {grp.items.map((tf) => {
                    const isSelected = activeTimeframe === tf;
                    return (
                      <button
                        key={tf}
                        type="button"
                        onClick={() => {
                          onChangeTimeframe(tf);
                          setTfOpen(false);
                        }}
                        className={`min-h-[30px] min-w-[42px] rounded-lg px-2 font-mono-tabular text-xs font-bold transition-colors ${
                          isSelected
                            ? 'bg-[#2962ff] text-white'
                            : 'border border-[#e0e3eb] bg-[#f8fafd] text-[#131722] hover:border-[#2962ff] hover:text-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]'
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
        </div>
      )}

      {/* Fast-Forward / Custom Time-Jump Popover */}
      {jumpOpen && !replay.selectingStart && (
        <div
          className="absolute bottom-full left-1/2 z-50 mb-2 w-[310px] max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-2xl border border-[#e0e3eb] bg-white p-3.5 shadow-2xl dark:border-[#2a2e39] dark:bg-[#1e222d]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#131722] dark:text-white">
              <FastForward className="h-3.5 w-3.5 text-[#2962ff]" />
              <span>Fast-Forward Replay</span>
            </div>
            <button
              type="button"
              onClick={() => setJumpOpen(false)}
              aria-label="Close fast-forward popup"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[#787b86] hover:bg-[#f0f3fa] dark:hover:bg-[#2a2e39]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* 1. Quick-Jump Presets + Custom Interval */}
          <div className="space-y-2 border-b border-[#f0f3fa] pb-3 dark:border-[#2a2e39]">
            <div className="text-[11px] font-semibold text-[#787b86]">
              Quick-Jump Forward
            </div>
            <div className="grid grid-cols-5 gap-1">
              {QUICK_JUMPS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    onJumpForward({ deltaSeconds: preset.deltaSeconds });
                    setJumpOpen(false);
                  }}
                  className="h-8 rounded-lg border border-[#e0e3eb] bg-[#f8fafd] font-mono-tabular text-[11px] font-bold text-[#131722] transition-colors hover:border-[#2962ff] hover:text-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleCustomSubmit} className="flex items-center gap-1.5 pt-1">
              <input
                type="number"
                min="1"
                step="1"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                aria-label="Custom forward jump value"
                className="h-8 w-16 rounded-lg border border-[#e0e3eb] bg-[#f8fafd] px-2 text-center font-mono-tabular text-xs font-bold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
              />
              <select
                value={customUnit}
                onChange={(e) =>
                  setCustomUnit(e.target.value as 'minutes' | 'hours' | 'bars')
                }
                aria-label="Custom forward jump unit"
                className="h-8 flex-1 rounded-lg border border-[#e0e3eb] bg-[#f8fafd] px-2 text-xs font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="bars">Candles</option>
              </select>
              <button
                type="submit"
                className="h-8 rounded-lg bg-[#2962ff] px-3 text-xs font-bold text-white hover:bg-[#1e53e5]"
              >
                Go
              </button>
            </form>
          </div>

          {/* 2. Exact Date & Time Target */}
          <form onSubmit={handleExactTimeSubmit} className="space-y-2 pt-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#787b86]">
              <Clock className="h-3 w-3 text-[#2962ff]" />
              <span>Jump Forward to Exact Date &amp; Time</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="date"
                required
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
                aria-label="Target replay date"
                className="h-8 rounded-lg border border-[#e0e3eb] bg-[#f8fafd] px-2 font-mono-tabular text-[11px] font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
              />
              <input
                type="time"
                required
                value={timeStr}
                onChange={(e) => setTimeStr(e.target.value)}
                aria-label="Target replay time"
                className="h-8 rounded-lg border border-[#e0e3eb] bg-[#f8fafd] px-2 font-mono-tabular text-[11px] font-semibold text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
              />
            </div>
            <button
              type="submit"
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[#2962ff]/12 text-xs font-bold text-[#2962ff] transition-colors hover:bg-[#2962ff] hover:text-white"
            >
              <FastForward className="h-3.5 w-3.5" />
              <span>Jump to Selected Time</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
