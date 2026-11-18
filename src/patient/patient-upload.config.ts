import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestWithPatient } from './patient-role.guard';
import { privateDocumentMulterOptions } from '../storage/private-storage';

/** Patient documents go to private storage: PRIVATE_ROOT/patient-files/<patientId>/. */
export function createPatientDocumentMulterOptions() {
  return privateDocumentMulterOptions((req: Request) => {
    const patient = (req as unknown as RequestWithPatient).patient;
    if (!patient?.id) {
      throw new BadRequestException('Patient context missing');
    }
    return `patient-files/${patient.id}`;
  });
}

/** Authenticated download URL stored in PatientDocument.fileUrl. */
export function patientDocumentUrl(documentId: string): string {
  return `/files/patient-documents/${documentId}`;
}
