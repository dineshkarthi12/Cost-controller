import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { cx, EmptyState, ErrorState, LoadingBlock, Menu, Button, Pagination } from '../ui';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  className?: string;
  /** Hide on small screens (row is still accessible via detail view). */
  hideOnMobile?: boolean;
  width?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  sort?: { field: string; dir: 'asc' | 'desc' };
  onSort?: (field: string) => void;
  empty?: { title: string; description?: string; action?: ReactNode };
  pagination?: { page: number; pageSize: number; total: number; onPage: (p: number) => void };
  footer?: ReactNode;
  dense?: boolean;
  /** Renders each row as a card below the `sm` breakpoint. */
  mobileCard?: (row: T) => ReactNode;
  caption?: string;
}

export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, onRowClick, sort, onSort, empty, pagination, footer, dense, mobileCard, caption }: DataTableProps<T>) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading && !rows) return <LoadingBlock rows={6} />;
  if (!rows || rows.length === 0) return <EmptyState title={empty?.title ?? 'No records yet'} description={empty?.description} action={empty?.action} />;
  return (
    <div>
      {mobileCard && (
        <ul className="divide-y divide-line sm:hidden">
          {rows.map((r) => (
            <li key={rowKey(r)}>
              <button className="block w-full px-4 py-3 text-left active:bg-slate-50" onClick={() => onRowClick?.(r)}>
                {mobileCard(r)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={cx('overflow-x-auto', mobileCard && 'hidden sm:block')}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10">
            <tr>
              {columns.map((c) => {
                const active = sort?.field === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={{ width: c.width }}
                    aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cx('whitespace-nowrap border-b border-line bg-slate-50 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left', c.hideOnMobile && 'hidden md:table-cell', c.className)}
                  >
                    {c.sortable && onSort ? (
                      <button className={cx('inline-flex items-center gap-1 hover:text-ink', c.align === 'right' && 'flex-row-reverse')} onClick={() => onSort(c.key)}>
                        {c.header}
                        {active ? sort?.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-50" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={cx('group', onRowClick && 'cursor-pointer hover:bg-brand-50/40 focus:bg-brand-50/60 focus:outline-none')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cx('border-b border-line px-3 align-middle text-ink', dense ? 'py-1.5' : 'py-2.5', c.align === 'right' ? 'text-right tabular-nums whitespace-nowrap' : c.align === 'center' ? 'text-center' : 'text-left', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      {pagination && <Pagination {...pagination} />}
    </div>
  );
}

export function ExportMenu({ onExport, disabled }: { onExport: (format: 'csv' | 'xlsx' | 'pdf') => void; disabled?: boolean }) {
  return (
    <Menu
      trigger={
        <Button variant="outline" size="md" icon={<Download className="h-4 w-4" />} disabled={disabled}>
          Export
        </Button>
      }
      items={[
        { label: 'Excel (.xlsx)', icon: <FileSpreadsheet className="h-4 w-4" />, onSelect: () => onExport('xlsx') },
        { label: 'CSV', icon: <FileText className="h-4 w-4" />, onSelect: () => onExport('csv') },
        { label: 'PDF', icon: <FileText className="h-4 w-4" />, onSelect: () => onExport('pdf') },
      ]}
    />
  );
}

/** Client-side CSV export of the rows currently loaded (used for simple registers). */
export function downloadCsv(filename: string, columns: Array<{ key: string; label: string }>, rows: Array<Record<string, unknown>>) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = '﻿' + [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex flex-wrap items-end gap-2 border-b border-line p-3', className)}>{children}</div>;
}
