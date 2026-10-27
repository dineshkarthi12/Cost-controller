/**
 * Schedule import from Microsoft Project XML (MSPDI, "Save As → XML") and Oracle Primavera P6 XER.
 * Both are converted to one neutral structure; nothing is written until the user commits the preview.
 */
import { XMLParser } from 'fast-xml-parser';

export interface ImportedActivity {
  /** Identifier inside the file (MSP UID, P6 task_id); used to resolve dependencies. */
  key: string;
  code: string;
  name: string;
  wbs: string | null;
  plannedStart: string | null; // YYYY-MM-DD
  plannedFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  percentComplete: number; // 0–100
  isMilestone: boolean;
}

export interface ImportedDependency {
  predecessorKey: string;
  successorKey: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
}

export interface ParsedSchedule {
  format: 'MS_PROJECT_XML' | 'PRIMAVERA_XER';
  projectName: string | null;
  activities: ImportedActivity[];
  dependencies: ImportedDependency[];
  warnings: string[];
}

export const MAX_IMPORT_ACTIVITIES = 5000;

const date = (v: unknown): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const m = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};
const clampPct = (v: unknown) => Math.min(100, Math.max(0, Number(v) || 0));
const cleanCode = (v: string) => v.trim().replace(/\s+/g, '-').slice(0, 40);

