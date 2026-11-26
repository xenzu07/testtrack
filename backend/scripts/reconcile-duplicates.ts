// Brings reports that were linked as duplicates BEFORE the "one problem = one
// job order" rule in line with it, using exactly the same code as the
// coordinator's "Same problem" action:
//   - if both linked reports have an open job order, the one further along is
//     kept and the other is cancelled as merged (never deleted)
//   - linked reports get the main report's status
//
//   npm run duplicates:reconcile -- --dry-run   # show what would change
//   npm run duplicates:reconcile
//
// Safe to re-run: pairs that already follow the rule are left alone.
import { PrismaClient, Status } from '@prisma/client';
import { chooseKeptJob, linkSameProblem, moveOpenFlagsToMain } from '../src/duplicates/report-links';

try {
  process.loadEnvFile();
} catch {
  // no .env file: variables come from the environment
}

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  // the earliest coordinator account is recorded as the one making the change
  const actor = await prisma.user.findFirst({
    where: { role: { in: ['COORDINATOR', 'ADMIN'] }, isActive: true },
    orderBy: { role: 'asc' },
    select: { id: true, fullName: true },
  });
  if (!actor) throw new Error('No active coordinator or admin account found');

  const jobSel = { id: true, jobOrderNo: true, status: true, assignmentStatus: true, technicianId: true };
  const copies = await prisma.report.findMany({
    where: { duplicateOfId: { not: null } },
    select: {
      id: true,
      createdAt: true,
      status: true,
      description: true,
      jobOrder: { select: jobSel },
      duplicateOf: { select: { id: true, createdAt: true, status: true, jobOrder: { select: jobSel } } },
    },
  });

  console.log(`${copies.length} linked report(s)${dryRun ? ' (dry run: nothing will change)' : ''}; acting as ${actor.fullName}`);
  let changed = 0;
  for (const c of copies) {
    const main = c.duplicateOf!;
    const cj = c.jobOrder && c.jobOrder.status !== Status.CANCELLED ? c.jobOrder : null;
    const mj = main.jobOrder && main.jobOrder.status !== Status.CANCELLED ? main.jobOrder : null;
    const label = `"${c.description.slice(0, 40)}"`;

    // linked reports are closed; one with no job order of its own is in line
    if (!cj && c.status === Status.CLOSED) continue;

    if (cj && mj) {
      const olderIsMain = main.createdAt <= c.createdAt;
      try {
        const { keep, drop } = chooseKeptJob(olderIsMain ? mj : cj, olderIsMain ? cj : mj);
        console.log(`  ${label}: two job orders -> keep ${keep.jobOrderNo} (${keep.status}), cancel ${drop.jobOrderNo} (${drop.status}) as merged`);
      } catch (e) {
        console.log(`  ${label}: SKIPPED, ${(e as Error).message}`);
        continue;
      }
    } else if (cj && !mj) {
      console.log(`  ${label}: only the linked report has a job order (${cj.jobOrderNo}) -> it becomes the main report`);
    } else {
      console.log(`  ${label}: status ${c.status} -> CLOSED (linked as a duplicate)`);
    }
    if (dryRun) continue;

    const older = main.createdAt <= c.createdAt ? main.id : c.id;
    const newer = older === main.id ? c.id : main.id;
    await prisma.$transaction(async (tx) => {
      await tx.report.update({ where: { id: c.id }, data: { duplicateOfId: null } });
      await linkSameProblem(tx, older, newer, actor.id, undefined, { relink: true });
    });
    changed++;
  }
  // open suggestions still pointing at linked reports move to their main report
  const stranded = await prisma.report.findMany({
    where: {
      duplicateOfId: { not: null },
      OR: [
        { duplicateFlags: { some: { status: 'OPEN' } } },
        { duplicateOfFlags: { some: { status: 'OPEN' } } },
      ],
    },
    select: { id: true, duplicateOfId: true, description: true },
  });
  for (const c of stranded) {
    console.log(`  "${c.description.slice(0, 40)}": open duplicate suggestions -> moved to its main report`);
    if (!dryRun) await prisma.$transaction((tx) => moveOpenFlagsToMain(tx, c.id, c.duplicateOfId!));
  }

  console.log(dryRun ? 'Dry run finished.' : `Done. ${changed} link(s) brought in line, ${stranded.length} report(s) had suggestions moved.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
