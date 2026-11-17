import {
  Activity,
  AlignJustify,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart2,
  Calculator,
  CalendarRange,
  Circle,
  Columns2,
  Crosshair,
  GitBranch,
  Highlighter,
  Info,
  MessageSquare,
  Minus,
  MousePointer,
  MoveDiagonal,
  MoveHorizontal,
  MoveVertical,
  Pen,
  RectangleHorizontal,
  Ruler,
  SlidersHorizontal,
  Square,
  Tag,
  TrendingUp,
  Triangle,
  type LucideIcon,
} from 'lucide-react';
import type { DrawingTool } from '../types/trading';

export const TOOL_ICONS: Record<DrawingTool, LucideIcon> = {
  cursor: MousePointer,
  // Lines
  trendline: TrendingUp,
  ray: ArrowUpRight,
  infoLine: Info,
  extendedLine: MoveDiagonal,
  horizontal: Minus,
  horizontalRay: ArrowRight,
  vertical: MoveVertical,
  crossLine: Crosshair,
  // Fib & Gann
  fibRetracement: AlignJustify,
  fibChannel: SlidersHorizontal,
  pitchfork: GitBranch,
  // Projection & Risk/Reward
  long: ArrowUpRight,
  short: ArrowDownRight,
  priceRange: MoveVertical,
  datePriceRange: CalendarRange,
  barsPattern: BarChart2,
  // Geometric Shapes
  rectangle: Square,
  rotatedRectangle: RectangleHorizontal,
  ellipse: Circle,
  triangle: Triangle,
  parallelChannel: Columns2,
  // Annotation & Brushes
  brush: Pen,
  highlighter: Highlighter,
  arrow: ArrowUpRight,
  text: Activity,
  priceLabel: Tag,
  callout: MessageSquare,
  // Measurement
  measure: Ruler,
  contractRuler: Calculator,
};

export function getToolIcon(tool: DrawingTool): LucideIcon {
  return TOOL_ICONS[tool] ?? MoveHorizontal;
}
