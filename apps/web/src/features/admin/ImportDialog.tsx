import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Download, FileUp, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Checkbox, Dialog, Field, Input, Select, cx } from '../../components/ui';

export type ImportKind = 'BOQ' | 'COST_CODES' | 'MATERIALS' | 'SUPPLIERS' | 'OPENING_STOCK';

interface FieldSpec {
  key: string;
  label: string;
  required?: boolean;
  type?: 'number' | 'text';
}
interface PreviewRow {
  row: number;
  values: Record<string, string>;
  errors: string[];
  action: 'CREATE' | 'SKIP';
}
interface Preview {
  id: string;
  summary: { total: number; valid: number; invalid: number; headers: string[]; missingRequired: string[] };
  mapping: Record<string, number>;
  fields: FieldSpec[];
  rows: PreviewRow[];
}

const TITLES: Record<ImportKind, string> = { BOQ: 'BOQ items', COST_CODES: 'Cost codes & budget', MATERIALS: 'Material master', SUPPLIERS: 'Suppliers & contractors', OPENING_STOCK: 'Opening stock' };
const PROJECT_KINDS: ImportKind[] = ['BOQ', 'COST_CODES', 'OPENING_STOCK'];

/** Upload → preview & column mapping → commit. Nothing is written until the user commits; the server re-validates on commit. */
export function ImportDialog({ kind, open, onOpenChange }: { kind: ImportKind; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { projectId } = useAuth();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const reset = () => {
    setFile(null);
    setPreview(null);
    setMapping({});
    setSkipInvalid(false);
    setOnlyErrors(false);
  };
  const doPreview = useMutation({
    mutationFn: async (withMapping: boolean) => {
      if (preview) await api.post(`/imports/${preview.id}/cancel`).catch(() => undefined);
      const form = new FormData();
      form.set('kind', kind);
      if (PROJECT_KINDS.includes(kind) && projectId) form.set('projectId', projectId);
      if (withMapping) form.set('mapping', JSON.stringify(mapping));
      form.set('file', file!);
      return api.upload<Preview>('/imports/preview', form);
    },
    onSuccess: (p) => {
      setPreview(p);
      setMapping(p.mapping);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const commit = useMutation({
    mutationFn: () => api.post<{ imported: number; skipped: number }>(`/imports/${preview!.id}/commit`, { skipInvalid }),
    onSuccess: (r) => {
      toast.success(`Imported ${r.imported} row(s)${r.skipped ? `, skipped ${r.skipped}` : ''}`);
      void qc.invalidateQueries();
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const close = (o: boolean) => {
    if (!o && preview && !commit.isSuccess) void api.post(`/imports/${preview.id}/cancel`).catch(() => undefined);
    if (!o) reset();
    onOpenChange(o);
  };
  const mappingChanged = preview && JSON.stringify(mapping) !== JSON.stringify(preview.mapping);
  const shown = (preview?.rows ?? []).filter((r) => !onlyErrors || r.errors.length);
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="xl"
      title={`Import ${TITLES[kind]}`}
      description="Upload an .xlsx or .csv file with a header row. You will see every row validated before anything is saved."
      footer={
        preview ? (
          <>
            <Button variant="ghost" onClick={reset}>Choose another file</Button>
            {preview.summary.invalid > 0 && (
              <a className="inline-flex" href={api.url(`/imports/${preview.id}/errors.csv`)}>
                <Button variant="outline" icon={<Download className="h-4 w-4" />}>Error report</Button>
              </a>
            )}
            <Button loading={commit.isPending} disabled={!!mappingChanged || preview.summary.valid === 0 || (preview.summary.invalid > 0 && !skipInvalid)} onClick={() => commit.mutate()}>
              Import {preview.summary.valid} row(s)
            </Button>
          </>
        ) : (
          <Button icon={<Upload className="h-4 w-4" />} disabled={!file} loading={doPreview.isPending} onClick={() => doPreview.mutate(false)}>
            Upload & validate
          </Button>
        )
      }
    >
      {!preview ? (
        <Field label="File" required help="Columns are matched by header name; you can adjust the mapping after upload. Max 5,000 rows.">
          <Input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FileUp className="h-4 w-4 text-muted" />
            <span className="font-medium">{file?.name}</span>
            <Badge tone="neutral">{preview.summary.total} rows</Badge>
            <Badge tone="success">{preview.summary.valid} valid</Badge>
            {preview.summary.invalid > 0 && <Badge tone="danger">{preview.summary.invalid} with errors</Badge>}
          </div>
          <details open={preview.summary.missingRequired.length > 0} className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-sm font-medium">Column mapping</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {preview.fields.map((f) => (
                <Field key={f.key} label={f.label} required={f.required}>
                  <Select
                    options={preview.summary.headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }))}
                    placeholder="— not mapped —"
                    value={mapping[f.key] === undefined ? '' : String(mapping[f.key])}
                    invalid={f.required && mapping[f.key] === undefined}
                    onChange={(e) => setMapping((m) => {
                      const next = { ...m };
                      if (e.target.value === '') delete next[f.key];
                      else next[f.key] = Number(e.target.value);
                      return next;
                    })}
                  />
                </Field>
              ))}
            </div>
            {mappingChanged && (
              <div className="mt-3 flex justify-end">
                <Button size="sm" loading={doPreview.isPending} onClick={() => doPreview.mutate(true)}>Re-validate with this mapping</Button>
              </div>
            )}
          </details>
          {preview.summary.invalid > 0 && (
            <div className="flex flex-wrap items-center gap-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              <span>Rows with errors are not imported.</span>
              <Checkbox label="Skip invalid rows and import the rest" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} />
              <Checkbox label="Show only rows with errors" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
            </div>
          )}
          <div className="max-h-[45vh] overflow-auto rounded-lg border border-line">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-50 text-left text-muted">
                <tr>
                  <th className="px-2 py-1.5">Row</th>
                  {preview.fields.map((f) => <th key={f.key} className="px-2 py-1.5 whitespace-nowrap">{f.label}</th>)}
                  <th className="px-2 py-1.5">Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.row} className={cx('border-t border-line', r.errors.length && 'bg-red-50/60')}>
                    <td className="px-2 py-1 tabular-nums">{r.row}</td>
                    {preview.fields.map((f) => <td key={f.key} className="max-w-[180px] truncate px-2 py-1">{r.values[f.key]}</td>)}
                    <td className="px-2 py-1">{r.errors.length ? <span className="text-red-700">{r.errors.join('; ')}</span> : <span className="text-emerald-700">OK</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length < preview.summary.total && <p className="text-xs text-muted">Showing the first {preview.rows.length} rows. All rows are validated and the error report covers the whole file.</p>}
        </div>
      )}
    </Dialog>
  );
}

export function ImportButton({ kind, label = 'Import' }: { kind: ImportKind; label?: string }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!can('import.manage')) return null;
  return (
    <>
      <Button variant="outline" icon={<Upload className="h-4 w-4" />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ImportDialog kind={kind} open={open} onOpenChange={setOpen} />
    </>
  );
}
