const { drizzle } = require('drizzle-orm/postgres-js');
const { migrate } = require('drizzle-orm/postgres-js/migrator');
const postgres = require('postgres');
require('dotenv').config();

async function runMigrations() {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/ai_query_platform';

    console.log('🔄 Running database migrations...');

    // Create postgres client for migrations
    const migrationClient = postgres(connectionString, { max: 1 });
    const db = drizzle(migrationClient);

    try {
        // Run all migrations in the migrations folder
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
