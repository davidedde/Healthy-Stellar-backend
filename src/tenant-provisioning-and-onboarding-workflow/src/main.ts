import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Enable validation pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS — never fall back to wildcard '*' which allows any origin
  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? (process.env.APP_URL ? [process.env.APP_URL] : [])
    : ['http://localhost:3000', 'http://localhost:4200'];
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  const port = parseInt(process.env.APP_PORT || '3000');
  await app.listen(port);
  logger.log(`Application is running on: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start application:', err);
  process.exit(1);
});
