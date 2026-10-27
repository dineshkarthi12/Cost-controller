import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useForm, useFieldArray, Controller, type UseFormReturn } from 'react-hook-form';
import { useBlocker } from 'react-router';
import Decimal from 'decimal.js';
import { AlertCircle, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { buildObjectSchema, humanize, type FieldDef, type ResourceDef } from '@toprock/shared';
import { ApiError } from '../../lib/api';
import { useFormDraft, clearDraft } from '../../lib/drafts';
import { formatMoney } from '../../lib/format';
import { Button, Checkbox, Field, Input, Select, Textarea, cx, ConfirmDialog } from '../ui';
import { RefSelect, type RefOption } from './RefSelect';

type Values = Record<string, unknown>;

const pctToUi = (v: unknown) => (v === null || v === undefined || v === '' ? '' : new Decimal(String(v)).times(100).toDecimalPlaces(4).toString());
const pctToApi = (v: unknown) => (v === null || v === undefined || v === '' ? v : new Decimal(String(v)).div(100).toDecimalPlaces(6).toString());

function toUiValue(f: FieldDef, v: unknown): unknown {
  if (f.type === 'percent') return pctToUi(v);
  if ((f.type === 'date' || f.type === 'datetime') && typeof v === 'string') return v.slice(0, 10);
  if (f.type === 'lines' && Array.isArray(v)) return v.map((row) => toUiRow(f.lines ?? [], row));
  if (f.type === 'tags') return Array.isArray(v) ? v : [];
  if (f.type === 'boolean') return !!v;
  if (v === null || v === undefined) return '';
  return typeof v === 'number' ? String(v) : v;
}

function toUiRow(fields: FieldDef[], row: Record<string, unknown>) {
  const out: Record<string, unknown> = { _labels: row._labels };
  for (const f of fields) out[f.name] = toUiValue(f, row[f.name] ?? (f.default as unknown) ?? (f.type === 'boolean' ? false : ''));
  return out;
}

function toApiValue(f: FieldDef, v: unknown): unknown {
  if (f.type === 'percent') return pctToApi(v);
  if (f.type === 'int') return v === '' || v === null || v === undefined ? (f.required ? v : null) : Number(v);
  if (f.type === 'lines' && Array.isArray(v))
    return v.map((row: Record<string, unknown>) => {
      const o: Record<string, unknown> = {};
      for (const lf of f.lines ?? []) if (!lf.readOnly && lf.name in row) o[lf.name] = toApiValue(lf, row[lf.name]);
      return o;
    });
  return v;
}

export function defaultValues(def: ResourceDef, record?: Record<string, unknown> | null, overrides: Values = {}): Values {
  const out: Values = {};
  for (const f of def.fields) {
    if (f.readOnly && !record) continue;
    const raw = record ? record[f.name] : (overrides[f.name] ?? f.default ?? (f.type === 'lines' ? [{}] : f.type === 'boolean' ? false : f.type === 'tags' ? [] : ''));
    out[f.name] = f.type === 'lines' && !record && Array.isArray(raw) ? raw.map((r) => toUiRow(f.lines ?? [], r as Record<string, unknown>)) : toUiValue(f, raw);
  }
  return { ...out, ...(record ? {} : Object.fromEntries(Object.entries(overrides).filter(([k]) => !def.fields.some((f) => f.name === k && f.type === 'lines')))) };
}

const AUTOFILL_ALIASES: Record<string, string[]> = { standardRate: ['estimatedRate', 'rate'], unitRate: ['rate'], unit: ['unit'], description: ['description'], costCodeId: ['costCodeId'], taxRate: ['taxRate'] };

export function FieldInput({ f, value, onChange, error, label, refParams, onRefPicked, disabled }: { f: FieldDef; value: unknown; onChange: (v: unknown) => void; error?: string; label?: string | null; refParams?: Record<string, string | undefined>; onRefPicked?: (o?: RefOption) => void; disabled?: boolean }) {
  const id = `f-${f.name}`;
  const common = { id, disabled, invalid: !!error };
  switch (f.type) {
    case 'textarea':
      return <Textarea {...common} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} maxLength={f.maxLength ?? 10000} />;
    case 'int':
      return <Input {...common} type="number" inputMode="numeric" step={1} min={f.min} max={f.max} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'decimal':
    case 'money':
      return <Input {...common} inputMode="decimal" className="num" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value.replace(/[^\d.-]/g, ''))} placeholder={f.type === 'money' ? '0.00' : '0'} />;
    case 'percent':
      return (
        <div className="relative">
          <Input {...common} inputMode="decimal" className="num pr-7" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
        </div>
      );
    case 'date':
    case 'datetime':
      return <Input {...common} type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return <Select {...common} options={f.options ?? []} placeholder={f.required ? undefined : '—'} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'boolean':
      return <Checkbox id={id} disabled={disabled} label={f.label} checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case 'ref':
      return <RefSelect id={id} source={f.ref!} value={(value as string) || null} initialLabel={label ?? undefined} onChange={(v, o) => { onChange(v ?? ''); onRefPicked?.(o); }} disabled={disabled} invalid={!!error} params={refParams} label={f.label} />;
    case 'tags': {
      const arr = (value as string[]) ?? [];
      if (f.options)
        return (
          <div className="flex flex-wrap gap-3 pt-1">
            {f.options.map((o) => (
              <Checkbox key={o} label={humanize(o)} checked={arr.includes(o)} disabled={disabled} onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} />
            ))}
          </div>
        );
      return <TagsInput value={arr} onChange={onChange} disabled={disabled} />;
    }
    default:
      return <Input {...common} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} maxLength={f.maxLength ?? 300} />;
  }
}

