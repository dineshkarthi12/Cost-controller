import { useState, type ReactNode } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import { formatMoneyCompact } from '../../lib/format';
import { Card, IconButton } from '../ui';

/**
 * Validated categorical palette (light surface) — fixed order, never cycled.
 * Slots 3–5 sit below 3:1 contrast, so every chart offers a table view and legends.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const GRID = '#e3e8f0';
export const AXIS = '#5b6475';

export const axisProps = { stroke: AXIS, fontSize: 11, tickLine: false, axisLine: { stroke: GRID } } as const;

export function moneyTick(v: number) {
  return formatMoneyCompact(v).replace('₹ ', '₹');
}

/** Tooltip body: values in ink, a colour swatch carries identity. */
export function ChartTooltip({ active, payload, label, money = true, suffix = '' }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string; money?: boolean; suffix?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-1 font-semibold text-ink">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-ink">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto font-medium tabular-nums">{money ? formatMoneyCompact(p.value) : `${p.value}${suffix}`}</span>
        </p>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Card with a chart/table toggle so the data is never colour-only. */
export function ChartCard({ title, subtitle, legend, chart, table, actions, className }: { title: string; subtitle?: string; legend?: Array<{ label: string; color: string }>; chart: ReactNode; table: { columns: string[]; rows: Array<Array<ReactNode>> }; actions?: ReactNode; className?: string }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card
      title={title}
      subtitle={subtitle}
      className={className}
      actions={
        <>
          {actions}
          <IconButton label={asTable ? 'Show chart' : 'Show as table'} onClick={() => setAsTable(!asTable)} className="h-8 w-8">
            {asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
          </IconButton>
        </>
      }
    >
      {asTable ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {table.columns.map((c, i) => (
                  <th key={c} className={`border-b border-line py-1.5 font-semibold text-muted ${i ? 'text-right' : 'text-left'}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={`border-b border-line py-1.5 ${j ? 'text-right tabular-nums' : ''}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {legend && legend.length > 1 && (
            <div className="mb-3">
              <Legend items={legend} />
            </div>
          )}
          {chart}
        </>
      )}
    </Card>
  );
}
