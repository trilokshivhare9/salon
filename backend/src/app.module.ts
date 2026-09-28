import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
// Core & Infrastructure
import { AuthModule } from './modules/core/auth/auth.module';
import { HealthModule } from './modules/core/health/health.module';

// Super Admin Domain
import { MasterCategoriesModule } from './modules/super-admin/master-categories/master-categories.module';
import { ErrorLogModule } from './modules/super-admin/error-logs/error-log.module';

// Salon Admin Domain
import { SalonsModule } from './modules/salon-admin/salons/salons.module';
import { StaffModule } from './modules/salon-admin/staff/staff.module';
import { ServicesModule } from './modules/salon-admin/services/services.module';
import { AvailabilityModule } from './modules/salon-admin/availability/availability.module';
import { AppointmentsModule } from './modules/salon-admin/appointments/appointments.module';
import { CustomersModule } from './modules/salon-admin/customers/customers.module';
import { ReportsModule } from './modules/salon-admin/reports/reports.module';
import { QuickBookingModule } from './modules/salon-admin/quick-booking/quick-booking.module';

// Customer Channels
import { WhatsAppModule } from './modules/channels/whatsapp/whatsapp.module';
import { BookingModule } from './modules/channels/booking/booking.module';

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

    // Core & Infrastructure
    AuthModule,
    HealthModule,

    // Super Admin Domain
    MasterCategoriesModule,
    ErrorLogModule,

    // Salon Admin Domain
    SalonsModule,
    StaffModule,
    ServicesModule,
    AvailabilityModule,
    AppointmentsModule,
    CustomersModule,
    ReportsModule,
    QuickBookingModule,

    // Customer Channels
    WhatsAppModule,
    BookingModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
