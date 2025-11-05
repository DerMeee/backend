import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { doubleCsrf, CsrfRequestMethod } from 'csrf-csrf';
import { Request } from 'express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { HttpExceptionFilter } from './middlewares/http.exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'debug', 'log', 'verbose', 'fatal'],
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  const doubleCsrfOptions = {
    getSecret: () => process.env.CSRF_SECRET || '', // must be constant between restarts
    getSessionIdentifier: (req: Request) => {
      // ❌ simple version: always return the same string
      // ✅ better: tie it to the user or session ID if you have auth
      return req.cookies['session_id'] || 'anonymous';
    },
    cookieName: '__Host-csrf-token', // the name of the cookie
    cookieOptions: {
      httpOnly: true,
      sameSite: 'strict' as const,
      path: '/',
      secure: process.env.NODE_ENV === 'production', // secure cookie in production
    },
    size: 64, // token size in bytes
    ignoredMethods: ['GET', 'HEAD', 'OPTIONS'] as CsrfRequestMethod[], // do not require CSRF for safe methods
  };

  app.use(cookieParser());
  // CORS configuration for Docker deployment
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean); // removes empty strings

  // app.use(doubleCsrfProtection);
  app.use(helmet());
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
bootstrap();
