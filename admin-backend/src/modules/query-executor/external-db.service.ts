import { Injectable, BadRequestException, Logger, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { agentExternalDbCredentials } from '../../db/schema/core.schema';
import { EncryptionService } from '../../common/encryption.service';

interface DbCredentials {
    host: string;
    port: number;
    database: string;
    username: string;
    encryptedPassword: string;
}

@Injectable()
export class ExternalDbService {
    private readonly logger = new Logger(ExternalDbService.name);
    private pools = new Map<string, Pool>();

    constructor(
        @Inject(DRIZZLE) private db: DrizzleDB,
        private encryptionService: EncryptionService,
    ) { }

    async executeQuery(credentials: DbCredentials, sql: string): Promise<any[]> {
        const pool = await this.getOrCreatePool(credentials);

        try {
            this.logger.log(`Executing query: ${sql.substring(0, 100)}...`);
            const result = await pool.query(sql);
            return result.rows;
        } catch (error) {
            this.logger.error('Query execution failed', error.stack);
            throw new BadRequestException(`Query execution failed: ${error.message}`);
        }
    }

    async getAgentCredentials(agentId: string): Promise<DbCredentials> {
        const credentials = await this.db
            .select()
            .from(agentExternalDbCredentials)
            .where(eq(agentExternalDbCredentials.agentId, agentId))
            .limit(1);

        if (!credentials || credentials.length === 0) {
            throw new BadRequestException('Agent database credentials not found');
        }

        const cred = credentials[0];

        return {
            host: cred.host,
            port: cred.port,
            database: cred.databaseName,
            username: cred.username,
            encryptedPassword: cred.encryptedPassword,
        };
    }

    private async getOrCreatePool(credentials: DbCredentials): Promise<Pool> {
        const key = this.getPoolKey(credentials);

        if (!this.pools.has(key)) {
            const password = this.encryptionService.decrypt(
                credentials.encryptedPassword,
            );

            const pool = new Pool({
                host: credentials.host,
                port: credentials.port,
                database: credentials.database,
                user: credentials.username,
                password,
                max: 10,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 10000,
                ssl: {
                    rejectUnauthorized: false
                }
            });

            // Test connection
            try {
                await pool.query('SELECT 1');
                this.logger.log(`Created connection pool for ${key}`);
            } catch (error) {
                this.logger.error(`Failed to connect to database: ${key}`, error.stack);
                throw new BadRequestException(`Failed to connect to external database: ${error.message}`);
            }

            this.pools.set(key, pool);
        }

        return this.pools.get(key)!;
    }

    private getPoolKey(credentials: DbCredentials): string {
        return `${credentials.host}:${credentials.port}:${credentials.database}`;
    }

    async closeAll() {
        for (const [key, pool] of this.pools.entries()) {
            await pool.end();
            this.logger.log(`Closed connection pool for ${key}`);
        }
        this.pools.clear();
    }

    onModuleDestroy() {
        this.closeAll();
    }
}
