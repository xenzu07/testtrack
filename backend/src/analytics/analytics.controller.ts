import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AnalyticsService } from './analytics.service';
import { OverviewQueryDto, RangeQueryDto } from './dto/analytics-query.dto';

// Who can see what:
//   technicians  only their own performance (/analytics/me)
//   coordinators/admins  everything
//   reporters    nothing
@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Roles(Role.TECHNICIAN)
  @Get('me')
  me(@Req() req: any, @Query() q: RangeQueryDto) {
    return this.analytics.technicianStats(req.user.userId, q, req.user);
  }

  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Get('overview')
  overview(@Query() q: OverviewQueryDto) {
    return this.analytics.overview(q);
  }

  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Get('technicians/:id')
  technician(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any,
    @Query() q: RangeQueryDto,
  ) {
    return this.analytics.technicianStats(id, q, req.user);
  }
}
