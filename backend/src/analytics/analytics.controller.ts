import { Controller, Get, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  // coordinator/admin: ?days=7|30|90|365 (leave out for all time)
  @Roles(Role.COORDINATOR, Role.ADMIN)
  @Get('overview')
  overview(@Query('days', new ParseIntPipe({ optional: true })) days?: number) {
    return this.analytics.overview(days);
  }

  // technician: their own performance only
  @Roles(Role.TECHNICIAN)
  @Get('me')
  me(@Req() req: any) {
    return this.analytics.technician(req.user.userId);
  }
}