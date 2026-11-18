import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
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
} from '@nestjs/swagger';
import { DoctorDocumentType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-aut.guard';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorRoleGuard, type RequestWithDoctor } from './doctor-role.guard';
import {
  privateDocumentMulterOptions,
  removeStoredFile,
  storageKeyOf,
} from '../storage/private-storage';

export class UploadDoctorDocumentDto {
  @IsEnum(DoctorDocumentType)
  documentType: DoctorDocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

export const doctorDocumentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  size: true,
  documentType: true,
  title: true,
  createdAt: true,
} as const;

export function doctorDocumentUrl(id: string) {
  return `/files/doctor-documents/${id}`;
}

/** A doctor's own verification documents (license, diploma, ID). Reviewed by admins. */
@ApiTags('doctor-documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, DoctorRoleGuard)
@Controller('doctor/me/documents')
export class DoctorDocumentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'List my verification documents' })
  async list(@Req() req: RequestWithDoctor) {
    const docs = await this.prisma.doctorDocument.findMany({
      where: { doctorId: req.doctor.id },
      orderBy: { createdAt: 'desc' },
      select: doctorDocumentSelect,
    });
    return docs.map((d) => ({ ...d, url: doctorDocumentUrl(d.id) }));
  }

  @Post()
  @ApiOperation({
    summary:
      'Upload a verification document (PDF/JPEG/PNG/WebP/DOC/DOCX, 15 MB max)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        documentType: {
          type: 'string',
          enum: Object.values(DoctorDocumentType),
        },
        title: { type: 'string' },
      },
      required: ['file', 'documentType'],
    },
  })
  @UseInterceptors(
    FileInterceptor(
      'file',
      privateDocumentMulterOptions((req: Request) => {
        const doctor = (req as unknown as RequestWithDoctor).doctor;
        if (!doctor?.id)
          throw new BadRequestException('Doctor context missing');
        return `doctor-files/${doctor.id}`;
      }),
    ),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDoctorDocumentDto,
    @Req() req: RequestWithDoctor,
  ) {
    if (!file) throw new BadRequestException('File is required');
    try {
      const doc = await this.prisma.doctorDocument.create({
        data: {
          id: randomUUID(),
          doctorId: req.doctor.id,
          storageKey: storageKeyOf(file),
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          documentType: dto.documentType,
          title: dto.title?.trim() || null,
        },
        select: doctorDocumentSelect,
      });
      return { ...doc, url: doctorDocumentUrl(doc.id) };
    } catch (e) {
      await removeStoredFile(storageKeyOf(file));
      throw e;
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete one of my verification documents' })
  async remove(@Param('id') id: string, @Req() req: RequestWithDoctor) {
    const doc = await this.prisma.doctorDocument.findFirst({
      where: { id, doctorId: req.doctor.id },
    });
    if (!doc) throw new NotFoundException('Document not found');
    await this.prisma.doctorDocument.delete({ where: { id } });
    await removeStoredFile(doc.storageKey);
    return { deleted: true };
  }
}
