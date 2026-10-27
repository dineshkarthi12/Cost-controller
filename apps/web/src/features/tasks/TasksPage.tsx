import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ChevronLeft, ChevronRight, Lock, Plus } from 'lucide-react';
import { TASK_STATUS, TASK_STATUS_LABEL } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { Badge, Button, Card, EmptyState, LoadingBlock, Select, StatusBadge, TabPanel, Tabs, cx } from '../../components/ui';
import { RefSelect } from '../../components/forms/RefSelect';
import { PageHeader } from '../../components/layout/AppShell';
import { ResourceList } from '../resources/ResourceViews';

interface TaskCard {
  id: string;
  number: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  category: string;
  overdue: boolean;
  blockedBy?: string[];
  owner?: { id: string; name: string } | null;
  project?: { code: string; name: string };
  role?: string;
  projectId: string;
}

const BOARD: Array<(typeof TASK_STATUS)[number]> = ['BACKLOG', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_INFO', 'BLOCKED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'COMPLETED'];

function Card1({ t, onOpen, draggable }: { t: TaskCard; onOpen: () => void; draggable?: boolean }) {
  return (
    <button
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData('text/task', t.id)}
      onClick={onOpen}
      className={cx('w-full rounded-lg border bg-white p-3 text-left shadow-sm hover:border-brand-500', t.overdue ? 'border-red-200' : 'border-line')}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium text-muted">{t.number}</span>
        <StatusBadge status={t.priority} />
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-medium text-ink">{t.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
        {t.owner && <span>{t.owner.name}</span>}
        {t.project && <Badge>{t.project.code}</Badge>}
        {t.dueDate && (
          <span className={cx(t.overdue && 'font-semibold text-red-600')}>
            {t.overdue && <AlertTriangle className="mr-0.5 inline h-3 w-3" />}
            {formatDate(t.dueDate, { day: '2-digit', month: 'short' })}
          </span>
        )}
        {t.blockedBy && t.blockedBy.length > 0 && (
          <span className="inline-flex items-center gap-0.5 text-amber-700" title={`Waiting on ${t.blockedBy.join(', ')}`}>
            <Lock className="h-3 w-3" /> {t.blockedBy.join(', ')}
          </span>
        )}
      </div>
    </button>
  );
}

