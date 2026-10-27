import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type Paged } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime, humanize } from '../../lib/format';
import { Button, Card, Checkbox, EmptyState, LoadingBlock, Pagination, TabPanel, Tabs, cx } from '../../components/ui';
import { Page, PageHeader } from '../../components/layout/AppShell';

interface Row {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  projectId: string | null;
}
interface Pref {
  type: string;
  inApp: boolean;
  email: boolean;
}

export function NotificationsPage() {
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { projectId, setProjectId } = useAuth();
  const emailStatus = useQuery({ queryKey: ['email-status'], queryFn: () => api.get<{ configured: boolean }>('/notifications/email-status'), staleTime: 300_000 });
  const list = useQuery({ queryKey: ['notifications', tab, page], queryFn: () => api.get<Paged<Row> & { unread: number }>('/notifications', { unread: tab === 'unread' ? true : undefined, page, pageSize: 30 }), enabled: tab !== 'prefs' });
  const prefs = useQuery({ queryKey: ['notifications', 'prefs'], queryFn: () => api.get<Pref[]>('/notifications/preferences'), enabled: tab === 'prefs' });
  const [draft, setDraft] = useState<Pref[]>([]);
  useEffect(() => {
    if (prefs.data) setDraft(prefs.data);
  }, [prefs.data]);
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const save = useMutation({ mutationFn: () => api.put('/notifications/preferences', { preferences: draft }), onSuccess: () => toast.success('Preferences saved'), onError: (e: Error) => toast.error(e.message) });
  return (
    <Page className="max-w-4xl">
      <PageHeader title="Notifications" subtitle="Alerts are de-duplicated: the same alert reaches you once per day at most." actions={<Button variant="outline" disabled={!list.data?.unread} onClick={() => readAll.mutate()}>Mark all read</Button>} />
      <Card bodyClassName="p-0">
        <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }} tabs={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread', count: list.data?.unread }, { value: 'prefs', label: 'Preferences' }]} className="px-4 pt-1">
          {['all', 'unread'].map((t) => (
            <TabPanel key={t} value={t}>
              {list.isLoading && <LoadingBlock rows={5} />}
              {list.data?.items.length === 0 && <EmptyState title="No notifications" />}
              <ul className="divide-y divide-line">
                {list.data?.items.map((n) => (
                  <li key={n.id}>
                    <button
                      className={cx('flex w-full gap-3 px-2 py-3 text-left hover:bg-slate-50', !n.readAt && 'bg-brand-50/40')}
                      onClick={() => {
                        if (!n.readAt) read.mutate(n.id);
                        if (n.projectId && n.projectId !== projectId) setProjectId(n.projectId);
                        if (n.link) navigate(n.link);
                      }}
                    >
                      <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-slate-200' : 'bg-brand-600')} aria-label={n.readAt ? 'Read' : 'Unread'} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{n.title}</span>
                        {n.body && <span className="block text-sm text-muted">{n.body}</span>}
                        <span className="text-xs text-slate-400">
                          {humanize(n.type)} · {formatDateTime(n.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {list.data && <Pagination page={page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
            </TabPanel>
          ))}
          <TabPanel value="prefs" className="py-4">
            <p className="mb-3 text-sm text-muted">{emailStatus.data?.configured ? 'Ticked alerts are also sent to your email address.' : 'Email is not set up yet. Your email choices are saved and start working once an administrator sets up email.'}</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-2">Alert</th>
                  <th className="py-2 text-center">In-app</th>
                  <th className="py-2 text-center">Email</th>
                </tr>
              </thead>
              <tbody>
                {draft.map((p, i) => (
                  <tr key={p.type} className="border-t border-line">
                    <td className="py-2">{humanize(p.type)}</td>
                    <td className="text-center">
                      <Checkbox label={<span className="sr-only">In-app</span>} checked={p.inApp} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, inApp: e.target.checked } : x)))} />
                    </td>
                    <td className="text-center">
                      <Checkbox label={<span className="sr-only">Email</span>} checked={p.email} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, email: e.target.checked } : x)))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex justify-end">
              <Button loading={save.isPending} onClick={() => save.mutate()}>Save preferences</Button>
            </div>
          </TabPanel>
        </Tabs>
      </Card>
    </Page>
  );
}
