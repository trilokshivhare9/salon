import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantContextGuard } from './modules/auth/guards/tenant-context.guard';
import { PrismaService } from './database/prisma.service';
import { ErrorLogService } from './modules/error-logs/error-log.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Enable Gzip/Deflate compression for fast JSON payloads
  app.use(compression());

  // Global API Prefix
  app.setGlobalPrefix('api/v1');

  // CORS Configuration
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global Pipes & Interceptors
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const errorLogService = app.get(ErrorLogService);
  app.useGlobalFilters(new AllExceptionsFilter(errorLogService));
  app.useGlobalInterceptors(new TransformInterceptor());

  // Global Auth, RBAC & Tenant Context Guards
  const reflector = app.get(Reflector);
  const prisma = app.get(PrismaService);
  app.useGlobalGuards(
    new JwtAuthGuard(reflector),
    new RolesGuard(reflector),
    new TenantContextGuard(prisma, reflector),
  );

  // Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('Salon SaaS Operations & Booking API')
    .setDescription('Multi-tenant salon appointment, customer management, availability engine, and centralized error logging API.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Salon SaaS Backend running at http://0.0.0.0:${port}/api/v1`);
  logger.log(`📖 Swagger API Documentation available at http://localhost:${port}/api/docs`);
}

bootstrap();
