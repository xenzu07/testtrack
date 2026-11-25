// Read-only check that the database and storage are locked down.
//   npm run db:check-security
// Exits with code 1 if anything is open, so it can run in CI or before deploys.
import { PrismaClient } from '@prisma/client';

// local runs read backend/.env; on a server the variables are already set
try {
  process.loadEnvFile();
} catch {
  // no .env file
}

const prisma = new PrismaClient();
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'report-photos';

async function main() {
  const problems: string[] = [];

  const noRls = await prisma.$queryRaw<{ table: string }[]>`
    select c.relname as "table"
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
    order by 1`;
  noRls.forEach((r) => problems.push(`RLS is OFF on public."${r.table}"`));

  const grants = await prisma.$queryRaw<{ grantee: string; table: string; privs: string }[]>`
    select grantee, table_name as "table", string_agg(privilege_type, ',') as privs
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated')
    group by 1, 2 order by 2, 1`;
  grants.forEach((g) =>
    problems.push(`${g.grantee} still has ${g.privs} on public."${g.table}"`),
  );

  const buckets = await prisma.$queryRaw<{ public: boolean }[]>`
    select public from storage.buckets where id = ${bucket}`;
  if (buckets.length === 0) problems.push(`storage bucket "${bucket}" does not exist`);
  else if (buckets[0].public) problems.push(`storage bucket "${bucket}" is PUBLIC`);

  const storagePolicy = await prisma.$queryRaw<{ n: number }[]>`
    select count(*)::int as n from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'report_photos_backend_only'`;
  if (!storagePolicy[0]?.n) problems.push('storage policy "report_photos_backend_only" is missing');

  const tokenVersion = await prisma.$queryRaw<{ n: number }[]>`
    select count(*)::int as n from information_schema.columns
    where table_schema = 'public' and table_name = 'User' and column_name = 'tokenVersion'`;
  if (!tokenVersion[0]?.n) problems.push('column User.tokenVersion is missing');

  const legacy = await prisma.$queryRaw<{ n: number }[]>`
    select ((select count(*) from "ReportPhoto" where "storageUrl" like '/uploads/%')
          + (select count(*) from "StatusLog" where "photoUrl" like '/uploads/%'))::int as n`;
  const legacyCount = legacy[0]?.n ?? 0;

  if (problems.length) {
    console.error('SECURITY CHECK FAILED:');
    problems.forEach((p) => console.error(`  - ${p}`));
    console.error('Fix: npm run db:phase1');
  } else {
    console.log('Security check passed: RLS on, Data API closed, photo bucket private.');
  }
  if (legacyCount) {
    console.warn(
      `Note: ${legacyCount} photo(s) still use local /uploads storage. Run: npm run storage:migrate-legacy`,
    );
  }
  process.exitCode = problems.length ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
