import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { HttpExceptionFilter } from './middlewares/http.exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'debug', 'log', 'verbose', 'fatal'],
  });

  // Behind Nginx: trust the first proxy so req.ip is the client address (used in audit logs).
  app.set('trust proxy', 1);

  // Patient documents used to live in the public uploads folder. They are now served
  // only by /files/patient-documents/:id after a permission check, so block the old path.
  app.use('/uploads/patient-files', (_req: Request, res: Response) => {
    res.status(404).json({
      error: true,
      responseBody: { statusCode: 404, message: 'Not Found' },
    });
  });

  const uploadsRoot = join(process.cwd(), 'uploads');
  app.useStaticAssets(uploadsRoot, { prefix: '/uploads/', index: false });

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
