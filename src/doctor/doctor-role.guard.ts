import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DoctorApprovalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type RequestWithDoctor = Express.Request & {
  doctor: { id: string; userId: string; approvalStatus: DoctorApprovalStatus };
};

/**
 * Requires a DOCTOR with a doctor profile and attaches it as `req.doctor`.
 * Does NOT require approval: pending doctors must be able to upload verification documents.
 */
@Injectable()
export class DoctorRoleGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithDoctor>();
    const user = req.user as { userId?: string; role?: string } | undefined;
    if (!user?.userId || user.role !== 'DOCTOR') {
      throw new ForbiddenException('Only doctors can access this resource');
    }
    const doctor = await this.prisma.doctor.findUnique({
      where: { userId: user.userId },
      select: { id: true, userId: true, approvalStatus: true },
    });
    if (!doctor) throw new ForbiddenException('Doctor profile not found');
    req.doctor = doctor;
    return true;
  }
}
