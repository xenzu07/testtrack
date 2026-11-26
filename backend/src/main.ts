import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { corsOriginCheck, warnIfCorsOpen } from './common/cors';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  // behind a reverse proxy / load balancer, set TRUST_PROXY to the number of
  // proxy hops (usually 1) so req.ip is the real client IP for rate limiting
  const trustProxy = process.env.TRUST_PROXY?.trim();
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }
  app.disable('x-powered-by');

  // baseline security headers for every response
  app.use((req: any, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.enableCors({
    origin: corsOriginCheck,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
  });
  warnIfCorsOpen();

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // LEGACY: photos uploaded before the move to Supabase Storage were saved in
  // ./uploads and are still referenced as "/uploads/<file>" until
  // `npm run storage:migrate-legacy` copies them to the bucket. After that,
  // set SERVE_LEGACY_UPLOADS=false. Only image files are served, and never
  // as anything the browser could run.
  const uploadsDir = join(process.cwd(), 'uploads');
  if (process.env.SERVE_LEGACY_UPLOADS !== 'false' && existsSync(uploadsDir)) {
    app.use('/uploads', (req: any, res: any, next: () => void) => {
      if (!/^\/[\w.-]+\.(jpe?g|png|webp)$/i.test(req.path)) {
        res.status(404).end();
        return;
      }
      next();
    });
    app.useStaticAssets(uploadsDir, {
      prefix: '/uploads',
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => {
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Cache-Control', 'private, max-age=3600');
      },
    });
    logger.warn(
      'Serving legacy /uploads photos. Run `npm run storage:migrate-legacy`, then set SERVE_LEGACY_UPLOADS=false.',
    );
  }

  // for the host's health check (no login, no database call)
  app.getHttpAdapter().get('/health', (_req: any, res: any) => {
    res.json({ ok: true });
  });

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on port ${port}`);
}
void bootstrap();
