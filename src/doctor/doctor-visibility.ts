import type { Prisma } from '@prisma/client';

/**
 * Single definition of "a doctor patients can see and book":
 * approved by Dermee and with an active (not suspended) account.
 */
export const publicDoctorUserWhere: Prisma.UserWhereInput = {
  role: 'DOCTOR',
  status: 'ACTIVE',
  doctorProfile: { is: { approvalStatus: 'APPROVED' } },
};

export const bookableDoctorWhere: Prisma.DoctorWhereInput = {
  approvalStatus: 'APPROVED',
  user: { status: 'ACTIVE' },
};
