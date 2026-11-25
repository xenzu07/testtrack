import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { DuplicatesService } from '../duplicates/duplicates.service';
import { PriorityService } from '../priority/priority.service';
import { DecideDuplicateDto, ReviewPriorityDto } from './dto/review.dto';
import { RoutingService } from './routing.service';

// Coordinator tools for Phase 5: the routing queue, technician
// recommendations, priority review/override and duplicate decisions.
// Paths under /reports/:id/... have more segments than /reports/:id, so they
// never clash with the existing report routes.
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.COORDINATOR, Role.ADMIN)
export class RoutingController {
  constructor(
    private routing: RoutingService,
    private priority: PriorityService,
    private duplicates: DuplicatesService,
  ) {}

  @Get('routing/queue')
  queue() {
    return this.routing.queue();
  }

  @Get('reports/:id/recommendation')
  recommendation(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('tradeUnitId', new ParseUUIDPipe({ optional: true }))
    tradeUnitId?: string,
  ) {
    return this.routing.recommendation(id, tradeUnitId);
  }

  @Get('reports/:id/priority')
  priorityDetails(@Param('id', ParseUUIDPipe) id: string) {
    return this.priority.details(id);
  }

  // action "confirm": agree with the automatic result
  // action "adjust": set a priority (or null = back to automatic) with a reason
  @Post('reports/:id/priority')
  @HttpCode(200)
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Body() dto: ReviewPriorityDto,
  ) {
    if (dto.action === 'confirm') {
      await this.priority.confirm(id, req.user.userId);
      return this.priority.details(id);
    }
    return this.priority.adjust(
      id,
      req.user.userId,
      dto.priority ?? null,
      dto.reason ?? '',
    );
  }

  @Get('reports/:id/duplicates')
  duplicatesFor(@Param('id', ParseUUIDPipe) id: string) {
    return this.duplicates.listFor(id);
  }

  @Post('reports/:id/duplicates/:flagId')
  @HttpCode(200)
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @Req() req: any,
    @Body() dto: DecideDuplicateDto,
  ) {
    return this.duplicates.decide(
      id,
      flagId,
      req.user.userId,
      dto.decision,
      dto.keepJobOrderId,
    );
  }

  @Post('reports/:id/unlink-duplicate')
  @HttpCode(200)
  unlink(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.duplicates.unlink(id, req.user.userId);
  }
}
