import { useParams } from 'react-router-dom'
import { ChatInterface } from '@/components/chat/ChatInterface'

export default function ChatPage() {
  const { agentId } = useParams()

  return (
    <div className="h-[calc(100vh-8rem)]">
      <ChatInterface
        mode="admin"
        initialAgentId={agentId}
        showSidebar={true}
        showAgentSelector={true}
        showConnectionStatus={true}
        showSqlToggle={true}
        showClearButton={true}
      />
    </div>
  )
}
