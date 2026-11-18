/**
 * Creates test accounts (and a few products) for local testing. Safe to run again:
 * existing accounts are left as they are (their password is reset to the test password).
 *
 *   npm run build && npm run seed:test
 *
 * Refuses to run when NODE_ENV=production. Never use these passwords on a real server.
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient, type WeekDay } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const PASSWORDS = {
  admin: 'Admin-Test-2026!',
  patient: 'Patient-Test-2026!',
  doctor: 'Doctor-Test-2026!',
};

/** Work hours are stored in UTC: 08:00–16:00 UTC = 09:00–17:00 Algeria time. */
const WORK_DAYS: WeekDay[] = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
];
const utcTime = (hhmm: string) => new Date(`2026-01-01T${hhmm}:00.000Z`);

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to create test accounts with NODE_ENV=production.',
    );
  }
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const hash = async (pw: string) => bcrypt.hash(pw, 10);

    /** Creates the user if missing; always resets the password so the printed one works. */
    async function upsertUser(
      email: string,
      data: {
        name: string;
        firstName: string;
        lastName: string;
        role: 'ADMIN' | 'PATIENT' | 'DOCTOR';
        phoneNumber?: string;
        address?: { street: string; city: string; state: string };
      },
      password: string,
    ) {
      const passwordHash = await hash(password);
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { passwordHash, status: 'ACTIVE' },
        });
        return { user: existing, created: false };
      }
      const user = await prisma.user.create({
        data: {
          email,
          name: data.name,
          firstName: data.firstName,
          lastName: data.lastName,
          role: data.role,
          phoneNumber: data.phoneNumber,
          passwordHash,
          ...(data.address
            ? {
                address: {
                  create: {
                    ...data.address,
                    postalCode: '16000',
                    country: 'Algérie',
                    validated: true,
                  },
                },
              }
            : {}),
        },
      });
      return { user, created: true };
    }

    // ── Admin ───────────────────────────────────────────────────────────────
    const admin = await upsertUser(
      'admin@dermee.test',
      {
        name: 'Admin DerMee',
        firstName: 'Admin',
        lastName: 'DerMee',
        role: 'ADMIN',
      },
      PASSWORDS.admin,
    );

    // ── Patient ─────────────────────────────────────────────────────────────
    const patient = await upsertUser(
      'patient@dermee.test',
      {
        name: 'Amina Benali',
        firstName: 'Amina',
        lastName: 'Benali',
        role: 'PATIENT',
        phoneNumber: '0555 12 34 56',
        address: {
          street: 'Cité 5 Juillet, bât. 12',
          city: 'Bab Ezzouar',
          state: 'Alger',
        },
      },
      PASSWORDS.patient,
    );
    await prisma.patient.upsert({
      where: { userId: patient.user.id },
      create: { userId: patient.user.id },
      update: {},
    });

    // ── Approved doctor with weekly hours (bookable right away) ─────────────
    const doctor = await upsertUser(
      'doctor@dermee.test',
      {
        name: 'Dr Karim Haddad',
        firstName: 'Karim',
        lastName: 'Haddad',
        role: 'DOCTOR',
        phoneNumber: '0661 22 33 44',
        address: {
          street: '12 rue Didouche Mourad',
          city: 'Alger Centre',
          state: 'Alger',
        },
      },
      PASSWORDS.doctor,
    );
    const doctorProfile = await prisma.doctor.upsert({
      where: { userId: doctor.user.id },
      create: {
        userId: doctor.user.id,
        specialty: 'Dermatologie',
        fees: 2500,
        workYears: 12,
        about:
          'Dermatologue, spécialisé en acné, dermatologie esthétique et suivi des maladies chroniques de la peau.',
        approvalStatus: 'APPROVED',
        approvedAt: new Date(),
        approvedById: admin.user.id,
      },
      update: { approvalStatus: 'APPROVED' },
    });
    for (const day of WORK_DAYS) {
      await prisma.workDay.upsert({
        where: { doctorId_day: { doctorId: doctorProfile.id, day } },
        create: {
          doctorId: doctorProfile.id,
          day,
          startTime: utcTime('08:00'),
          endTime: utcTime('16:00'),
        },
        update: {},
      });
    }

    // ── Doctor waiting for approval (to test the review queue) ──────────────
    const pending = await upsertUser(
      'pending.doctor@dermee.test',
      {
        name: 'Dr Sara Meziane',
        firstName: 'Sara',
        lastName: 'Meziane',
        role: 'DOCTOR',
        phoneNumber: '0770 98 76 54',
        address: {
          street: 'Boulevard de la Soummam',
          city: 'Oran',
          state: 'Oran',
        },
      },
      PASSWORDS.doctor,
    );
    await prisma.doctor.upsert({
      where: { userId: pending.user.id },
      create: {
        userId: pending.user.id,
        specialty: 'Dermatologie pédiatrique',
        fees: 2000,
        workYears: 4,
        about: 'Dermatologue pour enfants et adolescents.',
        approvalStatus: 'PENDING',
      },
      update: {},
    });

    // ── A few published products with stock (shop / checkout testing) ───────
    const products = [
      {
        sku: 'TEST-SPF50',
        name: 'Crème solaire SPF 50+',
        brand: 'DermaSun',
        category: 'Protection solaire',
        price: 2400,
        stock: 30,
      },
      {
        sku: 'TEST-CLEANSER',
        name: 'Gel nettoyant peaux grasses',
        brand: 'PureSkin',
        category: 'Nettoyants',
        price: 1650,
        stock: 4,
      },
      {
        sku: 'TEST-HYDRA',
        name: 'Crème hydratante visage',
        brand: 'HydraCare',
        category: 'Hydratants',
        price: 1980,
        stock: 0,
      },
    ];
    let productsCreated = 0;
    for (const p of products) {
      const exists = await prisma.product.findUnique({ where: { sku: p.sku } });
      if (exists) continue;
      await prisma.product.create({
        data: {
          ...p,
          description: 'Produit de démonstration pour tester la boutique.',
          status: 'PUBLISHED',
          stockMovements:
            p.stock > 0
              ? {
                  create: {
                    delta: p.stock,
                    stockAfter: p.stock,
                    reason: 'INITIAL',
                    note: 'Test data',
                  },
                }
              : undefined,
        },
      });
      productsCreated++;
    }

    console.log('\nTest accounts ready (local testing only):\n');
    const rows = [
      ['Admin', 'admin@dermee.test', PASSWORDS.admin, admin.created],
      ['Patient', 'patient@dermee.test', PASSWORDS.patient, patient.created],
      [
        'Doctor (approved)',
        'doctor@dermee.test',
        PASSWORDS.doctor,
        doctor.created,
      ],
      [
        'Doctor (pending)',
        'pending.doctor@dermee.test',
        PASSWORDS.doctor,
        pending.created,
      ],
    ] as const;
    for (const [role, email, pw, created] of rows) {
      console.log(
        `  ${role.padEnd(18)} ${email.padEnd(28)} ${pw}${created ? '' : '   (already existed, password reset)'}`,
      );
    }
    console.log(
      `\n  Products: ${productsCreated} created (${products.length - productsCreated} already there)\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
