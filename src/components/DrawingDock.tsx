import {
  Eye,
  EyeOff,
  GripVertical,
  LayoutList,
  Lock,
  Magnet,
  MousePointer,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DRAWING_TOOLS_CATALOG,
  type DrawingTool,
} from '../types/trading';
import { getToolIcon } from '../utils/drawingToolIcons';

interface DrawingDockProps {
  activeTool: DrawingTool;
  pinnedTools: DrawingTool[];
  placementHint: string | null;
  magnetMode: boolean;
  lockedDrawings: boolean;
  hiddenDrawings: boolean;
  drawingCount: number;
  onSelectTool: (tool: DrawingTool) => void;
  onOpenDrawer: () => void;
  onToggleMagnet: () => void;
  onToggleLock: () => void;
  onToggleHide: () => void;
  onCancelPending: () => void;
  onClearAll: () => void;
}

export function DrawingDock({
  activeTool,
  pinnedTools,
  placementHint,
  magnetMode,
  lockedDrawings,
  hiddenDrawings,
  drawingCount,
  onSelectTool,
  onOpenDrawer,
  onToggleMagnet,
  onToggleLock,
  onToggleHide,
  onCancelPending,
  onClearAll,
}: DrawingDockProps) {
  const activeMeta = DRAWING_TOOLS_CATALOG.find((t) => t.id === activeTool);

  const dockRef = useRef<HTMLDivElement | null>(null);
  const toolsStripRef = useRef<HTMLDivElement | null>(null);
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
    const el = dockRef.current;
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

    // On narrow/mobile screens where toolbar fills most of the width, still allow smooth sideways sliding
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
    if (dockRef.current) {
      dockRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }, []);

  // Keep bar clamped inside visible screen bounds when window resizes
  useEffect(() => {
    const handleResize = () => {
      const bounds = getBounds();
      if (!bounds) return;
      const cx = Math.min(bounds.maxX, Math.max(bounds.minX, offsetRef.current.x));
      const cy = Math.min(bounds.maxY, Math.max(bounds.minY, offsetRef.current.y));
      applyTransform(cx, cy);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [getBounds, applyTransform]);

  // Global move/up listeners so dragging works smoothly even when started from anywhere on the toolbar
  useEffect(() => {
    const handleWindowPointerMove = (e: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || e.pointerId !== session.pointerId) return;

      const dx = e.clientX - session.startX;
      const dy = e.clientY - session.startY;

      if (!session.activated) {
        if (Math.hypot(dx, dy) < 5) return;
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
          // Ignore if already released
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

  const startBarDrag = (
    e: React.PointerEvent<HTMLElement>,
    immediate: boolean
  ) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const bounds = getBounds();
    if (!bounds) return;

    suppressClickRef.current = false;
    let capturedEl: HTMLElement | null = null;
    if (immediate) {
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
        capturedEl = e.currentTarget;
      } catch {
        // Fallback to window listener
      }
      setIsDraggingBar(true);
    }

    dragSessionRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: offsetRef.current.x,
      baseY: offsetRef.current.y,
      minX: bounds.minX,
      maxX: bounds.maxX,
      minY: bounds.minY,
      maxY: bounds.maxY,
      activated: immediate,
      capturedEl,
    };
  };

  return (
    <div
      ref={dockRef}
      style={{ willChange: 'transform', transform: 'translate3d(0px, 0px, 0px)' }}
      className="pointer-events-none flex max-w-full flex-col items-center gap-1.5 px-2"
    >
      {(placementHint || (activeTool !== 'cursor' && activeMeta)) && (
        <div
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            startBarDrag(e, true);
          }}
          style={{ touchAction: 'none' }}
          className="pointer-events-auto flex cursor-grab items-center gap-2 rounded-lg bg-[#2962ff] px-3 py-1.5 text-xs font-medium text-white shadow-md active:cursor-grabbing"
        >
          <span>
            {placementHint ??
              `${activeMeta?.name}: ${
                activeMeta?.pointsNeeded === 'freehand'
                  ? 'Drag on chart to draw'
                  : activeMeta?.pointsNeeded === 1
                  ? 'Drag crosshair, tap screen to place'
                  : `Drag crosshair, tap point 1 of ${activeMeta?.pointsNeeded}`
              }`}
          </span>
          <button
            type="button"
            onClick={onCancelPending}
            className="flex h-5 w-5 items-center justify-center rounded bg-white/20 hover:bg-white/30"
            aria-label="Cancel drawing"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div
        onPointerDown={(e) => startBarDrag(e, false)}
        onClickCapture={(e) => {
          if (suppressClickRef.current) {
            e.preventDefault();
            e.stopPropagation();
            suppressClickRef.current = false;
          }
        }}
        style={{ touchAction: 'none' }}
        className={`pointer-events-auto flex max-w-full flex-col rounded-xl border bg-white/95 shadow-lg backdrop-blur-md select-none dark:bg-[#1e222d]/95 ${
          isDraggingBar
            ? 'border-[#2962ff] ring-2 ring-[#2962ff]/25'
            : 'border-[#e0e3eb] dark:border-[#2a2e39]'
        }`}
      >
        {/* Top Full-Width Drag Handle Bar for easy up/down & sideways dragging */}
        <div
          onPointerDown={(e) => startBarDrag(e, true)}
          onDoubleClick={() => applyTransform(0, 0)}
          style={{ touchAction: 'none' }}
          title="Drag drawing toolbar up, down, or sideways (double-click to reset)"
          className="flex h-3.5 w-full cursor-grab items-center justify-center rounded-t-xl border-b border-[#f0f3fa] hover:bg-[#f0f3fa]/70 active:cursor-grabbing dark:border-[#2a2e39]/60 dark:hover:bg-[#2a2e39]/50"
        >
          <span className="h-1 w-10 rounded-full bg-[#b2b5be] dark:bg-[#4c525e]" />
        </div>

        <div className="flex max-w-full items-center p-1 pt-0.5">
          {/* 6-Dot Drag Grip Handle */}
          <button
            type="button"
            onPointerDown={(e) => startBarDrag(e, true)}
            onDoubleClick={() => applyTransform(0, 0)}
            style={{ touchAction: 'none' }}
            title="Drag favorites toolbar anywhere on chart"
            aria-label="Drag favorites drawing toolbar"
            className="mr-0.5 flex min-h-[38px] w-8 shrink-0 cursor-grab items-center justify-center rounded-lg text-[#787b86] select-none hover:bg-[#f0f3fa] hover:text-[#131722] active:cursor-grabbing active:text-[#2962ff] dark:hover:bg-[#2a2e39] dark:hover:text-white"
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div
            ref={toolsStripRef}
            className="flex min-w-0 items-center gap-0.5 overflow-x-auto no-scrollbar"
          >
          {/* All Tools Drawer Button */}
          <button
            type="button"
            onClick={onOpenDrawer}
            title="Open all drawing tools"
            className="flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg bg-[#f0f3fa] px-2.5 py-1.5 text-xs font-semibold text-[#131722] transition-colors hover:bg-[#e0e3eb] dark:bg-[#2a2e39] dark:text-[#d1d4dc] dark:hover:bg-[#363a45]"
          >
            <LayoutList className="h-4 w-4 shrink-0 text-[#2962ff]" />
            <span className="hidden sm:inline">Tools</span>
          </button>

          {/* Pan / Cursor */}
          <button
            type="button"
            onClick={() => onSelectTool('cursor')}
            title="Crosshair / Pan"
            aria-label="Crosshair or Pan"
            className={`flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTool === 'cursor'
                ? 'bg-[#2962ff] text-white'
                : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#2a2e39]'
            }`}
          >
            <MousePointer className="h-4 w-4 shrink-0" />
          </button>

          {/* Pinned / Starred Tools */}
          {pinnedTools.map((toolId) => {
            const meta = DRAWING_TOOLS_CATALOG.find((t) => t.id === toolId);
            if (!meta) return null;
            const Icon = getToolIcon(toolId);
            const isActive = activeTool === toolId;
            return (
              <button
                key={toolId}
                type="button"
                onClick={() => onSelectTool(toolId)}
                title={meta.name}
                aria-label={meta.name}
                className={`flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-[#2962ff] text-white'
                    : 'text-[#131722] hover:bg-[#f0f3fa] dark:text-[#d1d4dc] dark:hover:bg-[#2a2e39]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden md:inline">{meta.shortName}</span>
              </button>
            );
          })}

          <div className="mx-1 h-5 w-px shrink-0 bg-[#e0e3eb] dark:bg-[#2a2e39]" />

          {/* Magnet Mode Toggle */}
          <button
            type="button"
            onClick={onToggleMagnet}
            title="Magnet Mode (snap to OHLC)"
            aria-label="Toggle Magnet Mode"
            className={`flex min-h-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-lg transition-colors ${
              magnetMode
                ? 'bg-[#2962ff]/15 text-[#2962ff]'
                : 'text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white'
            }`}
          >
            <Magnet className="h-4 w-4" />
          </button>

          {/* Lock All Toggle */}
          <button
            type="button"
            onClick={onToggleLock}
            title={lockedDrawings ? 'Unlock Drawings' : 'Lock All Drawings'}
            aria-label="Toggle Lock All Drawings"
            className={`flex min-h-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-lg transition-colors ${
              lockedDrawings
                ? 'bg-[#2962ff]/15 text-[#2962ff]'
                : 'text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white'
            }`}
          >
            {lockedDrawings ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
          </button>

          {/* Hide All Toggle */}
          <button
            type="button"
            onClick={onToggleHide}
            title={hiddenDrawings ? 'Show Drawings' : 'Hide All Drawings'}
            aria-label="Toggle Hide All Drawings"
            className={`flex min-h-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-lg transition-colors ${
              hiddenDrawings
                ? 'bg-[#2962ff]/15 text-[#2962ff]'
                : 'text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white'
            }`}
          >
            {hiddenDrawings ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>

          {/* Clear All */}
          <button
            type="button"
            onClick={onClearAll}
            disabled={drawingCount === 0}
            title="Remove all drawings on active chart"
            aria-label="Clear drawings"
            className={`flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              drawingCount > 0
                ? 'text-[#f23645] hover:bg-[#f23645]/10'
                : 'cursor-not-allowed text-[#787b86]/45'
            }`}
          >
            <Trash2 className="h-4 w-4 shrink-0" />
            {drawingCount > 0 && <span>{drawingCount}</span>}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
