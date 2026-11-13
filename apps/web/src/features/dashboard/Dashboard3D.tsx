/**
 * 3D dashboard charts, drawn with @niekes/charts-3d (flat-shaded SVG on d3-3d):
 * one row of bars or one ribbon per series along the depth axis, grid walls, drag or arrow keys to turn,
 * double-click to reset, hover for exact values. Loaded lazily, so only the dashboard downloads it.
 */
import { AreaChart3D, BarChart3D, ChartContainer3D } from '@niekes/charts-3d';

export interface Series3D {
  key: string;
  label: string;
  color: string;
}

export default function DashboardChart3D({
  kind,
  data,
  index,
  series,
  formatY,
  formatX,
  label,
  className = 'h-80 w-full',
  width = 640,
  height = 400,
}: {
  kind: 'bar' | 'area';
  data: Array<Record<string, string | number>>;
  index: string;
  series: Series3D[];
  formatY: (v: number) => string;
  formatX?: (v: string) => string;
  label: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  const config = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));
  const keys = series.map((s) => s.key);
  return (
    <ChartContainer3D config={config} width={width} height={height} className={`chart-3d ${className}`} aria-label={label} gizmo={false} shortcuts={false} animationDuration={700}>
      {kind === 'bar' ? <BarChart3D data={data} index={index} keys={keys} format={{ y: formatY, x: formatX }} /> : <AreaChart3D data={data} index={index} keys={keys} format={{ y: formatY, x: formatX }} />}
    </ChartContainer3D>
  );
}
