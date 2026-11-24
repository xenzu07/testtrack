import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ReportsModule } from './reports/reports.module';
import { JobOrdersModule } from './job-orders/job-orders.module';
import { EventsModule } from './events/events.module';
import { UsersModule } from './users/users.module';
import { AnalyticsModule } from './analytics/analytics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ReportsModule,
    JobOrdersModule,
    EventsModule,
    UsersModule,
    AnalyticsModule, // <-- add
  ],
})
export class AppModule {}