import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Send, Loader2, Database, Code, RefreshCw, Bot, Download, Copy, Check } from 'lucide-react'
import { clsx } from 'clsx'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import toast from 'react-hot-toast'
import { agentsApi } from '@/services/api'
import { conversationsApi, Conversation } from '@/services/conversations'
import { socketService } from '@/services/socket'
import { useChatStore } from '@/store/chat'
import { ChatSidebar } from '@/components/ChatSidebar'
import { QueryResultsTable as OldQueryResultsTable } from '@/components/QueryResultsTable'
import { QueryResultsTable } from '@/components/chat/QueryResultsTable'
import { ExcelDownloadButton } from '@/components/chat/ExcelDownloadButton'
import { messagesApi } from '@/services/messages'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sql?: string
  timestamp: Date
  isStreaming?: boolean
  previewData?: any[]
  rowCount?: number
  hasMore?: boolean
  threadId?: string
  isRefinement?: boolean
  iterationCount?: number
  resultType?: string
  agentId?: string
  isLoadedFromHistory?: boolean // Track if message was loaded from history vs freshly generated
}

interface ChatInterfaceProps {
  mode: 'admin' | 'embed'
  initialAgentId?: string
  token?: string
  showSidebar?: boolean
  showAgentSelector?: boolean
  showConnectionStatus?: boolean
  showSqlToggle?: boolean
  showClearButton?: boolean
  customization?: {
    primaryColor?: string
    backgroundColor?: string
    height?: string
  }
}

