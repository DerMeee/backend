import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-aut.guard';
import { CurrentUser } from '../auth/decorator/current-user.decorator';
import type { RequestUser } from '../common/request-user';
import { PrismaService } from '../prisma/prisma.service';
import { PatientService } from '../patient/patient.service';
import { resolveStoredFile } from './private-storage';

/**
 * Authenticated downloads for medical files. The client fetches these with the
 * Bearer token (e.g. fetch → blob → object URL), not with a plain <img>/<a> link.
 */
@ApiTags('files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patients: PatientService,
  ) {}

  @Get('patient-documents/:id')
  @ApiOperation({
    summary: 'Download a patient document (patient, linked doctor or admin)',
  })
  async patientDocument(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const doc = await this.prisma.patientDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    if (!(await this.patients.canReadPatientDocuments(user, doc.patientId))) {
      throw new ForbiddenException('You cannot access this document');
    }
    // Documents uploaded before private storage only have the old public path.
    const key = doc.storageKey ?? doc.fileUrl.replace(/^\/uploads\//, '');
    this.send(res, key, doc.fileName, doc.mimeType);
  }

  @Get('doctor-documents/:id')
  @ApiOperation({
    summary: 'Download a doctor verification document (owner doctor or admin)',
  })
  async doctorDocument(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ) {
    const doc = await this.prisma.doctorDocument.findUnique({
      where: { id },
      include: { doctor: { select: { userId: true } } },
    });
    if (!doc) throw new NotFoundException('Document not found');
    const allowed = user.role === 'ADMIN' || doc.doctor.userId === user.userId;
    if (!allowed)
      throw new ForbiddenException('You cannot access this document');
    this.send(res, doc.storageKey, doc.fileName, doc.mimeType);
  }

  private send(
    res: Response,
    key: string,
    fileName: string,
    mimeType: string | null,
  ) {
    const path = resolveStoredFile(key);
    if (!path) throw new NotFoundException('File is missing from storage');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    if (mimeType) res.type(mimeType);
    res.sendFile(path);
  }
}
