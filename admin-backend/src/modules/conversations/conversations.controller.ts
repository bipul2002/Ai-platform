import { Controller, Get, Post, Delete, Patch, Param, Body, UseGuards, Request } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ConversationsController {
    constructor(private readonly conversationsService: ConversationsService) { }

    @Post('agents/:agentId/conversations')
    @ApiOperation({ summary: 'Create a new conversation' })
    async createConversation(
        @Param('agentId') agentId: string,
        @Request() req: any,
        @Body('title') title?: string
    ) {
        const userId = req.user.role === 'api_key' ? null : req.user.sub;
        const apiKeyId = req.user.role === 'api_key' ? req.user.sub : undefined;
        return await this.conversationsService.createConversation(agentId, userId, apiKeyId, title);
    }

    @Get('agents/:agentId/conversations')
    @ApiOperation({ summary: 'List conversations for an agent' })
    async getConversations(
        @Param('agentId') agentId: string,
        @Request() req: any
    ) {
        const userId = req.user.role === 'api_key' ? null : req.user.sub;
        const apiKeyId = req.user.role === 'api_key' ? req.user.sub : undefined;
        return await this.conversationsService.getAgentConversations(agentId, userId, apiKeyId);
    }

    @Get('conversations/:id')
    @ApiOperation({ summary: 'Get conversation details and history' })
    async getConversation(
        @Param('id') id: string,
        @Request() req: any
    ) {
        const userId = req.user.role === 'api_key' ? null : req.user.sub;
        const apiKeyId = req.user.role === 'api_key' ? req.user.sub : undefined;
        return await this.conversationsService.getConversation(id, userId, apiKeyId);
    }

    @Delete('conversations/:id')
    @ApiOperation({ summary: 'Delete a conversation' })
    async deleteConversation(
        @Param('id') id: string,
        @Request() req: any
    ) {
        const userId = req.user.role === 'api_key' ? null : req.user.sub;
        const apiKeyId = req.user.role === 'api_key' ? req.user.sub : undefined;
        return await this.conversationsService.deleteConversation(id, userId, apiKeyId);
    }

    @Delete('conversations/:id/messages')
    @ApiOperation({ summary: 'Clear all messages in a conversation' })
    async clearConversationMessages(
        @Param('id') id: string,
        @Request() req: any
    ) {
        const userId = req.user.role === 'api_key' ? null : req.user.sub;
        const apiKeyId = req.user.role === 'api_key' ? req.user.sub : undefined;
        return await this.conversationsService.clearConversationMessages(id, userId, apiKeyId);
    }
    @Patch('conversations/:id')
    @ApiOperation({ summary: 'Update conversation title' })
    async updateConversation(
        @Param('id') id: string,
        @Request() req: any,
        @Body('title') title: string
    ) {
        const userId = req.user.role === 'api_key' ? null : req.user.sub;
        const apiKeyId = req.user.role === 'api_key' ? req.user.sub : undefined;
        return await this.conversationsService.updateConversationTitle(id, userId, apiKeyId, title);
    }
}
