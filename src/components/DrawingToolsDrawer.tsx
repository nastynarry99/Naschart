import {
  Eye,
  EyeOff,
  Lock,
  Magnet,
  Search,
  Star,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { useState } from 'react';
import {
  DRAWING_TOOLS_CATALOG,
  type DrawingCategory,
  type DrawingTool,
} from '../types/trading';
import { getToolIcon } from '../utils/drawingToolIcons';

interface DrawingToolsDrawerProps {
  activeTool: DrawingTool;
  pinnedTools: DrawingTool[];
  magnetMode: boolean;
  lockedDrawings: boolean;
  hiddenDrawings: boolean;
  drawingCount: number;
  onSelectTool: (tool: DrawingTool) => void;
  onTogglePin: (tool: DrawingTool) => void;
  onToggleMagnet: () => void;
  onToggleLock: () => void;
  onToggleHide: () => void;
  onClearAll: () => void;
  onClose: () => void;
}

const CATEGORY_ORDER: DrawingCategory[] = [
  'Lines',
  'Fib & Gann',
  'Projection & Risk/Reward',
  'Geometric Shapes',
  'Annotation & Brushes',
  'Measurement',
];

export function DrawingToolsDrawer({
  activeTool,
  pinnedTools,
  magnetMode,
  lockedDrawings,
  hiddenDrawings,
  drawingCount,
  onSelectTool,
  onTogglePin,
  onToggleMagnet,
  onToggleLock,
  onToggleHide,
  onClearAll,
  onClose,
}: DrawingToolsDrawerProps) {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-[#e0e3eb] bg-white shadow-2xl sm:rounded-2xl dark:border-[#2a2e39] dark:bg-[#1e222d]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#e0e3eb] sm:hidden dark:bg-[#363a45]" />

        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-[#f0f3fa] px-5 py-3.5 dark:border-[#2a2e39]">
          <div>
            <h2 className="text-base font-bold text-[#131722] dark:text-[#d1d4dc]">
              Drawing Tools
            </h2>
            <p className="text-xs text-[#787b86]">
              Tap a tool to draw · Star tools to pin to quick-access bar
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawing drawer"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search + Utility Toggles */}
        <div className="space-y-3 border-b border-[#f0f3fa] px-5 py-3 dark:border-[#2a2e39]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#787b86]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter drawing tools..."
              className="h-10 w-full rounded-xl border border-[#e0e3eb] bg-[#f8fafd] pr-3 pl-9 text-sm font-medium text-[#131722] outline-none focus:border-[#2962ff] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              type="button"
              onClick={onToggleMagnet}
              className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition-colors ${
                magnetMode
                  ? 'border-[#2962ff] bg-[#2962ff]/10 text-[#2962ff]'
                  : 'border-[#e0e3eb] bg-[#f8fafd] text-[#131722] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]'
              }`}
            >
              <Magnet className="h-3.5 w-3.5" />
              <span>Magnet</span>
            </button>

            <button
              type="button"
              onClick={onToggleLock}
              className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition-colors ${
                lockedDrawings
                  ? 'border-[#2962ff] bg-[#2962ff]/10 text-[#2962ff]'
                  : 'border-[#e0e3eb] bg-[#f8fafd] text-[#131722] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]'
              }`}
            >
              {lockedDrawings ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              <span>{lockedDrawings ? 'Locked' : 'Lock All'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleHide}
              className={`flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition-colors ${
                hiddenDrawings
                  ? 'border-[#2962ff] bg-[#2962ff]/10 text-[#2962ff]'
                  : 'border-[#e0e3eb] bg-[#f8fafd] text-[#131722] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#d1d4dc]'
              }`}
            >
              {hiddenDrawings ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span>{hiddenDrawings ? 'Hidden' : 'Hide All'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onClearAll();
                onClose();
              }}
              disabled={drawingCount === 0}
              className="flex min-h-[38px] items-center justify-center gap-1.5 rounded-xl border border-[#e0e3eb] bg-[#f8fafd] px-2.5 text-xs font-semibold text-[#f23645] transition-colors hover:bg-[#f23645]/10 disabled:opacity-40 dark:border-[#2a2e39] dark:bg-[#131722]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Remove ({drawingCount})</span>
            </button>
          </div>
        </div>

        {/* Categorized Tool List */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {CATEGORY_ORDER.map((category) => {
            const tools = DRAWING_TOOLS_CATALOG.filter(
              (t) =>
                t.category === category &&
                (q === '' ||
                  t.name.toLowerCase().includes(q) ||
                  category.toLowerCase().includes(q))
            );
            if (tools.length === 0) return null;

            return (
              <section key={category}>
                <h3 className="mb-2 text-xs font-bold text-[#787b86]">
                  {category}
                </h3>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {tools.map((tool) => {
                    const Icon = getToolIcon(tool.id);
                    const isActive = activeTool === tool.id;
                    const isPinned = pinnedTools.includes(tool.id);

                    return (
                      <div
                        key={tool.id}
                        className={`flex min-h-[46px] items-center justify-between rounded-xl border px-2 transition-colors ${
                          isActive
                            ? 'border-[#2962ff] bg-[#2962ff]/10'
                            : 'border-[#f0f3fa] bg-[#f8fafd] hover:border-[#e0e3eb] dark:border-[#2a2e39] dark:bg-[#131722] dark:hover:border-[#363a45]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectTool(tool.id);
                            onClose();
                          }}
                          className="flex flex-1 items-center gap-2.5 px-2 py-2 text-left"
                        >
                          <Icon
                            className={`h-4 w-4 shrink-0 ${
                              isActive
                                ? 'text-[#2962ff]'
                                : 'text-[#787b86]'
                            }`}
                          />
                          <span
                            className={`text-xs font-semibold ${
                              isActive
                                ? 'text-[#2962ff]'
                                : 'text-[#131722] dark:text-[#d1d4dc]'
                            }`}
                          >
                            {tool.name}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onTogglePin(tool.id)}
                          aria-label={isPinned ? `Unpin ${tool.name}` : `Pin ${tool.name}`}
                          title={isPinned ? 'Pinned to quick bar' : 'Pin to quick bar'}
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                            isPinned
                              ? 'text-[#f59e0b] hover:bg-[#f59e0b]/10'
                              : 'text-[#787b86]/60 hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white'
                          }`}
                        >
                          <Star
                            className="h-4 w-4"
                            fill={isPinned ? 'currentColor' : 'none'}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
