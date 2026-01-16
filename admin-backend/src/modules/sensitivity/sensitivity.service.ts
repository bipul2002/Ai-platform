import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, or } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  sensitiveFieldRegistryGlobal,
  sensitiveFieldRegistryAgent,
  forbiddenFields,
  agentColumns,
  agentTables,
  agents,
} from '../../db/schema';
import { AuditService } from '../audit/audit.service';
import { CreateSensitivityRuleDto } from './dto/create-sensitivity-rule.dto';
import { UpdateSensitivityRuleDto } from './dto/update-sensitivity-rule.dto';

@Injectable()
export class SensitivityService {
  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private auditService: AuditService,
  ) { }

  async getGlobalRules(): Promise<any[]> {
    return this.db
      .select()
      .from(sensitiveFieldRegistryGlobal)
      .where(eq(sensitiveFieldRegistryGlobal.isActive, true));
  }

  async createGlobalRule(dto: CreateSensitivityRuleDto, userId: string): Promise<any> {
    const rules = await this.db
      .insert(sensitiveFieldRegistryGlobal)
      .values({
        patternType: dto.patternType,
        patternValue: dto.patternValue,
        patternRegex: dto.patternRegex,
        sensitivityLevel: dto.sensitivityLevel,
        maskingStrategy: dto.maskingStrategy,
        description: dto.description,
        createdBy: userId,
      })
      .returning();

    await this.auditService.log({
      userId,
      organizationId: null, // Global rule - only visible to Super Admin
      action: 'sensitivity_rule_created',
      resourceType: 'global_sensitivity',
      resourceId: rules[0].id,
      details: { patternType: dto.patternType, patternValue: dto.patternValue },
    });

    return rules[0];
  }

  async updateGlobalRule(id: string, dto: UpdateSensitivityRuleDto, userId: string): Promise<any> {
    const existing = await this.db
      .select()
      .from(sensitiveFieldRegistryGlobal)
      .where(eq(sensitiveFieldRegistryGlobal.id, id))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException(`Global rule ${id} not found`);
    }

    await this.db
      .update(sensitiveFieldRegistryGlobal)
      .set({
        patternType: dto.patternType,
        patternValue: dto.patternValue,
        patternRegex: dto.patternRegex,
        sensitivityLevel: dto.sensitivityLevel,
        maskingStrategy: dto.maskingStrategy,
        description: dto.description,
        isActive: dto.isActive,
        updatedAt: new Date(),
      })
      .where(eq(sensitiveFieldRegistryGlobal.id, id));

    await this.auditService.log({
      userId,
      organizationId: null, // Global rule - only visible to Super Admin
      action: 'sensitivity_rule_updated',
      resourceType: 'global_sensitivity',
      resourceId: id,
      details: { changes: Object.keys(dto) },
    });

    return this.db
      .select()
      .from(sensitiveFieldRegistryGlobal)
      .where(eq(sensitiveFieldRegistryGlobal.id, id))
      .limit(1)
      .then((res) => res[0]);
  }

  async deleteGlobalRule(id: string, userId: string): Promise<void> {
    await this.db
      .delete(sensitiveFieldRegistryGlobal)
      .where(eq(sensitiveFieldRegistryGlobal.id, id));

    await this.auditService.log({
      userId,
      organizationId: null, // Global rule - only visible to Super Admin
      action: 'sensitivity_rule_deleted',
      resourceType: 'global_sensitivity',
      resourceId: id,
    });
  }

  async getAgentRules(agentId: string): Promise<any[]> {
    return this.db
      .select()
      .from(sensitiveFieldRegistryAgent)
      .where(
        and(
          eq(sensitiveFieldRegistryAgent.agentId, agentId),
          eq(sensitiveFieldRegistryAgent.isActive, true)
        )
      );
  }

  async createAgentRule(agentId: string, dto: CreateSensitivityRuleDto, userId: string): Promise<any> {
    // Fetch agent's organizationId for proper scoping
    const agent = await this.db
      .select({ organizationId: agents.organizationId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    const rules = await this.db
      .insert(sensitiveFieldRegistryAgent)
      .values({
        agentId,
        columnId: dto.columnId,
        patternType: dto.patternType,
        patternValue: dto.patternValue,
        patternRegex: dto.patternRegex,
        sensitivityLevel: dto.sensitivityLevel,
        maskingStrategy: dto.maskingStrategy,
        description: dto.description,
        createdBy: userId,
      })
      .returning();

    await this.auditService.log({
      agentId,
      userId,
      organizationId: agent[0]?.organizationId || null,
      action: 'sensitivity_rule_created',
      resourceType: 'agent_sensitivity',
      resourceId: rules[0].id,
      details: { patternType: dto.patternType, patternValue: dto.patternValue },
    });

    return rules[0];
  }

  async updateAgentRule(
    agentId: string,
    ruleId: string,
    dto: UpdateSensitivityRuleDto,
    userId: string,
  ): Promise<any> {
    // Fetch agent's organizationId for proper scoping
    const agent = await this.db
      .select({ organizationId: agents.organizationId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    const existing = await this.db
      .select()
      .from(sensitiveFieldRegistryAgent)
      .where(
        and(
          eq(sensitiveFieldRegistryAgent.agentId, agentId),
          eq(sensitiveFieldRegistryAgent.id, ruleId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException(`Agent rule ${ruleId} not found`);
    }

    await this.db
      .update(sensitiveFieldRegistryAgent)
      .set({
        patternType: dto.patternType,
        patternValue: dto.patternValue,
        patternRegex: dto.patternRegex,
        sensitivityLevel: dto.sensitivityLevel,
        maskingStrategy: dto.maskingStrategy,
        description: dto.description,
        isActive: dto.isActive,
        updatedAt: new Date(),
      })
      .where(eq(sensitiveFieldRegistryAgent.id, ruleId));

    await this.auditService.log({
      agentId,
      userId,
      organizationId: agent[0]?.organizationId || null,
      action: 'sensitivity_rule_updated',
      resourceType: 'agent_sensitivity',
      resourceId: ruleId,
      details: { changes: Object.keys(dto) },
    });

    return this.db
      .select()
      .from(sensitiveFieldRegistryAgent)
      .where(eq(sensitiveFieldRegistryAgent.id, ruleId))
      .limit(1)
      .then((res) => res[0]);
  }

  async deleteAgentRule(agentId: string, ruleId: string, userId: string): Promise<void> {
    // Fetch agent's organizationId for proper scoping
    const agent = await this.db
      .select({ organizationId: agents.organizationId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    await this.db
      .delete(sensitiveFieldRegistryAgent)
      .where(
        and(
          eq(sensitiveFieldRegistryAgent.agentId, agentId),
          eq(sensitiveFieldRegistryAgent.id, ruleId)
        )
      );

    await this.auditService.log({
      agentId,
      userId,
      organizationId: agent[0]?.organizationId || null,
      action: 'sensitivity_rule_deleted',
      resourceType: 'agent_sensitivity',
      resourceId: ruleId,
    });
  }

  async getCombinedRules(agentId: string): Promise<any> {
    const globalRules = await this.getGlobalRules();
    const agentRules = await this.getAgentRules(agentId);

    const forbidden = await this.db
      .select()
      .from(forbiddenFields)
      .where(
        or(
          eq(forbiddenFields.agentId, agentId),
          eq(forbiddenFields.scope, 'global')
        )
      );

    // Fetch schema-based sensitive columns
    const schemaSensitiveColumns = await this.db
      .select({
        id: agentColumns.id,
        tableName: agentTables.tableName,
        columnName: agentColumns.columnName,
        dataType: agentColumns.dataType,
        isSensitive: agentColumns.isSensitive,
        sensitivityLevel: agentColumns.sensitivityOverride,
        maskingStrategy: agentColumns.maskingStrategyOverride,
        adminDescription: agentColumns.adminDescription,
      })
      .from(agentColumns)
      .innerJoin(agentTables, eq(agentColumns.tableId, agentTables.id))
      .where(
        and(
          eq(agentTables.agentId, agentId),
          eq(agentColumns.isSensitive, true)
        )
      )
      .orderBy(agentTables.tableName, agentColumns.columnName);

    return {
      globalRules,
      agentRules,
      schemaSensitiveColumns,
      forbiddenFields: forbidden,
    };
  }

  async getForbiddenFields(agentId: string): Promise<any[]> {
    return this.db
      .select()
      .from(forbiddenFields)
      .where(
        and(
          or(
            eq(forbiddenFields.agentId, agentId),
            eq(forbiddenFields.scope, 'global')
          ),
          eq(forbiddenFields.isActive, true)
        )
      );
  }
}
