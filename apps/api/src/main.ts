import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // The production API has exactly one trusted proxy hop (Caddy).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.get('WEB_ORIGIN', 'http://localhost:5173'),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableShutdownHooks();

  const port = config.get<number>('API_PORT', 3000);
  await app.listen(port);
  console.log(`Idea2Screenplay API listening on http://localhost:${port}/api`);
}

void bootstrap();
