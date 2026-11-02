import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, Copy, Download, FileDown, MessageCircle, Send, Settings2 } from 'lucide-react';
import { whatsappUrl } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { todayIso } from '../../lib/format';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, StatusBadge } from '../../components/ui';
import { PageHeader } from '../../components/layout/AppShell';

interface PackDoc {
  projectId: string;
  projectName: string;
  entityType: string;
  type: string;
  id: string;
  title: string;
  status: string | null;
  actions: string[];
  link: string | null;
}
interface PackData {
  date: string;
  docs: PackDoc[];
  text: string;
  link: string;
  contacts: Array<{ name: string; role: string; phone: string; email: string }>;
  auto: { enabled: boolean; time: string };
  whatsappApi: boolean;
  email: boolean;
}
interface SendResult {
  sent: Array<{ to: string; via: string; ok: boolean; error?: string }>;
}

const pdfFile = async (date: string) => {
  const r = await fetch(api.url('/daily-pack/pdf', { date }), { credentials: 'include' });
  if (!r.ok) throw new Error('Could not make the PDF');
  return new File([await r.blob()], `Daily-pack-${date}.pdf`, { type: 'application/pdf' });
};

/**
 * One place for the end of the day: every document of the day on every project (DPR, labour, manpower,
 * BOQ, BOM, MR, PR, PO, GRN, bills…) in one PDF, sent to the Executive Director in one click.
 */
