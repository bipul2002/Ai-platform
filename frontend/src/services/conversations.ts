import { api } from './api'

export interface Conversation {
    id: string
    title: string
    start_time: string
    message_count: number
    agent_id: string
    created_at: string
    updated_at: string
    updatedAt?: string // Handle Drizzle camelCase response
    messages?: any[]
}

export const conversationsApi = {
    list: (agentId: string) => api.get(`/agents/${agentId}/conversations`),

    create: (agentId: string, title?: string) =>
        api.post(`/agents/${agentId}/conversations`, { title }),

    get: (conversationId: string) => api.get(`/conversations/${conversationId}`),

    clearMessages: (conversationId: string) => api.delete(`/conversations/${conversationId}/messages`),

    update: (conversationId: string, title: string) => api.patch(`/conversations/${conversationId}`, { title }),

    delete: (conversationId: string) => api.delete(`/conversations/${conversationId}`),
}
