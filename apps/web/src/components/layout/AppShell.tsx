import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import { Bell, Camera, ChevronDown, ChevronsLeft, ChevronsRight, Home, ListTodo, LogOut, Menu as MenuIcon, MoreHorizontal, Search, ShieldCheck, Stamp, User, WifiOff, X } from 'lucide-react';
import { MODULES, MODULE_GROUPS, type ModuleDef } from '@toprock/shared';
import { useAuth } from '../../lib/auth';
import { api, type Paged } from '../../lib/api';
import { useOnline, useUploadQueue } from '../../lib/offline';
import { relativeTime } from '../../lib/format';
import { ModuleIcon } from '../../lib/icons';
import { Badge, IconButton, Menu, cx } from '../ui';

const COLLAPSE_KEY = 'tr.sidebarCollapsed';

function useVisibleModules(): ModuleDef[] {
  const { me, can } = useAuth();
  return useMemo(() => MODULES.filter((m) => (me?.visibleModules ?? []).includes(m.key) || m.key === 'dashboard' || m.key === 'settings').filter((m) => can(m.permission)), [me, can]);
}

function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="TOPROCK GLOBAL — Dashboard">
      {compact ? <img src="/brand/toprock-mark.png" alt="TOPROCK GLOBAL" className="h-9 w-9 object-contain" /> : <img src="/brand/toprock-logo.png" alt="TOPROCK GLOBAL" className="h-9 w-auto object-contain" />}
    </Link>
  );
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const modules = useVisibleModules();
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main navigation">
      {MODULE_GROUPS.map((g) => {
        const items = modules.filter((m) => m.group === g);
        if (!items.length) return null;
        return (
          <div key={g} className="mb-3">
            {!collapsed && <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-blue-200/60">{g}</p>}
            <ul className="space-y-0.5">
              {items.map((m) => (
                <li key={m.key}>
                  <NavLink
                    to={m.path}
                    end={m.path === '/'}
                    onClick={onNavigate}
                    title={collapsed ? m.label : undefined}
                    className={({ isActive }) => cx('group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors', isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-blue-100/85 hover:bg-white/10 hover:text-white', collapsed && 'justify-center px-2')}
                  >
                    <ModuleIcon name={m.icon} className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="truncate">{m.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function ProjectSwitcher() {
  const { me, projectId, setProjectId } = useAuth();
  const navigate = useNavigate();
  if (!me?.projects.length) return null;
  return (
    <label className="relative flex min-w-0 items-center">
      <span className="sr-only">Current project</span>
      <select
        value={projectId ?? ''}
        onChange={(e) => {
          setProjectId(e.target.value);
          navigate('/');
        }}
        className="h-9 w-full min-w-0 max-w-[260px] appearance-none truncate rounded-lg border border-line bg-white py-1.5 pl-3 pr-8 text-sm font-medium text-ink focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      >
        {me.projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} · {p.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-muted" aria-hidden />
    </label>
  );
}

interface SearchHit {
  type: string;
  label: string;
  status?: string | null;
  link: string;
  projectId: string | null;
}

function GlobalSearch({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const { projectId, setProjectId } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const res = useQuery({ queryKey: ['search', debounced], queryFn: () => api.get<SearchHit[]>('/search', { q: debounced }), enabled: debounced.length >= 2 });
  const go = (h: SearchHit) => {
    if (h.projectId && h.projectId !== projectId) setProjectId(h.projectId);
    navigate(h.link);
    setOpen(false);
    setQ('');
    onDone?.();
  };
  return (
    <Popover.Root open={open && debounced.length >= 2} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={q}
            autoFocus={autoFocus}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => e.key === 'Enter' && res.data?.[0] && go(res.data[0])}
            placeholder="Search documents, projects, suppliers…"
            aria-label="Global search"
            className="h-9 w-full rounded-lg border border-line bg-slate-50 pl-9 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} onOpenAutoFocus={(e) => e.preventDefault()} className="z-50 max-h-96 w-[min(560px,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line bg-white p-1 shadow-lg">
          {res.isLoading && <p className="p-3 text-sm text-muted">Searching…</p>}
          {res.data?.length === 0 && <p className="p-3 text-sm text-muted">No matches for “{debounced}”.</p>}
          {res.data?.map((h, i) => (
            <button key={i} onClick={() => go(h)} className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{h.label}</span>
                <span className="text-xs text-muted">{h.type}</span>
              </span>
              {h.status && <Badge>{h.status}</Badge>}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  type: string;
  projectId: string | null;
}

function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { projectId, setProjectId } = useAuth();
  const q = useQuery({ queryKey: ['notifications', 'bell'], queryFn: () => api.get<Paged<NotificationRow> & { unread: number }>('/notifications', { pageSize: 8 }), refetchInterval: 60_000 });
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const unread = q.data?.unread ?? 0;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-slate-100 hover:text-ink" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="absolute right-1 top-1 min-w-[18px] rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-[18px] text-white">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(380px,calc(100vw-1.5rem))] rounded-xl border border-line bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50" disabled={!unread} onClick={() => readAll.mutate()}>
              Mark all read
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {q.data?.items.length === 0 && <li className="p-6 text-center text-sm text-muted">You’re all caught up.</li>}
            {q.data?.items.map((n) => (
              <li key={n.id}>
                <button
                  className={cx('flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50', !n.readAt && 'bg-brand-50/50')}
                  onClick={() => {
                    if (!n.readAt) read.mutate(n.id);
                    if (n.projectId && n.projectId !== projectId) setProjectId(n.projectId);
                    if (n.link) navigate(n.link);
                  }}
                >
                  <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-xs text-muted">{n.body}</span>}
                    <span className="text-[11px] text-slate-400">{relativeTime(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link to="/notifications" className="block border-t border-line px-4 py-2.5 text-center text-sm font-medium text-brand-600 hover:bg-slate-50">
            View all
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  if (!me) return null;
  const initials = me.user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
  return (
    <Menu
      trigger={
        <button className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100" aria-label="Account menu">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-800 text-xs font-semibold text-white">{initials}</span>
          <span className="hidden text-left leading-tight lg:block">
            <span className="block text-sm font-medium text-ink">{me.user.name}</span>
            <span className="block text-xs text-muted">{me.user.designation ?? me.roles[0]}</span>
          </span>
          <ChevronDown className="hidden h-4 w-4 text-muted lg:block" />
        </button>
      }
      items={[
        { label: 'My profile & security', icon: <User className="h-4 w-4" />, onSelect: () => navigate('/account') },
        { label: 'My approvals', icon: <Stamp className="h-4 w-4" />, onSelect: () => navigate('/approvals') },
        'separator',
        { label: 'Sign out', icon: <LogOut className="h-4 w-4" />, onSelect: () => void logout(), danger: true },
      ]}
    />
  );
}

function StatusStrip() {
  const online = useOnline();
  const queue = useUploadQueue();
  const pending = queue.filter((q) => q.status !== 'uploaded').length;
  const { project } = useAuth();
  return (
    <>
      {project?.isDemo && (
        <div className="bg-amber-50 px-4 py-1.5 text-center text-xs font-medium text-amber-900" role="note">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5" aria-hidden />
          DEMO DATA — figures in this project are sample data for evaluation, not real project records.
        </div>
      )}
      {(!online || pending > 0) && (
        <div className={cx('px-4 py-1.5 text-center text-xs font-medium', online ? 'bg-sky-50 text-sky-800' : 'bg-slate-800 text-white')} role="status">
          {!online && (
            <>
              <WifiOff className="mr-1 inline h-3.5 w-3.5" aria-hidden /> You are offline. Drafts are kept on this device; nothing is saved to the server until you reconnect.
            </>
          )}
          {pending > 0 && (
            <Link to="/evidence?tab=queue" className="ml-2 underline">
              {pending} photo upload(s) pending synchronisation
            </Link>
          )}
        </div>
      )}
    </>
  );
}

function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const { can } = useAuth();
  const item = (to: string, label: string, icon: ReactNode) => (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-navy-800' : 'text-muted')}>
      {icon}
      {label}
    </NavLink>
  );
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex items-end border-t border-line bg-white/95 backdrop-blur lg:hidden" aria-label="Quick navigation">
      {item('/', 'Home', <Home className="h-5 w-5" />)}
      {item('/tasks', 'Tasks', <ListTodo className="h-5 w-5" />)}
      {can('evidence.manage') ? (
        <NavLink to="/evidence?capture=1" className="-mt-5 flex flex-1 flex-col items-center gap-0.5 pb-2 text-[11px] font-medium text-navy-800" aria-label="Capture site photo">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg ring-4 ring-white">
            <Camera className="h-5 w-5" />
          </span>
          Capture
        </NavLink>
      ) : (
        item('/manpower', 'Manpower', <Camera className="h-5 w-5" />)
      )}
      {item('/approvals', 'Approvals', <Stamp className="h-5 w-5" />)}
      <button onClick={onMore} className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium text-muted">
        <MoreHorizontal className="h-5 w-5" />
        More
      </button>
    </nav>
  );
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [drawer, setDrawer] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setDrawer(false);
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className={cx('hidden shrink-0 flex-col bg-navy-900 lg:flex', collapsed ? 'w-[72px]' : 'w-64')}>
        <div className={cx('flex h-16 items-center border-b border-navy-950 bg-white', collapsed ? 'justify-center px-2' : 'px-4')}>
          <Logo compact={collapsed} />
        </div>
        {!collapsed && <p className="bg-white px-4 pb-2 text-[10px] font-semibold uppercase tracking-wider text-navy-700">Construction Cost Control Management</p>}
        <SidebarNav collapsed={collapsed} />
        <button onClick={toggle} className="flex items-center justify-center gap-2 border-t border-white/10 py-3 text-xs text-blue-100/70 hover:text-white" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && 'Collapse'}
        </button>
      </aside>

      {/* Mobile / tablet drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[min(300px,85vw)] flex-col bg-navy-900 shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-navy-950 bg-white px-4">
              <Logo />
              <IconButton label="Close navigation" onClick={() => setDrawer(false)}>
                <X className="h-5 w-5" />
              </IconButton>
            </div>
            <SidebarNav collapsed={false} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-white">
          <div className="flex h-16 items-center gap-2 px-3 sm:px-4 lg:gap-4 lg:px-6">
            <IconButton label="Open navigation" className="lg:hidden" onClick={() => setDrawer(true)}>
              <MenuIcon className="h-5 w-5" />
            </IconButton>
            <div className="lg:hidden">
              <img src="/brand/toprock-mark.png" alt="TOPROCK GLOBAL" className="h-8 w-8" />
            </div>
            <div className="min-w-0 flex-1 sm:flex-none">
              <ProjectSwitcher />
            </div>
            <div className="hidden max-w-xl flex-1 md:block">
              <GlobalSearch />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <IconButton label="Search" className="md:hidden" onClick={() => setMobileSearch(true)}>
                <Search className="h-5 w-5" />
              </IconButton>
              <NotificationBell />
              <UserMenu />
            </div>
          </div>
          {mobileSearch && (
            <div className="flex items-center gap-2 border-t border-line px-3 py-2 md:hidden">
              <GlobalSearch autoFocus onDone={() => setMobileSearch(false)} />
              <IconButton label="Close search" onClick={() => setMobileSearch(false)}>
                <X className="h-5 w-5" />
              </IconButton>
            </div>
          )}
          <StatusStrip />
        </header>
        <main id="main" ref={mainRef} className="flex-1 overflow-y-auto pb-24 lg:pb-8">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav onMore={() => setDrawer(true)} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumbs?: Array<{ label: string; to?: string }> }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs && (
          <nav aria-label="Breadcrumb" className="mb-1">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted">
              {breadcrumbs.map((b, i) => (
                <li key={i} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden>/</span>}
                  {b.to ? (
                    <Link to={b.to} className="hover:text-ink hover:underline">
                      {b.label}
                    </Link>
                  ) : (
                    <span aria-current="page">{b.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[1600px] px-3 py-5 sm:px-4 lg:px-6', className)}>{children}</div>;
}
