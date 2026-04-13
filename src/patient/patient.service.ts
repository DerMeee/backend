import {

  BadRequestException,

  ForbiddenException,

  Injectable,

  NotFoundException,

} from '@nestjs/common';

import { PatientDocumentType } from '@prisma/client';

import { unlink } from 'fs/promises';

import { join } from 'path';

import { PrismaService } from '../prisma/prisma.service';

import { publicFilePath } from './patient-upload.config';

import { catchServiceError } from '../utils/catch-service-error';
import { PatientMeResponseDto } from './dto/patient-me-response.dto';



@Injectable()

export class PatientService {

  constructor(private readonly prisma: PrismaService) {}



  async getMe(userId: string): Promise<PatientMeResponseDto> {
    try {
      const patient = await this.prisma.patient.findUnique({
        where: { userId },
        select: {
          id: true,
          createdAt: true,
          user: {
            select: {
              name: true,
              email: true,
              phoneNumber: true,
              profilePictureUrl: true,
            },
          },
        },
      });

      if (!patient) {
        throw new ForbiddenException('Patient profile not found');
      }

      return {
        id: patient.id,
        profilePictureUrl: patient.user.profilePictureUrl,
        createdAt: patient.createdAt,
        user: {
          name: patient.user.name,
          email: patient.user.email,
          phoneNumber: patient.user.phoneNumber,
        },
      };
    } catch (error) {
      catchServiceError(error);
    }
  }

  async addDocument(

    patientId: string,

    file: Express.Multer.File,

    data: { documentType: PatientDocumentType; title?: string },

  ) {

    try {

      if (!file) {

        throw new BadRequestException('File is required');

      }



      const url = publicFilePath(patientId, file.filename);



      return this.prisma.patientDocument.create({

        data: {

          patientId,

          fileUrl: url,

          fileName: file.originalname,

          mimeType: file.mimetype,

          documentType: data.documentType,

          title: data.title?.trim() || null,

        },

      });

    } catch (error) {

      catchServiceError(error);

    }

  }



  async listDocuments(patientId: string) {

    try {

      return this.prisma.patientDocument.findMany({

        where: { patientId },

        orderBy: { createdAt: 'desc' },

      });

    } catch (error) {

      catchServiceError(error);

    }

  }

  /**
   * For doctors: same document list as the patient sees, only if the doctor
   * shares at least one appointment with that patient.
   */
  async listDocumentsForDoctor(
    doctorUserId: string,
    patientId: string,
  ) {
    try {
      const patient = await this.prisma.patient.findUnique({
        where: { id: patientId },
        select: { id: true },
      });
      if (!patient) {
        throw new NotFoundException('Patient not found');
      }

      const doctor = await this.prisma.doctor.findUnique({
        where: { userId: doctorUserId },
        select: { id: true },
      });
      if (!doctor) {
        throw new ForbiddenException(
          'Only doctors can list another patient’s documents this way',
        );
      }

      const hasSharedAppointment = await this.prisma.appointment.findFirst({
        where: {
          doctorId: doctor.id,
          patientId,
        },
        select: { id: true },
      });
      if (!hasSharedAppointment) {
        throw new ForbiddenException(
          'You can only view documents for patients you have appointments with',
        );
      }

      return this.listDocuments(patientId);
    } catch (error) {
      catchServiceError(error);
    }
  }



  async removeDocument(userId: string, documentId: string) {

    try {

      const patient = await this.prisma.patient.findUnique({

        where: { userId },

        select: { id: true },

      });

      if (!patient) {

        throw new ForbiddenException('Patient profile not found');

      }



      const doc = await this.prisma.patientDocument.findFirst({

        where: { id: documentId, patientId: patient.id },

      });



      if (!doc) {

        throw new NotFoundException('Document not found');

      }



      const relative = doc.fileUrl.replace(/^\//, '');

      const diskPath = join(process.cwd(), relative);

      await unlink(diskPath).catch(() => undefined);



      await this.prisma.patientDocument.delete({ where: { id: doc.id } });

      return { deleted: true };

    } catch (error) {

      catchServiceError(error);

    }

  }

}

