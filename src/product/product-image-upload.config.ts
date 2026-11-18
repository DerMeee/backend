import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';

const SEGMENT = 'products';
const IMAGE_MIMES = /^image\/(jpeg|png|webp)$/;
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/** Product photos are public (shop pages): uploads/products/<productId>/<uuid>.<ext>. */
export function productImageMulterOptions() {
  return {
    storage: diskStorage({
      destination: (req: Request, _file, cb) => {
        try {
          const id = String(req.params.id ?? '');
          if (!/^[A-Za-z0-9_-]{1,40}$/.test(id))
            throw new BadRequestException('Invalid product id');
          const dir = join(process.cwd(), 'uploads', SEGMENT, id);
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        } catch (e) {
          cb(e as Error, '');
        }
      },
      filename: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        cb(
          null,
          `${randomUUID()}${/^\.(jpe?g|png|webp)$/.test(ext) ? ext : (EXT_BY_MIME[file.mimetype] ?? '')}`,
        );
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (
      _req: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, acceptFile: boolean) => void,
    ) => {
      if (!IMAGE_MIMES.test(file.mimetype)) {
        cb(
          new BadRequestException('Product images must be JPEG, PNG or WebP'),
          false,
        );
        return;
      }
      cb(null, true);
    },
  };
}

export function publicProductImagePath(productId: string, filename: string) {
  return `/uploads/${SEGMENT}/${productId}/${filename}`;
}