function TagsInput({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setText('');
  };
  return (
    <div className="input flex flex-wrap items-center gap-1.5 py-1.5">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-xs text-navy-800">
          {t}
          {!disabled && (
            <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
              ×
            </button>
          )}
        </span>
      ))}
      <input
        className="min-w-[120px] flex-1 border-0 p-0 text-sm focus:outline-none focus:ring-0"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder="Type and press Enter"
      />
    </div>
  );
}

function linePreview(row: Record<string, unknown>): string | null {
  const q = row.qty ?? row.actualCount;
  const r = row.rate ?? row.estimatedRate ?? row.hourlyRate;
  try {
    if (q && r && /^-?\d/.test(String(q)) && /^\d/.test(String(r))) {
      let v = new Decimal(String(q)).times(String(r));
      if (row.hourlyRate && row.regularHours) v = new Decimal(String(row.actualCount ?? 0)).times(new Decimal(String(row.regularHours)).times(String(row.hourlyRate)).plus(new Decimal(String(row.overtimeHours || 0)).times(String(row.overtimeRate || 0))));
      if (row.discountPct) v = v.times(new Decimal(1).minus(new Decimal(String(row.discountPct)).div(100)));
      return formatMoney(v.toFixed(2));
    }
  } catch {
    return null;
  }
  return null;
}

