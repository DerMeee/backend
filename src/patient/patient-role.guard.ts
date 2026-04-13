import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type RequestWithPatient = Express.Request & {
  patient: { id: string; userId: string };
};

@Injectable()
export class PatientRoleGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithPatient>();
    const user = req.user as { userId?: string; role?: string } | undefined;

    if (!user?.userId || user.role !== 'PATIENT') {
      throw new ForbiddenException('Only patients can access this resource');
    }

    const patient = await this.prisma.patient.findUnique({
      where: { userId: user.userId },
      select: { id: true, userId: true },
    });

    if (!patient) {
      throw new ForbiddenException('Patient profile not found');
    }

    req.patient = patient;
    return true;
  }
}
