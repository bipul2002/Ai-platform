import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as dotenv from 'dotenv';

dotenv.config();

async function runMigrations() {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5430/ai_query_platform';

    console.log('🔄 Running database migrations...');

    // Create postgres client for migrations
    const migrationClient = postgres(connectionString, { max: 1 });
    const db = drizzle(migrationClient);

    try {
        await migrate(db, { migrationsFolder: './src/db/migrations' });
        console.log('✅ Migrations completed successfully');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await migrationClient.end();
    }
}

runMigrations()
    .then(() => {
        console.log('Migration process finished');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Migration process failed:', error);
        process.exit(1);
    });
