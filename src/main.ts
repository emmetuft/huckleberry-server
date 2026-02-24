import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { DomoExceptionFilter } from './common/filters/domo-exception.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import { AppConfig } from './common/config/configuration.js';

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

  app.enableShutdownHooks();

  const port = config.get<AppConfig>('app')?.port ?? 3000;
  await app.listen(port);
}
void bootstrap();
