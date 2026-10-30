/**
 * Reads a photo of a handwritten daily labour sheet (site name, date, workers grouped by
 * activity, and in the evening the work done) into a draft the user reviews before saving.
 *
 * Uses the Claude API and is only available when ANTHROPIC_API_KEY is set. Nothing is saved
 * here: the result fills the form, and every name and quantity is checked by a person.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const LABOUR_SHEET_MODEL = 'claude-opus-5-5';
export const MAX_SHEET_IMAGE_BYTES = 5 * 1024 * 1024; // API limit per image
export const SHEET_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type SheetImageType = (typeof SHEET_IMAGE_TYPES)[number];

const gangSchema = z.object({
  workers: z.array(z.string()),
  work: z.string(),
  outcome: z.string().nullable(),
  doneQty: z.number().nullable(),
  unit: z.string().nullable(),
  progress: z.enum(['PLANNED', 'IN_PROGRESS', 'DONE']),
});
const sheetSchema = z.object({
  site: z.string().nullable(),
  date: z.string().nullable(),
  gangs: z.array(gangSchema),
  unreadable: z.array(z.string()),
});
export type ExtractedSheet = z.infer<typeof sheetSchema>;

// JSON Schema for structured output; mirrors sheetSchema.
const nullable = (t: string) => ({ type: [t, 'null'] });
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['site', 'date', 'gangs', 'unreadable'],
  properties: {
    site: nullable('string'),
    date: { ...nullable('string'), description: 'Date written on the sheet as YYYY-MM-DD, or null' },
    gangs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['workers', 'work', 'outcome', 'doneQty', 'unit', 'progress'],
        properties: {
          workers: { type: 'array', items: { type: 'string' } },
          work: { type: 'string' },
          outcome: { ...nullable('string'), description: 'Evening result exactly as written, e.g. "70 Nos done", or null' },
          doneQty: { ...nullable('number'), description: 'Quantity done, only when a number is written' },
          unit: { ...nullable('string'), description: 'One of Sq.ft, Nos, Rft, Rmt, Sqm, Cum, Kg, Bags, or null' },
          progress: { type: 'string', enum: ['PLANNED', 'IN_PROGRESS', 'DONE'] },
        },
      },
    },
    unreadable: { type: 'array', items: { type: 'string' }, description: 'Anything that could not be read with confidence' },
  },
} as const;

const SYSTEM = `You read photos of handwritten daily labour sheets from Indian construction sites and return their content as JSON.

A sheet has a site name and a date at the top, then rows of worker names. A bracket or a shared line groups several workers under one activity ("gang"). In the evening a third column records the result, such as "70 Nos done", "145 Rft done", "110 sq ft work done", "on progress", "work completed" or "20% work pending".

Rules:
- One entry in gangs per activity, in the order written, with all of its workers.
- Ignore names that are struck through.
- Copy the activity text as written, correcting only obvious spelling (for example "Glue filling", "Aluminium frame").
- When a list of known workers is given and a written name is clearly the same person, use the known spelling.
- doneQty and unit only when a number is written for that activity; otherwise null. Units: Sq.ft, Nos, Rft, Rmt, Sqm, Cum, Kg, Bags ("sq ft" and "ft²" are Sq.ft; "RFT" is Rft).
- progress: DONE when the result says done or completed, IN_PROGRESS for "on progress", "pending" or a partial %, otherwise PLANNED.
- Never invent names, activities or quantities. List anything you cannot read with confidence in unreadable.`;

type CreateFn = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;
let createOverride: CreateFn | null = null;

/** Tests replace the API call with a fake. */
export function setLabourSheetClientForTests(fn: CreateFn | null) {
  createOverride = fn;
}

export function labourSheetAiConfigured(): boolean {
  return !!createOverride || !!process.env.ANTHROPIC_API_KEY?.trim();
}

let client: Anthropic | null = null;
function create(params: Anthropic.Beta.MessageCreateParamsNonStreaming) {
  if (createOverride) return createOverride(params);
  client ??= new Anthropic({ timeout: 55_000, maxRetries: 1 });
  return client.beta.messages.create(params);
}

export async function extractLabourSheet(
  image: Buffer,
  mediaType: SheetImageType,
  context: { stage: 'morning' | 'evening'; knownWorkers: string[] },
): Promise<ExtractedSheet> {
  if (!labourSheetAiConfigured()) throw new AppError(503, 'AI_NOT_CONFIGURED', 'Reading photos needs an Anthropic API key (ANTHROPIC_API_KEY) set by the administrator. You can type the report instead.');
  if (image.length > MAX_SHEET_IMAGE_BYTES) throw new AppError(413, 'IMAGE_TOO_LARGE', 'The photo is larger than 5 MB. Take it again at a lower resolution.');

  const known = context.knownWorkers.length ? `Known workers on this project: ${context.knownWorkers.slice(0, 400).join(', ')}.` : 'No worker list is available.';
  const ask = context.stage === 'evening' ? 'This is the evening sheet: include the result column.' : 'This is the morning sheet: there may be no result column yet.';
  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = await create({
      model: LABOUR_SHEET_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
            { type: 'text', text: `${ask}\n${known}` },
          ],
        },
      ],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AppError(503, 'AI_NOT_CONFIGURED', 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.');
    if (e instanceof Anthropic.RateLimitError) throw new AppError(429, 'AI_BUSY', 'The photo reader is busy. Try again in a minute, or type the report.');
    if (e instanceof Anthropic.BadRequestError) throw new AppError(422, 'AI_REJECTED', 'The photo could not be read. Try a clearer photo, or type the report.');
    if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) {
      logger.warn({ err: e }, 'labour sheet extraction failed');
      throw new AppError(502, 'AI_UNAVAILABLE', 'The photo reader is not reachable right now. Type the report, or try again later.');
    }
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new AppError(422, 'AI_REJECTED', 'The photo could not be read. Type the report instead.');
  if (msg.stop_reason === 'max_tokens') throw new AppError(422, 'AI_INCOMPLETE', 'The sheet is too long to read in one photo. Split it into two photos.');
  const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let parsed: ExtractedSheet;
  try {
    parsed = sheetSchema.parse(JSON.parse(text));
  } catch {
    throw new AppError(502, 'AI_BAD_OUTPUT', 'The photo reader returned something unexpected. Try again, or type the report.');
  }
  // Tidy up: drop empty names and rows with nothing in them.
  parsed.gangs = parsed.gangs
    .map((g) => ({ ...g, workers: g.workers.map((w) => w.trim()).filter(Boolean), work: g.work.trim() }))
    .filter((g) => g.workers.length || g.work);
  if (parsed.date && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) parsed.date = null;
  return parsed;
}
