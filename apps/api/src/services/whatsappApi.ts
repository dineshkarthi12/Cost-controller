/**
 * Sending through the WhatsApp Business (Cloud) API, so the end-of-day pack goes out by itself.
 * Needs a Meta Business account with a WhatsApp number and an approved message template that has
 * a DOCUMENT header and one body variable, e.g. template "daily_report":
 *   header: document · body: "Daily report {{1}}. The full PDF is attached."
 * Configure WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and (optionally) WHATSAPP_TEMPLATE,
 * WHATSAPP_TEMPLATE_LANG. Without them nothing is sent automatically.
 */
import { whatsappNumber } from '@toprock/shared';

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
export function setWhatsAppFetchForTests(f: Fetch | null) {
  fetchImpl = f ?? ((...a) => fetch(...a));
}

export function whatsappApiConfigured() {
  return !!(process.env.WHATSAPP_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim());
}

/** Sends the pack PDF (by link) with a one-line summary. Resolves with the message id or an error. */
export async function sendDocumentTemplate(to: string, doc: { link: string; fileName: string }, summary: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!whatsappApiConfigured()) return { ok: false, error: 'WhatsApp Business API is not set up' };
  const version = process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0';
  const body = {
    messaging_product: 'whatsapp',
    to: whatsappNumber(to),
    type: 'template',
    template: {
      name: process.env.WHATSAPP_TEMPLATE?.trim() || 'daily_report',
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || 'en' },
      components: [
        { type: 'header', parameters: [{ type: 'document', document: { link: doc.link, filename: doc.fileName } }] },
        { type: 'body', parameters: [{ type: 'text', text: summary.replace(/\s+/g, ' ').slice(0, 900) }] },
      ],
    },
  };
  try {
    const r = await fetchImpl(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID!.trim()}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string } };
    return r.ok ? { ok: true, id: j.messages?.[0]?.id } : { ok: false, error: j.error?.message ?? `WhatsApp API error ${r.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
