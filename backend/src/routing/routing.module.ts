import { Global, Module } from '@nestjs/common';
import { TechniciansModule } from '../technicians/technicians.module';
import { PriorityService } from '../priority/priority.service';
import { DuplicatesService } from '../duplicates/duplicates.service';
import { RoutingController } from './routing.controller';
import { RoutingService } from './routing.service';

// Priority scoring, duplicate detection and assignment recommendation live in
// their own folders (src/priority, src/duplicates, src/routing) and are
// provided here together; the services are exported so report creation can
// run detection and scoring.
@Global()
@Module({
  imports: [TechniciansModule],
  controllers: [RoutingController],
  providers: [PriorityService, DuplicatesService, RoutingService],
  exports: [PriorityService, DuplicatesService],
})
export class RoutingModule {}
