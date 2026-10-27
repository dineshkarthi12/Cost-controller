import path from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Load the repository-level .env when present; real environment variables take precedence.
config({ path: path.resolve(process.cwd(), '../../.env') });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { path: path.join('prisma', 'migrations'), seed: 'tsx prisma/seed.ts' },
});
