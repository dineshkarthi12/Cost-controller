/** WhatsApp "click to chat" links: open the chat with the message typed in, ready to send. */

/** "+91 89407 42959", "089407 42959" or "8940742959" → "918940742959" (10-digit numbers are taken as Indian). */
export function whatsappNumber(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d;
}

/** Long messages are cut so the link still opens on phones. */
export const WHATSAPP_MAX_TEXT = 3500;

export function whatsappUrl(phone: string | null, text: string): string {
  const body = text.length > WHATSAPP_MAX_TEXT ? `${text.slice(0, WHATSAPP_MAX_TEXT - 40)}\n… (continued in the app)` : text;
  return `https://wa.me/${phone ? whatsappNumber(phone) : ''}?text=${encodeURIComponent(body)}`;
}
