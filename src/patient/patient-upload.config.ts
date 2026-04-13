import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { join, extname } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { RequestWithPatient } from './patient-role.guard';

const UPLOAD_SEGMENT = 'patient-files';

function patientDir(req: Request): string {
  const patient = (req as unknown as RequestWithPatient).patient;
  if (!patient?.id) {
    throw new BadRequestException('Patient context missing');
  }
  return join(process.cwd(), 'uploads', UPLOAD_SEGMENT, patient.id);
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      '.docx',
  };
  return map[mime] ?? '';
}

const documentMimes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export function createPatientDocumentMulterOptions() {
  return {
    storage: diskStorage({
      destination: (req, _file, cb) => {
        try {
          const dir = patientDir(req);
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        } catch (e) {
          cb(e as Error, '');
        }
      },
      filename: (_req, file, cb) => {
        const ext =
          extname(file.originalname).toLowerCase() || extFromMime(file.mimetype);
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (
      _req: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, acceptFile: boolean) => void,
    ) => {
      if (!documentMimes.has(file.mimetype)) {
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

export function publicFilePath(patientId: string, filename: string): string {
  return `/uploads/${UPLOAD_SEGMENT}/${patientId}/${filename}`;
}
