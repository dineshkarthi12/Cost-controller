import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { Button, Card, Field, Input, Badge } from '../../components/ui';
import { Page, PageHeader } from '../../components/layout/AppShell';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-gradient-to-b from-white to-surface">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <img src="/brand/toprock-logo.png" alt="TOPROCK GLOBAL" className="h-14 w-auto" />
          </div>
          <div className="card p-6 sm:p-8">
            <h1 className="text-xl font-semibold text-ink">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          <p className="mt-6 text-center text-xs text-muted">Construction Cost Control Management · Authorised users only</p>
        </div>
      </div>
    </div>
  );
}

function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      {error instanceof Error ? error.message : 'Something went wrong'}
    </p>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const m = useMutation({
    mutationFn: () => api.post<{ mfaRequired: boolean }>('/auth/login', { email, password }),
    onSuccess: async (r) => {
      if (r.mfaRequired) return navigate('/mfa');
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate(params.get('next') ?? '/');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <AuthLayout title="Sign in" subtitle="Use your TOPROCK GLOBAL work account.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email" required>
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password" htmlFor="password" required>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorText error={m.error} />
        <Button type="submit" size="lg" className="w-full" loading={m.isPending} icon={<LogIn className="h-4 w-4" />}>
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="text-brand-600 hover:underline">
            Forgot password?
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function MfaPage() {
  const [code, setCode] = useState('');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => api.post('/auth/mfa/verify', { code }), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['me'] }); navigate('/'); } });
  return (
    <AuthLayout title="Two-step verification" subtitle="Enter the 6-digit code from your authenticator app.">
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-4">
        <Field label="Verification code" htmlFor="code" required>
          <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
        </Field>
        <ErrorText error={m.error} />
        <Button type="submit" size="lg" className="w-full" loading={m.isPending} disabled={code.length !== 6} icon={<ShieldCheck className="h-4 w-4" />}>
          Verify
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const m = useMutation({ mutationFn: () => api.post<{ ok: boolean; devToken?: string }>('/auth/password/forgot', { email }) });
  return (
    <AuthLayout title="Reset your password" subtitle="We’ll send a reset link if the account exists.">
      {m.isSuccess ? (
        <div className="space-y-3 text-sm">
          <p>If an account exists for {email}, a reset link has been issued. Email delivery is not configured in this environment — ask your administrator.</p>
          {m.data?.devToken && (
            <p className="rounded bg-amber-50 p-2 text-amber-900">
              Development only:{' '}
              <Link className="underline" to={`/reset-password?token=${m.data.devToken}`}>
                open reset link
              </Link>
            </p>
          )}
          <Link to="/login" className="text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="space-y-4">
          <Field label="Email" htmlFor="email" required>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <ErrorText error={m.error} />
          <Button type="submit" className="w-full" size="lg" loading={m.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

function PasswordForm({ submitLabel, onSubmit, pending, error }: { submitLabel: string; onSubmit: (p: string) => void; pending: boolean; error: unknown }) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const mismatch = p2.length > 0 && p1 !== p2;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!mismatch) onSubmit(p1); }} className="space-y-4">
      <Field label="New password" htmlFor="p1" required help="At least 10 characters with upper and lower case letters and a number.">
        <Input id="p1" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} />
      </Field>
      <Field label="Confirm password" htmlFor="p2" required error={mismatch ? 'Passwords do not match' : undefined}>
        <Input id="p2" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} invalid={mismatch} />
      </Field>
      <ErrorText error={error} />
      <Button type="submit" className="w-full" size="lg" loading={pending} disabled={!p1 || mismatch} icon={<KeyRound className="h-4 w-4" />}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const m = useMutation({ mutationFn: (password: string) => api.post('/auth/password/reset', { token: params.get('token'), password }), onSuccess: () => { toast.success('Password updated. Please sign in.'); navigate('/login'); } });
  return (
    <AuthLayout title="Choose a new password">
      <PasswordForm submitLabel="Update password" onSubmit={(p) => m.mutate(p)} pending={m.isPending} error={m.error} />
    </AuthLayout>
  );
}

export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const m = useMutation({ mutationFn: (password: string) => api.post('/auth/invitations/accept', { token: params.get('token'), password }), onSuccess: () => { toast.success('Account activated. Please sign in.'); navigate('/login'); } });
  return (
    <AuthLayout title="Activate your account" subtitle="Set a password to finish joining TOPROCK GLOBAL.">
      <PasswordForm submitLabel="Activate account" onSubmit={(p) => m.mutate(p)} pending={m.isPending} error={m.error} />
    </AuthLayout>
  );
}

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  lastSeenAt: string;
  current: boolean;
}

export function AccountPage() {
  const { me, refresh } = useAuth();
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<SessionRow[]>('/auth/sessions') });
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({ mutationFn: () => api.post('/auth/password/change', { currentPassword: cur, newPassword: next }), onSuccess: () => { toast.success('Password changed; other sessions signed out'); setCur(''); setNext(''); void qc.invalidateQueries({ queryKey: ['sessions'] }); }, onError: (e: Error) => toast.error(e.message) });
  const [mfa, setMfa] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const setup = useMutation({ mutationFn: () => api.post<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup'), onSuccess: setMfa });
  const enable = useMutation({ mutationFn: () => api.post('/auth/mfa/enable', { code }), onSuccess: () => { toast.success('Two-step verification enabled'); setMfa(null); void refresh(); }, onError: (e: Error) => toast.error(e instanceof ApiError ? e.message : 'Failed') });
  const revoke = useMutation({ mutationFn: (id: string) => api.post(`/auth/sessions/${id}/revoke`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['sessions'] }) });
  if (!me) return null;
  return (
    <Page className="max-w-4xl">
      <PageHeader title="My account" subtitle={`${me.user.name} · ${me.user.email}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Change password">
          <div className="space-y-3">
            <Field label="Current password">
              <Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
            </Field>
            <Field label="New password" help="At least 10 characters with upper and lower case letters and a number.">
              <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Button loading={change.isPending} disabled={!cur || !next} onClick={() => change.mutate()}>
              Change password
            </Button>
          </div>
        </Card>
        <Card title="Two-step verification" subtitle="Optional TOTP (authenticator app) for sign-in.">
          {me.user.mfaEnabled ? (
            <Badge tone="success">Enabled</Badge>
          ) : mfa ? (
            <div className="space-y-3 text-sm">
              <p>Add this secret to your authenticator app, then enter the 6-digit code:</p>
              <code className="block break-all rounded bg-slate-100 p-2 text-xs">{mfa.secret}</code>
              <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" aria-label="Verification code" />
              <Button loading={enable.isPending} disabled={code.length !== 6} onClick={() => enable.mutate()}>
                Enable
              </Button>
            </div>
          ) : (
            <Button variant="outline" loading={setup.isPending} onClick={() => setup.mutate()}>
              Set up authenticator
            </Button>
          )}
        </Card>
        <Card title="Active sessions" className="md:col-span-2">
          <ul className="divide-y divide-line">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate">{s.userAgent ?? 'Unknown device'}</span>
                  <span className="text-xs text-muted">
                    {s.ip} · last active {formatDateTime(s.lastSeenAt)}
                  </span>
                </span>
                {s.current ? <Badge tone="success">This device</Badge> : <Button size="sm" variant="outline" onClick={() => revoke.mutate(s.id)}>Sign out</Button>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
