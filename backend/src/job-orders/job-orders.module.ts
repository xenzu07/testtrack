import { Module } from '@nestjs/common';
import { JobOrdersController } from './job-orders.controller';
import { JobOrdersService } from './job-orders.service';
import { TechniciansModule } from '../technicians/technicians.module';

@Module({
  imports: [TechniciansModule],
  controllers: [JobOrdersController],
  providers: [JobOrdersService],
})
export class JobOrdersModule {}