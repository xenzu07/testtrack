// Scores existing reports and looks for duplicates among the open ones,
// using exactly the same code as new reports.
//
//   npm run priority:backfill -- --dry-run   # show what would change
//   npm run priority:backfill
//
// Safe to re-run: scores are recomputed from current data, manual
// priorities set by coordinators are kept, and duplicate decisions already
// made are never reopened.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Status } from '@prisma/client';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PriorityService } from '../src/priority/priority.service';
import { DuplicatesService } from '../src/duplicates/duplicates.service';
import { scorePriority } from '../src/priority/priority-scoring';
import { EventsGateway } from '../src/events/events.gateway';
import { NotificationsService } from '../src/notifications/notifications.service';

// Re-scoring old data must not message anyone: live updates and
// notifications are replaced by silent stand-ins.
const silent = {
  statusChanged: () => undefined,
  notification: () => undefined,
  emit: () => undefined,
  emitPriorityReview: () => undefined,
};

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  providers: [
    PriorityService,
    DuplicatesService,
    { provide: EventsGateway, useValue: silent },
    { provide: NotificationsService, useValue: silent },
  ],
})
class BackfillModule {}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const priority = app.get(PriorityService);
  const duplicates = app.get(DuplicatesService);

  // oldest first, so each report is compared with the ones before it
  const reports = await prisma.report.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      affectedPeople: true,
      safetyHazard: true,
      blocksUse: true,
      priority: true,
      category: { select: { name: true, severity: true } },
    },
  });
  console.log(`${reports.length} report(s)${dryRun ? ' (dry run: nothing will change)' : ''}`);

  let flagged = 0;
  for (const r of reports) {
    if (dryRun) {
      const res = scorePriority({
        categorySeverity: r.category.severity,
        affectedPeople: r.affectedPeople,
        safetyHazard: r.safetyHazard,
        blocksUse: r.blocksUse,
        corroboratingReports: 0,
      });
      console.log(
        `  ${r.id.slice(0, 8)} ${r.category.name.padEnd(24)} ${r.status.padEnd(12)} -> ${res.level} (${res.score})` +
          (res.flags.length ? `  flags: ${res.flags.join(', ')}` : ''),
      );
      continue;
    }
    if (r.status !== Status.CLOSED) flagged += await duplicates.detectFor(r.id);
    await priority.recalculate(r.id);
  }

  if (!dryRun) {
    // duplicate links change the score of the original, so score everything once more
    for (const r of reports) await priority.recalculate(r.id);
    const summary = await prisma.report.groupBy({ by: ['priority'], _count: { _all: true } });
    console.log(
      'Done. Priorities:',
      summary.map((s) => `${s.priority ?? 'none'}=${s._count._all}`).join(' '),
      `| possible duplicate flags found: ${flagged}`,
    );
  }
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
