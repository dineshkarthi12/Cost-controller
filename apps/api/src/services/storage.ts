import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { get as blobGet, head as blobHead, put as blobPut } from '@vercel/blob';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';

/** Object-storage abstraction: local disk, or Vercel Blob (private) on Vercel. The S3 adapter is an interface only. */
export interface StorageProvider {
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
}

class LocalStorage implements StorageProvider {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    // wx: never overwrite an existing object (evidence is immutable)
    await fsp.writeFile(p, data, { flag: 'wx' });
  }
  async get(key: string) {
    // Open first, so a missing file becomes a 404 for this request instead of an unhandled stream error
    // that would stop the whole server.
    try {
      const handle = await fsp.open(this.resolve(key), 'r');
      return handle.createReadStream();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError(404, 'FILE_MISSING', 'This file is missing from storage. Upload it again.');
      throw e;
    }
  }
  async exists(key: string) {
    try {
      await fsp.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

class S3StorageNotConfigured implements StorageProvider {
  private fail(): never {
    throw new Error('S3 storage adapter is not configured in this deployment');
  }
  async put(): Promise<void> {
    this.fail();
  }
  async get(): Promise<Readable> {
    this.fail();
  }
  async exists(): Promise<boolean> {
    this.fail();
  }
}

/**
 * Vercel Blob. With a private store objects are never publicly readable; the API streams them to
 * users after its own access checks. Keys contain a random UUID and are never overwritten.
 */
class VercelBlobStorage implements StorageProvider {
  // Create the Blob store with access "Private". BLOB_ACCESS=public is only for public stores;
  // objects are still served through the API, and keys contain a random UUID.
  private access: 'private' | 'public' = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';
  private wrap(e: unknown): never {
    throw new AppError(503, 'STORAGE_ERROR', `File storage error: ${(e as Error).message}. Check the Blob store is connected to this project and its access type matches BLOB_ACCESS (default private).`);
  }
  async put(key: string, data: Buffer, mimeType: string) {
    try {
      await blobPut(key, data, { access: this.access, contentType: mimeType, addRandomSuffix: false, allowOverwrite: false });
    } catch (e) {
      this.wrap(e);
    }
  }
  async get(key: string) {
    let r;
    try {
      r = await blobGet(key, { access: this.access });
    } catch (e) {
      this.wrap(e);
    }
    if (!r || !r.stream) throw new AppError(404, 'NOT_FOUND', 'File not found in storage');
    return Readable.fromWeb(r.stream as unknown as WebReadableStream<Uint8Array>);
  }
  async exists(key: string) {
    try {
      await blobHead(key);
      return true;
    } catch {
      return false;
    }
  }
}

/** Serverless without object storage: refuse clearly instead of writing to a disk that disappears. */
class StorageUnavailable implements StorageProvider {
  private fail(): never {
    throw new AppError(503, 'STORAGE_NOT_CONFIGURED', 'File storage is not configured. In Vercel, open Storage → create a Blob store and connect it to this project, then redeploy.');
  }
  async put(): Promise<void> {
    this.fail();
  }
  async get(): Promise<Readable> {
    this.fail();
  }
  async exists(): Promise<boolean> {
    return false;
  }
}

function createStorage(): StorageProvider {
  switch (config.storageDriver) {
    case 'vercel-blob':
      return new VercelBlobStorage();
    case 's3':
      return new S3StorageNotConfigured();
    case 'none':
      return new StorageUnavailable();
    default:
      return new LocalStorage(config.storageDir);
  }
}

export const storage: StorageProvider = createStorage();
export const storageAvailable = config.storageDriver === 'local' || config.storageDriver === 'vercel-blob';

const SIGNATURES: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString() === '%PDF-' },
  { mime: 'application/zip', test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
];

const ALLOWED_DECLARED: Record<string, string[]> = {
  'image/jpeg': ['image/jpeg'],
  'image/png': ['image/png'],
  'image/webp': ['image/webp'],
  'application/pdf': ['application/pdf'],
  'application/zip': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
  ],
};

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Types phones and some apps send for any file they cannot name (WhatsApp, Drive, Files, older Excel). */
const UNKNOWN_DECLARED = new Set(['', 'application/octet-stream', 'application/vnd.ms-excel', 'application/x-zip-compressed', 'application/x-zip', 'application/msword', 'binary/octet-stream']);

/** Office files are zips whose entry names (stored as plain text) tell what they are. */
function officeType(buf: Buffer): string | null {
  if (buf.includes('xl/workbook.xml') || buf.includes('xl/worksheets/')) return XLSX;
  if (buf.includes('word/document.xml')) return DOCX;
  return null;
}

/**
 * Validates file content against its declared type using magic bytes. Returns the stored
 * mime type or null if the file is not an allowed type. Excel and Word files are recognised by their
 * content, because phones often declare them as "application/octet-stream" (or as old Excel), sometimes
 * without the file extension.
 */
export function detectAllowedType(buf: Buffer, declared: string, name: string, opts: { imagesOnly?: boolean } = {}): string | null {
  const sig = SIGNATURES.find((s) => s.test(buf));
  const lower = name.toLowerCase();
  if (sig) {
    if (opts.imagesOnly && !sig.mime.startsWith('image/')) return null;
    if (sig.mime === 'application/zip') {
      const office = officeType(buf);
      if (office) return office;
      const allowed = ALLOWED_DECLARED[sig.mime] ?? [];
      // A zip that does not look like an Office file is only accepted when declared as one (kept as before).
      if (allowed.includes(declared) && declared !== 'application/zip') return declared;
      if (declared === 'application/zip' || (UNKNOWN_DECLARED.has(declared) && (lower.endsWith('.xlsx') || lower.endsWith('.docx')))) return lower.endsWith('.docx') ? DOCX : lower.endsWith('.xlsx') ? XLSX : null;
      return null;
    }
    return sig.mime;
  }
  if (opts.imagesOnly) return null;
  // CSV / plain text: must decode as UTF-8 text without NUL bytes.
  const textual = declared === 'text/csv' || declared === 'text/plain' || declared === 'text/comma-separated-values' || lower.endsWith('.csv');
  if (textual && !buf.subarray(0, 4096).includes(0)) return declared === 'text/plain' && !lower.endsWith('.csv') ? 'text/plain' : 'text/csv';
  return null;
}
