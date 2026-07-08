import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { API_PREFIX } from '@crm/types';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  // rawBody: true lets the MyOperator webhook verify the HMAC over exact bytes.
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  const config = app.get(ConfigService<Env, true>);

  const origins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({
    origin: origins.length ? origins : true,
    credentials: true,
  });
  // Explicit Socket.io adapter for the notifications gateway (shares the HTTP
  // server/port); mirror the REST CORS allow-list onto the websocket handshake.
  app.useWebSocketAdapter(new IoAdapter(app));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  Logger.log(`API listening on http://0.0.0.0:${port}/${API_PREFIX}`, 'Bootstrap');
}

void bootstrap();
