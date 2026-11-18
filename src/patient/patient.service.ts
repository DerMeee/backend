import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PatientDocumentType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { patientDocumentUrl } from './patient-upload.config';
import { catchServiceError } from '../utils/catch-service-error';
import { PatientMeResponseDto } from './dto/patient-me-response.dto';
import { removeStoredFile, storageKeyOf } from '../storage/private-storage';
import type { RequestUser } from '../common/request-user';

const documentSelect = {
  id: true,
  patientId: true,
  fileUrl: true,
  fileName: true,
  mimeType: true,
  documentType: true,
  title: true,
  createdAt: true,
  updatedAt: true,
} as const;

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
      const id = randomUUID();
      return await this.prisma.patientDocument.create({
        data: {
          id,
          patientId,
          fileUrl: patientDocumentUrl(id),
          storageKey: storageKeyOf(file),
          fileName: file.originalname,
          mimeType: file.mimetype,
          documentType: data.documentType,
          title: data.title?.trim() || null,
        },
        select: documentSelect,
      });
    } catch (error) {
      catchServiceError(error);
    }
  }

  async listDocuments(patientId: string) {
    try {
      return await this.prisma.patientDocument.findMany({
        where: { patientId },
        orderBy: { createdAt: 'desc' },
        select: documentSelect,
      });
    } catch (error) {
      catchServiceError(error);
    }
  }

  /**
   * Who may read a patient's documents: the patient, an admin, or a doctor
   * who has at least one appointment with that patient.
   */
  async canReadPatientDocuments(
    user: RequestUser,
    patientId: string,
  ): Promise<boolean> {
    if (user.role === 'ADMIN') return true;
    if (user.role === 'PATIENT') {
      const patient = await this.prisma.patient.findUnique({
        where: { userId: user.userId },
        select: { id: true },
      });
      return patient?.id === patientId;
    }
    if (user.role === 'DOCTOR') {
      const shared = await this.prisma.appointment.findFirst({
        where: { patientId, doctor: { userId: user.userId } },
        select: { id: true },
      });
      return !!shared;
    }
    return false;
  }

  /**
   * For doctors: same document list as the patient sees, only if the doctor
   * shares at least one appointment with that patient.
   */
  async listDocumentsForDoctor(doctorUserId: string, patientId: string) {
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
        where: { doctorId: doctor.id, patientId },
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

      await this.prisma.patientDocument.delete({ where: { id: doc.id } });
      await removeStoredFile(doc.storageKey);
      return { deleted: true };
    } catch (error) {
      catchServiceError(error);
    }
  }
}
