import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export const DEFAULT_POOL_SIZE = 5;

// Supabase's session pooler allows only a small, fixed number of client
// connections for the whole project (15 on this plan). Prisma's default pool
// is (CPU cores x 2 + 1) per process - 25 on a 12-core machine - so a burst
// of queries, or two backend instances, could exhaust it and fail with
// "EMAXCONNSESSION max clients reached". Each process therefore uses at most
// DB_POOL_SIZE connections (default 5); extra queries wait their turn.
// A connection_limit already present in DATABASE_URL is always respected.
export function datasourceUrl(
  raw = process.env.DATABASE_URL,
  poolSize = process.env.DB_POOL_SIZE,
): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw; // let Prisma report the malformed URL itself
  }
  if (!url.searchParams.has('connection_limit')) {
    const n = Number(poolSize);
    url.searchParams.set(
      'connection_limit',
      String(Number.isInteger(n) && n > 0 ? n : DEFAULT_POOL_SIZE),
    );
  }
  // wait up to 20 s for a free connection before giving up
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '20');
  return url.toString();
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({ datasourceUrl: datasourceUrl() });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
