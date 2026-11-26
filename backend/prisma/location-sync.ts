import { PrismaClient } from '@prisma/client';
import { LOCATIONS, RETIRED_BUILDINGS } from './locations-data';

export interface SyncSummary {
  created: string[];
  alreadyPresent: number;
  reactivated: string[];
  deleted: string[];
  retired: { location: string; reports: number }[];
  // retired on an earlier run (already inactive): nothing to do
  alreadyRetired: { location: string; reports: number }[];
  untouched: string[];
}

const label = (l: { building: string; floor: string; room: string }) => `${l.building} / ${l.floor} / ${l.room}`;

// Brings the Location table in line with locations-data.ts:
// - every listed location exists and is active;
// - locations in RETIRED_BUILDINGS are deleted when no report uses them, and
//   kept but set inactive when one does (reports are never touched);
// - any other location is left as it is.
// With apply: false nothing is written; the summary says what would happen.
// Running it again after an apply changes nothing.
export async function syncLocations(prisma: PrismaClient, { apply }: { apply: boolean }): Promise<SyncSummary> {
  const existing = await prisma.location.findMany({
    select: { id: true, building: true, floor: true, room: true, isActive: true, _count: { select: { reports: true } } },
  });
  const byKey = new Map(existing.map((l) => [label(l), l]));
  const targetKeys = new Set(LOCATIONS.map(label));

  const summary: SyncSummary = {
    created: [],
    alreadyPresent: 0,
    reactivated: [],
    deleted: [],
    retired: [],
    alreadyRetired: [],
    untouched: [],
  };
  const toCreate = LOCATIONS.filter((t) => !byKey.has(label(t)));
  const toReactivate = LOCATIONS.map((t) => byKey.get(label(t))).filter((l) => l && !l.isActive) as typeof existing;
  summary.created = toCreate.map(label);
  summary.reactivated = toReactivate.map(label);
  summary.alreadyPresent = LOCATIONS.length - toCreate.length - toReactivate.length;

  const toDelete: string[] = [];
  const toRetire: string[] = [];
  for (const l of existing) {
    if (targetKeys.has(label(l))) continue;
    if (RETIRED_BUILDINGS.includes(l.building)) {
      if (l._count.reports === 0) {
        toDelete.push(l.id);
        summary.deleted.push(label(l));
      } else if (l.isActive) {
        toRetire.push(l.id);
        summary.retired.push({ location: label(l), reports: l._count.reports });
      } else {
        summary.alreadyRetired.push({ location: label(l), reports: l._count.reports });
      }
    } else {
      summary.untouched.push(label(l));
    }
  }

  if (apply && (toCreate.length || toReactivate.length || toDelete.length || toRetire.length)) {
    await prisma.$transaction(async (tx) => {
      for (const t of toCreate) {
        await tx.location.upsert({
          where: { building_floor_room: t },
          create: { ...t, isActive: true },
          update: { isActive: true },
        });
      }
      if (toReactivate.length) {
        await tx.location.updateMany({ where: { id: { in: toReactivate.map((l) => l.id) } }, data: { isActive: true } });
      }
      if (toRetire.length) {
        await tx.location.updateMany({ where: { id: { in: toRetire } }, data: { isActive: false } });
      }
      if (toDelete.length) {
        // re-checked inside the transaction: never delete a location a report uses
        await tx.location.deleteMany({ where: { id: { in: toDelete }, reports: { none: {} } } });
      }
    }, { timeout: 60_000 });
  }
  return summary;
}

export function printSummary(s: SyncSummary, apply: boolean) {
  const verb = apply ? '' : 'would be ';
  console.log(`Target list: ${LOCATIONS.length} locations`);
  console.log(`  ${verb}created:        ${s.created.length}`);
  console.log(`  already present:    ${s.alreadyPresent}`);
  console.log(`  ${verb}reactivated:    ${s.reactivated.length}`);
  console.log(`  ${verb}deleted:        ${s.deleted.length}${s.deleted.length ? `  (${s.deleted.join('; ')})` : ''}`);
  console.log(
    `  ${verb}retired (kept, inactive because reports use them): ${s.retired.length}` +
      (s.retired.length ? `  (${s.retired.map((r) => `${r.location}: ${r.reports} report(s)`).join('; ')})` : ''),
  );
  if (s.alreadyRetired.length) console.log(`  already retired earlier: ${s.alreadyRetired.length}`);
  console.log(`  untouched other locations: ${s.untouched.length}${s.untouched.length ? `  (${s.untouched.join('; ')})` : ''}`);
  const changes = s.created.length + s.reactivated.length + s.deleted.length + s.retired.length;
  if (changes === 0) console.log('No changes: the locations already match the list.');
}
