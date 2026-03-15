import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { HttpExceptionFilter } from './middlewares/http.exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'debug', 'log', 'verbose', 'fatal'],
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  app.use(cookieParser());
  // CORS configuration for Docker deployment
  const allowedOriginsEnv = (process.env.ALLOWED_ORIGINS || '').trim();

  // For mobile apps, use '*' to allow all origins
  // For web apps, specify comma-separated origins
  let allowedOrigins:
    | string
    | string[]
    | ((
        origin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => void);

  if (allowedOriginsEnv === '*' || allowedOriginsEnv === '') {
    // Allow all origins (for mobile apps or development)
    allowedOrigins = '*';
  } else {
    // Allow specific origins (for web apps)
    allowedOrigins = allowedOriginsEnv
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  // app.use(doubleCsrfProtection);
  // Disable CSP - Swagger UI requires inline scripts/styles and blob: URLs that are hard to whitelist
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    }),
  );
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const config = new DocumentBuilder()
    .setTitle('DerMee API Documentation')
    .setDescription('API description for DerMee application')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
