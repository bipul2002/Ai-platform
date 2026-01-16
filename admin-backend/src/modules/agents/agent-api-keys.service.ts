import { Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { agentApiKeys, agents } from '../../db/schema';
import { EncryptionService } from '../../common/encryption.service';

@Injectable()
export class AgentApiKeysService {
  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private encryptionService: EncryptionService,
  ) {}

  async create(agentId: string, name: string, userId: string, userOrg: string) {
    // Verify agent access
    const agent = await this.verifyAgentAccess(agentId, userOrg);

    // Generate API key
    const apiKey = this.encryptionService.generateApiKey();
    const encryptedKey = this.encryptionService.encrypt(apiKey);

    // Store in database
    const [created] = await this.db.insert(agentApiKeys).values({
      agentId,
      name,
      encryptedKey,
      createdBy: userId,
    }).returning();

    // Return with plaintext key (only time it's shown)
    return {
      ...created,
      apiKey, // Plain key, never stored
    };
  }

  async list(agentId: string, userOrg: string) {
    await this.verifyAgentAccess(agentId, userOrg);

    return this.db.query.agentApiKeys.findMany({
      where: eq(agentApiKeys.agentId, agentId),
      orderBy: (keys, { desc }) => [desc(keys.createdAt)],
    });
  }

  async revoke(keyId: string, userOrg: string) {
    const key = await this.db.query.agentApiKeys.findFirst({
      where: eq(agentApiKeys.id, keyId),
      with: { agent: true },
    });

    if (!key) throw new NotFoundException('API key not found');
    if (key.agent.organizationId !== userOrg) {
      throw new ForbiddenException('Access denied');
    }

    await this.db.update(agentApiKeys)
      .set({ isActive: false })
      .where(eq(agentApiKeys.id, keyId));
  }

  async revealKey(keyId: string, userOrg: string) {
    const key = await this.db.query.agentApiKeys.findFirst({
      where: eq(agentApiKeys.id, keyId),
      with: { agent: true },
    });

    if (!key) throw new NotFoundException('API key not found');
    if (key.agent.organizationId !== userOrg) {
      throw new ForbiddenException('Access denied');
    }

    return this.encryptionService.decrypt(key.encryptedKey);
  }

  async updateUsage(keyId: string) {
    await this.db.update(agentApiKeys)
      .set({
        lastUsedAt: new Date(),
        requestCount: sql`${agentApiKeys.requestCount} + 1`,
      })
      .where(eq(agentApiKeys.id, keyId));
  }

  async findByAgentAndKey(agentId: string, apiKey: string, parentOrigin: string) {
    // Get all active keys for this agent
    const keys = await this.db
      .select()
      .from(agentApiKeys)
      .where(eq(agentApiKeys.agentId, agentId))
      .limit(50);

    // Decrypt and compare each key
    for (const key of keys) {
      if (!key.isActive) continue;

      try {
        const decrypted = this.encryptionService.decrypt(key.encryptedKey);
        const allowed = this.isOriginAllowed(
          key.allowedOrigins,
          parentOrigin
        )

        if (!allowed) {
          // Optional: audit log
          return null
        }
        if (decrypted === apiKey) {
          return key;
        }
      } catch (error) {
        // Skip keys that can't be decrypted
        continue;
      }
    }

    return null;
  }

  private async verifyAgentAccess(agentId: string, userOrg: string) {
    const agent = await this.db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });

    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.organizationId !== userOrg) {
      throw new ForbiddenException('Access denied');
    }

    return agent;
  }

  private isOriginAllowed(
    allowedOrigins: string[] | null,
    parentOrigin: string
  ): boolean {
    if (!allowedOrigins || allowedOrigins.length === 0) {
      return true
    }

    return allowedOrigins.some((allowedOrigin) =>
      parentOrigin.startsWith(allowedOrigin)
    )
  }

  async updateAllowedOrigins(keyId: string, origins: string[]) {
    await this.db
      .update(agentApiKeys)
      .set({ allowedOrigins: origins })
      .where(eq(agentApiKeys.id, keyId))
  }
}
