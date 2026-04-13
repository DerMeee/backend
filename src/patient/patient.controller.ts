import {

  BadRequestException,

  Body,

  Controller,

  Delete,

  Get,

  Param,

  Post,

  Req,

  UploadedFile,

  UseGuards,

  UseInterceptors,

} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import {

  ApiBearerAuth,

  ApiBody,

  ApiConsumes,

  ApiOperation,

  ApiTags,

  ApiUnauthorizedResponse,

  ApiForbiddenResponse,

  ApiOkResponse,

} from '@nestjs/swagger';

import { unlink } from 'fs/promises';

import { JwtAuthGuard } from '../auth/guards/jwt-aut.guard';

import { CurrentUser } from '../auth/decorator/current-user.decorator';

import { UserPayload } from '../auth/dto/user-payload.dto';

import { PatientService } from './patient.service';

import { PatientRoleGuard } from './patient-role.guard';

import type { RequestWithPatient } from './patient-role.guard';

import { createPatientDocumentMulterOptions } from './patient-upload.config';

import { UploadPatientDocumentDto } from './dto/upload-patient-document.dto';

import { PatientMeResponseDto } from './dto/patient-me-response.dto';



@ApiTags('patients')

@ApiBearerAuth()

@UseGuards(JwtAuthGuard, PatientRoleGuard)

@Controller('patients')

export class PatientController {

  constructor(private readonly patientService: PatientService) {}



  @Get('me')

  @ApiOperation({

    summary: 'Current patient profile',

    description:

      'Returns patient id, createdAt, nested user fields, and profilePictureUrl from the linked User (same avatar as doctors: see POST /users/me/profile-picture).',

  })

  @ApiOkResponse({

    description: 'Patient profile',

    type: PatientMeResponseDto,

  })

  @ApiUnauthorizedResponse({ description: 'Unauthorized' })

  @ApiForbiddenResponse({ description: 'Not a patient' })

  getMe(@CurrentUser() user: UserPayload): Promise<PatientMeResponseDto> {

    return this.patientService.getMe(user.userId);

  }



  @Post('me/documents')

  @ApiOperation({ summary: 'Upload a document (prescription, lab, etc.)' })

  @ApiConsumes('multipart/form-data')

  @ApiBody({

    schema: {

      type: 'object',

      properties: {

        file: { type: 'string', format: 'binary' },

        documentType: {

          type: 'string',

          enum: [

            'PRESCRIPTION',

            'LAB_RESULT',

            'MEDICAL_REPORT',

            'INSURANCE',

            'OTHER',

          ],

        },

        title: { type: 'string' },

      },

      required: ['file', 'documentType'],

    },

  })

  @ApiUnauthorizedResponse({ description: 'Unauthorized' })

  @ApiForbiddenResponse({ description: 'Not a patient' })

  @UseInterceptors(FileInterceptor('file', createPatientDocumentMulterOptions()))

  async uploadDocument(

    @UploadedFile() file: Express.Multer.File,

    @Body() dto: UploadPatientDocumentDto,

    @Req() req: RequestWithPatient,

  ) {

    if (!file) {

      throw new BadRequestException('File is required');

    }

    try {

      return await this.patientService.addDocument(req.patient.id, file, dto);

    } catch (e) {

      if (file.path) {

        await unlink(file.path).catch(() => undefined);

      }

      throw e;

    }

  }



  @Get('me/documents')

  @ApiOperation({
    summary: 'List your uploaded documents',
    description:
      'Patients only. Doctors list another patient’s files via GET /doctor/patients/{patientId}/documents (requires a shared appointment).',
  })

  @ApiUnauthorizedResponse({ description: 'Unauthorized' })

  @ApiForbiddenResponse({ description: 'Not a patient' })

  listDocuments(@Req() req: RequestWithPatient) {

    return this.patientService.listDocuments(req.patient.id);

  }



  @Delete('me/documents/:id')

  @ApiOperation({ summary: 'Delete an uploaded document' })

  @ApiUnauthorizedResponse({ description: 'Unauthorized' })

  @ApiForbiddenResponse({ description: 'Not a patient' })

  deleteDocument(

    @Param('id') id: string,

    @CurrentUser() user: UserPayload,

  ) {

    return this.patientService.removeDocument(user.userId, id);

  }

}