export function ChatInterface({
  mode,
  initialAgentId,
  token,
  showSidebar = true,
  showAgentSelector = true,
  showConnectionStatus = true,
  showSqlToggle = true,
  showClearButton = true,
  customization,
}: ChatInterfaceProps) {
  const navigate = mode === 'admin' ? useNavigate() : () => { }
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()

  const [input, setInput] = useState('')
  const [selectedAgent, setSelectedAgent] = useState<string | null>(initialAgentId || null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [showSql, setShowSql] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [isConnecting, setIsConnecting] = useState(false)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const selectedConversationIdRef = useRef<string | null>(null)

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId
  }, [selectedConversationId])

  const { isConnected, processingConversations } = useChatStore()
  const isProcessing = selectedConversationId ? processingConversations[selectedConversationId] : false

  // Fetch Agents (only for admin mode with agent selector)
  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => agentsApi.list({ isActive: true }),
    enabled: mode === 'admin' && showAgentSelector,
  })
  const agents = agentsData?.data?.data || []

  // Auto-select first agent if none selected and agents are available
  useEffect(() => {
    if (mode === 'admin' && !selectedAgent && agents.length > 0 && !initialAgentId) {
      const firstAgentId = agents[0].id
      handleAgentSelect(firstAgentId)
    }
  }, [agents, selectedAgent, mode, initialAgentId])

  // Fetch Agent Info (for embed mode or specific agent view)
  const { data: currentAgentData } = useQuery({
    queryKey: ['agent', selectedAgent],
    queryFn: () => agentsApi.get(selectedAgent!),
    enabled: !!selectedAgent,
  })
  const currentAgent = currentAgentData?.data

  // Fetch Conversations for selected agent
  const { data: conversationsData } = useQuery({
    queryKey: ['conversations', selectedAgent],
    queryFn: () => conversationsApi.list(selectedAgent!),
    enabled: !!selectedAgent && showSidebar,
  })
  const conversations: Conversation[] = conversationsData?.data || []

  // Delete Conversation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => conversationsApi.delete(id),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedAgent] })
      if (selectedConversationId === deletedId) {
        setSelectedConversationId(null)
        setMessages([])
        socketService.setConversation(null)
      }
      toast.success('Conversation deleted')
    },
    onError: () => toast.error('Failed to delete conversation')
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Sticky scroll implementation
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      const { scrollHeight, scrollTop, clientHeight } = container
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight

      if (distanceFromBottom < 500) {
        container.scrollTo({ top: scrollHeight, behavior: 'smooth' })
      }
    })

    if (container.firstElementChild) {
      observer.observe(container.firstElementChild)
    } else {
      observer.observe(container)
    }

    return () => observer.disconnect()
  }, [messages])

  // Socket Connection & Event Handlers
  useEffect(() => {
    const connect = async () => {
      setIsConnecting(true)
      try {
        await socketService.connect(token)

        socketService.onMessage('conversation_created', (data) => {
          queryClient.setQueryData(['conversations', selectedAgent], (old: any) => {
            if (!old) return { data: [data] }
            return { ...old, data: [data, ...old.data] }
          })
          queryClient.invalidateQueries({ queryKey: ['conversations', selectedAgent] })
          setSelectedConversationId(data.id)
          setMessages([])
        })

        socketService.onMessage('query_started', (data) => {
          setMessages((prev) => [
            ...prev,
            {
              id: data.message_id,
              role: 'assistant',
              content: '',
              timestamp: new Date(),
              isStreaming: true,
              isLoadedFromHistory: false, // Mark as fresh message to trigger auto-load
            },
          ])
        })

        socketService.onMessage('sql_generated', (data) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.message_id
                ? { ...m, sql: data.sql }
                : m
            )
          )
        })

        socketService.onMessage('response_chunk', (data) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.message_id
                ? { ...m, content: m.content + data.content }
                : m
            )
          )
        })

        socketService.onMessage('query_result', (data) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.message_id
                ? { ...m, data: data.data, rowCount: data.row_count }
                : m
            )
          )
        })

        socketService.onMessage('query_complete', (data) => {
          if (data.thread_id) {
            setActiveThreadId(data.thread_id)
          }

          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.message_id
                ? {
                  ...m,
                  content: data.response,
                  isStreaming: false,
                  previewData: data.preview_data,
                  rowCount: data.row_count,
                  hasMore: data.has_more,
                  threadId: data.thread_id,
                  isRefinement: data.is_refinement,
                  iterationCount: data.iteration_count,
                  resultType: data.result_type,
                  agentId: data.agent_id,
                  sql: data.sql,
                  isLoadedFromHistory: false, // Keep as fresh message for auto-load
                }
                : m
            )
          )
        })

        socketService.onMessage('query_error', (data) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === data.message_id
                ? { ...m, content: `Error: ${data.error}`, isStreaming: false }
                : m
            )
          )
          toast.error(data.error)
        })

        if (selectedAgent) {
          await socketService.setAgent(selectedAgent)
        }
      } catch (error) {
        console.error('Connection failed:', error)
        toast.error('Failed to connect to chat server')
      } finally {
        setIsConnecting(false)
      }
    }

    connect()

    return () => {
      socketService.offMessage('conversation_created')
      socketService.offMessage('query_started')
      socketService.offMessage('sql_generated')
      socketService.offMessage('response_chunk')
      socketService.offMessage('query_result')
      socketService.offMessage('query_complete')
      socketService.offMessage('query_error')
    }
  }, [selectedAgent, queryClient, token])

  // Auto-selection and URL Sync (admin mode only)
  useEffect(() => {
    if (mode !== 'admin' || !conversations || conversations.length === 0) return

    const conversationIdParam = searchParams.get('cid')

    if (conversationIdParam) {
      if (selectedConversationId !== conversationIdParam) {
        handleConversationSelect(conversationIdParam)
      }
    } else if (!selectedConversationId) {
      const latestId = conversations[0].id
      handleConversationSelect(latestId)
    }
  }, [conversations, searchParams, selectedConversationId, mode])

  const handleAgentSelect = async (newAgentId: string) => {
    setSelectedAgent(newAgentId)
    setSelectedConversationId(null)
    setMessages([])

    if (mode === 'admin') {
      navigate(`/chat/${newAgentId}`)
    }

    try {
      await socketService.setAgent(newAgentId)
      toast.success('Agent selected')
    } catch (error: any) {
      toast.error(error.message || 'Failed to select agent')
    }
  }

  const handleConversationSelect = async (id: string) => {
    setSelectedConversationId(id)
    if (mode === 'admin') {
      setSearchParams({ cid: id })
    }
    setMessages([])

    try {
      const res = await conversationsApi.get(id)
      const conversation = res.data

      if (conversation && conversation.messages) {
        const formattedMessages: Message[] = conversation.messages.map((msg: any) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.created_at || msg.createdAt),
          sql: msg.metadata?.sql,
          rowCount: msg.metadata?.row_count,
          previewData: msg.metadata?.query_results?.slice(0, 10),
          hasMore: (msg.metadata?.row_count || 0) > 10,
          threadId: msg.threadId || msg.thread_id,
          resultType: msg.metadata?.result_type,
          agentId: msg.metadata?.agent_id || selectedAgent,
          isLoadedFromHistory: true, // Mark messages loaded from conversation history
        }))

        if (formattedMessages.length === 0) {
          const welcomeMessage: Message = {
            id: `welcome-${Date.now()}`,
            role: 'assistant',
            content: "Welcome back! 👋 How can I help you today?",
            timestamp: new Date(),
          }
          setMessages([welcomeMessage])
        } else {
          setMessages(formattedMessages)

          if (formattedMessages.length > 0) {
            const lastMsg = formattedMessages[formattedMessages.length - 1]
            if (lastMsg.threadId) {
              setActiveThreadId(lastMsg.threadId)
            } else {
              setActiveThreadId(null)
            }
          } else {
            setActiveThreadId(null)
          }
        }
      }

      await socketService.setConversation(id)
    } catch (e: any) {
      console.error(e)
      if (mode === 'admin') {
        if (e.status === 404) {
          navigate('/chat')
        } else {
          toast.error("Failed to load conversation")
          navigate('/chat')
        }
      } else {
        toast.error("Failed to load conversation")
      }
    }
  }

  const handleNewChat = async () => {
    if (!selectedAgent) return

    setMessages([])
    setActiveThreadId(null)

    if (!selectedAgent) {
      toast.error("No agent selected")
      return
    }

    try {
      const res = await conversationsApi.create(selectedAgent, "New Conversation")
      const newConv = res.data
      await socketService.setConversation(newConv.id)
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedAgent] })
      setSelectedConversationId(newConv.id)
      if (mode === 'admin') {
        setSearchParams({ cid: newConv.id })
      }

      const welcomeMessage: Message = {
        id: `welcome-${Date.now()}`,
        role: 'assistant',
        content: "Hey there! 👋 How can I help you today?",
        timestamp: new Date(),
      }
      setMessages([welcomeMessage])
    } catch (e) {
      toast.error("Failed to create new chat")
    }
  }

  const handleNewQuery = () => {
    setActiveThreadId(null)
    setInput('')
  }

  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm("Are you sure you want to delete this conversation?")) {
      deleteMutation.mutate(id)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!input.trim() || !selectedAgent || isProcessing) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    socketService.sendQuery(input, activeThreadId)
    setInput('')
  }

  const handleClearChat = async () => {
    if (!selectedConversationId) return

    if (confirm("Are you sure you want to clear all messages in this chat?")) {
      try {
        await conversationsApi.clearMessages(selectedConversationId)
        setMessages([])
        toast.success("Chat history cleared")
      } catch (e) {
        toast.error("Failed to clear chat history")
      }
    }
  }

  const handleRenameConversation = async (id: string, newTitle: string) => {
    try {
      await conversationsApi.update(id, newTitle)
      queryClient.invalidateQueries({ queryKey: ['conversations', selectedAgent] })
      toast.success("Conversation renamed")
    } catch (e) {
      toast.error("Failed to rename conversation")
    }
  }

  const handleDownloadExcel = async (messageId: string) => {
    try {
      await messagesApi.downloadExcel(messageId)
      toast.success('Excel file downloaded')
    } catch (error) {
      toast.error('Failed to download Excel file')
    }
  }

  const handleCopy = (sql: string, id: string) => {
    navigator.clipboard.writeText(sql)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
    toast.success('Query copied to clipboard')
  }

  return (
    <div
      className="h-full flex overflow-hidden rounded-xl border dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm"
      style={{
        backgroundColor: customization?.backgroundColor || undefined,
        ['--primary-custom' as any]: customization?.primaryColor || '#2563eb', // Default to primary-600
        ['--primary-custom-hover' as any]: customization?.primaryColor ? `${customization.primaryColor}ee` : '#1d4ed8',
      }}
    >
      {/* Sidebar */}
      {showSidebar && selectedAgent && (
        <ChatSidebar
          conversations={conversations}
          selectedId={selectedConversationId}
          onSelect={handleConversationSelect}
          onNewChat={handleNewChat}
          onDelete={handleDeleteConversation}
          onRename={handleRenameConversation}
          processingConversations={processingConversations}
          customization={customization}
        />
      )}

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        {(showAgentSelector || showConnectionStatus || showSqlToggle || showClearButton || mode === 'embed') && (
          <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <div className="flex items-center space-x-4">
              {mode === 'embed' && currentAgent && (
                <div className="flex items-center space-x-2">
                  <Bot className="w-5 h-5 text-primary-600" />
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[200px]">
                    {currentAgent.name}
                  </h3>
                </div>
              )}

              {showAgentSelector && mode === 'admin' && (
                <select
                  value={selectedAgent || ''}
                  onChange={(e) => handleAgentSelect(e.target.value)}
                  className="input max-w-xs"
                >
                  <option value="">Select an agent...</option>
                  {agents.map((agent: any) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              )}

              {(showConnectionStatus || mode === 'embed') && (
                <div className="flex items-center space-x-2">
                  <span
                    className={clsx(
                      'w-2 h-2 rounded-full',
                      isConnected ? 'bg-green-500' : 'bg-red-500'
                    )}
                  />
                  <span className="text-sm text-slate-500">
                    {isConnecting ? 'Connecting...' : isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2">
              {showSqlToggle && (
                <button
                  onClick={() => setShowSql(!showSql)}
                  className={clsx(
                    'btn btn-ghost text-sm',
                    showSql && 'bg-slate-100 dark:bg-slate-800'
                  )}
                >
                  <Code className="w-4 h-4 mr-2" />
                  <span className="hidden sm:inline">Show SQL</span>
                </button>
              )}
              {showClearButton && (
                <button onClick={handleClearChat} className="btn btn-ghost text-sm">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  <span className="hidden sm:inline">Clear</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 bg-slate-50/50 dark:bg-slate-900/50">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <Bot className="w-16 h-16 mb-4" />
              {agents.length === 0 && mode === 'admin' ? (
                <>
                  <p className="text-lg font-medium text-slate-600 dark:text-slate-300">
                    No agents available
                  </p>
                  <p className="text-sm text-slate-400 mt-2">
                    Please contact your administrator to request access to an agent
                  </p>
                </>
              ) : selectedAgent ? (
                <>
                  <p className="text-lg font-medium">Start a conversation</p>
                  <p className="text-sm text-slate-400">
                    Ask a question about your data
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium">Select an agent to start</p>
                  <p className="text-sm text-slate-400">
                    Choose an agent from the dropdown above
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={clsx(
                    'flex animate-fade-in',
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={clsx(
                      'max-w-[80%] rounded-2xl px-4 py-3 shadow-sm',
                      message.role === 'user'
                        ? 'text-white'
                        : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600'
                    )}
                    style={message.role === 'user' ? { backgroundColor: 'var(--primary-custom)' } : {}}
                  >
                    {message.role === 'assistant' && message.isStreaming && !message.content ? (
                      <div className="flex space-x-1 py-1">
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse-dot" />
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse-dot" style={{ animationDelay: '0.2s' }} />
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse-dot" style={{ animationDelay: '0.4s' }} />
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between">
                          <div className={clsx(
                            "prose prose-sm max-w-none flex-1 min-w-0",
                            message.role === 'user' ? "prose-invert text-white [&_*]:text-white" : "dark:prose-invert",
                            message.resultType === 'table' && message.role === 'assistant' && "[&_p:first-child]:font-bold"
                          )}>
                            <ReactMarkdown
                              components={{
                                code({ node, inline, className, children, ...props }: any) {
                                  const match = /language-(\w+)/.exec(className || '')
                                  return !inline && match ? (
                                    <SyntaxHighlighter
                                      {...props}
                                      style={oneDark}
                                      language={match[1]}
                                      PreTag="div"
                                      customStyle={{
                                        margin: '1em 0',
                                        borderRadius: '0.5rem',
                                        fontSize: '0.875rem',
                                        maxWidth: '100%',
                                        overflowX: 'auto',
                                      }}
                                    >
                                      {String(children).replace(/\n$/, '')}
                                    </SyntaxHighlighter>
                                  ) : (
                                    <code className={className} {...props}>
                                      {children}
                                    </code>
                                  )
                                }
                              }}
                            >
                              {message.content}
                            </ReactMarkdown>
                          </div>
                          {!!(message.previewData && message.rowCount && message.rowCount > 0) && !message.resultType && (
                            <button
                              onClick={() => handleDownloadExcel(message.id)}
                              className="btn btn-sm flex items-center space-x-1 ml-4 flex-shrink-0"
                            >
                              <Download className="w-4 h-4" />
                              <span>Download Excel</span>
                            </button>
                          )}
                          {message.resultType === 'table' && message.sql && message.agentId && (
                            <div className="ml-4 flex-shrink-0">
                              <ExcelDownloadButton
                                agentId={message.agentId}
                                sql={message.sql}
                                iconOnly={true}
                              />
                            </div>
                          )}
                        </div>

                        {message.sql && showSql && (
                          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-600 w-full">
                            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                              <div className="flex items-center">
                                <Database className="w-3 h-3 mr-1" />
                                <span className="font-medium">Generated SQL</span>
                              </div>
                              <button
                                onClick={() => handleCopy(message.sql!, message.id)}
                                className="hover:text-primary-600 transition-colors flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
                              >
                                {copiedId === message.id ? (
                                  <Check className="w-3 h-3" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>{copiedId === message.id ? 'Copied' : 'Copy'}</span>
                              </button>
                            </div>
                            <div className="rounded-lg overflow-hidden">
                              <SyntaxHighlighter
                                language="sql"
                                style={oneDark}
                                customStyle={{
                                  fontSize: '13px',
                                  borderRadius: '8px',
                                  margin: 0,
                                  padding: '12px',
                                }}
                                wrapLongLines={true}
                              >
                                {message.sql}
                              </SyntaxHighlighter>
                            </div>
                          </div>
                        )}

                        {message.rowCount !== undefined && message.rowCount > 0 && !message.resultType && (
                          <div className="mt-2 text-xs text-slate-500">
                            {message.rowCount} rows returned
                          </div>
                        )}

                        {message.previewData && (message.rowCount || 0) > 0 && !message.resultType && (
                          <OldQueryResultsTable
                            messageId={message.id}
                            initialData={message.previewData}
                            totalRows={message.rowCount || 0}
                          />
                        )}

                        {message.resultType === 'table' && message.sql && message.agentId && (
                          <div className="mt-4">
                            <QueryResultsTable
                              key={message.id}
                              messageId={message.id}
                              agentId={message.agentId}
                              sql={message.sql}
                              autoLoad={!message.isLoadedFromHistory}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}

              {isProcessing && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 rounded-tl-none shadow-sm space-y-2">
                    <div className="flex items-center space-x-2 text-sm text-slate-500 dark:text-slate-400">
                      <div className="flex space-x-1 py-1">
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse-dot" />
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse-dot" style={{ animationDelay: '0.2s' }} />
                        <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse-dot" style={{ animationDelay: '0.4s' }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <form onSubmit={handleSubmit} className="p-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
          {activeThreadId && (
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs text-slate-500 flex items-center">
                <RefreshCw className="w-3 h-3 mr-1" />
                Refining previous query (Thread Active)
              </span>
              <button
                type="button"
                onClick={handleNewQuery}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center"
              >
                Start New Query
              </button>
            </div>
          )}
          <div className="flex space-x-4">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                selectedAgent
                  ? 'Ask a question about your data...'
                  : 'Select an agent to start chatting'
              }
              disabled={!selectedAgent || isProcessing}
              className="input flex-1"
            />
            <button
              type="submit"
              disabled={!selectedConversationId || isProcessing || !isConnected}
              className={clsx(
                "btn text-white",
                !customization?.primaryColor && "btn-primary"
              )}
              style={{
                backgroundColor: customization?.primaryColor ? 'var(--primary-custom)' : undefined,
              }}
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>Send</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
