import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/*.ts',
  out: './src/db/migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/ai_query_platform',
  },
  verbose: true,
  strict: true,
});
