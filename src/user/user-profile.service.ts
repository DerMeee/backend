import { BadRequestException, Injectable } from '@nestjs/common';
import { readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { catchServiceError } from '../utils/catch-service-error';
import { publicUserProfilePicturePath } from './user-profile-upload.config';

const PROFILE_FILES_ROOT = join(process.cwd(), 'uploads', 'profile-pictures');

@Injectable()
export class UserProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async setProfilePictureFromUpload(
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ profilePictureUrl: string }> {
    try {
      if (!file) {
        throw new BadRequestException('File is required');
      }

      const url = publicUserProfilePicturePath(userId, file.filename);

      await this.prisma.user.update({
        where: { id: userId },
        data: { profilePictureUrl: url },
      });

      await this.removeOtherProfileVariants(userId, file.filename);
      return { profilePictureUrl: url };
    } catch (error) {
      catchServiceError(error);
    }
  }

  private async removeOtherProfileVariants(
    userId: string,
    keepFilename: string,
  ): Promise<void> {
    const dir = join(PROFILE_FILES_ROOT, userId);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return;
    }
    for (const name of files) {
      if (name.startsWith('profile.') && name !== keepFilename) {
        await unlink(join(dir, name)).catch(() => undefined);
      }
    }
  }

  async removeProfilePicture(
    userId: string,
  ): Promise<{ profilePictureUrl: string | null }> {
    try {
      const dir = join(PROFILE_FILES_ROOT, userId);
      try {
        const files = await readdir(dir);
        for (const name of files) {
          if (name.startsWith('profile.')) {
            await unlink(join(dir, name)).catch(() => undefined);
          }
        }
      } catch {
        // directory may not exist
      }

      await this.prisma.user.update({
        where: { id: userId },
        data: { profilePictureUrl: null },
      });

      return { profilePictureUrl: null };
    } catch (error) {
      catchServiceError(error);
    }
  }
}
