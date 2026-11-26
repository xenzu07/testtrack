// Deletes EVERY report and everything that hangs off it: photos, job orders,
// assignments, status history, delays, feedback, priority adjustments,
// duplicate flags, Job Order Forms (with their signatures) and report
// notifications. Also removes the matching files from Supabase Storage
// (reports/... and signatures/...). Users, trade units, categories and
// locations are kept.
//
//   npm run reports:clear              # preview: counts only, nothing deleted
//   npm run reports:clear -- --confirm # really delete (cannot be undone)
//
// Safe to re-run: a second run also removes storage files left behind if a
// previous run was interrupted.
import { PrismaClient } from '@prisma/client';

try {
  process.loadEnvFile();
} catch {
  // no .env file: variables come from the environment
}

const prisma = new PrismaClient();

const baseUrl = (process.env.SUPABASE_URL ?? '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/(rest|storage)\/v1$/i, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'report-photos';

function storage(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}/storage/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// every file under a folder, following sub-folders
async function listFiles(prefix: string): Promise<string[]> {
  const files: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await storage('POST', `/object/list/${encodeURIComponent(bucket)}`, {
      prefix,
      limit: 1000,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (!res.ok) throw new Error(`Listing ${prefix} failed: HTTP ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as { name: string; id: string | null }[];
    for (const r of rows) {
      const full = `${prefix}/${r.name}`;
      if (r.id === null) files.push(...(await listFiles(full)));
      else files.push(full);
    }
    if (rows.length < 1000) return files;
  }
}

const isStoragePath = (p: string | null) => !!p && !p.startsWith('/') && !/^https?:/i.test(p);

async function main() {
  const confirm = process.argv.includes('--confirm');

  const [photos, logPhotos, forms] = await Promise.all([
    prisma.reportPhoto.findMany({ select: { storageUrl: true } }),
    prisma.statusLog.findMany({ where: { photoUrl: { not: null } }, select: { photoUrl: true } }),
    prisma.jobOrderForm.findMany({ select: { signaturePath: true } }),
  ]);
  const paths = new Set<string>(
    [
      ...photos.map((p) => p.storageUrl),
      ...logPhotos.map((l) => l.photoUrl),
      ...forms.map((f) => f.signaturePath),
    ].filter(isStoragePath) as string[],
  );
  for (const p of [...(await listFiles('reports')), ...(await listFiles('signatures'))]) paths.add(p);

  const counts = {
    reports: await prisma.report.count(),
    reportPhotos: photos.length,
    jobOrders: await prisma.jobOrder.count(),
    jobAssignments: await prisma.jobAssignment.count(),
    statusLogs: await prisma.statusLog.count(),
    materialDelays: await prisma.materialDelay.count(),
    feedback: await prisma.feedback.count(),
    priorityAdjustments: await prisma.priorityAdjustment.count(),
    duplicateFlags: await prisma.duplicateFlag.count(),
    jobOrderForms: forms.length,
    reportNotifications: await prisma.notification.count({ where: { OR: [{ reportId: { not: null } }, { jobOrderId: { not: null } }] } }),
    storageFiles: paths.size,
  };
  console.table(counts);

  if (!confirm) {
    console.log('Preview only. Nothing was deleted. Run with --confirm to delete all of the above.');
    return;
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.notification.deleteMany({ where: { OR: [{ reportId: { not: null } }, { jobOrderId: { not: null } }] } });
      await tx.feedback.deleteMany({});
      await tx.materialDelay.deleteMany({});
      await tx.jobAssignment.deleteMany({});
      await tx.statusLog.deleteMany({});
      await tx.priorityAdjustment.deleteMany({});
      await tx.duplicateFlag.deleteMany({});
      await tx.jobOrderForm.deleteMany({});
      await tx.reportPhoto.deleteMany({});
      await tx.jobOrder.updateMany({ data: { mergedIntoId: null } });
      await tx.jobOrder.deleteMany({});
      await tx.report.updateMany({ data: { duplicateOfId: null } });
      await tx.report.deleteMany({});
    },
    { timeout: 120_000 },
  );
  console.log('Database rows deleted.');

  const list = [...paths];
  let failed = 0;
  for (let i = 0; i < list.length; i += 1000) {
    const chunk = list.slice(i, i + 1000);
    const res = await storage('DELETE', `/object/${encodeURIComponent(bucket)}`, { prefixes: chunk });
    if (!res.ok) {
      failed += chunk.length;
      console.error(`Could not delete ${chunk.length} files: HTTP ${res.status} ${await res.text()}`);
    }
  }
  console.log(
    failed
      ? `Storage: ${list.length - failed} files deleted, ${failed} failed. Run again to retry.`
      : `Storage: ${list.length} files deleted.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
