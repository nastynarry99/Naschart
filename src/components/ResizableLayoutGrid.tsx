import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LayoutPresetId } from '../types/trading';

export interface LayoutSplitRatios {
  cols: number[];
  rows: number[];
  topCols?: number[];
  botCols?: number[];
}

export interface DividerHandle {
  id: string;
  axis: 'vertical' | 'horizontal';
  x: number; // % 0..100
  y: number; // % 0..100
  length: number; // % 0..100
  group: keyof LayoutSplitRatios;
  boundaryIndex: number;
}

export interface PaneRectPct {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function getDefaultSplitRatios(presetId: LayoutPresetId): LayoutSplitRatios {
  switch (presetId) {
    case '1-single':
      return { cols: [1], rows: [1] };
    case '2-vertical':
      return { cols: [0.5, 0.5], rows: [1] };
    case '2-horizontal':
      return { cols: [1], rows: [0.5, 0.5] };
    case '3-cols':
      return { cols: [1 / 3, 1 / 3, 1 / 3], rows: [1] };
    case '3-rows':
      return { cols: [1], rows: [1 / 3, 1 / 3, 1 / 3] };
    case '3-left1-right2':
    case '3-left2-right1':
    case '3-top1-bottom2':
    case '3-top2-bottom1':
    case '4-grid':
      return { cols: [0.5, 0.5], rows: [0.5, 0.5] };
    case '4-rows':
      return { cols: [1], rows: [0.25, 0.25, 0.25, 0.25] };
    case '4-cols':
      return { cols: [0.25, 0.25, 0.25, 0.25], rows: [1] };
    case '4-left1-right3':
    case '4-left3-right1':
      return { cols: [0.5, 0.5], rows: [1 / 3, 1 / 3, 1 / 3] };
    case '4-top1-bottom3':
    case '4-top3-bottom1':
      return { cols: [1 / 3, 1 / 3, 1 / 3], rows: [0.5, 0.5] };
    case '4-1-1-2':
    case '4-2-1-1':
      return { cols: [1 / 3, 1 / 3, 1 / 3], rows: [0.5, 0.5] };
    case '4-top2-bottom2':
      return {
        cols: [0.5, 0.5],
        rows: [0.5, 0.5],
        topCols: [0.58, 0.42],
        botCols: [0.42, 0.58],
      };
    default:
      return { cols: [1], rows: [1] };
  }
}

function prefixSums(arr: number[]): number[] {
  const out = [0];
  let acc = 0;
  for (const v of arr) {
    acc += v;
    out.push(acc);
  }
  return out;
}

export function computeLayoutGeometry(
  presetId: LayoutPresetId,
  ratios: LayoutSplitRatios
): { rects: PaneRectPct[]; handles: DividerHandle[] } {
  const cols = ratios.cols.map((c) => c * 100);
  const rows = ratios.rows.map((r) => r * 100);
  const colEdges = prefixSums(cols);
  const rowEdges = prefixSums(rows);
  const handles: DividerHandle[] = [];

  const addFullColHandles = (yStart = 0, len = 100, group: keyof LayoutSplitRatios = 'cols') => {
    const arr = group === 'topCols' && ratios.topCols
      ? prefixSums(ratios.topCols.map((c) => c * 100))
      : group === 'botCols' && ratios.botCols
      ? prefixSums(ratios.botCols.map((c) => c * 100))
      : colEdges;
    for (let i = 0; i < arr.length - 2; i++) {
      handles.push({
        id: `${presetId}-${group}-${i}`,
        axis: 'vertical',
        x: arr[i + 1],
        y: yStart,
        length: len,
        group,
        boundaryIndex: i,
      });
    }
  };

  const addFullRowHandles = (xStart = 0, len = 100) => {
    for (let i = 0; i < rowEdges.length - 2; i++) {
      handles.push({
        id: `${presetId}-rows-${i}`,
        axis: 'horizontal',
        x: xStart,
        y: rowEdges[i + 1],
        length: len,
        group: 'rows',
        boundaryIndex: i,
      });
    }
  };

  switch (presetId) {
    case '1-single':
      return {
        rects: [{ left: 0, top: 0, width: 100, height: 100 }],
        handles,
      };
    case '2-vertical':
      addFullColHandles();
      return {
        rects: [
          { left: 0, top: 0, width: cols[0], height: 100 },
          { left: colEdges[1], top: 0, width: cols[1], height: 100 },
        ],
        handles,
      };
    case '2-horizontal':
      addFullRowHandles();
      return {
        rects: [
          { left: 0, top: 0, width: 100, height: rows[0] },
          { left: 0, top: rowEdges[1], width: 100, height: rows[1] },
        ],
        handles,
      };
    case '3-cols':
      addFullColHandles();
      return {
        rects: [
          { left: 0, top: 0, width: cols[0], height: 100 },
          { left: colEdges[1], top: 0, width: cols[1], height: 100 },
          { left: colEdges[2], top: 0, width: cols[2], height: 100 },
        ],
        handles,
      };
    case '3-rows':
      addFullRowHandles();
      return {
        rects: [
          { left: 0, top: 0, width: 100, height: rows[0] },
          { left: 0, top: rowEdges[1], width: 100, height: rows[1] },
          { left: 0, top: rowEdges[2], width: 100, height: rows[2] },
        ],
        handles,
      };
    case '3-left1-right2':
      addFullColHandles(0, 100, 'cols');
      addFullRowHandles(colEdges[1], cols[1]);
      return {
        rects: [
          { left: 0, top: 0, width: cols[0], height: 100 },
          { left: colEdges[1], top: 0, width: cols[1], height: rows[0] },
          { left: colEdges[1], top: rowEdges[1], width: cols[1], height: rows[1] },
        ],
        handles,
      };
    case '3-left2-right1':
      addFullColHandles(0, 100, 'cols');
      addFullRowHandles(0, cols[0]);
      return {
        rects: [
          { left: 0, top: 0, width: cols[0], height: rows[0] },
          { left: 0, top: rowEdges[1], width: cols[0], height: rows[1] },
          { left: colEdges[1], top: 0, width: cols[1], height: 100 },
        ],
        handles,
      };
    case '3-top1-bottom2':
      addFullRowHandles(0, 100);
      addFullColHandles(rowEdges[1], rows[1], 'cols');
      return {
        rects: [
          { left: 0, top: 0, width: 100, height: rows[0] },
          { left: 0, top: rowEdges[1], width: cols[0], height: rows[1] },
          { left: colEdges[1], top: rowEdges[1], width: cols[1], height: rows[1] },
        ],
        handles,
      };
    case '3-top2-bottom1':
      addFullRowHandles(0, 100);
      addFullColHandles(0, rows[0], 'cols');
      return {
        rects: [
          { left: 0, top: 0, width: cols[0], height: rows[0] },
          { left: colEdges[1], top: 0, width: cols[1], height: rows[0] },
          { left: 0, top: rowEdges[1], width: 100, height: rows[1] },
        ],
        handles,
      };
    case '4-grid':
      addFullColHandles();
      addFullRowHandles();
      return {
        rects: [
          { left: 0, top: 0, width: cols[0], height: rows[0] },
          { left: colEdges[1], top: 0, width: cols[1], height: rows[0] },
          { left: 0, top: rowEdges[1], width: cols[0], height: rows[1] },
          { left: colEdges[1], top: rowEdges[1], width: cols[1], height: rows[1] },
        ],
        handles,
      };
    case '4-rows':
      addFullRowHandles();
      return {
        rects: [
          { left: 0, top: 0, width: 100, height: rows[0] },
          { left: 0, top: rowEdges[1], width: 100, height: rows[1] },
          { left: 0, top: rowEdges[2], width: 100, height: rows[2] },
          { left: 0, top: rowEdges[3], width: 100, height: rows[3] },
        ],
        handles,
      };
    case '4-cols':
      addFullColHandles();
      return {
        rects: [
          { left: 0, top: 0, width: cols[0], height: 100 },
          { left: colEdges[1], top: 0, width: cols[1], height: 100 },
          { left: colEdges[2], top: 0, width: cols[2], height: 100 },
          { left: colEdges[3], top: 0, width: cols[3], height: 100 },
        ],
        handles,
      };
    case '4-left1-right3':
      addFullColHandles();
      addFullRowHandles(colEdges[1], cols[1]);
      return {
        rects: [
          { left: 0, top: 0, width: cols[0], height: 100 },
          { left: colEdges[1], top: 0, width: cols[1], height: rows[0] },
          { left: colEdges[1], top: rowEdges[1], width: cols[1], height: rows[1] },
          { left: colEdges[1], top: rowEdges[2], width: cols[1], height: rows[2] },
        ],
        handles,
      };
    case '4-left3-right1':
      addFullColHandles();
      addFullRowHandles(0, cols[0]);
      return {
        rects: [
          { left: 0, top: 0, width: cols[0], height: rows[0] },
          { left: 0, top: rowEdges[1], width: cols[0], height: rows[1] },
          { left: 0, top: rowEdges[2], width: cols[0], height: rows[2] },
          { left: colEdges[1], top: 0, width: cols[1], height: 100 },
        ],
        handles,
      };
    case '4-top1-bottom3':
      addFullRowHandles();
      addFullColHandles(rowEdges[1], rows[1], 'cols');
      return {
        rects: [
          { left: 0, top: 0, width: 100, height: rows[0] },
          { left: 0, top: rowEdges[1], width: cols[0], height: rows[1] },
          { left: colEdges[1], top: rowEdges[1], width: cols[1], height: rows[1] },
          { left: colEdges[2], top: rowEdges[1], width: cols[2], height: rows[1] },
        ],
        handles,
      };
    case '4-top3-bottom1':
      addFullRowHandles();
      addFullColHandles(0, rows[0], 'cols');
      return {
        rects: [
          { left: 0, top: 0, width: cols[0], height: rows[0] },
          { left: colEdges[1], top: 0, width: cols[1], height: rows[0] },
          { left: colEdges[2], top: 0, width: cols[2], height: rows[0] },
          { left: 0, top: rowEdges[1], width: 100, height: rows[1] },
        ],
        handles,
      };
    case '4-1-1-2':
      addFullColHandles();
      addFullRowHandles(colEdges[2], cols[2]);
      return {
        rects: [
          { left: 0, top: 0, width: cols[0], height: 100 },
          { left: colEdges[1], top: 0, width: cols[1], height: 100 },
          { left: colEdges[2], top: 0, width: cols[2], height: rows[0] },
          { left: colEdges[2], top: rowEdges[1], width: cols[2], height: rows[1] },
        ],
        handles,
      };
    case '4-2-1-1':
      addFullColHandles();
      addFullRowHandles(0, cols[0]);
      return {
        rects: [
          { left: 0, top: 0, width: cols[0], height: rows[0] },
          { left: 0, top: rowEdges[1], width: cols[0], height: rows[1] },
          { left: colEdges[1], top: 0, width: cols[1], height: 100 },
          { left: colEdges[2], top: 0, width: cols[2], height: 100 },
        ],
        handles,
      };
    case '4-top2-bottom2': {
      const tCols = (ratios.topCols ?? [0.58, 0.42]).map((c) => c * 100);
      const bCols = (ratios.botCols ?? [0.42, 0.58]).map((c) => c * 100);
      addFullRowHandles();
      addFullColHandles(0, rows[0], 'topCols');
      addFullColHandles(rowEdges[1], rows[1], 'botCols');
      return {
        rects: [
          { left: 0, top: 0, width: tCols[0], height: rows[0] },
          { left: tCols[0], top: 0, width: tCols[1], height: rows[0] },
          { left: 0, top: rowEdges[1], width: bCols[0], height: rows[1] },
          { left: bCols[0], top: rowEdges[1], width: bCols[1], height: rows[1] },
        ],
        handles,
      };
    }
    default:
      return {
        rects: [{ left: 0, top: 0, width: 100, height: 100 }],
        handles,
      };
  }
}

interface ResizableLayoutGridProps {
  presetId: LayoutPresetId;
  paneCount: number;
  onPanesResized: () => void;
  renderPane: (index: number) => ReactNode;
}

export function ResizableLayoutGrid({
  presetId,
  paneCount,
  onPanesResized,
  renderPane,
}: ResizableLayoutGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ratiosByPreset, setRatiosByPreset] = useState<
    Partial<Record<LayoutPresetId, LayoutSplitRatios>>
  >({});
  const [activeHandleId, setActiveHandleId] = useState<string | null>(null);

