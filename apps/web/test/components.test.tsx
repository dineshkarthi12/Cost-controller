import DashboardChart3D from '../src/features/dashboard/Dashboard3D';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, StatusBadge } from '../src/components/ui';
import { DataTable } from '../src/components/data/DataTable';

describe('ConfirmDialog', () => {
  it('requires a reason before confirming when asked to', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onOpenChange={() => {}} title="Reject bill" message="Explain why" requireReason confirmLabel="Reject" onConfirm={onConfirm} />);
    const confirm = screen.getByRole('button', { name: 'Reject' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), '  Quantities not verified  ');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Quantities not verified');
  });
});

describe('DataTable', () => {
  const rows = [
    { id: 'a', name: 'Cement', amount: '100' },
    { id: 'b', name: 'Steel', amount: '250' },
  ];
  it('renders rows and calls back for sorting and row clicks', async () => {
    const onSort = vi.fn();
    const onRowClick = vi.fn();
    render(<DataTable rows={rows} rowKey={(r) => r.id} onSort={onSort} onRowClick={onRowClick} columns={[{ key: 'name', header: 'Material', cell: (r) => r.name, sortable: true }, { key: 'amount', header: 'Amount', align: 'right', cell: (r) => r.amount }]} />);
    expect(screen.getByText('Cement')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Material/ }));
    expect(onSort).toHaveBeenCalledWith('name');
    await userEvent.click(screen.getByText('Steel'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it('shows an empty state instead of a blank table', () => {
    render(<DataTable rows={[]} rowKey={(r: { id: string }) => r.id} columns={[{ key: 'x', header: 'X', cell: () => null }]} empty={{ title: 'No purchase orders yet' }} />);
    expect(screen.getByText('No purchase orders yet')).toBeInTheDocument();
  });

  it('shows an error state with the server message', () => {
    render(<DataTable rows={undefined} error={new Error('Missing permission: budget.view')} rowKey={(r: { id: string }) => r.id} columns={[{ key: 'x', header: 'X', cell: () => null }]} />);
    expect(screen.getByText(/Missing permission: budget.view/)).toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it('humanises workflow statuses', () => {
    render(<StatusBadge status="PARTIALLY_RECEIVED" />);
    expect(screen.getByText('Partially Received')).toBeInTheDocument();
  });
});

describe('3D chart', () => {
  it('draws the bars as SVG with an accessible name', () => {
    const { container } = render(<DashboardChart3D kind="bar" label="Budget vs actual, 3D bars" data={[{ c: 'Material', budget: 10, eac: 12 }, { c: 'Labour', budget: 4, eac: 3 }]} index="c" series={[{ key: 'budget', label: 'Budget', color: '#2a78d6' }, { key: 'eac', label: 'EAC', color: '#1baf7a' }]} formatY={(v) => String(v)} />);
    expect(screen.getByLabelText('Budget vs actual, 3D bars')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
