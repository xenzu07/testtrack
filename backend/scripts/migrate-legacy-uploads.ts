// Copies photos saved on the server's disk (./uploads, the old storage) into
// the private Supabase Storage bucket and points the database rows at them.
//
//   npm run storage:migrate-legacy -- --dry-run   # show what would happen
//   npm run storage:migrate-legacy                # do it
//
// Safe to re-run: rows already migrated are skipped, uploads use upsert, and
// a row is only updated if it still holds the old "/uploads/..." value.
// Nothing is deleted: the files in ./uploads stay until you remove them
// yourself after checking the photos show up in the apps.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { basename, join, parse } from 'path';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageModule } from '../src/storage/storage.module';
import { PhotoStorageService } from '../src/storage/photo-storage.service';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, StorageModule] })
class MigrationModule {}

const LEGACY_PREFIX = '/uploads/';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uploadsDir = process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
  const app = await NestFactory.createApplicationContext(MigrationModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const storage = app.get(PhotoStorageService);

  const photos = await prisma.reportPhoto.findMany({
    where: { storageUrl: { startsWith: LEGACY_PREFIX } },
    select: { id: true, reportId: true, storageUrl: true },
  });
  const logs = await prisma.statusLog.findMany({
    where: { photoUrl: { startsWith: LEGACY_PREFIX } },
    select: { id: true, reportId: true, photoUrl: true },
  });

  console.log(
    `${photos.length} report photo(s) and ${logs.length} work photo(s) still on local storage` +
      (dryRun ? ' (dry run: nothing will change)' : ''),
  );

  let moved = 0;
  let missing = 0;
  let failed = 0;

  // one file can be referenced by several rows; upload it once per target folder
  const uploaded = new Map<string, string>();
  const copy = async (legacyUrl: string, folder: string): Promise<string | null> => {
    // only a bare file name is accepted, never a path that leaves ./uploads
    const fileName = basename(legacyUrl.slice(LEGACY_PREFIX.length));
    const cacheKey = `${folder}|${fileName}`;
    const cached = uploaded.get(cacheKey);
    if (cached) return cached;

    const filePath = join(uploadsDir, fileName);
    if (!existsSync(filePath)) {
      console.warn(`  MISSING  ${legacyUrl} (not found in ${uploadsDir})`);
      missing++;
      return null;
    }
    if (dryRun) {
      console.log(`  WOULD COPY  ${legacyUrl} -> ${folder}/${parse(fileName).name}.*`);
      return null;
    }
    const data = await readFile(filePath);
    const objectPath = await storage.uploadImage(data, folder, {
      name: parse(fileName).name,
      upsert: true,
    });
    uploaded.set(cacheKey, objectPath);
    return objectPath;
  };

  for (const p of photos) {
    try {
      const path = await copy(p.storageUrl, `reports/${p.reportId}/legacy`);
      if (!path) continue;
      const res = await prisma.reportPhoto.updateMany({
        where: { id: p.id, storageUrl: p.storageUrl },
        data: { storageUrl: path },
      });
      if (res.count) {
        moved++;
        console.log(`  COPIED  ${p.storageUrl} -> ${path}`);
      }
    } catch (e) {
      failed++;
      console.error(`  FAILED  ${p.storageUrl}: ${String(e)}`);
    }
  }

  for (const l of logs) {
    try {
      const path = await copy(l.photoUrl!, `reports/${l.reportId}/work/legacy`);
      if (!path) continue;
      const res = await prisma.statusLog.updateMany({
        where: { id: l.id, photoUrl: l.photoUrl },
        data: { photoUrl: path },
      });
      if (res.count) {
        moved++;
        console.log(`  COPIED  ${l.photoUrl} -> ${path}`);
      }
    } catch (e) {
      failed++;
      console.error(`  FAILED  ${l.photoUrl}: ${String(e)}`);
    }
  }

  console.log(`Done. Migrated: ${moved}, missing files: ${missing}, failed: ${failed}.`);
  if (!dryRun && missing === 0 && failed === 0) {
    console.log('All photos are in Supabase Storage. You can now set SERVE_LEGACY_UPLOADS=false.');
  }
  await app.close();
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
