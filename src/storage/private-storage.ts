import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import {
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'path';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

/**
 * Medical files (patient documents, doctor verification documents) are written here,
 * never under the public /uploads folder. They are only served by FilesController
 * after a permission check.
 */
export const PRIVATE_ROOT = resolve(process.cwd(), 'private');

/** Old public folder. Patient files uploaded before private storage may still be here. */
export const LEGACY_PUBLIC_ROOT = resolve(process.cwd(), 'uploads');

export const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    '.docx',
};

function safeExt(file: Express.Multer.File): string {
  const ext = extname(file.originalname).toLowerCase();
  // Only keep short alphanumeric extensions; fall back to the one implied by the MIME type.
  return /^\.[a-z0-9]{1,5}$/.test(ext)
    ? ext
    : (EXT_BY_MIME[file.mimetype] ?? '');
}

/** Resolves `key` inside `root`, refusing anything that escapes it (path traversal). */
function within(root: string, key: string): string | null {
  if (!key || isAbsolute(key)) return null;
  const full = resolve(root, normalize(key));
  const rel = relative(root, full);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return full;
}

/** Absolute path of a stored file, or null if missing. Checks private storage, then the legacy folder. */
export function resolveStoredFile(key: string): string | null {
  for (const root of [PRIVATE_ROOT, LEGACY_PUBLIC_ROOT]) {
    const full = within(root, key);
    if (full && existsSync(full)) return full;
  }
  return null;
}

export async function removeStoredFile(
  key: string | null | undefined,
): Promise<void> {
  if (!key) return;
  const full = resolveStoredFile(key);
  if (full) await unlink(full).catch(() => undefined);
}

/** Storage key (path relative to PRIVATE_ROOT, forward slashes) of a file multer just wrote. */
export function storageKeyOf(file: Express.Multer.File): string {
  return relative(PRIVATE_ROOT, file.path).split(sep).join('/');
}

/**
 * Multer options writing into PRIVATE_ROOT/<folder(req)>/<uuid>.<ext>.
 * `folder` must return a path built from trusted ids only.
 */
export function privateDocumentMulterOptions(folder: (req: Request) => string) {
  return {
    storage: diskStorage({
      destination: (req, _file, cb) => {
        try {
          const dir = join(PRIVATE_ROOT, folder(req));
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        } catch (e) {
          cb(e as Error, '');
        }
      },
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${safeExt(file)}`),
    }),
    limits: { fileSize: 15 * 1024 * 1024, files: 1 },
    fileFilter: (
      _req: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, acceptFile: boolean) => void,
    ) => {
      if (!DOCUMENT_MIME_TYPES.has(file.mimetype)) {
        cb(
          new BadRequestException(
            'Allowed document types: PDF, JPEG, PNG, WebP, DOC, DOCX',
          ),
          false,
        );
        return;
      }
      cb(null, true);
    },
  };
}
