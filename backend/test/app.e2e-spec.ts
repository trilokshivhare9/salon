import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';

describe('Salon SaaS E2E Integration Suite', () => {
  let app: INestApplication;
  let salonAdminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health should return ok and connected database', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.database).toBe('connected');
  });

  it('POST /api/v1/auth/login should authenticate salon owner and return JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'owner@glamourstudio.com',
        password: 'Password123!',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.role).toBe('SALON_ADMIN');
    expect(res.body.data.user.salon.slug).toBe('glamour-studio');

    salonAdminToken = res.body.data.accessToken;
  });

  it('GET /api/v1/booking/glamour-studio should return public salon details and catalog', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/booking/glamour-studio')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Glamour Studio & Lounge');
    expect(res.body.data.services.length).toBeGreaterThan(0);
    expect(res.body.data.staff.length).toBeGreaterThan(0);
  });

  it('GET /api/v1/reports/dashboard should return salon KPIs for authenticated owner', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/dashboard')
      .set('Authorization', `Bearer ${salonAdminToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.statusCounts).toBeDefined();
    expect(res.body.data.salonMetrics.totalActiveStaff).toBeGreaterThan(0);
  });
});
