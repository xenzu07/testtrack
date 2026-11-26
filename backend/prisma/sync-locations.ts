// Replaces the campus locations with the list in prisma/locations-data.ts.
//
//   npx ts-node prisma/sync-locations.ts            dry run: shows what would change
//   npx ts-node prisma/sync-locations.ts --apply    makes the changes (one transaction)
//
// Uses DATABASE_URL from the shell if set, otherwise the one in backend/.env.
import { PrismaClient } from '@prisma/client';
import { printSummary, syncLocations } from './location-sync';

// A DATABASE_URL set in the shell always wins (e.g. a one-off production
// run); backend/.env is read only when none is set.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // no .env file: DATABASE_URL must come from the environment
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  let host = '(unreadable)';
  try {
    host = new URL(url).hostname;
  } catch {
    // keep the placeholder; never print the URL itself
  }
  console.log(`Database host: ${host}`);
  console.log(apply ? 'Mode: APPLY (changes will be written)\n' : 'Mode: dry run (nothing is changed; add --apply to write)\n');

  const prisma = new PrismaClient();
  try {
    printSummary(await syncLocations(prisma, { apply }), apply);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
