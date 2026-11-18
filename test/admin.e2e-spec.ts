/**
 * End-to-end tests for the admin system against a real, disposable Postgres.
 *
 *   E2E_DATABASE_URL=postgresql://user:pass@localhost:5432/dermee_e2e npm run test:e2e
 *
 * The database is wiped (TRUNCATE) before the run, so the name must end in _e2e or _test.
 * Migrations are applied first with `prisma migrate deploy`, which also proves they run
 * on an empty database. Skipped entirely when E2E_DATABASE_URL is not set.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execSync } from 'child_process';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import type { App } from 'supertest/types';

const DB = process.env.E2E_DATABASE_URL;
const describeIfDb = DB ? describe : describe.skip;

if (DB) {
  if (
    !/_(e2e|test)(\?|$)/.test(
      new URL(DB).pathname + (new URL(DB).search ? '?' : ''),
    )
  ) {
    throw new Error(
      'E2E_DATABASE_URL must point to a database whose name ends in _e2e or _test',
    );
  }
  process.env.DATABASE_URL = DB;
  process.env.JWT_SECRET = 'e2e-access-secret';
  process.env.REFRESH_SECRET = 'e2e-refresh-secret';
  process.env.DISABLE_SCHEDULED_JOBS = 'true';
  for (const k of ['GOOGLE_CLIENT_ID', 'FACEBOOK_APP_ID'])
    delete process.env[k];
  process.env.OAUTH_GOOGLE_CLIENT_ID = 'x';
  process.env.OAUTH_GOOGLE_CLIENT_SECRET = 'x';
  process.env.OAUTH_GOOGLE_CALLBACK_URL = 'http://localhost/cb';
  process.env.OAUTH_FACEBOOK_APP_ID = 'x';
  process.env.OAUTH_FACEBOOK_APP_SECRET = 'x';
  process.env.OAUTH_FACEBOOK_CALLBACK_URL = 'http://localhost/cb';
  process.env.OAUTH_SUCCESS_REDIRECT = 'http://localhost/done';
}

describeIfDb('Admin system (e2e)', () => {
  let app: INestApplication<App>;
  // Loaded lazily so env vars above are set before Nest modules read them.
  let prisma: import('../src/prisma/prisma.service').PrismaService;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  async function createUser(
    key: string,
    role: 'ADMIN' | 'PATIENT' | 'DOCTOR',
    extra: Record<string, unknown> = {},
  ) {
    const user = await prisma.user.create({
      data: {
        name: `${key} Test`,
        firstName: key,
        lastName: 'Test',
        email: `${key}@e2e.local`,
        phoneNumber: `0555${String(Object.keys(ids).length).padStart(6, '0')}`,
        role,
        passwordHash: await bcrypt.hash('Password123!', 4),
        ...(role === 'PATIENT' ? { patientProfile: { create: {} } } : {}),
        ...(role === 'DOCTOR'
          ? {
              doctorProfile: {
                create: {
                  fees: 2000,
                  workYears: 5,
                  approvalStatus: 'APPROVED',
                  ...extra,
                },
              },
            }
          : {}),
      },
      include: { doctorProfile: true, patientProfile: true },
    });
    ids[key] = user.id;
    const res = await http()
      .post('/auth/login')
      .send({ email: user.email, password: 'Password123!' });
    tokens[key] = res.body.accessToken;
    return user;
  }

  beforeAll(async () => {
    execSync('npx prisma migrate deploy', {
      env: process.env,
      stdio: 'inherit',
    });
    const { AppModule } = await import('../src/app.module');
    const { PrismaService } = await import('../src/prisma/prisma.service');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );

    await createUser('admin', 'ADMIN');
    await createUser('patient', 'PATIENT');
    await createUser('patient2', 'PATIENT');
    const doctor = await createUser('doctor', 'DOCTOR');
    ids.doctorProfile = doctor.doctorProfile!.id;
    // Works every day 08:00–18:00 UTC.
    for (const day of [
      'SUNDAY',
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
      'SATURDAY',
    ] as const) {
      await prisma.workDay.create({
        data: {
          doctorId: doctor.doctorProfile!.id,
          day,
          startTime: new Date('2026-01-01T08:00:00Z'),
          endTime: new Date('2026-01-01T18:00:00Z'),
        },
      });
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  const tomorrow = () =>
    new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  describe('access control', () => {
    it.each([
      ['get', '/admin/users'],
      ['get', '/admin/doctors'],
      ['get', '/admin/reservations'],
      ['get', '/admin/orders'],
      ['get', '/admin/products'],
      ['get', '/admin/audit-logs'],
      ['get', '/admin/settings'],
      ['get', '/admin/stats/registrations'],
    ])(
      '%s %s: 401 without token, 403 for patient and doctor, 200 for admin',
      async (_m, path) => {
        await http().get(path).expect(401);
        await http().get(path).set(as('patient')).expect(403);
        await http().get(path).set(as('doctor')).expect(403);
        await http().get(path).set(as('admin')).expect(200);
      },
    );
  });

  describe('doctor approval', () => {
    it('a new doctor signup is pending, hidden from patients, and can be approved', async () => {
      const signup = await http()
        .post('/auth/signup')
        .send({
          name: 'New Doc',
          email: 'newdoc@e2e.local',
          password: 'Password123!',
          role: 'DOCTOR',
          specialty: 'Dermatology',
        })
        .expect(201);
      expect(signup.body.user.doctor.approvalStatus).toBe('PENDING');
      const newDocId = signup.body.user.id;

      const list = await http().get('/doctor').expect(200);
      expect(list.body.data.map((d: { id: string }) => d.id)).not.toContain(
        newDocId,
      );
      await http()
        .post('/appointments')
        .set(as('patient'))
        .send({
          doctorUserId: newDocId,
          date: tomorrow(),
          time: '10:00',
          durationMinutes: 30,
        })
        .expect(400);

      await http()
        .post(`/admin/doctors/${newDocId}/reject`)
        .set(as('admin'))
        .send({})
        .expect(400); // reason required
      await http()
        .post(`/admin/doctors/${newDocId}/approve`)
        .set(as('admin'))
        .send({})
        .expect(200);
      const after = await http().get('/doctor').expect(200);
      expect(after.body.data.map((d: { id: string }) => d.id)).toContain(
        newDocId,
      );

      const history = await http()
        .get(`/admin/doctors/${newDocId}/approval-history`)
        .set(as('admin'))
        .expect(200);
      expect(history.body[0]).toMatchObject({
        field: 'APPROVAL',
        fromValue: 'PENDING',
        toValue: 'APPROVED',
      });
      const audit = await prisma.auditLog.count({
        where: { action: 'DOCTOR_APPROVED' },
      });
      expect(audit).toBe(1);
    });
  });

  describe('suspension', () => {
    it('blocks requests, refresh and login of a suspended user, then reactivates', async () => {
      const login = await http()
        .post('/auth/login')
        .send({ email: 'patient2@e2e.local', password: 'Password123!' });
      await http()
        .post(`/admin/users/${ids.patient2}/suspend`)
        .set(as('admin'))
        .send({ reason: 'Fraud check' })
        .expect(200);

      await http().get('/auth/profile').set(as('patient2')).expect(401);
      await http()
        .post('/auth/refresh-token')
        .send({ refreshToken: login.body.refreshToken })
        .expect(401);
      await http()
        .post('/auth/login')
        .send({ email: 'patient2@e2e.local', password: 'Password123!' })
        .expect(403);

      await http()
        .post(`/admin/users/${ids.patient2}/reactivate`)
        .set(as('admin'))
        .send({})
        .expect(200);
      await http().get('/auth/profile').set(as('patient2')).expect(200);
    });

    it('an admin cannot be suspended through the API', async () => {
      await http()
        .post(`/admin/users/${ids.admin}/suspend`)
        .set(as('admin'))
        .send({ reason: 'x x x' })
        .expect(403);
    });
  });

  describe('reservations', () => {
    let reservationId: string;

    it('only one of two parallel bookings of the same slot succeeds', async () => {
      const body = {
        doctorUserId: ids.doctor,
        date: tomorrow(),
        time: '11:00',
        durationMinutes: 30,
      };
      const [a, b] = await Promise.all([
        http().post('/appointments').set(as('patient')).send(body),
        http().post('/appointments').set(as('patient2')).send(body),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 400]);
      reservationId = (a.status === 201 ? a : b).body.data.id;
    });

    it('follows doctor confirmation then Dermee confirmation', async () => {
      // Dermee cannot confirm before the doctor.
      await http()
        .post(`/admin/reservations/${reservationId}/confirm`)
        .set(as('admin'))
        .send({})
        .expect(400);
      await http()
        .post(`/appointments/${reservationId}/approve`)
        .set(as('doctor'))
        .send({})
        .expect(201);
      const detail = await http()
        .get(`/admin/reservations/${reservationId}`)
        .set(as('admin'))
        .expect(200);
      expect(detail.body.state).toBe('CONFIRMED');
      expect(detail.body.allowedActions).toContain('dermeeConfirm');

      await http()
        .post(`/admin/reservations/${reservationId}/confirm`)
        .set(as('admin'))
        .send({})
        .expect(200);
      const after = await http()
        .get(`/admin/reservations/${reservationId}`)
        .set(as('admin'))
        .expect(200);
      expect(after.body.state).toBe('DERMEE_CONFIRMED');
      expect(
        after.body.history.map((h: { toState: string }) => h.toState),
      ).toEqual(['PENDING', 'CONFIRMED', 'DERMEE_CONFIRMED']);
    });

    it('cancelling keeps the reservation (state CANCELLED) and frees the slot', async () => {
      await http()
        .delete(`/appointments/${reservationId}`)
        .set(as('doctor'))
        .expect(200);
      const row = await prisma.appointment.findUnique({
        where: { id: reservationId },
      });
      expect(row?.state).toBe('CANCELLED');
      await http()
        .post('/appointments')
        .set(as('patient2'))
        .send({
          doctorUserId: ids.doctor,
          date: tomorrow(),
          time: '11:00',
          durationMinutes: 30,
        })
        .expect(201);
    });

    it('lists by priority with urgency and filters by urgency', async () => {
      const res = await http()
        .get('/admin/reservations?urgency=URGENT')
        .set(as('admin'))
        .expect(200);
      for (const r of res.body.data) expect(r.urgency.level).toBe('URGENT');
    });

    it('the alert job never sends the same alert twice', async () => {
      const { ReservationAlertsJob } = await import(
        '../src/admin/reservations/reservation-alerts.job'
      );
      const job = app.get(ReservationAlertsJob);
      const soon = new Date(Date.now() + 2 * 3_600_000);
      await prisma.appointment.create({
        data: {
          doctorId: ids.doctorProfile,
          patientId: (
            await prisma.patient.findUniqueOrThrow({
              where: { userId: ids.patient },
            })
          ).id,
          type: 'GENERAL',
          startAt: soon,
          endAt: new Date(soon.getTime() + 1_800_000),
        },
      });
      const first = await job.run(new Date());
      const second = await job.run(new Date());
      expect(first.length).toBeGreaterThan(0);
      expect(second.length).toBe(0);
    });
  });

  describe('marketplace', () => {
    let productId: string;

    it('creates a product with stock and refuses negative stock', async () => {
      const res = await http()
        .post('/admin/products')
        .set(as('admin'))
        .send({
          name: 'SPF 50 cream',
          price: 1500,
          sku: 'SPF50-E2E',
          stock: 1,
          category: 'sun',
        })
        .expect(201);
      productId = res.body.id;
      expect(res.body.stockLevel).toBe('LOW_STOCK');
      await http()
        .post(`/admin/products/${productId}/stock-adjustments`)
        .set(as('admin'))
        .send({ delta: -5 })
        .expect(400);
    });

    it('two parallel checkouts for the last unit: exactly one succeeds, stock never below 0', async () => {
      const address = {
        payMethod: 'CASH',
        recipientPhone: '0555000000',
        wilaya: 'Alger',
        commune: 'Hydra',
        addressLine: 'Rue 1',
      };
      for (const who of ['patient', 'patient2']) {
        await http()
          .post('/cart/items')
          .set(as(who))
          .send({ productId, quantity: 1 })
          .expect(201);
      }
      const [a, b] = await Promise.all([
        http().post('/orders').set(as('patient')).send(address),
        http().post('/orders').set(as('patient2')).send(address),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 400]);
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: productId },
      });
      expect(product.stock).toBe(0);
      ids.order = (a.status === 201 ? a : b).body.id;
    });

    it('rejecting the order releases the stock exactly once', async () => {
      await http()
        .post(`/admin/orders/${ids.order}/status`)
        .set(as('admin'))
        .send({ status: 'REJECTED' })
        .expect(400);
      await http()
        .post(`/admin/orders/${ids.order}/status`)
        .set(as('admin'))
        .send({ status: 'REJECTED', reason: 'Payment issue' })
        .expect(200);
      await http()
        .post(`/admin/orders/${ids.order}/status`)
        .set(as('admin'))
        .send({ status: 'CANCELLED', reason: 'again' })
        .expect(400);
      const product = await prisma.product.findUniqueOrThrow({
        where: { id: productId },
      });
      expect(product.stock).toBe(1);
      const movements = await prisma.stockMovement.findMany({
        where: { productId },
        orderBy: { createdAt: 'asc' },
      });
      expect(movements.map((m) => m.reason)).toEqual([
        'INITIAL',
        'ORDER_PLACED',
        'ORDER_RELEASED',
      ]);
    });
  });

  describe('impersonation', () => {
    it('is read-only, ends cleanly, and refuses admin targets', async () => {
      await http()
        .post(`/admin/impersonation/users/${ids.admin}`)
        .set(as('admin'))
        .send({})
        .expect(403);

      const start = await http()
        .post(`/admin/impersonation/users/${ids.patient}`)
        .set(as('admin'))
        .send({ reason: 'support' })
        .expect(201);
      const imp = { Authorization: `Bearer ${start.body.accessToken}` };

      await http().get('/appointments/patient').set(imp).expect(200);
      const banner = await http()
        .get('/impersonation/current')
        .set(imp)
        .expect(200);
      expect(banner.body).toMatchObject({
        impersonating: true,
        target: { id: ids.patient },
      });

      await http()
        .post('/orders')
        .set(imp)
        .send({ payMethod: 'CASH' })
        .expect(403);
      await http().get('/admin/users').set(imp).expect(403); // permissions are the patient's

      await http().post('/impersonation/end').set(imp).expect(200);
      await http().get('/appointments/patient').set(imp).expect(401);
      // The admin's own session is untouched.
      await http().get('/admin/users').set(as('admin')).expect(200);

      const actions = await prisma.auditLog.findMany({
        where: {
          action: { in: ['IMPERSONATION_STARTED', 'IMPERSONATION_ENDED'] },
        },
      });
      expect(actions).toHaveLength(2);
    });
  });

  describe('exports', () => {
    it('exports CSV with a BOM and an audit entry', async () => {
      const res = await http()
        .get('/admin/users/export?format=csv')
        .set(as('admin'))
        .expect(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      expect(
        await prisma.auditLog.count({ where: { action: 'USERS_EXPORTED' } }),
      ).toBe(1);
    });
  });
});
