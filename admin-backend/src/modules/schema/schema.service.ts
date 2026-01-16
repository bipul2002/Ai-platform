import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { eq, and, sql } from 'drizzle-orm';
import { firstValueFrom } from 'rxjs';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  agents,
  agentTables,
  agentColumns,
  agentRelationships,
  agentExternalDbCredentials,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { ExternalDbService } from '../external-db/external-db.service';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateColumnDto } from './dto/update-column.dto';
import { ImportSchemaDto } from './dto/import-schema.dto';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class SchemaService {
  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private configService: ConfigService,
    private httpService: HttpService,
    private auditService: AuditService,
    private externalDbService: ExternalDbService,
    private redisService: RedisService,
  ) { }

  private async invalidateCache(agentId: string) {
    if (this.redisService) {
      await this.redisService.del(`schema:${agentId}`);
      console.log(`Invalidated schema cache for agent ${agentId}`);
    }
  }

  async getSchema(agentId: string): Promise<any> {
    const tables = await this.db
      .select()
      .from(agentTables)
      .where(eq(agentTables.agentId, agentId))
      .orderBy(agentTables.tableName);

    const columns = await this.db
      .select()
      .from(agentColumns)
      .where(eq(agentColumns.agentId, agentId));

    // Fetch relationships with table and column names using joins
    const relationshipsRaw = await this.db
      .select({
        id: agentRelationships.id,
        sourceTableId: agentRelationships.sourceTableId,
        sourceColumnId: agentRelationships.sourceColumnId,
        targetTableId: agentRelationships.targetTableId,
        targetColumnId: agentRelationships.targetColumnId,
        relationshipType: agentRelationships.relationshipType,
        isInferred: agentRelationships.isInferred,
        confidenceScore: agentRelationships.confidenceScore,
        adminDescription: agentRelationships.adminDescription,
        isActive: agentRelationships.isActive,
      })
      .from(agentRelationships)
      .where(eq(agentRelationships.agentId, agentId));

    // Map relationships to include table and column names
    const relationships = relationshipsRaw.map((rel) => {
      const sourceTable = tables.find(t => t.id === rel.sourceTableId);
      const targetTable = tables.find(t => t.id === rel.targetTableId);
      const sourceColumn = columns.find(c => c.id === rel.sourceColumnId);
      const targetColumn = columns.find(c => c.id === rel.targetColumnId);

      return {
        ...rel,
        sourceTable: sourceTable?.tableName || '',
        sourceColumn: sourceColumn?.columnName || '',
        targetTable: targetTable?.tableName || '',
        targetColumn: targetColumn?.columnName || '',
      };
    });

    const tablesWithColumns = tables.map((table) => ({
      ...table,
      columns: columns.filter((col) => col.tableId === table.id),
    }));

    return {
      tables: tablesWithColumns,
      relationships,
      stats: {
        tableCount: tables.length,
        columnCount: columns.length,
        relationshipCount: relationships.length,
      },
    };
  }

  async refreshSchema(agentId: string, userId: string): Promise<any> {
    const agentList = await this.db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (agentList.length === 0) {
      throw new NotFoundException(`Agent ${agentId} not found`);
    }

    const credentials = await this.db
      .select()
      .from(agentExternalDbCredentials)
      .where(eq(agentExternalDbCredentials.agentId, agentId))
      .limit(1);

    if (credentials.length === 0) {
      throw new BadRequestException('No database credentials configured for this agent');
    }

    const cred = credentials[0];
    const schemaData = await this.externalDbService.fetchSchema(agentId);

    // Delete relationships (they will be recreated)
    await this.db.delete(agentRelationships).where(eq(agentRelationships.agentId, agentId));

    // UPSERT tables and columns (preserve admin fields)
    for (const table of schemaData.tables) {
      // Check if table already exists
      const existingTables = await this.db
        .select()
        .from(agentTables)
        .where(
          and(
            eq(agentTables.agentId, agentId),
            eq(agentTables.schemaName, table.schema || 'public'),
            eq(agentTables.tableName, table.name)
          )
        )
        .limit(1);

      let tableId: string;

      if (existingTables.length > 0) {
        // UPDATE: Refresh external DB fields only, preserve admin fields
        await this.db
          .update(agentTables)
          .set({
            originalComment: table.comment,
            rowCountEstimate: table.rowCount,
            lastAnalyzedAt: new Date(),
            updatedAt: new Date(),
            // adminDescription, semanticHints, customPrompt,
            // isVisible, isQueryable are NOT touched
          })
          .where(eq(agentTables.id, existingTables[0].id));

        tableId = existingTables[0].id;
      } else {
        // INSERT: New table
        const newTables = await this.db
          .insert(agentTables)
          .values({
            agentId,
            tableName: table.name,
            schemaName: table.schema || 'public',
            originalComment: table.comment,
            rowCountEstimate: table.rowCount,
            lastAnalyzedAt: new Date(),
          })
          .returning();

        tableId = newTables[0].id;
      }

      // UPSERT columns for this table
      for (const column of table.columns) {
        const existingColumns = await this.db
          .select()
          .from(agentColumns)
          .where(
            and(
              eq(agentColumns.tableId, tableId),
              eq(agentColumns.columnName, column.name)
            )
          )
          .limit(1);

        if (existingColumns.length > 0) {
          // UPDATE: Refresh external DB fields only, preserve admin fields
          await this.db
            .update(agentColumns)
            .set({
              dataType: column.type,
              isNullable: column.nullable,
              isPrimaryKey: column.isPrimaryKey,
              isForeignKey: column.isForeignKey,
              isUnique: column.isUnique,
              isIndexed: column.isIndexed,
              defaultValue: column.defaultValue,
              originalComment: column.comment,
              updatedAt: new Date(),
              // adminDescription, semanticHints, customPrompt,
              // isVisible, isQueryable, isSensitive, sensitivityOverride,
              // maskingStrategyOverride are NOT touched
            })
            .where(eq(agentColumns.id, existingColumns[0].id));
        } else {
          // INSERT: New column
          await this.db.insert(agentColumns).values({
            agentId,
            tableId,
            columnName: column.name,
            dataType: column.type,
            isNullable: column.nullable,
            isPrimaryKey: column.isPrimaryKey,
            isForeignKey: column.isForeignKey,
            isUnique: column.isUnique,
            isIndexed: column.isIndexed,
            defaultValue: column.defaultValue,
            originalComment: column.comment,
          });
        }
      }
    }

    // Recreate relationships

    for (const rel of schemaData.relationships || []) {
      const sourceTable = await this.db
        .select({ id: agentTables.id })
        .from(agentTables)
        .where(
          and(
            eq(agentTables.agentId, agentId),
            eq(agentTables.tableName, rel.sourceTable)
          )
        )
        .limit(1);

      const targetTable = await this.db
        .select({ id: agentTables.id })
        .from(agentTables)
        .where(
          and(
            eq(agentTables.agentId, agentId),
            eq(agentTables.tableName, rel.targetTable)
          )
        )
        .limit(1);

      if (sourceTable.length && targetTable.length) {
        const sourceColumn = await this.db
          .select({ id: agentColumns.id })
          .from(agentColumns)
          .where(
            and(
              eq(agentColumns.tableId, sourceTable[0].id),
              eq(agentColumns.columnName, rel.sourceColumn)
            )
          )
          .limit(1);

        const targetColumn = await this.db
          .select({ id: agentColumns.id })
          .from(agentColumns)
          .where(
            and(
              eq(agentColumns.tableId, targetTable[0].id),
              eq(agentColumns.columnName, rel.targetColumn)
            )
          )
          .limit(1);

        if (sourceColumn.length && targetColumn.length) {
          await this.db.insert(agentRelationships).values({
            agentId,
            sourceTableId: sourceTable[0].id,
            sourceColumnId: sourceColumn[0].id,
            targetTableId: targetTable[0].id,
            targetColumnId: targetColumn[0].id,
            relationshipType: rel.type || 'foreign_key',
            originalConstraintName: rel.constraintName,
            isInferred: false,
          });
        }
      }
    }

    // Log the refresh action
    await this.auditService.log({
      agentId,
      userId,
      action: 'schema_refreshed',
      resourceType: 'agent',
      resourceId: agentId,
      details: {
        tablesCount: schemaData.tables.length,
        relationshipsCount: schemaData.relationships.length,
      },
    });

    await this.invalidateCache(agentId);

    return this.getSchema(agentId);
  }

  async getTable(agentId: string, tableId: string): Promise<any> {
    const tables = await this.db
      .select()
      .from(agentTables)
      .where(
        and(
          eq(agentTables.agentId, agentId),
          eq(agentTables.id, tableId)
        )
      )
      .limit(1);

    if (tables.length === 0) {
      throw new NotFoundException(`Table ${tableId} not found`);
    }

    const columns = await this.db
      .select()
      .from(agentColumns)
      .where(eq(agentColumns.tableId, tableId));

    return {
      ...tables[0],
      columns,
    };
  }

  async updateTable(
    agentId: string,
    tableId: string,
    updateDto: UpdateTableDto,
    userId: string,
  ): Promise<any> {
    await this.getTable(agentId, tableId);

    await this.db
      .update(agentTables)
      .set({
        adminDescription: updateDto.adminDescription,
        semanticHints: updateDto.semanticHints,
        customPrompt: updateDto.customPrompt,
        isVisible: updateDto.isVisible,
        isQueryable: updateDto.isQueryable,
        updatedAt: new Date(),
      })
      .where(eq(agentTables.id, tableId));

    await this.auditService.log({
      agentId,
      userId,
      action: 'metadata_updated',
      resourceType: 'table',
      resourceId: tableId,
      details: { changes: Object.keys(updateDto) },
    });

    await this.invalidateCache(agentId);

    return this.getTable(agentId, tableId);
  }

  async updateColumn(
    agentId: string,
    columnId: string,
    updateDto: UpdateColumnDto,
    userId: string,
  ): Promise<any> {
    const columns = await this.db
      .select()
      .from(agentColumns)
      .where(
        and(
          eq(agentColumns.agentId, agentId),
          eq(agentColumns.id, columnId)
        )
      )
      .limit(1);

    if (columns.length === 0) {
      throw new NotFoundException(`Column ${columnId} not found`);
    }

    await this.db
      .update(agentColumns)
      .set({
        adminDescription: updateDto.adminDescription,
        semanticHints: updateDto.semanticHints,
        customPrompt: updateDto.customPrompt,
        isVisible: updateDto.isVisible,
        isQueryable: updateDto.isQueryable,
        isSensitive: updateDto.isSensitive,
        sensitivityOverride: updateDto.sensitivityOverride,
        maskingStrategyOverride: updateDto.maskingStrategyOverride,
        updatedAt: new Date(),
      })
      .where(eq(agentColumns.id, columnId));

    await this.auditService.log({
      agentId,
      userId,
      action: 'metadata_updated',
      resourceType: 'column',
      resourceId: columnId,
      details: { changes: Object.keys(updateDto) },
    });

    await this.invalidateCache(agentId);

    return this.db
      .select()
      .from(agentColumns)
      .where(eq(agentColumns.id, columnId))
      .limit(1)
      .then((res) => res[0]);
  }

  async getRelationships(agentId: string): Promise<any[]> {
    return this.db
      .select()
      .from(agentRelationships)
      .where(eq(agentRelationships.agentId, agentId));
  }

  /**
   * Import schema from JSON without connecting to external database
   */
  async importSchema(agentId: string, importDto: ImportSchemaDto, userId: string): Promise<any> {
    // Verify agent exists
    const agentList = await this.db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (agentList.length === 0) {
      throw new NotFoundException(`Agent ${agentId} not found`);
    }

    // Delete existing schema data for this agent
    await this.db.delete(agentRelationships).where(eq(agentRelationships.agentId, agentId));
    await this.db.delete(agentColumns).where(eq(agentColumns.agentId, agentId));
    await this.db.delete(agentTables).where(eq(agentTables.agentId, agentId));

    // Track created table IDs for relationship mapping
    const tableIdMap: Record<string, string> = {};
    const columnIdMap: Record<string, Record<string, string>> = {};

    // Insert tables and columns
    for (const table of importDto.tables) {
      const schemaName = table.schema || 'public';

      // Insert table
      const insertedTables = await this.db
        .insert(agentTables)
        .values({
          agentId,
          tableName: table.name,
          schemaName: schemaName,
          originalComment: table.comment,
          rowCountEstimate: table.rowCount,
          lastAnalyzedAt: new Date(),
        })
        .returning();

      const tableId = insertedTables[0].id;
      tableIdMap[table.name] = tableId;
      columnIdMap[table.name] = {};

      // Insert columns for this table
      for (const column of table.columns) {
        const insertedColumns = await this.db
          .insert(agentColumns)
          .values({
            agentId,
            tableId,
            columnName: column.name,
            dataType: column.type,
            isNullable: column.nullable ?? true,
            isPrimaryKey: column.isPrimaryKey ?? false,
            isForeignKey: column.isForeignKey ?? false,
            isUnique: column.isUnique ?? false,
            isIndexed: column.isIndexed ?? false,
            defaultValue: column.defaultValue,
            originalComment: column.comment,
          })
          .returning();

        columnIdMap[table.name][column.name] = insertedColumns[0].id;
      }
    }

    // Insert relationships
    let relationshipsCreated = 0;
    if (importDto.relationships && importDto.relationships.length > 0) {
      for (const rel of importDto.relationships) {
        const sourceTableId = tableIdMap[rel.sourceTable];
        const targetTableId = tableIdMap[rel.targetTable];

        if (!sourceTableId || !targetTableId) {
          console.warn(`Skipping relationship: table not found (${rel.sourceTable} -> ${rel.targetTable})`);
          continue;
        }

        const sourceColumnId = columnIdMap[rel.sourceTable]?.[rel.sourceColumn];
        const targetColumnId = columnIdMap[rel.targetTable]?.[rel.targetColumn];

        if (!sourceColumnId || !targetColumnId) {
          console.warn(`Skipping relationship: column not found (${rel.sourceColumn} -> ${rel.targetColumn})`);
          continue;
        }

        await this.db.insert(agentRelationships).values({
          agentId,
          sourceTableId,
          sourceColumnId,
          targetTableId,
          targetColumnId,
          relationshipType: rel.type || 'foreign_key',
          originalConstraintName: rel.constraintName,
          isInferred: false,
        });

        relationshipsCreated++;
      }
    }

    // Calculate totals
    const totalTables = importDto.tables.length;
    const totalColumns = importDto.tables.reduce((sum, t) => sum + t.columns.length, 0);

    // Log the import action
    await this.auditService.log({
      agentId,
      userId,
      action: 'schema_refreshed',
      resourceType: 'agent',
      resourceId: agentId,
      details: {
        importType: 'json',
        tablesCount: totalTables,
        columnsCount: totalColumns,
        relationshipsCount: relationshipsCreated,
      },
    });

    await this.invalidateCache(agentId);

    return {
      success: true,
      imported: {
        tables: totalTables,
        columns: totalColumns,
        relationships: relationshipsCreated,
      },
      message: `Successfully imported ${totalTables} tables, ${totalColumns} columns, and ${relationshipsCreated} relationships`,
    };
  }
}
