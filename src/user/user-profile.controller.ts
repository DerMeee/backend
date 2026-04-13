import {
  BadRequestException,
  Controller,
  Delete,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { unlink } from 'fs/promises';
import { JwtAuthGuard } from '../auth/guards/jwt-aut.guard';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import { UserPayload } from '../auth/dto/user-payload.dto';
import { UserProfileService } from './user-profile.service';
import { createUserProfilePictureMulterOptions } from './user-profile-upload.config';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserProfileController {
  constructor(private readonly userProfileService: UserProfileService) {}

  @Post('me/profile-picture')
  @ApiOperation({
    summary: 'Upload or replace profile picture',
    description:
      'Available to any authenticated user (patient, doctor, or admin). Stores the URL on the User record.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'Image file' },
      },
      required: ['file'],
    },
  })
  @ApiOkResponse({
    description: 'New profile picture URL path',
    schema: {
      type: 'object',
      properties: {
        profilePictureUrl: {
          type: 'string',
          example: '/uploads/profile-pictures/clxxx/profile.jpg',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @UseInterceptors(
    FileInterceptor('file', createUserProfilePictureMulterOptions()),
  )
  async uploadProfilePicture(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: UserPayload,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    try {
      return await this.userProfileService.setProfilePictureFromUpload(
        user.userId,
        file,
      );
    } catch (e) {
      if (file.path) {
        await unlink(file.path).catch(() => undefined);
      }
      throw e;
    }
  }

  @Delete('me/profile-picture')
  @ApiOperation({ summary: 'Remove profile picture' })
  @ApiOkResponse({
    description: 'Profile picture cleared',
    schema: {
      type: 'object',
      properties: { profilePictureUrl: { type: 'string', nullable: true } },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  removeProfilePicture(
    @CurrentUser() user: UserPayload,
  ): Promise<{ profilePictureUrl: string | null }> {
    return this.userProfileService.removeProfilePicture(user.userId);
  }
}
