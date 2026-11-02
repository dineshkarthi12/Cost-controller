import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Copy, FileDown, MessageCircle, Settings2, Users } from 'lucide-react';
import { useNavigate } from 'react-router';
import { whatsappUrl } from '@toprock/shared';
import { api } from '../../lib/api';
import { useAuth, useProjectId } from '../../lib/auth';
import { Button, Menu } from '../../components/ui';

export interface WhatsAppContact {
  name: string;
  role: string;
  phone: string;
}

type TextSource = string | (() => Promise<string>);

/**
 * One click sends a report to the people set up in Settings → WhatsApp contacts (e.g. the Executive
 * Director): WhatsApp opens with the message already typed in that person's chat, and Send is pressed
 * there. A file (PDF / Excel) can also be shared from phones that allow it.
 */
export function WhatsAppShare({ text, what, file, size = 'sm', label }: { text: TextSource; what: string; file?: () => Promise<File>; size?: 'sm' | 'md'; label?: string }) {
  const { me, can } = useAuth();
  const projectId = useProjectId();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const contacts = me?.whatsappContacts ?? [];
  const withLink = (t: string) => `${t}\n\n${window.location.origin}${window.location.pathname}`;

  const send = async (c: WhatsAppContact | null) => {
    // Open the window inside the click, then point it at WhatsApp once the text is ready (browsers block late pop-ups).
    const win = typeof text === 'string' ? null : window.open('', '_blank');
    setBusy(true);
    try {
      const body = withLink(typeof text === 'string' ? text : await text());
      const url = whatsappUrl(c?.phone ?? null, body);
      if (win) win.location.href = url;
      else window.open(url, '_blank', 'noopener');
      if (projectId) void api.post(`/projects/${projectId}/daily-digest/shared`, { what, to: c ? `${c.name}${c.role ? ` (${c.role})` : ''}` : '' }).catch(() => undefined);
    } catch (e) {
      win?.close();
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    const body = withLink(typeof text === 'string' ? text : await text());
    await navigator.clipboard.writeText(body);
    toast.success('Copied. Paste it in any WhatsApp chat.');
  };
  const shareFile = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const f = await file();
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: what, text: typeof text === 'string' ? text.split('\n')[0] : what });
      else {
        // Desktop browsers cannot hand a file to WhatsApp: download it to attach in WhatsApp Web.
        const a = document.createElement('a');
        a.href = URL.createObjectURL(f);
        a.download = f.name;
        a.click();
        toast.info('File downloaded. Attach it in WhatsApp (this browser cannot share files directly).');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const items = [
    ...contacts.slice(1).map((c) => ({ label: `Send to ${c.name}${c.role ? ` · ${c.role}` : ''}`, icon: <MessageCircle className="h-4 w-4" />, onSelect: () => void send(c) })),
    { label: 'Choose a chat or group…', icon: <Users className="h-4 w-4" />, onSelect: () => void send(null) },
    ...(file ? [{ label: 'Share as file (PDF / Excel)…', icon: <FileDown className="h-4 w-4" />, onSelect: () => void shareFile() }] : []),
    { label: 'Copy the message', icon: <Copy className="h-4 w-4" />, onSelect: () => void copy() },
    ...(!contacts.length && can('settings.manage') ? (['separator', { label: 'Add WhatsApp contacts in Settings', icon: <Settings2 className="h-4 w-4" />, onSelect: () => navigate('/settings') }] as const) : []),
  ];
  const first = contacts[0];
  return (
    <div className="inline-flex items-center">
      {first ? (
        <Button size={size} className="rounded-r-none bg-[#128C7E] text-white hover:bg-[#0f7a6e]" icon={<MessageCircle className="h-4 w-4" />} loading={busy} onClick={() => void send(first)} title={`Opens WhatsApp with the ${what.toLowerCase()} typed in ${first.name}'s chat`}>
          {label ?? 'WhatsApp'} {first.name}
        </Button>
      ) : null}
      <Menu
        trigger={
          <Button size={size} variant="outline" className={first ? 'rounded-l-none border-l-0 px-2' : ''} icon={first ? undefined : <MessageCircle className="h-4 w-4" />} aria-label="More WhatsApp options">
            {first ? <ChevronDown className="h-4 w-4" /> : (label ?? 'WhatsApp')}
          </Button>
        }
        items={items as never}
      />
    </div>
  );
}
