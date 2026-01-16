import { io, Socket } from 'socket.io-client'
import { useChatStore } from '@/store/chat'
import { useAuthStore } from '@/store/auth'

const WS_URL = import.meta.env.VITE_WS_URL || ''

class SocketService {
  private socket: Socket | null = null
  private messageHandlers: Map<string, (data: any) => void> = new Map()

  connect(providedToken?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve()
        return
      }
      if (this.socket) {
        this.socket.once('connect', resolve)
        this.socket.once('connect_error', reject)
        return
      }

      const token = providedToken || useAuthStore.getState().accessToken
      console.log('Socket connecting with token:', token ? 'Present' : 'Missing')

      this.socket = io(WS_URL, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        auth: {
          token
        },
        query: {
          token
        }
      })

      this.socket.on('connect', () => {
        console.log('Socket connected')
        useChatStore.getState().setConnected(true)
        resolve()
      })

      this.socket.on('disconnect', () => {
        console.log('Socket disconnected')
        useChatStore.getState().setConnected(false)
      })

      this.socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error)
        reject(error)
      })

      this.setupEventHandlers()
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
  }

  setAgent(agentId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'))
        return
      }

      this.socket.emit('set_agent', { agent_id: agentId })

      this.socket.once('agent_set', () => {
        useChatStore.getState().setCurrentAgent(agentId)
        resolve()
      })

      this.socket.once('error', (data) => {
        reject(new Error(data.message))
      })
    })
  }

  setConversation(conversationId: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'))
        return
      }

      this.socket.emit('set_conversation', { conversation_id: conversationId })

      // We assume success if no error immediately, 
      // or we could wait for an ack event if backend sends one.
      // Backend currently emits 'conversation_set' or similar? 
      // Checking backend websocket.py: it emits 'conversation_set' on success.

      this.socket.once('conversation_set', () => {
        resolve()
      })

      this.socket.once('error', (data) => {
        reject(new Error(data.message))
      })
    })
  }

  sendQuery(message: string, threadId?: string | null): void {
    if (!this.socket) {
      console.error('Socket not connected')
      return
    }

    if (threadId) {
      useChatStore.getState().setProcessing(threadId, true)
    }
    // If no threadId, we rely on UI to handle initial loading state or backend response

    this.socket.emit('query', { message, thread_id: threadId })
  }

  clearContext(): void {
    if (this.socket) {
      this.socket.emit('clear_context')
    }
  }

  onMessage(event: string, handler: (data: any) => void): void {
    this.messageHandlers.set(event, handler)
  }

  offMessage(event: string): void {
    this.messageHandlers.delete(event)
  }
  private handlersInitialized = false
  private setupEventHandlers(): void {
    if (!this.socket || this.handlersInitialized) return
    this.handlersInitialized = true
    this.socket.on('query_started', (data) => {
      const handler = this.messageHandlers.get('query_started')
      if (handler) handler(data)
    })

    this.socket.on('thinking', (data) => {
      if (data.conversation_id) {
        useChatStore.getState().setProcessing(data.conversation_id, true)
      }
      const handler = this.messageHandlers.get('thinking')
      if (handler) handler(data)
    })

    this.socket.on('sql_generated', (data) => {
      const handler = this.messageHandlers.get('sql_generated')
      if (handler) handler(data)
    })

    this.socket.on('response_chunk', (data) => {
      const handler = this.messageHandlers.get('response_chunk')
      if (handler) handler(data)
    })

    this.socket.on('query_result', (data) => {
      const handler = this.messageHandlers.get('query_result')
      if (handler) handler(data)
    })

    this.socket.on('query_complete', (data) => {
      if (data.conversation_id) {
        useChatStore.getState().setProcessing(data.conversation_id, false)
      }
      const handler = this.messageHandlers.get('query_complete')
      if (handler) handler(data)
    })

    this.socket.on('query_error', (data) => {
      if (data.conversation_id) {
        useChatStore.getState().setProcessing(data.conversation_id, false)
      }
      const handler = this.messageHandlers.get('query_error')
      if (handler) handler(data)
    })

    this.socket.on('context_cleared', () => {
      const handler = this.messageHandlers.get('context_cleared')
      if (handler) handler({})
    })
  }
}

export const socketService = new SocketService()
