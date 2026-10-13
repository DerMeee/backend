import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DATABASE_URL is only needed by the Prisma CLI for migrate/db/studio commands.
// `prisma generate` (local dev and Docker build stages) must work without it,
// so the datasource block is only added when the variable is present.
// The application itself connects through the pg driver adapter in PrismaService.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
