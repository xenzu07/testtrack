import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ReportsModule } from './reports/reports.module';
import { JobOrdersModule } from './job-orders/job-orders.module';
import { EventsModule } from './events/events.module';
import { UsersModule } from './users/users.module';
import { StorageModule } from './storage/storage.module';
import { TechniciansModule } from './technicians/technicians.module';
import { RoutingModule } from './routing/routing.module';
import { FormsModule } from './forms/forms.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
    AuthModule,
    ReportsModule,
    JobOrdersModule,
    EventsModule,
    UsersModule,
    TechniciansModule,
    RoutingModule,
    FormsModule,
    AnalyticsModule,
  ],
})
export class AppModule {}