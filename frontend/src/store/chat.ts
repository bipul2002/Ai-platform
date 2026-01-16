import { create } from 'zustand'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  sql?: string
  timestamp: Date
  isStreaming?: boolean
  data?: any[]
  rowCount?: number
  executionTimeMs?: number
}

interface ChatState {
  messages: Message[]
  isConnected: boolean
  processingConversations: Record<string, boolean>
  currentAgentId: string | null

  addMessage: (message: Message) => void
  updateMessage: (id: string, updates: Partial<Message>) => void
  clearMessages: () => void
  setConnected: (connected: boolean) => void
  setProcessing: (conversationId: string, isProcessing: boolean) => void
  setCurrentAgent: (agentId: string | null) => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isConnected: false,
  processingConversations: {}, // Map of conversationId -> boolean
  currentAgentId: null,

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),

  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map((msg) =>
      msg.id === id ? { ...msg, ...updates } : msg
    ),
  })),

  clearMessages: () => set({ messages: [] }),

  setConnected: (connected) => set({ isConnected: connected }),

  setProcessing: (conversationId, isProcessing) => set((state) => ({
    processingConversations: {
      ...state.processingConversations,
      [conversationId]: isProcessing
    }
  })),

  setCurrentAgent: (agentId) => set({ currentAgentId: agentId }),
}))
