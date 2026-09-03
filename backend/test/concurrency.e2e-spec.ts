import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/database/prisma.service';

describe('Concurrency & Double-Booking Prevention E2E Suite', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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
    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('Concurrent requests for the EXACT same slot must result in 1 booking and 409 Conflicts for the rest', async () => {
    let salon: any = await prisma.salon.findFirst({
      where: { status: 'ACTIVE' },
      include: { services: true, staff: true },
    });

    if (!salon || salon.services.length === 0 || salon.staff.length === 0) {
      salon = await prisma.salon.create({
        data: {
          name: 'Glamour Studio',
          slug: `glamour-studio-${Date.now()}`,
          phone: '+919999000011',
          email: `glamour-${Date.now()}@test.com`,
          timezone: 'Asia/Kolkata',
          services: {
            create: { name: 'Haircut & Styling', durationMinutes: 30, price: 250 },
          },
          staff: {
            create: { name: 'Rahul Mehta' },
          },
          workingHours: {
            create: { dayOfWeek: 'TUESDAY', isOpen: true, openTime: '09:00', closeTime: '19:00' },
          },
        },
        include: { services: true, staff: true },
      });
      await prisma.staffService.create({
        data: { staffId: salon.staff[0].id, serviceId: salon.services[0].id },
      });
      await prisma.staffWorkingHours.create({
        data: { staffId: salon.staff[0].id, dayOfWeek: 'TUESDAY', isWorking: true, startTime: '09:00', endTime: '19:00' },
      });
    }


    const service = salon.services[0];
    const staff = salon.staff[0];

    expect(service).toBeDefined();
    expect(staff).toBeDefined();

    const targetDate = '2026-09-15';
    const targetTime = '15:00';

    await prisma.appointment.deleteMany({
      where: {
        staffId: staff.id,
        date: new Date(targetDate),
      },
    });

    const concurrentCount = 6;
    const requests = Array.from({ length: concurrentCount }).map((_, index) =>
      request(app.getHttpServer())
        .post(`/api/v1/booking/${salon!.slug}/appointments`)
        .send({
          serviceId: service.id,
          staffId: staff.id,
          date: targetDate,
          startTime: targetTime,
          customerName: `Concurrent Client ${index + 1}`,
          customerPhone: `+91999990000${index + 1}`,
        }),
    );


    const responses = await Promise.all(requests);

    const successful = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(successful.length).toBe(1);
    expect(conflicts.length).toBe(concurrentCount - 1);
    expect(conflicts[0].body.message).toContain('slot was just booked');

    const dbAppointments = await prisma.appointment.findMany({
      where: {
        staffId: staff!.id,
        date: new Date(targetDate),
      },
    });
    expect(dbAppointments.length).toBe(1);
  }, 20000);
});
