import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { userAgentAccess, agents } from '../../db/schema/core.schema';

@Injectable()
export class UserAgentAccessService {
  constructor(@Inject(DRIZZLE) private db: DrizzleDB) {}

  /**
   * Get the list of agent IDs that a user has access to
   */
  async getUserAgentAccess(userId: string): Promise<string[]> {
    const access = await this.db
      .select({ agentId: userAgentAccess.agentId })
      .from(userAgentAccess)
      .where(eq(userAgentAccess.userId, userId));

    return access.map(a => a.agentId);
  }

  /**
   * Get the list of agents with full details that a user has access to
   */
  async getUserAgentsWithDetails(userId: string, organizationId: string) {
    const result = await this.db
      .select({
        id: agents.id,
        name: agents.name,
        description: agents.description,
        isActive: agents.isActive,
        createdAt: userAgentAccess.createdAt,
      })
      .from(userAgentAccess)
      .innerJoin(agents, eq(userAgentAccess.agentId, agents.id))
      .where(
        and(
          eq(userAgentAccess.userId, userId),
          eq(agents.organizationId, organizationId),
          eq(agents.isActive, true)
        )
      );

    return result;
  }

  /**
   * Set which agents a user has access to (replaces existing access)
   */
  async setUserAgentAccess(
    userId: string,
    agentIds: string[],
    grantedBy: string,
    userOrganizationId: string
  ): Promise<void> {
    // Verify all agents belong to the same organization
    if (agentIds.length > 0) {
      const agentCheck = await this.db
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            inArray(agents.id, agentIds),
            eq(agents.organizationId, userOrganizationId)
          )
        );

      if (agentCheck.length !== agentIds.length) {
        throw new ForbiddenException('Some agents do not belong to the user organization');
      }
    }

    // Remove all existing access for this user
    await this.db
      .delete(userAgentAccess)
      .where(eq(userAgentAccess.userId, userId));

    // Add new access entries
    if (agentIds.length > 0) {
      await this.db.insert(userAgentAccess).values(
        agentIds.map(agentId => ({
          userId,
          agentId,
          grantedBy,
        }))
      );
    }
  }

  /**
   * Check if a user has access to a specific agent
   */
  async hasAgentAccess(userId: string, agentId: string): Promise<boolean> {
    const result = await this.db
      .select({ id: userAgentAccess.id })
      .from(userAgentAccess)
      .where(
        and(
          eq(userAgentAccess.userId, userId),
          eq(userAgentAccess.agentId, agentId)
        )
      )
      .limit(1);

    return result.length > 0;
  }
}
