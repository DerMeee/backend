import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_IMPERSONATION = 'allowDuringImpersonation';

/** Lets a write route run with an impersonation token (only "end impersonation" needs it). */
export const AllowDuringImpersonation = () =>
  SetMetadata(ALLOW_DURING_IMPERSONATION, true);
