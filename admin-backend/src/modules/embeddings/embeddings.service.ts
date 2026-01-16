import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { eq, sql, desc } from 'drizzle-orm';
import { firstValueFrom } from 'rxjs';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { agentSchemaEmbeddings, agentTables, agentColumns, agents } from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';

interface EmbeddingResponse {
  embeddings: number[][];
}

@Injectable()
export class EmbeddingsService {
  private readonly aiRuntimeUrl: string;

  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private configService: ConfigService,
    private httpService: HttpService,
    private auditService: AuditService,
    private redisService: RedisService,
  ) {
    this.aiRuntimeUrl = this.configService.get<string>('aiRuntime.url') || 'http://localhost:8000';
  }

  private async invalidateCache(agentId: string) {
    if (this.redisService) {
      // Invalidate all embedding search results for this agent
      await this.redisService.delPattern(`embedding_search:${agentId}:*`);
      console.log(`Invalidated embedding cache for agent ${agentId}`);
    }
  }

  async getEmbeddings(agentId: string): Promise<any[]> {
    return this.db
      .select({
        id: agentSchemaEmbeddings.id,
        targetType: agentSchemaEmbeddings.targetType,
        targetId: agentSchemaEmbeddings.targetId,
        embeddingText: agentSchemaEmbeddings.embeddingText,
        embeddingModel: agentSchemaEmbeddings.embeddingModel,
        metadata: agentSchemaEmbeddings.metadata,
        createdAt: agentSchemaEmbeddings.createdAt,
        updatedAt: agentSchemaEmbeddings.updatedAt,
      })
      .from(agentSchemaEmbeddings)
      .where(eq(agentSchemaEmbeddings.agentId, agentId))
      .orderBy(desc(agentSchemaEmbeddings.updatedAt));
  }

  async generateEmbeddings(agentId: string, userId: string, authToken?: string): Promise<any> {
    const agentList = await this.db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (agentList.length === 0) {
      throw new NotFoundException(`Agent ${agentId} not found`);
    }

    const tables = await this.db
      .select()
      .from(agentTables)
      .where(eq(agentTables.agentId, agentId));

    const columns = await this.db
      .select()
      .from(agentColumns)
      .where(eq(agentColumns.agentId, agentId));

    const embeddingData: { targetType: string; targetId: string; text: string; metadata: Record<string, any> }[] = [];

    // Build columns lookup for relationship enrichment
    const columnsByTableId = columns.reduce((acc, col) => {
      if (!acc[col.tableId]) acc[col.tableId] = [];
      acc[col.tableId].push(col);
      return acc;
    }, {} as Record<string, any[]>);

    for (const table of tables) {
      const tableColumns = columnsByTableId[table.id] || [];
      const tableText = this.buildTableEmbeddingText(table, tableColumns);
      embeddingData.push({
        targetType: 'table',
        targetId: table.id,
        text: tableText,
        metadata: {
          table_name: table.tableName,
          schema_name: table.schemaName || 'public',
        },
      });
    }

    for (const column of columns) {
      const table = tables.find((t) => t.id === column.tableId);
      const columnText = this.buildColumnEmbeddingText(column, table?.tableName || '', table);
      embeddingData.push({
        targetType: 'column',
        targetId: column.id,
        text: columnText,
        metadata: {
          table_name: table?.tableName || '',
          column_name: column.columnName,
          schema_name: table?.schemaName || 'public',
        },
      });
    }

    const embeddings = await this.callEmbeddingService(embeddingData.map((e) => e.text), authToken);

    await this.db
      .delete(agentSchemaEmbeddings)
      .where(eq(agentSchemaEmbeddings.agentId, agentId));

    for (let i = 0; i < embeddingData.length; i++) {
      const item = embeddingData[i];
      const vector = embeddings[i];

      await this.db.insert(agentSchemaEmbeddings).values({
        agentId,
        targetType: item.targetType,
        targetId: item.targetId,
        embeddingText: item.text,
        embeddingVector: vector,
        embeddingModel: 'text-embedding-3-small',
        metadata: item.metadata,
      });
    }

    await this.auditService.log({
      agentId,
      userId,
      action: 'embedding_generated',
      resourceType: 'embeddings',
      resourceId: agentId,
      details: {
        tableCount: tables.length,
        columnCount: columns.length,
        totalEmbeddings: embeddingData.length,
      },
    });

    await this.invalidateCache(agentId);

    return {
      success: true,
      embeddingsGenerated: embeddingData.length,
      tables: tables.length,
      columns: columns.length,
    };
  }

  async searchSimilar(agentId: string, query: string, limit: number = 10, authToken?: string): Promise<any[]> {
    const queryEmbedding = await this.callEmbeddingService([query], authToken);

    if (!queryEmbedding || queryEmbedding.length === 0) {
      return [];
    }

    const vectorString = `[${queryEmbedding[0].join(',')}]`;

    const results = await this.db.execute(sql`
      SELECT 
        id,
        target_type,
        target_id,
        embedding_text,
        metadata,
        1 - (embedding_vector <=> ${sql.raw(`'${vectorString}'::vector`)}) as similarity
      FROM agent_schema_embeddings
      WHERE agent_id = ${agentId}
      ORDER BY embedding_vector <=> ${sql.raw(`'${vectorString}'::vector`)}
      LIMIT ${limit}
    `);

    return results as any[];
  }

  private buildTableEmbeddingText(table: any, columns?: any[]): string {
    const parts = [];

    // 1. Table name (critical for keyword matching)
    parts.push(`Table name: ${table.tableName}`);

    // 2. Business description (from admin or comments)
    const description = this.cleanText(table.adminDescription || table.originalComment || '');
    if (description) {
      parts.push(description);
    } else {
      // If no description, add a generic one based on table name
      const readableName = table.tableName.replace(/_/g, ' ');
      parts.push(`Table storing ${readableName} records`);
    }

    // 3. Schema context
    parts.push(`Schema: ${table.schemaName || 'public'}`);

    // 4. Related entities (from FK column names)
    if (columns && columns.length > 0) {
      const fkColumns = columns.filter(c => c.isForeignKey);
      if (fkColumns.length > 0) {
        const relationships = fkColumns
          .map(c => this.extractRelatedTableName(c.columnName))
          .filter(Boolean)
          .join(', ');
        if (relationships) {
          parts.push(`Related to: ${relationships}`);
          parts.push(`Links with ${relationships} for data analysis and reporting`);
        }
      }

      // 5. Key columns (non-ID important columns)
      const importantCols = columns
        .filter(c => !c.columnName.toLowerCase().endsWith('_id') &&
          c.columnName.toLowerCase() !== 'id' &&
          !c.isPrimaryKey)
        .slice(0, 5)
        .map(c => c.columnName.replace(/_/g, ' '))
        .join(', ');
      if (importantCols) {
        parts.push(`Key fields include: ${importantCols}`);
      }
    }

    // 6. Use cases and semantic hints
    if (table.semanticHints) {
      parts.push(`Common queries: ${this.cleanText(table.semanticHints)}`);
    }

    return parts.filter(Boolean).join('. ');
  }

  // Helper: Extract related table name from FK column name
  // procuring_entity_id → procuring entity
  // supplier_id → supplier
  private extractRelatedTableName(columnName: string): string {
    return columnName
      .replace(/_id$/i, '')
      .replace(/_/g, ' ')
      .trim();
  }

  private buildColumnEmbeddingText(column: any, tableName: string, table?: any): string {
    const parts = [];

    // 1. Column name and table
    parts.push(`Column: ${column.columnName} in ${tableName} table`);

    // 2. Data type (in plain language)
    const friendlyType = this.getFriendlyType(column.dataType);
    parts.push(`Type: ${friendlyType}`);

    // 3. Key information with relationship context
    if (column.isPrimaryKey) {
      parts.push('Primary identifier for the table');
    } else if (column.isForeignKey) {
      const referencedTable = this.extractRelatedTableName(column.columnName);
      if (referencedTable) {
        parts.push(`Links to ${referencedTable} table`);
        parts.push(`Represents the ${referencedTable}`);
        parts.push(`Used for grouping by ${referencedTable}, joining with ${referencedTable} data, filtering by ${referencedTable}`);
      } else {
        parts.push('Foreign key relationship');
      }
    }

    // 4. Business description
    const description = this.cleanText(column.adminDescription || column.originalComment || '');
    if (description) {
      parts.push(description);
    }

    // 5. Semantic hints (use cases)
    if (column.semanticHints) {
      parts.push(this.cleanText(column.semanticHints));
    }

    return parts.filter(Boolean).join('. ');
  }

  // Convert technical data types to friendly names
  private getFriendlyType(dataType: string): string {
    const typeMap: Record<string, string> = {
      'uuid': 'unique identifier',
      'varchar': 'text',
      'character varying': 'text',
      'text': 'long text',
      'integer': 'whole number',
      'int': 'whole number',
      'bigint': 'large number',
      'smallint': 'small number',
      'timestamp': 'date and time',
      'timestamp without time zone': 'date and time',
      'timestamp with time zone': 'date and time with timezone',
      'date': 'date',
      'time': 'time',
      'boolean': 'yes/no flag',
      'bool': 'yes/no flag',
      'decimal': 'decimal number',
      'numeric': 'precise number',
      'real': 'decimal number',
      'double precision': 'precise decimal',
      'json': 'JSON data',
      'jsonb': 'JSON data',
      'array': 'list of values'
    };

    const lowerType = dataType.toLowerCase();
    for (const [key, value] of Object.entries(typeMap)) {
      if (lowerType.includes(key)) {
        return value;
      }
    }

    return dataType; // Return original if no mapping found
  }

  private cleanText(text: string): string {
    if (!text) return '';
    // Remove newlines, weird characters, and excessive whitespace
    return text
      .replace(/[\r\n]+/g, ' ') // Replace newlines with space
      .replace(/=u003E/g, '->') // Fix common JSON escape sequences
      .replace(/\s+/g, ' ')     // Collapse multiple spaces
      .trim();
  }

  private async callEmbeddingService(texts: string[], authToken?: string): Promise<number[][]> {
    try {
      const headers: Record<string, string> = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await firstValueFrom(
        this.httpService.post<EmbeddingResponse>(
          `${this.aiRuntimeUrl}/api/embeddings/generate`,
          { texts, model: 'text-embedding-3-small' },
          {
            timeout: 60000,
            headers
          }
        )
      );

      return (response.data as EmbeddingResponse).embeddings;
    } catch (error) {
      console.error('Failed to generate embeddings:', error);
      return texts.map(() => new Array(1536).fill(0));
    }
  }
}
