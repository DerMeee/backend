import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { LoggingMiddleware } from './middlewares/logging.middleware';
import { AppointmentModule } from './appointment/appointment.module';
import { DoctorModule } from './doctor/doctor.module';
import { ProductModule } from './product/product.module';
import { CartModule } from './cart/cart.module';
import { OrderModule } from './order/order.module';
import { MessagesModule } from './messages/messages.module';
import { PatientModule } from './patient/patient.module';
import { UserModule } from './user/user.module';
import { AuditModule } from './audit/audit.module';
import { HealthController } from './health/health.controller';
import { FilesModule } from './storage/files.module';
import { RealtimeModule } from './realtime/realtime.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { ScheduleModule } from '@nestjs/schedule';
import { InventoryModule } from './inventory/inventory.module';
import { ImpersonationModule } from './impersonation/impersonation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RealtimeModule,
    AuditModule,
    AuthModule,
    AppointmentModule,
    DoctorModule,
    ProductModule,
    CartModule,
    OrderModule,
    MessagesModule,
    PatientModule,
    UserModule,
    FilesModule,
    NotificationsModule,
    InventoryModule,
    ImpersonationModule,
    AdminModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
