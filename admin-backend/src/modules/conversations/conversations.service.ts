import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { conversations, messages } from '../../db/schema/core.schema';
import { eq, desc, asc, and } from 'drizzle-orm';

@Injectable()
export class ConversationsService {
    constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) { }

    async createConversation(agentId: string, userId: string | null, apiKeyId?: string, title?: string) {
        const result = await this.db.insert(conversations).values({
            agentId,
            userId,
            apiKeyId,
            title: title || 'New Conversation',
        }).returning();

        return result[0];
    }

    async getAgentConversations(agentId: string, userId: string | null, apiKeyId?: string) {
        const conditions = [eq(conversations.agentId, agentId)];
        if (apiKeyId) {
            conditions.push(eq(conversations.apiKeyId, apiKeyId));
        } else if (userId) {
            conditions.push(eq(conversations.userId, userId));
        }

        return await this.db.query.conversations.findMany({
            where: and(...conditions),
            orderBy: [desc(conversations.updatedAt)],
            with: {
                messages: {
                    limit: 1,
                    orderBy: [desc(messages.createdAt)]
                }
            }
        });
    }

    async getConversation(id: string, userId: string | null, apiKeyId?: string) {
        const conditions = [eq(conversations.id, id)];
        if (apiKeyId) {
            conditions.push(eq(conversations.apiKeyId, apiKeyId));
        } else if (userId) {
            conditions.push(eq(conversations.userId, userId));
        }

        const conversation = await this.db.query.conversations.findFirst({
            where: and(...conditions),
            with: {
                messages: {
                    orderBy: [asc(messages.createdAt)] // Oldest first for chat log
                }
            }
        });

        if (!conversation) {
            throw new NotFoundException(`Conversation with ID ${id} not found`);
        }

        return conversation;
    }

    async deleteConversation(id: string, userId: string | null, apiKeyId?: string) {
        const conditions = [eq(conversations.id, id)];
        if (apiKeyId) {
            conditions.push(eq(conversations.apiKeyId, apiKeyId));
        } else if (userId) {
            conditions.push(eq(conversations.userId, userId));
        }

        const result = await this.db.delete(conversations)
            .where(and(...conditions))
            .returning();

        if (result.length === 0) {
            throw new NotFoundException(`Conversation with ID ${id} not found`);
        }

        return { success: true };
    }
    async clearConversationMessages(id: string, userId: string | null, apiKeyId?: string) {
        // Verify ownership/existence first
        await this.getConversation(id, userId, apiKeyId);

        await this.db.delete(messages)
            .where(eq(messages.conversationId, id));

        return { success: true };
    }

    async updateConversationTitle(id: string, userId: string | null, apiKeyId: string | undefined, title: string) {
        const conditions = [eq(conversations.id, id)];
        if (apiKeyId) {
            conditions.push(eq(conversations.apiKeyId, apiKeyId));
        } else if (userId) {
            conditions.push(eq(conversations.userId, userId));
        }

        const result = await this.db.update(conversations)
            .set({ title, updatedAt: new Date() })
            .where(and(...conditions))
            .returning();

        if (result.length === 0) {
            throw new NotFoundException(`Conversation with ID ${id} not found`);
        }

        return result[0];
    }
}
