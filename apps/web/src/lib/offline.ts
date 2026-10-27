import { useEffect, useState, useSyncExternalStore } from 'react';
import { get, set } from 'idb-keyval';
import { api } from './api';

export function useOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Offline-tolerant photo upload queue. Captured photos are kept in IndexedDB until the
 * server confirms they were stored, so evidence is not lost on a flaky site connection.
 * The server remains the authoritative record; queued items are clearly shown as pending.
 */
export type QueueStatus = 'pending' | 'uploading' | 'failed' | 'uploaded';
export interface QueuedUpload {
  id: string;
  projectId: string;
  fields: Record<string, string>;
  file: Blob;
  fileName: string;
  createdAt: string;
  status: QueueStatus;
  error?: string;
}

const KEY = 'tr.uploadQueue';
let items: QueuedUpload[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  items = [...items];
  listeners.forEach((l) => l());
}

async function persist() {
  try {
    await set(
      KEY,
      items.filter((i) => i.status !== 'uploaded'),
    );
  } catch {
    /* IndexedDB unavailable — queue lives in memory only */
  }
}

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const stored = (await get<QueuedUpload[]>(KEY)) ?? [];
    items = stored.map((s) => ({ ...s, status: s.status === 'uploading' ? 'pending' : s.status }));
    emit();
  } catch {
    /* ignore */
  }
}

export async function enqueueUpload(projectId: string, file: File, fields: Record<string, string>) {
  await load();
  const item: QueuedUpload = { id: crypto.randomUUID(), projectId, fields: { ...fields, clientUploadId: crypto.randomUUID() }, file, fileName: file.name, createdAt: new Date().toISOString(), status: 'pending' };
  items.push(item);
  emit();
  await persist();
  void processQueue();
  return item.id;
}

let running = false;
export async function processQueue() {
  await load();
  if (running || !navigator.onLine) return;
  running = true;
  try {
    for (const item of items.filter((i) => i.status === 'pending' || i.status === 'failed')) {
      item.status = 'uploading';
      emit();
      const form = new FormData();
      for (const [k, v] of Object.entries(item.fields)) form.append(k, v);
      form.append('files', item.file, item.fileName);
      try {
        await api.upload(`/projects/${item.projectId}/evidence`, form);
        item.status = 'uploaded';
        item.error = undefined;
      } catch (e) {
        item.status = 'failed';
        item.error = (e as Error).message;
      }
      emit();
      await persist();
    }
  } finally {
    running = false;
  }
}

export function removeQueued(id: string) {
  items = items.filter((i) => i.id !== id);
  emit();
  void persist();
}

export function useUploadQueue() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    void load();
    const online = () => void processQueue();
    window.addEventListener('online', online);
    return () => {
      listeners.delete(l);
      window.removeEventListener('online', online);
    };
  }, []);
  return items;
}