  const activeRatios = useMemo(
    () => ratiosByPreset[presetId] ?? getDefaultSplitRatios(presetId),
    [presetId, ratiosByPreset]
  );

  const geometry = useMemo(
    () => computeLayoutGeometry(presetId, activeRatios),
    [presetId, activeRatios]
  );

  const dragRef = useRef<{
    handle: DividerHandle;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    containerW: number;
    containerH: number;
    startTracks: number[];
    capturedEl: HTMLElement | null;
  } | null>(null);

  const triggerResizeCallback = useCallback(() => {
    requestAnimationFrame(() => {
      onPanesResized();
    });
  }, [onPanesResized]);

  useEffect(() => {
    triggerResizeCallback();
  }, [presetId, triggerResizeCallback]);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (e.cancelable) e.preventDefault();

      const { handle, startClientX, startClientY, containerW, containerH, startTracks } = drag;
      const spanPx = handle.axis === 'vertical' ? containerW : containerH;
      if (spanPx <= 20) return;

      const deltaPx =
        handle.axis === 'vertical' ? e.clientX - startClientX : e.clientY - startClientY;
      const deltaFrac = deltaPx / spanPx;

      const idx = handle.boundaryIndex;
      const pairSum = startTracks[idx] + startTracks[idx + 1];
      const minFrac = startTracks.length >= 4 ? 0.12 : 0.15;
      const nextA = Math.max(minFrac, Math.min(pairSum - minFrac, startTracks[idx] + deltaFrac));
      const nextB = pairSum - nextA;

