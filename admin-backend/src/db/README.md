# Database Setup Guide

## Schema Management Strategy

This project uses **Drizzle ORM migrations only** for all database schema management.

### Components:

1. **Schema Definitions** (`src/db/schema/*.ts`):
   - TypeScript/Drizzle ORM schema definitions
   - **Source of truth** for the database structure
   - Used by the application at runtime

2. **Migrations** (`src/db/migrations/*.sql`):
   - Auto-generated SQL migrations from schema changes
   - Run automatically on application startup
   - Tracked in `__drizzle_migrations` table

## For New Deployments

When setting up on a new machine:

1. **First Time Setup**:
   ```bash
   docker-compose up --build
   ```
   - Postgres container starts with empty database
   - Application runs ALL migrations automatically
   - Creates all tables, enums, indexes, and constraints
   - Seeding creates the default admin user

2. **Subsequent Starts**:
   - Drizzle tracks which migrations have run
   - Only new migrations are executed
   - Safe to run multiple times

## Making Schema Changes

1. **Update Schema** (`src/db/schema/*.ts`):
   ```typescript
   // Example: Add a new column
   export const agents = pgTable('agents', {
     // ... existing fields
     newField: varchar('new_field', { length: 100 }),
   });
   ```

2. **Generate Migration**:
   ```bash
   npm run db:generate
   ```
   This creates a new SQL file in `src/db/migrations/`

3. **Review Migration**:
   - Check the generated SQL
   - Fix any issues (like empty array defaults)

4. **Deploy**:
   - Commit the migration file
   - Restart the application
   - Migration runs automatically

## Migration Files

Current migrations:
- `0001_add_llm_fields.sql` - Adds LLM configuration columns to agents table

## Important Notes

- **Single Source of Truth**: Schema definitions in TypeScript
- **Automatic Execution**: Migrations run on app startup
- **Safe**: Drizzle tracks executed migrations
- **No Manual SQL**: Always use `npm run db:generate`
