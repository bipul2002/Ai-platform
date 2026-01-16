import { useState, useEffect } from 'react'
import { X, Shield, Loader2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { usersApi, agentsApi } from '@/services/api'

interface AgentAccessModalProps {
  userId: string
  userName: string
  isOpen: boolean
  onClose: () => void
}

export function AgentAccessModal({ userId, userName, isOpen, onClose }: AgentAccessModalProps) {
  const queryClient = useQueryClient()
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])

  // Fetch all agents in org
  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => agentsApi.list({ limit: 100 }),
    enabled: isOpen,
  })
  const agents = agentsData?.data?.data || []

  // Fetch user's current agent access
  const { data: accessData, isLoading } = useQuery({
    queryKey: ['user-agent-access', userId],
    queryFn: () => usersApi.getUserAgentAccess(userId),
    enabled: isOpen,
  })

  useEffect(() => {
    if (accessData?.data) {
      setSelectedAgentIds(accessData.data.map((a: any) => a.id))
    }
  }, [accessData])

  const updateMutation = useMutation({
    mutationFn: (agentIds: string[]) => usersApi.setUserAgentAccess(userId, agentIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-agent-access', userId] })
      toast.success('Agent access updated successfully')
      onClose()
    },
    onError: () => {
      toast.error('Failed to update agent access')
    }
  })

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds(prev =>
      prev.includes(agentId)
        ? prev.filter(id => id !== agentId)
        : [...prev, agentId]
    )
  }

  const handleSave = () => {
    updateMutation.mutate(selectedAgentIds)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 p-6 rounded-lg w-full max-w-2xl shadow-xl border border-slate-200 dark:border-slate-800 max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Agent Access for {userName}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Select which agents this viewer can access
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto space-y-2 mb-6">
              {agents.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  No agents available
                </div>
              ) : (
                agents.map((agent: any) => (
                  <label
                    key={agent.id}
                    className="flex items-center p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAgentIds.includes(agent.id)}
                      onChange={() => toggleAgent(agent.id)}
                      className="w-4 h-4 text-primary-600 rounded border-slate-300 focus:ring-primary-500"
                    />
                    <div className="ml-3 flex-1">
                      <div className="font-medium text-slate-900 dark:text-white">
                        {agent.name}
                      </div>
                      {agent.description && (
                        <div className="text-sm text-slate-500">
                          {agent.description}
                        </div>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>

            <div className="flex justify-between items-center pt-4 border-t border-slate-200 dark:border-slate-700">
              <div className="text-sm text-slate-500">
                {selectedAgentIds.length} of {agents.length} agents selected
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {updateMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
