import { datasourceUrl } from './prisma.service';

describe('datasourceUrl (connection pool limit)', () => {
  const base = 'postgresql://postgres.ref:p%40ss%2Fword@aws-0-x.pooler.supabase.com:5432/postgres';

  it('caps the pool at 5 by default and keeps the password intact', () => {
    const u = new URL(datasourceUrl(base, undefined)!);
    expect(u.searchParams.get('connection_limit')).toBe('5');
    expect(u.searchParams.get('pool_timeout')).toBe('20');
    expect(u.password).toBe('p%40ss%2Fword');
    expect(u.host).toBe('aws-0-x.pooler.supabase.com:5432');
  });

  it('uses DB_POOL_SIZE when valid', () => {
    expect(new URL(datasourceUrl(base, '3')!).searchParams.get('connection_limit')).toBe('3');
    expect(new URL(datasourceUrl(base, 'lots')!).searchParams.get('connection_limit')).toBe('5');
  });

  it('never overrides settings already in DATABASE_URL', () => {
    const u = new URL(datasourceUrl(`${base}?connection_limit=1&pgbouncer=true`, '9')!);
    expect(u.searchParams.get('connection_limit')).toBe('1');
    expect(u.searchParams.get('pgbouncer')).toBe('true');
  });

  it('leaves a missing or malformed URL for Prisma to report', () => {
    expect(datasourceUrl('', undefined)).toBeUndefined();
    expect(datasourceUrl('not a url', undefined)).toBe('not a url');
  });
});