export function DailyPackPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayIso();
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['daily-pack', date], queryFn: () => api.get<PackData>('/daily-pack', { date }) });
  const serverSend = useMutation({
    mutationFn: () => api.post<SendResult>('/daily-pack/send', { date }),
    onSuccess: (r) => {
      for (const s of r.sent) (s.ok ? toast.success : toast.error)(`${s.to} by ${s.via}: ${s.ok ? 'sent' : s.error}`);
      if (!r.sent.length) toast.info('Nothing could be sent from the server (no WhatsApp Business API or email set up). Use the WhatsApp button.');
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const d = q.data;
  const sendTo = (c: PackData['contacts'][number] | null) => {
    if (!d) return;
    window.open(whatsappUrl(c?.phone ?? null, d.text), '_blank', 'noopener');
    void api.post('/daily-pack/shared', { date, to: c ? `${c.name}${c.role ? ` (${c.role})` : ''}` : '' }).catch(() => undefined);
  };
  const shareFile = async () => {
    setBusy(true);
    try {
      const f = await pdfFile(date);
      const nav = navigator as Navigator & { canShare?: (x: ShareData) => boolean };
      if (nav.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: f.name, text: d?.text.split('\n')[0] });
      else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(f);
        a.download = f.name;
        a.click();
        toast.info('PDF downloaded. This browser cannot hand files to WhatsApp; attach it in WhatsApp, or use the WhatsApp button (it sends a link to the PDF).');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const byProject = new Map<string, PackDoc[]>();
  for (const x of d?.docs ?? []) byProject.set(x.projectName, [...(byProject.get(x.projectName) ?? []), x]);

  return (
    <div>
      <PageHeader
        title="Daily send"
        subtitle="Everything done today on every project — site diary, labour, manpower, BOQ, BOM, MR, PR, PO, GRN, bills — in one PDF, sent to the management in one click."
        actions={
          <Field label="Date" htmlFor="dp-date">
            <Input id="dp-date" type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setParams({ date: e.target.value }, { replace: true })} />
          </Field>
        }
      />
      {q.isLoading ? (
        <LoadingBlock rows={6} />
      ) : q.error || !d ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card title="Send" className="lg:col-span-2" subtitle={`${d.docs.length} document(s) on ${byProject.size} project(s)`}>
            <div className="space-y-3">
              {d.contacts.length ? (
                d.contacts.map((c) => (
                  <Button key={c.phone} size="md" className="w-full justify-center bg-[#128C7E] text-white hover:bg-[#0f7a6e]" icon={<MessageCircle className="h-5 w-5" />} onClick={() => sendTo(c)}>
                    Send to {c.name}{c.role ? ` · ${c.role}` : ''}
                  </Button>
                ))
              ) : (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Add who gets the daily pack (name and WhatsApp number) under {can('settings.manage') ? <Link className="underline" to="/settings">Settings → WhatsApp contacts</Link> : 'Settings → WhatsApp contacts (ask the administrator)'}.
                </p>
              )}
              <p className="text-xs text-muted">WhatsApp opens with the message and the link to the full PDF typed in; press Send. The link opens the PDF without signing in, for 7 days.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" icon={<FileDown className="h-4 w-4" />} loading={busy} onClick={() => void shareFile()}>Share PDF file</Button>
                <a className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-medium hover:bg-slate-50" href={api.url('/daily-pack/pdf', { date })} download>
                  <Download className="h-4 w-4" /> Download PDF
                </a>
                <Button variant="outline" size="sm" icon={<MessageCircle className="h-4 w-4" />} onClick={() => sendTo(null)}>Other chat / group</Button>
                <Button variant="ghost" size="sm" icon={<Copy className="h-4 w-4" />} onClick={() => void navigator.clipboard.writeText(d.text).then(() => toast.success('Copied'))}>Copy</Button>
              </div>
              {(d.whatsappApi || d.email) && (
                <Button variant="outline" size="sm" icon={<Send className="h-4 w-4" />} loading={serverSend.isPending} onClick={() => serverSend.mutate()}>
                  Send now from the server ({[d.whatsappApi && 'WhatsApp Business', d.email && 'email'].filter(Boolean).join(' + ')})
                </Button>
              )}
              <div className="rounded-lg border border-line bg-slate-50 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium"><Clock className="h-4 w-4 text-muted" />Every day at {d.auto.time}: {d.auto.enabled ? <Badge tone="success">on</Badge> : <Badge tone="neutral">off</Badge>}</p>
                <p className="mt-1 text-xs text-muted">
                  {!d.auto.enabled
                    ? 'Turn it on in Settings to get the pack ready at that time every day.'
                    : d.whatsappApi
                      ? 'The pack is sent automatically by the WhatsApp Business API.'
                      : 'You get a notification at that time; tap it and press “Send”. Fully automatic WhatsApp sending needs the WhatsApp Business API (see Integrations).'}
                  {d.auto.enabled && d.email && !d.whatsappApi && ' Contacts with an email address also get the PDF by email automatically.'}
                </p>
                {can('settings.manage') && <Link to="/settings" className="mt-1 inline-flex items-center gap-1 text-xs text-brand-700 underline"><Settings2 className="h-3.5 w-3.5" />Change in Settings</Link>}
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-muted">Message preview</summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[#e7ffdb] p-3 text-xs text-ink">{d.text}</pre>
              </details>
            </div>
          </Card>
          <Card title="Documents in today's pack" className="lg:col-span-3" bodyClassName="p-0">
            {!d.docs.length ? (
              <EmptyState title="Nothing recorded yet for this day" description="Site diaries, labour reports, MR, PO, GRN, BOQ and BOM work done today appear here." />
            ) : (
              <div className="divide-y divide-line">
                {[...byProject.entries()].map(([name, docs]) => (
                  <section key={name} className="p-4">
                    <h3 className="mb-2 text-sm font-semibold text-navy-800">{name} <span className="font-normal text-muted">· {docs.length}</span></h3>
                    <ul className="space-y-1.5">
                      {docs.map((x) => (
                        <li key={`${x.entityType}-${x.id}`} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="w-40 shrink-0 text-muted">{x.type}</span>
                          <span className="font-medium">{x.title}</span>
                          {x.status && <StatusBadge status={x.status} />}
                          {x.actions.length > 0 && <span className="text-xs text-muted">{x.actions.join(', ')}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