function Calendar({ tasks, onOpen }: { tasks: TaskCard[]; onOpen: (t: TaskCard) => void }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((start.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const byDay = tasks.reduce<Record<string, TaskCard[]>>((acc, t) => {
    if (t.dueDate) (acc[t.dueDate.slice(0, 10)] ??= []).push(t);
    return acc;
  }, {});
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" size="sm" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>Prev</Button>
        <h3 className="text-sm font-semibold">{new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(month)}</h3>
        <Button variant="ghost" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>Next <ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line text-xs">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="bg-slate-50 px-2 py-1.5 font-semibold text-muted">{d}</div>
        ))}
        {days.map((d) => {
          const items = byDay[key(d)] ?? [];
          const isToday = key(d) === key(new Date());
          return (
            <div key={key(d)} className={cx('min-h-[84px] bg-white p-1.5', d.getMonth() !== month.getMonth() && 'bg-slate-50/70 text-slate-400')}>
              <span className={cx('inline-flex h-5 w-5 items-center justify-center rounded-full', isToday && 'bg-navy-800 text-white')}>{d.getDate()}</span>
              <ul className="mt-1 space-y-0.5">
                {items.slice(0, 3).map((t) => (
                  <li key={t.id}>
                    <button onClick={() => onOpen(t)} className={cx('w-full truncate rounded px-1 py-0.5 text-left', t.overdue ? 'bg-red-50 text-red-700' : t.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700' : 'bg-brand-50 text-navy-800')}>
                      {t.title}
                    </button>
                  </li>
                ))}
                {items.length > 3 && <li className="text-muted">+{items.length - 3} more</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TasksPage() {
  const projectId = useProjectId();
  const { can, setProjectId, me } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState('mine');
  const [owner, setOwner] = useState<string | null>(null);
  const [includeDone, setIncludeDone] = useState(false);
  const my = useQuery({ queryKey: ['p', 'my-tasks', includeDone], queryFn: () => api.get<TaskCard[]>('/my/tasks', { includeDone }) });
  const board = useQuery({ queryKey: ['p', 'board', projectId, owner], queryFn: () => api.get<TaskCard[]>(`/projects/${projectId}/tasks/board`, { ownerId: owner ?? undefined }), enabled: tab === 'board' || tab === 'calendar' });
  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/projects/${projectId}/r/tasks/${id}`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['p'] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const open = (t: TaskCard) => {
    if (t.projectId && t.projectId !== projectId) setProjectId(t.projectId);
    navigate(`/tasks/${t.id}`);
  };
  const grouped = (rows: TaskCard[]) => ({
    overdue: rows.filter((t) => t.overdue),
    today: rows.filter((t) => !t.overdue && t.dueDate?.slice(0, 10) === new Date().toISOString().slice(0, 10)),
    upcoming: rows.filter((t) => !t.overdue && t.dueDate?.slice(0, 10) !== new Date().toISOString().slice(0, 10) && t.status !== 'COMPLETED'),
    done: rows.filter((t) => t.status === 'COMPLETED'),
  });
  const g = grouped(my.data ?? []);
  return (
    <>
      <PageHeader title="Tasks & issues" subtitle={`Work allocation for the cost control team. Signed in as ${me?.user.name}.`} actions={can('task.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/tasks/new')}>New task</Button>} />
      <Card bodyClassName="p-0">
        <Tabs value={tab} onValueChange={setTab} tabs={[{ value: 'mine', label: 'My tasks', count: (my.data ?? []).filter((t) => t.status !== 'COMPLETED').length }, { value: 'board', label: 'Team board' }, { value: 'list', label: 'List' }, { value: 'calendar', label: 'Calendar' }]} className="px-4 pt-1">
          <TabPanel value="mine" className="py-4">
            <label className="mb-3 flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} /> Include completed
            </label>
            {my.isLoading && <LoadingBlock rows={4} />}
            {my.data?.length === 0 && <EmptyState title="No tasks assigned to you" description="Tasks you own, review, approve or contribute to appear here across all your projects." />}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {(
                [
                  ['Overdue', g.overdue, 'text-red-600'],
                  ['Due today', g.today, 'text-amber-700'],
                  ['Upcoming', g.upcoming, 'text-ink'],
                  ['Completed', g.done, 'text-emerald-700'],
                ] as const
              ).map(([label, rows, cls]) => (
                <section key={label}>
                  <h3 className={cx('mb-2 text-xs font-semibold uppercase tracking-wide', cls)}>
                    {label} ({rows.length})
                  </h3>
                  <div className="space-y-2">
                    {rows.map((t) => (
                      <div key={t.id}>
                        <Card1 t={t} onOpen={() => open(t)} />
                        {t.role && t.role !== 'OWNER' && <p className="mt-0.5 text-[11px] text-muted">You are {t.role.toLowerCase()}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </TabPanel>
          <TabPanel value="board" className="py-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="w-60">
                <RefSelect source="users" value={owner} onChange={setOwner} placeholder="All owners" params={{ members: 'true' }} />
              </div>
              <p className="text-xs text-muted">Drag a card to another column to change its status (completion checks dependencies).</p>
            </div>
            {board.isLoading && <LoadingBlock rows={4} />}
            <div className="flex gap-3 overflow-x-auto pb-2">
              {BOARD.map((s) => {
                const items = (board.data ?? []).filter((t) => t.status === s);
                return (
                  <section
                    key={s}
                    aria-label={TASK_STATUS_LABEL[s]}
                    className="w-64 shrink-0 rounded-lg bg-slate-100/70 p-2"
                    onDragOver={(e) => can('task.manage') && e.preventDefault()}
                    onDrop={(e) => {
                      const id = e.dataTransfer.getData('text/task');
                      const t = board.data?.find((x) => x.id === id);
                      if (t && t.status !== s) move.mutate({ id, status: s });
                    }}
                  >
                    <h3 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-muted">
                      {TASK_STATUS_LABEL[s]} <span className="rounded-full bg-white px-1.5">{items.length}</span>
                    </h3>
                    <div className="space-y-2">
                      {items.map((t) => (
                        <div key={t.id}>
                          <Card1 t={t} draggable={can('task.manage')} onOpen={() => open({ ...t, projectId })} />
                          <Select className="mt-1 h-7 py-0 text-xs sm:hidden" aria-label="Move to" options={BOARD.map((b) => ({ value: b, label: TASK_STATUS_LABEL[b] }))} value={t.status} onChange={(e) => move.mutate({ id: t.id, status: e.target.value })} />
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </TabPanel>
          <TabPanel value="list" className="py-4">
            <ResourceList resourceKey="tasks" basePath="/tasks" hideHeader />
          </TabPanel>
          <TabPanel value="calendar" className="py-4">
            {board.isLoading ? <LoadingBlock rows={4} /> : <Calendar tasks={(board.data ?? []).map((t) => ({ ...t, projectId }))} onOpen={open} />}
            <p className="mt-2 text-xs text-muted">
              Shows open tasks and tasks completed in the last 14 days for this project. <Link to="/tasks" className="text-brand-600">My tasks</Link> covers all projects.
            </p>
          </TabPanel>
        </Tabs>
      </Card>
    </>
  );
}
