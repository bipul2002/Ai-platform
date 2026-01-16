import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { eq, desc, ilike, or, sql, and, inArray } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { agents, agentExternalDbCredentials, agentTables, agentColumns, agentRelationships } from '../../db/schema';
import { CreateAgentDto } from './dto/create-agent.dto';
import { UpdateAgentDto } from './dto/update-agent.dto';
import { AgentConfigDto } from './dto/agent-config.dto';
import { AuditService } from '../audit/audit.service';
import { EncryptionService } from '../../common/encryption.service';
import { UserAgentAccessService } from '../users/user-agent-access.service';

@Injectable()
export class AgentsService {
  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private auditService: AuditService,
    private encryptionService: EncryptionService,
    private userAgentAccessService: UserAgentAccessService,
  ) { }

  async create(createAgentDto: CreateAgentDto, userId: string, organizationId: string): Promise<any> {
    const newAgents = await this.db.insert(agents).values({
      name: createAgentDto.name,
      description: createAgentDto.description,
      tags: createAgentDto.tags || [],
      isActive: true,
      createdBy: userId,
      organizationId,
      customDictionary: createAgentDto.customDictionary || {},
      systemPromptOverride: createAgentDto.systemPromptOverride,
      maxResultsLimit: createAgentDto.maxResultsLimit || 1000,
      timeoutSeconds: createAgentDto.timeoutSeconds || 30,
      disabledSensitivityRules: createAgentDto.disabledSensitivityRules || [],
    }).returning();

    const agent = newAgents[0];

    if (createAgentDto.externalDb) {
      const encryptedPassword = await this.encryptionService.encrypt(
        createAgentDto.externalDb.password
      );

      await this.db.insert(agentExternalDbCredentials).values({
        agentId: agent.id,
        dbType: createAgentDto.externalDb.dbType,
        host: createAgentDto.externalDb.host,
        port: createAgentDto.externalDb.port,
        databaseName: createAgentDto.externalDb.databaseName,
        username: createAgentDto.externalDb.username,
        encryptedPassword,
        sslEnabled: createAgentDto.externalDb.sslEnabled || false,
        connectionPoolSize: createAgentDto.externalDb.connectionPoolSize || 5,
        connectionTimeoutMs: createAgentDto.externalDb.connectionTimeoutMs || 5000,
        schemaFilterInclude: createAgentDto.externalDb.schemaFilterInclude || [],
        schemaFilterExclude: createAgentDto.externalDb.schemaFilterExclude || [],
      });
    }

    await this.auditService.log({
      agentId: agent.id,
      userId,
      organizationId,
      action: 'agent_created',
      resourceType: 'agent',
      resourceId: agent.id,
      details: { name: agent.name },
    });

    return this.findOne(agent.id);
  }

  async findAll(query?: {
    search?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }, organizationId?: string, userId?: string, userRole?: string): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const page = query?.page || 1;
    const limit = query?.limit || 20;
    const offset = (page - 1) * limit;

    // If no organizationId provided, return empty result
    // This can happen if user doesn't have an organization assigned
    if (!organizationId) {
      return {
        data: [],
        total: 0,
        page,
        limit,
      };
    }

    // For viewers, get their allowed agent IDs
    let allowedAgentIds: string[] | null = null;
    if (userRole === 'viewer' && userId) {
      allowedAgentIds = await this.userAgentAccessService.getUserAgentAccess(userId);
      if (allowedAgentIds.length === 0) {
        // Viewer has no access to any agents
        return {
          data: [],
          total: 0,
          page,
          limit,
        };
      }
    }

    // Base filter: enforce organization scoping
    const conditions = [
      eq(agents.organizationId, organizationId)
    ];

    // Add viewer access filter
    if (allowedAgentIds !== null) {
      conditions.push(inArray(agents.id, allowedAgentIds));
    }

    if (query?.search) {
      const searchCondition = or(
        ilike(agents.name, `%${query.search}%`),
        ilike(agents.description, `%${query.search}%`)
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    if (query?.isActive !== undefined) {
      conditions.push(eq(agents.isActive, query.isActive));
    }

    const whereClause = and(...conditions);

    const [agentList, countResult] = await Promise.all([
      this.db
        .select({
          id: agents.id,
          name: agents.name,
          description: agents.description,
          tags: agents.tags,
          isActive: agents.isActive,
          queryCount: agents.queryCount,
          lastUsedAt: agents.lastUsedAt,
          createdAt: agents.createdAt,
          updatedAt: agents.updatedAt,
          dbType: agentExternalDbCredentials.dbType,
          host: agentExternalDbCredentials.host,
          databaseName: agentExternalDbCredentials.databaseName,
          lastConnectionTestSuccess: agentExternalDbCredentials.lastConnectionTestSuccess,
        })
        .from(agents)
        .leftJoin(agentExternalDbCredentials, eq(agents.id, agentExternalDbCredentials.agentId))
        .where(whereClause)
        .orderBy(desc(agents.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(agents)
        .where(whereClause),
    ]);

    return {
      data: agentList,
      total: Number(countResult[0]?.count || 0),
      page,
      limit,
    };
  }

  async findOne(id: string, organizationId?: string): Promise<any> {
    const conditions = [
      eq(agents.id, id),
      organizationId ? eq(agents.organizationId, organizationId) : undefined
    ].filter(Boolean);

    const agentList = await this.db
      .select()
      .from(agents)
      .where(and(...conditions))
      .limit(1);

    if (agentList.length === 0) {
      throw new NotFoundException(`Agent with ID ${id} not found`);
    }

    const agent = agentList[0];

    const credentials = await this.db
      .select({
        id: agentExternalDbCredentials.id,
        dbType: agentExternalDbCredentials.dbType,
        host: agentExternalDbCredentials.host,
        port: agentExternalDbCredentials.port,
        databaseName: agentExternalDbCredentials.databaseName,
        username: agentExternalDbCredentials.username,
        sslEnabled: agentExternalDbCredentials.sslEnabled,
        connectionPoolSize: agentExternalDbCredentials.connectionPoolSize,
        connectionTimeoutMs: agentExternalDbCredentials.connectionTimeoutMs,
        schemaFilterInclude: agentExternalDbCredentials.schemaFilterInclude,
        schemaFilterExclude: agentExternalDbCredentials.schemaFilterExclude,
        lastConnectionTestAt: agentExternalDbCredentials.lastConnectionTestAt,
        lastConnectionTestSuccess: agentExternalDbCredentials.lastConnectionTestSuccess,
      })
      .from(agentExternalDbCredentials)
      .where(eq(agentExternalDbCredentials.agentId, id))
      .limit(1);

    const tableCount = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(agentTables)
      .where(eq(agentTables.agentId, id));

    const columnCount = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(agentColumns)
      .where(eq(agentColumns.agentId, id));

    return {
      ...agent,
      externalDb: credentials[0] || null,
      schemaStats: {
        tableCount: Number(tableCount[0]?.count || 0),
        columnCount: Number(columnCount[0]?.count || 0),
      },
    };
  }

  async update(id: string, updateAgentDto: UpdateAgentDto, userId: string, organizationId?: string): Promise<any> {
    const agent = await this.findOne(id, organizationId);

    const updateData: any = {};

    if (updateAgentDto.name !== undefined) updateData.name = updateAgentDto.name;
    if (updateAgentDto.description !== undefined) updateData.description = updateAgentDto.description;
    if (updateAgentDto.tags !== undefined) updateData.tags = updateAgentDto.tags;
    if (updateAgentDto.isActive !== undefined) updateData.isActive = updateAgentDto.isActive;
    if (updateAgentDto.customDictionary !== undefined) updateData.customDictionary = updateAgentDto.customDictionary;
    if (updateAgentDto.systemPromptOverride !== undefined) updateData.systemPromptOverride = updateAgentDto.systemPromptOverride;
    if (updateAgentDto.maxResultsLimit !== undefined) updateData.maxResultsLimit = updateAgentDto.maxResultsLimit;
    if (updateAgentDto.timeoutSeconds !== undefined) updateData.timeoutSeconds = updateAgentDto.timeoutSeconds;
    if (updateAgentDto.llmModel !== undefined) updateData.llmModel = updateAgentDto.llmModel;
    if (updateAgentDto.llmProvider !== undefined) updateData.llmProvider = updateAgentDto.llmProvider;
    if (updateAgentDto.llmTemperature !== undefined) updateData.llmTemperature = updateAgentDto.llmTemperature;
    if (updateAgentDto.disabledSensitivityRules !== undefined) updateData.disabledSensitivityRules = updateAgentDto.disabledSensitivityRules;

    if (Object.keys(updateData).length > 0) {

      updateData.updatedAt = new Date();
      await this.db
        .update(agents)
        .set(updateData)
        .where(eq(agents.id, id));
    }

    if (updateAgentDto.externalDb) {
      const dbUpdateData: any = {
        updatedAt: new Date(),
      };

      if (updateAgentDto.externalDb.dbType !== undefined) dbUpdateData.dbType = updateAgentDto.externalDb.dbType;
      if (updateAgentDto.externalDb.host !== undefined) dbUpdateData.host = updateAgentDto.externalDb.host;
      if (updateAgentDto.externalDb.port !== undefined) dbUpdateData.port = updateAgentDto.externalDb.port;
      if (updateAgentDto.externalDb.databaseName !== undefined) dbUpdateData.databaseName = updateAgentDto.externalDb.databaseName;
      if (updateAgentDto.externalDb.username !== undefined) dbUpdateData.username = updateAgentDto.externalDb.username;
      if (updateAgentDto.externalDb.sslEnabled !== undefined) dbUpdateData.sslEnabled = updateAgentDto.externalDb.sslEnabled;
      if (updateAgentDto.externalDb.connectionPoolSize !== undefined) dbUpdateData.connectionPoolSize = updateAgentDto.externalDb.connectionPoolSize;
      if (updateAgentDto.externalDb.connectionTimeoutMs !== undefined) dbUpdateData.connectionTimeoutMs = updateAgentDto.externalDb.connectionTimeoutMs;
      if (updateAgentDto.externalDb.schemaFilterInclude !== undefined) dbUpdateData.schemaFilterInclude = updateAgentDto.externalDb.schemaFilterInclude;
      if (updateAgentDto.externalDb.schemaFilterExclude !== undefined) dbUpdateData.schemaFilterExclude = updateAgentDto.externalDb.schemaFilterExclude;

      if (updateAgentDto.externalDb.password) {
        dbUpdateData.encryptedPassword = await this.encryptionService.encrypt(
          updateAgentDto.externalDb.password
        );
      }

      const existing = await this.db
        .select({ id: agentExternalDbCredentials.id })
        .from(agentExternalDbCredentials)
        .where(eq(agentExternalDbCredentials.agentId, id))
        .limit(1);

      if (existing.length > 0) {
        await this.db
          .update(agentExternalDbCredentials)
          .set(dbUpdateData)
          .where(eq(agentExternalDbCredentials.agentId, id));
      } else {
        if (!updateAgentDto.externalDb.password) {
          throw new ForbiddenException('Password is required for new database configuration');
        }
        await this.db.insert(agentExternalDbCredentials).values({
          agentId: id,
          ...dbUpdateData,
        });
      }
    }

    await this.auditService.log({
      agentId: id,
      userId,
      organizationId: agent.organizationId,
      action: 'agent_updated',
      resourceType: 'agent',
      resourceId: id,
      details: { changes: Object.keys(updateData) },
    });

    return this.findOne(id);
  }

  async remove(id: string, userId: string, organizationId?: string): Promise<void> {
    const agent = await this.findOne(id, organizationId);

    await this.auditService.log({
      agentId: id,
      userId,
      organizationId: agent.organizationId,
      action: 'agent_deleted',
      resourceType: 'agent',
      resourceId: id,
      details: { name: agent.name },
    });

    await this.db.delete(agents).where(eq(agents.id, id));
  }

  async getConfig(id: string): Promise<AgentConfigDto> {
    const agent = await this.findOne(id);

    return {
      agentId: agent.id,
      name: agent.name,
      description: agent.description,
      customDictionary: agent.customDictionary,
      systemPromptOverride: agent.systemPromptOverride,
      maxResultsLimit: agent.maxResultsLimit,
      timeoutSeconds: agent.timeoutSeconds,
      dbType: agent.externalDb?.dbType,
    };
  }

  async getConnectionDetails(id: string): Promise<any> {
    const credentials = await this.db
      .select()
      .from(agentExternalDbCredentials)
      .where(eq(agentExternalDbCredentials.agentId, id))
      .limit(1);

    if (credentials.length === 0) {
      throw new NotFoundException(`No database credentials found for agent ${id}`);
    }

    const cred = credentials[0];
    const decryptedPassword = await this.encryptionService.decrypt(cred.encryptedPassword);

    return {
      dbType: cred.dbType,
      host: cred.host,
      port: cred.port,
      database: cred.databaseName,
      username: cred.username,
      password: decryptedPassword,
      sslEnabled: cred.sslEnabled,
      sslCaCert: cred.sslCaCert,
      connectionPoolSize: cred.connectionPoolSize,
      connectionTimeoutMs: cred.connectionTimeoutMs,
    };
  }

  async updateLastUsedAt(id: string): Promise<void> {
    await this.db
      .update(agents)
      .set({
        lastUsedAt: new Date(),
        queryCount: sql`${agents.queryCount} + 1`,
      })
      .where(eq(agents.id, id));
  }

  async getEnrichedMetadata(id: string): Promise<any> {
    await this.findOne(id);

    const tables = await this.db
      .select()
      .from(agentTables)
      .where(eq(agentTables.agentId, id))
      .orderBy(agentTables.tableName);

    const columns = await this.db
      .select()
      .from(agentColumns)
      .where(eq(agentColumns.agentId, id));

    const relationships = await this.db
      .select()
      .from(agentRelationships)
      .where(eq(agentRelationships.agentId, id));

    const tablesWithColumns = tables.map((table) => ({
      ...table,
      columns: columns.filter((col) => col.tableId === table.id),
    }));

    return {
      tables: tablesWithColumns,
      relationships,
    };
  }
}
