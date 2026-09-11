import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { SalonsModule } from './modules/salons/salons.module';
import { StaffModule } from './modules/staff/staff.module';
import { ServicesModule } from './modules/services/services.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { BookingModule } from './modules/booking/booking.module';
import { CustomersModule } from './modules/customers/customers.module';
import { ReportsModule } from './modules/reports/reports.module';
import { HealthModule } from './modules/health/health.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { MasterCategoriesModule } from './modules/master-categories/master-categories.module';
import { ErrorLogModule } from './modules/error-logs/error-log.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV || 'development'}`,
        '.env.development',
        '.env.local',
        '.env',
      ],
      load: [configuration],
    }),
    DatabaseModule,
    ErrorLogModule,
    AuthModule,
    SalonsModule,
    StaffModule,
    ServicesModule,
    AvailabilityModule,
    AppointmentsModule,
    BookingModule,
    CustomersModule,
    ReportsModule,
    HealthModule,
    WhatsAppModule,
    MasterCategoriesModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
