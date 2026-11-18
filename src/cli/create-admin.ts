/**
 * Creates (or promotes) an administrator account. Signup can't create admins on purpose.
 *
 * Usage (inside the API container or after `npm run build`):
 *   ADMIN_EMAIL=ops@dermee.dz ADMIN_NAME="Ops" ADMIN_PASSWORD='...' node dist/cli/create-admin.js
 *   echo 'password' | ADMIN_EMAIL=ops@dermee.dz node dist/cli/create-admin.js
 *
 * Set ADMIN_PROMOTE=true to turn an existing account into an admin.
 * The password is read from env or stdin, never from the command line (it would land in shell history).
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || 'Administrator';
  const promote = process.env.ADMIN_PROMOTE === 'true';
  const password = process.env.ADMIN_PASSWORD || (await readStdin());

  if (!email || !email.includes('@')) throw new Error('Set ADMIN_EMAIL');
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role === 'ADMIN') {
        console.log(`${email} is already an administrator.`);
        return;
      }
      if (!promote) {
        throw new Error(
          `${email} exists with role ${existing.role}. Re-run with ADMIN_PROMOTE=true to make it an administrator.`,
        );
      }
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: 'ADMIN' },
      });
      await prisma.auditLog.create({
        data: {
          action: 'USER_PROMOTED_TO_ADMIN',
          entityType: 'User',
          entityId: existing.id,
          metadata: { via: 'cli', previousRole: existing.role },
        },
      });
      console.log(`${email} promoted to administrator.`);
      return;
    }

    if (password.length < 12) {
      throw new Error(
        'Password must be at least 12 characters (ADMIN_PASSWORD or stdin).',
      );
    }
    const user = await prisma.user.create({
      data: {
        name,
        email,
        role: 'ADMIN',
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
    await prisma.auditLog.create({
      data: {
        action: 'ADMIN_CREATED',
        entityType: 'User',
        entityId: user.id,
        metadata: { via: 'cli' },
      },
    });
    console.log(`Administrator created: ${email} (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
