import { PatientDocumentType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadPatientDocumentDto {
  @ApiProperty({ enum: PatientDocumentType, description: 'Category of the file' })
  @IsEnum(PatientDocumentType)
  documentType: PatientDocumentType;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Optional label shown in the UI',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
