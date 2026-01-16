import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Pool as PgPool } from 'pg';
import * as mysql from 'mysql2/promise';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { agentExternalDbCredentials, agents } from '../../db/schema';
import { EncryptionService } from '../../common/encryption.service';

interface SchemaTable {
  name: string;
  schema?: string;
  comment?: string;
  rowCount?: number;
  columns: SchemaColumn[];
}

interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique: boolean;
  isIndexed: boolean;
  defaultValue?: string;
  comment?: string;
}

interface SchemaRelationship {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  type: string;
  constraintName?: string;
}

interface SchemaData {
  tables: SchemaTable[];
  relationships: SchemaRelationship[];
}

@Injectable()
export class ExternalDbService {
  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private encryptionService: EncryptionService,
  ) { }

  async testConnection(agentId: string): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    const credentials = await this.getCredentials(agentId);
    const startTime = Date.now();

    try {
      if (credentials.dbType === 'postgresql') {
        await this.testPostgresConnection(credentials);
      } else {
        await this.testMysqlConnection(credentials);
      }

      const latencyMs = Date.now() - startTime;

      await this.db
        .update(agentExternalDbCredentials)
        .set({
          lastConnectionTestAt: new Date(),
          lastConnectionTestSuccess: true,
        })
        .where(eq(agentExternalDbCredentials.agentId, agentId));

      return { success: true, message: 'Connection successful', latencyMs };
    } catch (error: any) {
      await this.db
        .update(agentExternalDbCredentials)
        .set({
          lastConnectionTestAt: new Date(),
          lastConnectionTestSuccess: false,
        })
        .where(eq(agentExternalDbCredentials.agentId, agentId));

      return { success: false, message: error.message || 'Connection failed' };
    }
  }

  async fetchSchema(agentId: string): Promise<SchemaData> {
    const credentials = await this.getCredentials(agentId);

    if (credentials.dbType === 'postgresql') {
      return this.fetchPostgresSchema(credentials);
    } else {
      return this.fetchMysqlSchema(credentials);
    }
  }

  private async getCredentials(agentId: string): Promise<any> {
    const creds = await this.db
      .select()
      .from(agentExternalDbCredentials)
      .where(eq(agentExternalDbCredentials.agentId, agentId))
      .limit(1);

    if (creds.length === 0) {
      throw new NotFoundException(`No credentials found for agent ${agentId}`);
    }

    const credential = creds[0];
    const password = this.encryptionService.decrypt(credential.encryptedPassword);

    return {
      dbType: credential.dbType,
      host: credential.host,
      port: credential.port,
      database: credential.databaseName,
      username: credential.username,
      password,
      sslEnabled: credential.sslEnabled,
      sslCaCert: credential.sslCaCert,
      schemaFilterInclude: credential.schemaFilterInclude,
      schemaFilterExclude: credential.schemaFilterExclude,
    };
  }

  private async testPostgresConnection(credentials: any): Promise<void> {
    const pool = new PgPool({
      host: credentials.host,
      port: credentials.port,
      database: credentials.database,
      user: credentials.username,
      password: credentials.password,
      ssl: credentials.sslEnabled ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000,
    });

    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
    } finally {
      await pool.end();
    }
  }

  private async testMysqlConnection(credentials: any): Promise<void> {
    const connection = await mysql.createConnection({
      host: credentials.host,
      port: credentials.port,
      database: credentials.database,
      user: credentials.username,
      password: credentials.password,
      ssl: credentials.sslEnabled ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 5000,
    });

    try {
      await connection.execute('SELECT 1');
    } finally {
      await connection.end();
    }
  }

  private async fetchPostgresSchema(credentials: any): Promise<SchemaData> {
    const pool = new PgPool({
      host: credentials.host,
      port: credentials.port,
      database: credentials.database,
      user: credentials.username,
      password: credentials.password,
      ssl: credentials.sslEnabled ? { rejectUnauthorized: false } : false,
    });

    try {
      const client = await pool.connect();

      const tablesResult = await client.query(`
        SELECT 
          t.table_schema,
          t.table_name,
          obj_description(c.oid) as comment,
          c.reltuples::bigint as row_count
        FROM information_schema.tables t
        LEFT JOIN pg_class c ON c.relname = t.table_name
        LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
        WHERE t.table_type = 'BASE TABLE'
          AND t.table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY t.table_schema, t.table_name
      `);

      const tables: SchemaTable[] = [];

      for (const row of tablesResult.rows) {
        const columnsResult = await client.query(`
          SELECT 
            c.column_name,
            c.data_type,
            c.is_nullable,
            c.column_default,
            col_description(t.oid, c.ordinal_position) as comment,
            CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
            CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key,
            CASE WHEN uq.column_name IS NOT NULL THEN true ELSE false END as is_unique,
            CASE WHEN ix.column_name IS NOT NULL THEN true ELSE false END as is_indexed
          FROM information_schema.columns c
          LEFT JOIN pg_class t ON t.relname = c.table_name
          LEFT JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = c.table_schema
          LEFT JOIN (
            SELECT ku.column_name, ku.table_name, ku.table_schema
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
            WHERE tc.constraint_type = 'PRIMARY KEY'
          ) pk ON pk.column_name = c.column_name AND pk.table_name = c.table_name AND pk.table_schema = c.table_schema
          LEFT JOIN (
            SELECT ku.column_name, ku.table_name, ku.table_schema
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY'
          ) fk ON fk.column_name = c.column_name AND fk.table_name = c.table_name AND fk.table_schema = c.table_schema
          LEFT JOIN (
            SELECT ku.column_name, ku.table_name, ku.table_schema
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
            WHERE tc.constraint_type = 'UNIQUE'
          ) uq ON uq.column_name = c.column_name AND uq.table_name = c.table_name AND uq.table_schema = c.table_schema
          LEFT JOIN (
            SELECT DISTINCT a.attname as column_name, t.relname as table_name, n.nspname as table_schema
            FROM pg_index i
            JOIN pg_class t ON t.oid = i.indrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
            JOIN pg_namespace n ON n.oid = t.relnamespace
          ) ix ON ix.column_name = c.column_name AND ix.table_name = c.table_name AND ix.table_schema = c.table_schema
          WHERE c.table_name = $1 AND c.table_schema = $2
          ORDER BY c.ordinal_position
        `, [row.table_name, row.table_schema]);

        tables.push({
          name: row.table_name,
          schema: row.table_schema,
          comment: row.comment,
          // Set rowCount to null if it's negative or -1 (invalid/unavailable)
          rowCount: row.row_count && row.row_count > 0 ? row.row_count : null,
          columns: columnsResult.rows.map((col) => ({
            name: col.column_name,
            type: col.data_type,
            nullable: col.is_nullable === 'YES',
            isPrimaryKey: col.is_primary_key,
            isForeignKey: col.is_foreign_key,
            isUnique: col.is_unique,
            isIndexed: col.is_indexed,
            defaultValue: col.column_default,
            comment: col.comment,
          })),
        });
      }

      const relationshipsResult = await client.query(`
        SELECT
    
    child.relname     AS source_table,
    a_child.attname   AS source_column,
    
    parent.relname    AS target_table,
    a_parent.attname  AS target_column,
    con.conname       AS constraint_name
FROM pg_constraint con
JOIN pg_class child        ON con.conrelid  = child.oid
JOIN pg_namespace n_child  ON n_child.oid   = child.relnamespace
JOIN pg_class parent       ON con.confrelid = parent.oid
JOIN pg_namespace n_parent ON n_parent.oid  = parent.relnamespace
JOIN pg_attribute a_child
  ON a_child.attrelid = child.oid
 AND a_child.attnum   = ANY (con.conkey)
JOIN pg_attribute a_parent
  ON a_parent.attrelid = parent.oid
 AND a_parent.attnum   = ANY (con.confkey)
WHERE con.contype = 'f'
      `);
      console.log(relationshipsResult.rows);
      const relationships: SchemaRelationship[] = relationshipsResult.rows.map((row) => ({
        sourceTable: row.source_table,
        sourceColumn: row.source_column,
        targetTable: row.target_table,
        targetColumn: row.target_column,
        type: 'foreign_key',
        constraintName: row.constraint_name,
      }));
      console.log(relationships);

      client.release();
      return { tables, relationships };
    } finally {
      await pool.end();
    }
  }

  private async fetchMysqlSchema(credentials: any): Promise<SchemaData> {
    const connection = await mysql.createConnection({
      host: credentials.host,
      port: credentials.port,
      database: credentials.database,
      user: credentials.username,
      password: credentials.password,
      ssl: credentials.sslEnabled ? { rejectUnauthorized: false } : undefined,
    });

    try {
      const [tablesRows] = await connection.execute(`
        SELECT 
          TABLE_NAME as table_name,
          TABLE_SCHEMA as table_schema,
          TABLE_COMMENT as comment,
          TABLE_ROWS as row_count
        FROM information_schema.tables
        WHERE TABLE_SCHEMA = ?
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
      `, [credentials.database]);

      const tables: SchemaTable[] = [];

      for (const row of tablesRows as any[]) {
        const [columnsRows] = await connection.execute(`
          SELECT 
            COLUMN_NAME as column_name,
            DATA_TYPE as data_type,
            IS_NULLABLE as is_nullable,
            COLUMN_DEFAULT as column_default,
            COLUMN_COMMENT as comment,
            COLUMN_KEY as column_key,
            EXTRA as extra
          FROM information_schema.columns
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION
        `, [credentials.database, row.table_name]);

        tables.push({
          name: row.table_name,
          schema: row.table_schema,
          comment: row.comment,
          // Set rowCount to null if it's negative or -1 (invalid/unavailable)
          rowCount: row.row_count && row.row_count > 0 ? row.row_count : null,
          columns: (columnsRows as any[]).map((col) => ({
            name: col.column_name,
            type: col.data_type,
            nullable: col.is_nullable === 'YES',
            isPrimaryKey: col.column_key === 'PRI',
            isForeignKey: col.column_key === 'MUL',
            isUnique: col.column_key === 'UNI',
            isIndexed: col.column_key !== '',
            defaultValue: col.column_default,
            comment: col.comment,
          })),
        });
      }

      const [relationshipsRows] = await connection.execute(`
        SELECT
          TABLE_NAME as source_table,
          COLUMN_NAME as source_column,
          REFERENCED_TABLE_NAME as target_table,
          REFERENCED_COLUMN_NAME as target_column,
          CONSTRAINT_NAME as constraint_name
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ?
          AND REFERENCED_TABLE_NAME IS NOT NULL
      `, [credentials.database]);

      const relationships: SchemaRelationship[] = (relationshipsRows as any[]).map((row) => ({
        sourceTable: row.source_table,
        sourceColumn: row.source_column,
        targetTable: row.target_table,
        targetColumn: row.target_column,
        type: 'foreign_key',
        constraintName: row.constraint_name,
      }));

      return { tables, relationships };
    } finally {
      await connection.end();
    }
  }
}
