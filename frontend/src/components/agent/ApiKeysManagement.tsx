import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Eye, EyeOff, Copy, Key, Calendar, Activity, Code2 } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { agentApiKeysApi } from '@/services/api'
import { EmbeddingSnippets } from './EmbeddingSnippets'

interface ApiKey {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  requestCount: number
  isActive: boolean
  allowedOrigins: string[] | null
}

interface ApiKeysManagementProps {
  agentId: string
}

export function ApiKeysManagement({ agentId }: ApiKeysManagementProps) {
  const queryClient = useQueryClient()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<{ id: string; apiKey: string } | null>(null)
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [revealedKeyValues, setRevealedKeyValues] = useState<Map<string, string>>(new Map())
  const [selectedKeyForSnippets, setSelectedKeyForSnippets] = useState<string | null>(null)
  const [editingOriginsForKey, setEditingOriginsForKey] = useState<string | null>(null)
  const [originsInput, setOriginsInput] = useState('')

  const { data: keysData, isLoading } = useQuery({
    queryKey: ['agent-api-keys', agentId],
    queryFn: () => agentApiKeysApi.list(agentId),
  })

  const keys: ApiKey[] = keysData?.data || []

  const createMutation = useMutation({
    mutationFn: (name: string) => agentApiKeysApi.create(agentId, name),
    onSuccess: (response) => {
      setCreatedKey({
        id: response.data.id,
        apiKey: response.data.apiKey,
      })
      setNewKeyName('')
      setShowCreateModal(false)
      queryClient.invalidateQueries({ queryKey: ['agent-api-keys', agentId] })
      toast.success('API key created successfully')
    },
    onError: () => {
      toast.error('Failed to create API key')
    },
  })

  const updateOriginsMutation = useMutation({
    mutationFn: ({ keyId, origins }: { keyId: string; origins: string[] }) => {
      return agentApiKeysApi.updateAllowedOrigins(agentId, keyId, origins)
    },
    onSuccess: () => {
      toast.success('Allowed origins updated')
      setEditingOriginsForKey(null)
      setOriginsInput('')
      queryClient.invalidateQueries({ queryKey: ['agent-api-keys', agentId] })
    },
    onError: () => {
      toast.error('Failed to update allowed origins')
    },
  })


  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => agentApiKeysApi.revoke(agentId, keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-api-keys', agentId] })
      toast.success('API key revoked successfully')
    },
    onError: () => {
      toast.error('Failed to revoke API key')
    },
  })

  const revealMutation = useMutation({
    mutationFn: (keyId: string) => agentApiKeysApi.reveal(agentId, keyId),
    onSuccess: (response, keyId) => {
      const newRevealed = new Map(revealedKeyValues)
      newRevealed.set(keyId, response.data.apiKey)
      setRevealedKeyValues(newRevealed)

      const newRevealedSet = new Set(revealedKeys)
      newRevealedSet.add(keyId)
      setRevealedKeys(newRevealedSet)

      toast.success('API key revealed')
    },
    onError: () => {
      toast.error('Failed to reveal API key')
    },
  })

  const handleReveal = (keyId: string) => {
    if (revealedKeys.has(keyId)) {
      // Hide it
      const newRevealedSet = new Set(revealedKeys)
      newRevealedSet.delete(keyId)
      setRevealedKeys(newRevealedSet)
    } else {
      // Reveal it
      revealMutation.mutate(keyId)
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }

  const handleRevoke = (keyId: string, keyName: string) => {
    if (confirm(`Are you sure you want to revoke the API key "${keyName}"? This action cannot be undone.`)) {
      revokeMutation.mutate(keyId)
    }
  }

  const handleCreate = () => {
    if (!newKeyName.trim()) {
      toast.error('Please enter a name for the API key')
      return
    }
    createMutation.mutate(newKeyName)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            API Keys
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Manage API keys for embedding this agent in external applications
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary flex items-center space-x-2"
        >
          <Plus className="w-4 h-4" />
          <span>Create API Key</span>
        </button>
      </div>

      {/* API Keys List */}
      {keys.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 dark:bg-slate-800/50 rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700">
          <Key className="w-12 h-12 mx-auto text-slate-400 mb-4" />
          <p className="text-sm text-slate-600 dark:text-slate-400">No API keys yet</p>
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
            Create an API key to embed this agent in your application
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <div
              key={key.id}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2 mb-2">
                    <h4 className="font-medium text-slate-900 dark:text-slate-100">
                      {key.name}
                    </h4>
                    {!key.isActive && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded">
                        Revoked
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-400">
                      <Calendar className="w-4 h-4" />
                      <span>Created {format(new Date(key.createdAt), 'MMM d, yyyy')}</span>
                    </div>

                    {key.lastUsedAt && (
                      <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-400">
                        <Activity className="w-4 h-4" />
                        <span>Last used {format(new Date(key.lastUsedAt), 'MMM d, yyyy')}</span>
                      </div>
                    )}

                    <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-400">
                      <Activity className="w-4 h-4" />
                      <span>{key.requestCount} requests</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-2 ml-4 flex-shrink-0">
                  {key.isActive && (
                    <button
                      type="button"
                      onClick={() => {
                        handleReveal(key.id)
                        setSelectedKeyForSnippets(key.id)
                      }}
                      className="btn btn-sm btn-secondary flex items-center space-x-1"
                      title="Use this key for integration"
                    >
                      <Code2 className="w-4 h-4" />
                      <span>Integration</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleReveal(key.id)}
                    className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                    title={revealedKeys.has(key.id) ? 'Hide API key' : 'Reveal API key'}
                  >
                    {revealedKeys.has(key.id) ? (
                      <EyeOff className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                    ) : (
                      <Eye className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                    )}
                  </button>

                  {key.isActive && (
                    <button
                      type="button"
                      onClick={() => handleRevoke(key.id, key.name)}
                      className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      title="Revoke API key"
                    >
                      <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingOriginsForKey(key.id)
                      setOriginsInput((key.allowedOrigins || []).join('\n'))
                    }}
                    className="btn btn-sm btn-secondary"
                  >
                    Allowed Origins
                  </button>
                </div>
              </div>

              {/* Revealed Key Display */}
              {revealedKeys.has(key.id) && revealedKeyValues.has(key.id) && (
                <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-900/50 rounded border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <code className="text-sm font-mono text-slate-900 dark:text-slate-100 break-all">
                      {revealedKeyValues.get(key.id)}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy(revealedKeyValues.get(key.id)!)}
                      className="ml-2 p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors flex-shrink-0"
                      title="Copy to clipboard"
                    >
                      <Copy className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                    </button>
                  </div>
                </div>
              )}
              {/* Allowed Origins Display */}
              {editingOriginsForKey === key.id && (
                <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-900/50 rounded border border-slate-200 dark:border-slate-700 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      Allowed Origins (one per line)
                    </label>
                    <textarea
                      className="input w-full h-28 font-mono text-sm"
                      placeholder={`http://localhost:3000\nhttps://example.com`}
                      value={originsInput}
                      onChange={(e) => setOriginsInput(e.target.value)}
                    />
                  </div>

                  <div className="flex justify-end space-x-2">
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setEditingOriginsForKey(null)
                        setOriginsInput('')
                      }}
                    >
                      Cancel
                    </button>

                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={updateOriginsMutation.isPending}
                      onClick={() => {
                        const origins = originsInput
                          .split('\n')
                          .map(o => o.trim())
                          .filter(Boolean)

                        updateOriginsMutation.mutate({
                          keyId: key.id,
                          origins,
                        })
                      }}
                    >
                      Save Origins
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Embedding Snippets Section */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-10 mt-10">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center space-x-2">
            <Code2 className="w-5 h-5 text-primary-600" />
            <span>Embedding Snippets</span>
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Choose an API key to generate integration code for your website
          </p>
        </div>

        {keys.filter(k => k.isActive).length === 0 ? (
          <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/50 rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700">
            <p className="text-sm text-slate-500">Create an active API key first to see snippets</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center space-x-4">
              <select
                className="input max-w-xs"
                value={selectedKeyForSnippets || ''}
                onChange={(e) => setSelectedKeyForSnippets(e.target.value)}
              >
                <option value="">Select a key...</option>
                {keys.filter(k => k.isActive).map(k => (
                  <option key={k.id} value={k.id}>{k.name}</option>
                ))}
              </select>

              {selectedKeyForSnippets && !revealedKeys.has(selectedKeyForSnippets) && (
                <button
                  type="button"
                  onClick={() => handleReveal(selectedKeyForSnippets)}
                  className="btn btn-primary"
                >
                  Reveal Key to Show Snippets
                </button>
              )}
            </div>

            {selectedKeyForSnippets && revealedKeys.has(selectedKeyForSnippets) && revealedKeyValues.has(selectedKeyForSnippets) ? (
              <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 animate-in fade-in slide-in-from-top-2">
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 italic">
                  Integration code for <strong>{keys.find(k => k.id === selectedKeyForSnippets)?.name}</strong>:
                </p>
                <EmbeddingSnippets
                  agentId={agentId}
                  apiKey={revealedKeyValues.get(selectedKeyForSnippets)!}
                />
              </div>
            ) : selectedKeyForSnippets ? (
              <div className="p-8 text-center bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Please reveal the API key above or click the "Reveal" button to see the snippets.
                </p>
              </div>
            ) : (
              <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
                <p className="text-sm text-slate-500">Choose a key from the dropdown above to view integration code</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Create API Key
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Give your API key a descriptive name
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Key Name
                </label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g., Production Website, Mobile App"
                  className="input w-full"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      e.stopPropagation()
                      handleCreate()
                    }
                  }}
                  autoFocus
                />
              </div>
            </div>

            <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false)
                  setNewKeyName('')
                }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="btn btn-primary"
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Created Key Modal */}
      {createdKey && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-lg w-full mx-4">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                API Key Created Successfully
              </h3>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                <p className="text-sm text-yellow-800 dark:text-yellow-200 font-medium">
                  ⚠️ Important: Save this API key now
                </p>
                <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                  You can reveal it later, but make sure to store it securely.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Your API Key
                </label>
                <div className="flex items-center space-x-2">
                  <code className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded text-sm font-mono text-slate-900 dark:text-slate-100 break-all">
                    {createdKey.apiKey}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(createdKey.apiKey)}
                    className="btn btn-primary flex items-center space-x-2"
                  >
                    <Copy className="w-4 h-4" />
                    <span>Copy</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-200 dark:border-slate-700 flex justify-end">
              <button
                type="button"
                onClick={() => setCreatedKey(null)}
                className="btn btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