function LinesEditor({ f, form, errors, disabled, refParams }: { f: FieldDef; form: UseFormReturn<Values>; errors: Record<string, string>; disabled?: boolean; refParams?: (lineField: string, row: Record<string, unknown>) => Record<string, string | undefined> | undefined }) {
  const { fields, append, remove } = useFieldArray({ control: form.control, name: f.name as never });
  const lineFields = (f.lines ?? []).filter((x) => !x.hideInForm);
  const editable = lineFields.filter((x) => !x.readOnly);
  const readOnly = lineFields.filter((x) => x.readOnly);
  const rows = form.watch(f.name) as Record<string, unknown>[] | undefined;
  return (
    <div className="space-y-3">
      {fields.map((item, idx) => {
        const row = rows?.[idx] ?? {};
        const labels = (row._labels as Record<string, string> | undefined) ?? {};
        const preview = linePreview(row);
        return (
          <div key={item.id} className="rounded-lg border border-line bg-slate-50/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted">
                {f.label} line {idx + 1}
                {preview && <span className="ml-2 font-normal text-ink">≈ {preview}</span>}
              </span>
              {!disabled && fields.length > (f.required ? 1 : 0) && (
                <button type="button" onClick={() => remove(idx)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50" aria-label={`Remove line ${idx + 1}`}>
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
              {editable.map((lf) => {
                const name = `${f.name}.${idx}.${lf.name}`;
                const err = errors[name];
                return (
                  <Controller
                    key={lf.name}
                    control={form.control}
                    name={name}
                    render={({ field }) =>
                      lf.type === 'boolean' ? (
                        <div className="flex items-end pb-2">
                          <FieldInput f={lf} value={field.value} onChange={field.onChange} disabled={disabled} />
                        </div>
                      ) : (
                        <Field label={lf.label} htmlFor={`f-${lf.name}`} required={lf.required} error={err} className={cx(lf.type === 'textarea' && 'sm:col-span-2')}>
                          <FieldInput
                            f={lf}
                            value={field.value}
                            onChange={field.onChange}
                            error={err}
                            label={labels[lf.name]}
                            disabled={disabled}
                            refParams={refParams?.(lf.name, row)}
                            onRefPicked={(o) => {
                              form.setValue(`${f.name}.${idx}._labels.${lf.name}` as never, (o?.label ?? null) as never);
                              for (const [k, v] of Object.entries(o?.extra ?? {})) {
                                for (const target of AUTOFILL_ALIASES[k] ?? []) {
                                  if (target === lf.name || !lineFields.some((x) => x.name === target && !x.readOnly) || v === null) continue;
                                  const cur = form.getValues(`${f.name}.${idx}.${target}` as never) as unknown;
                                  if (cur === '' || cur === undefined || cur === null) form.setValue(`${f.name}.${idx}.${target}` as never, (target === 'taxRate' ? pctToUi(v) : v) as never, { shouldDirty: true });
                                }
                              }
                            }}
                          />
                        </Field>
                      )
                    }
                  />
                );
              })}
              {readOnly.some((r) => row[r.name] !== undefined && row[r.name] !== '') &&
                readOnly.map((r) => (
                  <div key={r.name}>
                    <p className="label">{r.label}</p>
                    <p className="py-2 text-sm tabular-nums text-ink">{r.type === 'money' ? formatMoney(String(row[r.name] ?? '0')) : String(row[r.name] ?? '—')}</p>
                  </div>
                ))}
            </div>
          </div>
        );
      })}
      {!disabled && (
        <Button type="button" variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => append(toUiRow(f.lines ?? [], {}) as never)}>
          Add {f.label.toLowerCase()} line
        </Button>
      )}
      {errors[f.name] && <p className="text-xs text-red-600">{errors[f.name]}</p>}
    </div>
  );
}

export interface ResourceFormProps {
  def: ResourceDef;
  mode: 'create' | 'update';
  record?: Record<string, unknown> | null;
  initial?: Values;
  draftKey?: string | null;
  onSubmit: (body: Values) => Promise<unknown>;
  onCancel?: () => void;
  submitLabel?: string;
  hideFields?: string[];
  lockedFields?: string[];
  refParams?: (field: string, row: Record<string, unknown>, values: Values) => Record<string, string | undefined> | undefined;
  extra?: ReactNode;
}

/** Metadata-driven form: the same field definitions validate on the server. */
export function ResourceForm({ def, mode, record, initial, draftKey, onSubmit, onCancel, submitLabel, hideFields = [], lockedFields = [], refParams, extra }: ResourceFormProps) {
  const form = useForm<Values>({ defaultValues: defaultValues(def, record, initial) });
  const { restored, discard } = useFormDraft(mode === 'create' ? (draftKey ?? null) : null, form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<{ message: string; list?: string[]; needsReason?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dupReason, setDupReason] = useState<{ open: boolean; body?: Values }>({ open: false });
  const schema = useMemo(() => buildObjectSchema(def.fields, mode), [def, mode]);
  const values = form.watch();

  // onSubmit usually navigates to the saved record before `saved` state updates, so the blocker reads a ref.
  const submittingRef = useRef(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => form.formState.isDirty && !saved && !submittingRef.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (form.formState.isDirty && !saved) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [form.formState.isDirty, saved]);

  const visible = def.fields.filter((f) => !f.readOnly && !f.hideInForm && !hideFields.includes(f.name) && !(mode === 'update' && f.createOnly && !lockedFields.includes(f.name)));
  const sections = visible.reduce<Record<string, FieldDef[]>>((acc, f) => {
    const s = f.type === 'lines' ? `__lines_${f.name}` : (f.section ?? 'Details');
    (acc[s] ??= []).push(f);
    return acc;
  }, {});

  const submit = async (extraBody: Values = {}) => {
    setErrors({});
    setFormError(null);
    const raw = form.getValues();
    const body: Values = {};
    for (const f of def.fields) {
      if (f.readOnly || !(f.name in raw)) continue;
      if (mode === 'update' && f.createOnly) continue;
      body[f.name] = toApiValue(f, raw[f.name]);
    }
    Object.assign(body, extraBody);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[issue.path.join('.')] = issue.message;
      setErrors(errs);
      setFormError({ message: 'Please correct the highlighted fields.' });
      return;
    }
    setSaving(true);
    submittingRef.current = true;
    try {
      await onSubmit({ ...body, ...(record?.updatedAt ? { expectedUpdatedAt: record.updatedAt } : {}) });
      setSaved(true);
      if (draftKey) clearDraft(draftKey);
    } catch (e) {
      submittingRef.current = false;
      if (e instanceof ApiError) {
        const fe = e.fieldErrors;
        setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0]])));
        const details = e.details as { errors?: string[]; needsReason?: boolean } | undefined;
        if (details?.needsReason) {
          setDupReason({ open: true, body: extraBody });
          setFormError({ message: e.message, needsReason: true });
        } else setFormError({ message: e.message, list: details?.errors });
      } else setFormError({ message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
      className="space-y-6"
    >
      {restored && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
          <span>Restored an unsaved draft from this device.</span>
          <button
            type="button"
            className="inline-flex items-center gap-1 font-medium hover:underline"
            onClick={() => {
              discard();
              form.reset(defaultValues(def, record, initial));
            }}
          >
            <RotateCcw className="h-4 w-4" /> Start over
          </button>
        </div>
      )}
      {def.description && mode === 'create' && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">{def.description}</p>}
      {Object.entries(sections).map(([section, fs]) =>
        section.startsWith('__lines_') ? (
          <fieldset key={section}>
            <legend className="mb-3 text-sm font-semibold text-ink">{fs[0].label}</legend>
            <LinesEditor f={fs[0]} form={form} errors={errors} refParams={refParams ? (lf, row) => refParams(lf, row, values) : undefined} />
          </fieldset>
        ) : (
          <fieldset key={section}>
            {Object.keys(sections).length > 1 && <legend className="mb-3 text-sm font-semibold text-ink">{section}</legend>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {fs.map((f) => (
                <Controller
                  key={f.name}
                  control={form.control}
                  name={f.name}
                  render={({ field }) =>
                    f.type === 'boolean' ? (
                      <div className={cx('flex items-end pb-2', f.span === 3 && 'sm:col-span-2 lg:col-span-3')}>
                        <div>
                          <FieldInput f={f} value={field.value} onChange={field.onChange} disabled={lockedFields.includes(f.name)} />
                          {f.help && <p className="mt-1 text-xs text-muted">{f.help}</p>}
                        </div>
                      </div>
                    ) : (
                      <Field label={f.label} htmlFor={`f-${f.name}`} required={f.required} error={errors[f.name]} help={f.help} className={cx(f.span === 3 && 'sm:col-span-2 lg:col-span-3', f.span === 2 && 'sm:col-span-2', f.type === 'textarea' && !f.span && 'sm:col-span-2 lg:col-span-3')}>
                        <FieldInput f={f} value={field.value} onChange={field.onChange} error={errors[f.name]} label={(record?._labels as Record<string, string> | undefined)?.[f.name]} disabled={lockedFields.includes(f.name)} refParams={refParams?.(f.name, {}, values)} />
                      </Field>
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
        ),
      )}
      {extra}
      {formError && (
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{formError.message}</p>
            {formError.list && (
              <ul className="mt-1 list-disc pl-5">
                {formError.list.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div className="sticky bottom-16 z-10 -mx-1 flex flex-wrap justify-end gap-2 bg-white/90 px-1 py-2 backdrop-blur lg:bottom-0">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={saving}>
          {submitLabel ?? (mode === 'create' ? `Save ${def.workflow ? 'draft' : def.label.toLowerCase()}` : 'Save changes')}
        </Button>
      </div>
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.reset?.()}
        title="Discard unsaved changes?"
        message={mode === 'create' && draftKey ? 'Your input is kept as a draft on this device and will be restored next time.' : 'Changes you made will be lost.'}
        confirmLabel="Leave page"
        tone="danger"
        onConfirm={() => blocker.proceed?.()}
      />
      <ConfirmDialog
        open={dupReason.open}
        onOpenChange={(o) => setDupReason({ open: o })}
        title="Possible duplicate"
        message={formError?.message ?? 'A similar record exists.'}
        requireReason
        reasonLabel="Why is this not a duplicate?"
        confirmLabel="Save anyway"
        onConfirm={(reason) => {
          setDupReason({ open: false });
          void submit({ duplicateReason: reason });
        }}
      />
    </form>
  );
}
