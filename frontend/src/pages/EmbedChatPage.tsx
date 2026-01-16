import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import { authApi } from '@/services/api'
import { ChatInterface } from '@/components/chat/ChatInterface'

export default function EmbedChatPage() {
  const [searchParams] = useSearchParams()
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const agentId = searchParams.get('agentId')
  const apiKey = searchParams.get('apiKey')
  const primaryColor = searchParams.get('primaryColor') || '#4f46e5'
  const backgroundColor = searchParams.get('backgroundColor') || '#ffffff'
  const height = searchParams.get('height') || '600px'

  const [parentOrigin, setParentOrigin] = useState<string | null>(null)

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type !== 'PARENT_ORIGIN') return

      setParentOrigin(event.data.origin)
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    async function exchangeToken() {
      if (!agentId || !apiKey || !parentOrigin) {
        return
      }

      try {
        setLoading(true)
        const response = await authApi.exchangeApiKey(apiKey, agentId, parentOrigin)
        const accessToken = response.data.accessToken

        // Store in sessionStorage (tab-specific) so other API services pick it up
        // without clobbering the admin session in the parent window
        sessionStorage.setItem('embed_token', accessToken)
        
        setToken(accessToken)
        setError(null)
      } catch (err: any) {
        console.error('API key exchange failed:', err)
        setError(err.response?.data?.message || 'Invalid API key or agent')
      } finally {
        setLoading(false)
      }
    }

    exchangeToken()
  }, [agentId, apiKey, parentOrigin])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          <p className="text-sm text-slate-600">Authenticating...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="flex flex-col items-center space-y-4 max-w-md p-6">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900">Authentication Failed</h3>
          <p className="text-sm text-slate-600 text-center">{error}</p>
          <p className="text-xs text-slate-500 text-center">
            Please check your API key and agent ID, or contact support.
          </p>
        </div>
      </div>
    )
  }

  if (!token) {
    return null
  }

  return (
    <div style={{ height }}>
      <ChatInterface
        mode="embed"
        initialAgentId={agentId!}
        token={token}
        showSidebar={true}
        showAgentSelector={false}
        showConnectionStatus={false}
        showSqlToggle={true}
        showClearButton={true}
        customization={{
          primaryColor,
          backgroundColor,
          height,
        }}
      />
    </div>
  )
}
