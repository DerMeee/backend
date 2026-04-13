import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { join, extname } from 'path';
import { mkdirSync } from 'fs';
import type { Request } from 'express';

const SEGMENT = 'profile-pictures';

type RequestWithJwtUser = Request & {
  user?: { userId?: string; id?: string };
};

function userProfileDir(req: Request): string {
  const u = (req as RequestWithJwtUser).user;
  const userId = u?.userId ?? u?.id;
  if (!userId) {
    throw new BadRequestException('User context missing');
  }
  return join(process.cwd(), 'uploads', SEGMENT, userId);
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
  };
  return map[mime] ?? '';
}

const profileImageMimes = /^image\/(jpeg|png|gif|webp)$/;

export function createUserProfilePictureMulterOptions() {
  return {
    storage: diskStorage({
      destination: (req, _file, cb) => {
        try {
          const dir = userProfileDir(req);
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        } catch (e) {
          cb(e as Error, '');
        }
      },
      filename: (_req, file, cb) => {
        const ext =
          extname(file.originalname).toLowerCase() || extFromMime(file.mimetype);
        cb(null, `profile${ext}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (
      _req: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, acceptFile: boolean) => void,
    ) => {
      if (!profileImageMimes.test(file.mimetype)) {
        cb(
          new BadRequestException(
            'Only JPEG, PNG, WebP or GIF images are allowed for profile pictures',
          ),
          false,
        );
        return;
      }
      cb(null, true);
    },
  };
}

export function publicUserProfilePicturePath(userId: string, filename: string): string {
  return `/uploads/${SEGMENT}/${userId}/${filename}`;
}