      const nextTracks = [...startTracks];
      nextTracks[idx] = nextA;
      nextTracks[idx + 1] = nextB;

      setRatiosByPreset((prev) => {
        const base = prev[presetId] ?? getDefaultSplitRatios(presetId);
        return {
          ...prev,
          [presetId]: {
            ...base,
            [handle.group]: nextTracks,
          },
        };
      });
      triggerResizeCallback();
    };

    const handlePointerUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (drag.capturedEl) {
        try {
          if (drag.capturedEl.hasPointerCapture(e.pointerId)) {
            drag.capturedEl.releasePointerCapture(e.pointerId);
          }
        } catch {
          // Ignore already released capture
        }
      }
      dragRef.current = null;
      setActiveHandleId(null);
      triggerResizeCallback();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [presetId, triggerResizeCallback]);

  const startHandleDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    handle: DividerHandle
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;

    e.preventDefault();
    e.stopPropagation();

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Fallback to window listeners
    }

    const rect = container.getBoundingClientRect();
    const tracks = activeRatios[handle.group];
    if (!tracks || tracks.length < 2) return;

    dragRef.current = {
      handle,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      containerW: rect.width,
      containerH: rect.height,
      startTracks: [...tracks],
      capturedEl: e.currentTarget,
    };
    setActiveHandleId(handle.id);
  };

  const resetPresetSplits = () => {
    setRatiosByPreset((prev) => {
      const copy = { ...prev };
      delete copy[presetId];
      return copy;
    });
    triggerResizeCallback();
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {Array.from({ length: paneCount }).map((_, idx) => {
        const rect = geometry.rects[idx] ?? { left: 0, top: 0, width: 100, height: 100 };
        return (
          <div
            key={idx}
            className="absolute min-h-0 min-w-0 overflow-hidden"
            style={{
              left: `${rect.left}%`,
              top: `${rect.top}%`,
              width: `${rect.width}%`,
              height: `${rect.height}%`,
            }}
          >
            {renderPane(idx)}
          </div>
        );
      })}

      {/* Interactive 4px Divider Splitters (Multi-Chart Layouts Only) */}
      {paneCount > 1 &&
        geometry.handles.map((handle) => {
          const isVertical = handle.axis === 'vertical';
          const isDragging = activeHandleId === handle.id;
          return (
            <div
              key={handle.id}
              role="separator"
              aria-orientation={isVertical ? 'vertical' : 'horizontal'}
              title="Drag to resize panes (double-click to reset)"
              onDoubleClick={(e) => {
                e.stopPropagation();
                resetPresetSplits();
              }}
              onPointerDown={(e) => startHandleDrag(e, handle)}
              style={
                isVertical
                  ? {
                      left: `${handle.x}%`,
                      top: `${handle.y}%`,
                      height: `${handle.length}%`,
                      width: '4px',
                      transform: 'translateX(-50%)',
                    }
                  : {
                      left: `${handle.x}%`,
                      top: `${handle.y}%`,
                      width: `${handle.length}%`,
                      height: '4px',
                      transform: 'translateY(-50%)',
                    }
              }
              className={`group absolute z-20 flex touch-none select-none items-center justify-center transition-colors ${
                isVertical ? 'cursor-col-resize' : 'cursor-row-resize'
              } ${
                isDragging
                  ? 'bg-[#2962ff]'
                  : 'bg-[#e0e3eb]/90 hover:bg-[#2962ff] dark:bg-[#2a2e39]/90 dark:hover:bg-[#2962ff]'
              }`}
            >
              {/* Invisible expanded touch target (12px) around crisp 4px visual bar */}
              <span
                aria-hidden="true"
                className={`absolute ${
                  isVertical ? 'inset-y-0 -left-1 -right-1' : 'inset-x-0 -top-1 -bottom-1'
                }`}
              />
              {/* Subtle center pill indicator */}
              <span
                aria-hidden="true"
                className={`pointer-events-none relative rounded-full transition-colors ${
                  isVertical ? 'h-6 w-[2px]' : 'h-[2px] w-6'
                } ${
                  isDragging
                    ? 'bg-white'
                    : 'bg-[#9598a1]/60 group-hover:bg-white dark:bg-[#787b86]/60'
                }`}
              />
            </div>
          );
        })}
    </div>
  );
}
