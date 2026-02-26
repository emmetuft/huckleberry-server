import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'node:child_process';
import { AppModule } from './app.module.js';
import { DomoExceptionFilter } from './common/filters/domo-exception.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import { AppConfig } from './common/config/configuration.js';

/**
 * Kill any process holding the given port. This handles the common dev
 * scenario where the NestJS file-watcher restarts faster than the previous
 * process can release the socket.
 */
function freePort(port: number): void {
  try {
    const pid = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf-8' }).trim();
    if (pid) {
      // Avoid killing ourselves
      const pids = pid
        .split('\n')
        .map(Number)
        .filter((p) => p !== process.pid);
      for (const p of pids) {
        process.kill(p, 'SIGKILL');
      }
      if (pids.length) {
        Logger.warn(
          `Killed stale process(es) on port ${port}: ${pids.join(', ')}`,
          'Bootstrap',
        );
      }
    }
  } catch {
    // lsof exits non-zero when nothing is listening — that's fine
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new DomoExceptionFilter());

  const config = app.get(ConfigService);
  app.useGlobalInterceptors(new LoggingInterceptor(config));

  const port = config.get<AppConfig>('app')?.port ?? 3000;

  if (config.get<AppConfig>('app')?.nodeEnv === 'development') {
    freePort(port);
  }

  await app.listen(port);

  const shutdown = () => {
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
