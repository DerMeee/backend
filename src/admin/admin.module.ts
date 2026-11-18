import { Module } from '@nestjs/common';
import { AdminStatsController } from './stats/admin-stats.controller';
import { AdminStatsService } from './stats/admin-stats.service';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminClientsController } from './clients/admin-clients.controller';
import { AdminClientsService } from './clients/admin-clients.service';
import { AdminDoctorsController } from './doctors/admin-doctors.controller';
import { AdminDoctorsService } from './doctors/admin-doctors.service';
import { AccountStatusService } from './accounts/account-status.service';
import { AdminReservationsController } from './reservations/admin-reservations.controller';
import { AdminReservationsService } from './reservations/admin-reservations.service';
import { ReservationAlertsJob } from './reservations/reservation-alerts.job';
import { AppointmentModule } from '../appointment/appointment.module';

/** Back-office endpoints under /admin/*. Every controller is ADMIN-only (see @AdminAccess). */
@Module({
  imports: [AppointmentModule],
  controllers: [
    AdminStatsController,
    AdminUsersController,
    AdminClientsController,
    AdminDoctorsController,
    AdminReservationsController,
  ],
  providers: [
    AdminStatsService,
    AdminUsersService,
    AdminClientsService,
    AdminDoctorsService,
    AccountStatusService,
    AdminReservationsService,
    ReservationAlertsJob,
  ],
  exports: [AccountStatusService],
})
export class AdminModule {}