/** Gives every activity a code that is unique within the file. */
function uniqueCodes(acts: ImportedActivity[], warnings: string[]) {
  const seen = new Map<string, number>();
  for (const a of acts) {
    const base = a.code || `T-${a.key}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    if (n > 0) {
      a.code = `${base}-${n + 1}`;
      warnings.push(`Duplicate code ${base} renamed to ${a.code}`);
    } else a.code = base;
  }
}

// ───────────── Microsoft Project XML ─────────────

const MSP_LINK: Record<string, ImportedDependency['type']> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };

/** MSP stores lag in tenths of a minute, normally on an 8-hour day (LagFormat 7 = days). */
function mspLagDays(lag: unknown, format: unknown): number {
  const tenthMinutes = Number(lag) || 0;
  if (!tenthMinutes) return 0;
  // Elapsed formats (em, eh, ed, ew, emo) count 24-hour days; the others count 8-hour working days.
  const elapsed = [4, 6, 8, 10, 12].includes(Number(format));
  return Math.round(tenthMinutes / (10 * 60 * (elapsed ? 24 : 8)));
}

export function parseMsProjectXml(xml: string): ParsedSchedule {
  const warnings: string[] = [];
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, isArray: (name) => ['Task', 'PredecessorLink'].includes(name) });
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new Error('The file is not valid XML');
  }
  const project = doc.Project as Record<string, unknown> | undefined;
  const tasks = ((project?.Tasks as Record<string, unknown> | undefined)?.Task as Array<Record<string, unknown>> | undefined) ?? null;
  if (!project || !tasks) throw new Error('This XML is not a Microsoft Project file (expected <Project><Tasks>). In MS Project use File → Save As → XML Format.');
  const activities: ImportedActivity[] = [];
  const dependencies: ImportedDependency[] = [];
  let summaries = 0;
  for (const t of tasks) {
    const uid = String(t.UID ?? '');
    if (!uid || uid === '0') continue; // project summary task
    if (String(t.Summary ?? '0') === '1') {
      summaries++;
      continue;
    }
    if (String(t.IsNull ?? '0') === '1') continue;
    const wbs = t.WBS ? String(t.WBS) : null;
    const isMilestone = String(t.Milestone ?? '0') === '1';
    activities.push({
      key: uid,
      code: cleanCode(wbs ?? (t.ID ? `T-${t.ID}` : `T-${uid}`)),
      name: String(t.Name ?? `Task ${uid}`).slice(0, 300),
      wbs,
      plannedStart: date(t.Start),
      plannedFinish: date(isMilestone ? (t.Start ?? t.Finish) : t.Finish),
      actualStart: date(t.ActualStart),
      actualFinish: date(t.ActualFinish),
      percentComplete: clampPct(t.PercentComplete),
      isMilestone,
    });
    for (const l of (t.PredecessorLink as Array<Record<string, unknown>> | undefined) ?? []) {
      dependencies.push({ predecessorKey: String(l.PredecessorUID), successorKey: uid, type: MSP_LINK[String(l.Type ?? '1')] ?? 'FS', lagDays: mspLagDays(l.LinkLag, l.LagFormat) });
    }
  }
  if (summaries) warnings.push(`${summaries} summary task(s) skipped; only work activities are imported`);
  uniqueCodes(activities, warnings);
  return { format: 'MS_PROJECT_XML', projectName: project.Title ? String(project.Title) : project.Name ? String(project.Name).replace(/\.xml$/i, '') : null, activities, dependencies, warnings };
}

// ───────────── Primavera P6 XER ─────────────

/** XER: tab-separated tables. %T table name, %F field names, %R rows. */
export function readXerTables(text: string): Map<string, Array<Record<string, string>>> {
  const tables = new Map<string, Array<Record<string, string>>>();
  let current: string | null = null;
  let fields: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const cols = raw.split('\t');
    if (cols[0] === '%T') {
      current = cols[1]?.trim() ?? null;
      fields = [];
      if (current) tables.set(current, []);
    } else if (cols[0] === '%F') fields = cols.slice(1).map((f) => f.trim());
    else if (cols[0] === '%R' && current) {
      const row: Record<string, string> = {};
      cols.slice(1).forEach((v, i) => {
        if (fields[i]) row[fields[i]] = v;
      });
      tables.get(current)!.push(row);
    }
  }
  return tables;
}

const XER_LINK: Record<string, ImportedDependency['type']> = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };

export function parseXer(text: string): ParsedSchedule {
  if (!text.startsWith('ERMHDR')) throw new Error('This is not a Primavera XER file (it should start with ERMHDR). In P6 use File → Export → Primavera PM (XER).');
  const warnings: string[] = [];
  const t = readXerTables(text);
  const tasks = t.get('TASK') ?? [];
  if (!tasks.length) throw new Error('The XER file has no TASK table');
  const projects = t.get('PROJECT') ?? [];
  const projIds = new Set(tasks.map((x) => x.proj_id));
  if (projIds.size > 1) warnings.push(`The file contains ${projIds.size} projects; all activities are imported together`);
  const wbsName = new Map((t.get('PROJWBS') ?? []).map((w) => [w.wbs_id, w.wbs_short_name || w.wbs_name]));
  const activities: ImportedActivity[] = [];
  let skipped = 0;
  for (const x of tasks) {
    if (x.task_type === 'TT_WBS' || x.task_type === 'TT_LOE') {
      skipped++;
      continue;
    }
    const isMilestone = x.task_type === 'TT_Mile' || x.task_type === 'TT_FinMile';
    const start = date(x.target_start_date || x.early_start_date);
    const finish = date(x.target_end_date || x.early_end_date);
    activities.push({
      key: x.task_id,
      code: cleanCode(x.task_code || `T-${x.task_id}`),
      name: (x.task_name || x.task_code || x.task_id).slice(0, 300),
      wbs: wbsName.get(x.wbs_id) ?? null,
      plannedStart: isMilestone ? (start ?? finish) : start,
      plannedFinish: isMilestone ? (start ?? finish) : finish,
      actualStart: date(x.act_start_date),
      actualFinish: date(x.act_end_date),
      percentComplete: x.status_code === 'TK_Complete' ? 100 : clampPct(x.phys_complete_pct),
      isMilestone,
    });
  }
  if (skipped) warnings.push(`${skipped} WBS-summary / level-of-effort activity(ies) skipped`);
  const dependencies: ImportedDependency[] = (t.get('TASKPRED') ?? []).map((p) => ({
    predecessorKey: p.pred_task_id,
    successorKey: p.task_id,
    type: XER_LINK[p.pred_type] ?? 'FS',
    // P6 stores lag in hours; an 8-hour working day is assumed.
    lagDays: Math.round((Number(p.lag_hr_cnt) || 0) / 8),
  }));
  uniqueCodes(activities, warnings);
  return { format: 'PRIMAVERA_XER', projectName: projects[0]?.proj_short_name ?? null, activities, dependencies, warnings };
}

/** Detects the format from content and file name. */
export function parseScheduleFile(fileName: string, buf: Buffer): ParsedSchedule {
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const parsed = /\.xer$/i.test(fileName) || text.startsWith('ERMHDR') ? parseXer(text) : /^\s*</.test(text) ? parseMsProjectXml(text) : null;
  if (!parsed) throw new Error('Upload a Microsoft Project XML file (.xml) or a Primavera P6 export (.xer)');
  if (parsed.activities.length > MAX_IMPORT_ACTIVITIES) throw new Error(`Imports are limited to ${MAX_IMPORT_ACTIVITIES} activities`);
  const keys = new Set(parsed.activities.map((a) => a.key));
  const before = parsed.dependencies.length;
  parsed.dependencies = parsed.dependencies.filter((d) => keys.has(d.predecessorKey) && keys.has(d.successorKey) && d.predecessorKey !== d.successorKey);
  if (parsed.dependencies.length < before) parsed.warnings.push(`${before - parsed.dependencies.length} link(s) to summary or missing activities ignored`);
  const undated = parsed.activities.filter((a) => !a.plannedStart || !a.plannedFinish).length;
  if (undated) parsed.warnings.push(`${undated} activity(ies) have no planned dates and will not appear on the Gantt chart`);
  return parsed;
}
