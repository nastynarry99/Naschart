import { ChevronDown, ChevronUp, Link2, X } from 'lucide-react';
import { useState } from 'react';
import {
  LAYOUT_GROUPS,
  getLayoutPresetMeta,
  type LayoutPresetId,
  type LayoutPresetMeta,
  type LayoutSyncOptions,
} from '../types/trading';

const SYNC_ITEMS: Array<{
  key: keyof LayoutSyncOptions;
  label: string;
  description: string;
}> = [
  { key: 'symbol', label: 'Symbol', description: 'Apply symbol changes to every pane' },
  { key: 'interval', label: 'Interval', description: 'Keep chart timeframes synchronized' },
  { key: 'crosshair', label: 'Crosshair', description: 'Mirror crosshair across all panes' },
  { key: 'time', label: 'Time', description: 'Align chart timeline anchor together' },
  { key: 'dateRange', label: 'Date range', description: 'Match visible zoom & scroll range' },
];

export function LayoutPreviewIcon({
  preset,
  className = 'h-6 w-7',
  strokeWidth = 1.6,
}: {
  preset: LayoutPresetMeta;
  className?: string;
  strokeWidth?: number;
}) {
  // Draw inside a padded 28x22 viewBox (inner box 2..26 x 2..20 => width 24, height 18)
  const w = 24;
  const h = 18;
  const ox = 2;
  const oy = 2;

  return (
    <svg
      viewBox="0 0 28 22"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x={ox} y={oy} width={w} height={h} rx={2.5} />
      {preset.cells.map(([cx, cy, cw, ch], idx) => {
        const x = ox + (cx / 100) * w;
        const y = oy + (cy / 100) * h;
        const rw = (cw / 100) * w;
        const rh = (ch / 100) * h;
        return (
          <rect
            key={idx}
            x={Number(x.toFixed(2))}
            y={Number(y.toFixed(2))}
            width={Number(rw.toFixed(2))}
            height={Number(rh.toFixed(2))}
          />
        );
      })}
    </svg>
  );
}

export function LayoutSheetModal({
  activePresetId,
  syncOptions,
  onSelectPreset,
  onToggleSyncOption,
  onClose,
}: {
  activePresetId: LayoutPresetId;
  syncOptions: LayoutSyncOptions;
  onSelectPreset: (id: LayoutPresetId) => void;
  onToggleSyncOption: (key: keyof LayoutSyncOptions) => void;
  onClose: () => void;
}) {
  const [syncExpanded, setSyncExpanded] = useState(false);

  const activeSyncLabels = SYNC_ITEMS.filter((item) => syncOptions[item.key]).map(
    (item) => item.label
  );
  const activePresetMeta = getLayoutPresetMeta(activePresetId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chart Layout Picker"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl dark:bg-[#1e222d]"
      >
        {/* Mobile grab pill */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-[#e0e3eb] dark:bg-[#363a45]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#f0f3fa] px-4 py-3 dark:border-[#2a2e39]">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[15px] font-bold text-[#131722] dark:text-[#d1d4dc]">
              Select layout
            </h2>
            <span className="rounded-md bg-[#f0f3fa] px-2 py-0.5 text-[11px] font-semibold text-[#787b86] dark:bg-[#2a2e39] dark:text-[#b2b5be]">
              {activePresetMeta.label}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close layout picker"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#787b86] hover:bg-[#f0f3fa] hover:text-[#131722] dark:hover:bg-[#2a2e39] dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 pt-3 pb-6">
          {/* "Sync in layout ∨" Collapsible Dropdown */}
          <div className="overflow-hidden rounded-xl border border-[#e0e3eb] bg-[#f8fafd] dark:border-[#2a2e39] dark:bg-[#131722]">
            <button
              type="button"
              onClick={() => setSyncExpanded((prev) => !prev)}
              aria-expanded={syncExpanded}
              className="flex min-h-[46px] w-full items-center justify-between px-3.5 py-2 text-left transition-colors hover:bg-[#f0f3fa] dark:hover:bg-[#1e222d]/70"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Link2 className="h-4 w-4 shrink-0 text-[#2962ff]" />
                <span className="text-sm font-semibold text-[#131722] dark:text-[#d1d4dc]">
                  Sync in layout
                </span>
                {activeSyncLabels.length > 0 ? (
                  <span className="truncate rounded-md bg-[#2962ff]/12 px-2 py-0.5 text-[11px] font-semibold text-[#2962ff]">
                    {activeSyncLabels.join(', ')}
                  </span>
                ) : (
                  <span className="text-xs font-medium text-[#787b86]">Off</span>
                )}
              </div>
              {syncExpanded ? (
                <ChevronUp className="h-4 w-4 shrink-0 text-[#787b86]" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-[#787b86]" />
              )}
            </button>

            {syncExpanded && (
              <div className="divide-y divide-[#e0e3eb]/70 border-t border-[#e0e3eb] bg-white dark:divide-[#2a2e39]/80 dark:border-[#2a2e39] dark:bg-[#181b25]">
                {SYNC_ITEMS.map((item) => {
                  const enabled = syncOptions[item.key];
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onToggleSyncOption(item.key)}
                      className="flex min-h-[48px] w-full items-center justify-between gap-3 px-3.5 py-2 text-left transition-colors hover:bg-[#f8fafd] dark:hover:bg-[#1e222d]/60"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-[#131722] dark:text-[#d1d4dc]">
                          {item.label}
                        </div>
                        <div className="text-[11px] text-[#787b86]">{item.description}</div>
                      </div>
                      <span
                        className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                          enabled ? 'bg-[#2962ff]' : 'bg-[#e0e3eb] dark:bg-[#363a45]'
                        }`}
                      >
                        <span
                          className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                            enabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Layout Icon Groups: 1, 2, 3, 4 */}
          <div className="space-y-4">
            {LAYOUT_GROUPS.map((group) => (
              <div key={group.count}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono-tabular text-xs font-bold text-[#787b86]">
                    {group.count}
                  </span>
                  <div className="h-px flex-1 bg-[#f0f3fa] dark:bg-[#2a2e39]" />
                </div>

                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {group.items.map((preset) => {
                    const isSelected = preset.id === activePresetId;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          onSelectPreset(preset.id);
                          onClose();
                        }}
                        title={preset.label}
                        aria-label={preset.label}
                        aria-pressed={isSelected}
                        className={`group flex min-h-[54px] flex-col items-center justify-center rounded-xl border transition-all active:scale-[0.97] ${
                          isSelected
                            ? 'border-[#1e222d] bg-[#1e222d] text-white shadow-md ring-1 ring-[#2962ff]/50 dark:border-[#4b5263] dark:bg-[#1e222d] dark:text-white'
                            : 'border-[#e0e3eb] bg-[#f8fafd] text-[#4c525e] hover:border-[#2962ff] hover:bg-white hover:text-[#131722] dark:border-[#2a2e39] dark:bg-[#131722] dark:text-[#b2b5be] dark:hover:border-[#2962ff] dark:hover:bg-[#242936] dark:hover:text-white'
                        }`}
                      >
                        <LayoutPreviewIcon
                          preset={preset}
                          className="h-6 w-8"
                          strokeWidth={isSelected ? 1.85 : 1.55}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
