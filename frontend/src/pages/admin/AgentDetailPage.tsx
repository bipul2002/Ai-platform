import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import {
  Database,
  RefreshCw,
  Loader2,
  Table,
  Zap,
  Save
} from 'lucide-react'
import toast from 'react-hot-toast'
import { agentsApi, schemaApi, embeddingsApi } from '@/services/api'
import AgentSensitivitySettings from './components/AgentSensitivitySettings'
import { ApiKeysManagement } from '@/components/agent/ApiKeysManagement'

interface AgentForm {
  name: string
  description: string
  tags: string
  isActive: boolean
  maxResultsLimit: number
  timeoutSeconds: number
  systemPromptOverride: string
  llmProvider: 'openai' | 'anthropic' | 'openrouter'
  llmModel: string
  llmTemperature: number
  externalDb: {
    dbType: 'postgresql' | 'mysql'
    host: string
    port: number
    databaseName: string
    username: string
    password: string
    sslEnabled: boolean
  }
  disabledSensitivityRules: string[]
}

const LLM_MODELS = {
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4-turbo-preview',
    'gpt-4',
    'gpt-4-0125-preview',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-16k',
    'o1-preview',
    'o1-mini'
  ],
  anthropic: [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307'
  ],
  openrouter: [
    'meta-llama/llama-3.3-70b-instruct:free',
    'meta-llama/llama-3.1-8b-instruct:free',
    'google/gemma-2-9b-it:free',
    'mistralai/mistral-7b-instruct:free',
    'qwen/qwen-2-7b-instruct:free'
  ]
}

export default function AgentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isNew = id === 'new'

  const [activeTab, setActiveTab] = useState<'general' | 'database' | 'sensitivity' | 'advanced' | 'embedding'>('general')
  const [testingConnection, setTestingConnection] = useState(false)
  const [refreshingSchema, setRefreshingSchema] = useState(false)
  const [generatingEmbeddings, setGeneratingEmbeddings] = useState(false)

  const { data: agent, isLoading } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => agentsApi.get(id!),
    enabled: !isNew && !!id,
  })

  const agentData = agent?.data

  const { register, handleSubmit, formState: { errors, dirtyFields }, watch, setValue, reset } = useForm<AgentForm>({
    defaultValues: {
      name: '',
      description: '',
      tags: '',
      isActive: true,
      maxResultsLimit: 1000,
      timeoutSeconds: 30,
      systemPromptOverride: '',
      llmProvider: 'openai',
      llmModel: 'gpt-4-turbo-preview',
      llmTemperature: 0,
      disabledSensitivityRules: [],
      externalDb: {
        dbType: 'postgresql',
        host: 'localhost',
        port: 5432,
        databaseName: '',
        username: '',
        password: '',
        sslEnabled: false,
      },
    },
  })

  // Update form values when agent data is loaded
  useEffect(() => {
    if (agentData) {
      reset({
        name: agentData.name || '',
        description: agentData.description || '',
        tags: agentData.tags?.join(', ') || '',
        isActive: agentData.isActive ?? true,
        maxResultsLimit: agentData.maxResultsLimit || 1000,
        timeoutSeconds: agentData.timeoutSeconds || 30,
        systemPromptOverride: agentData.systemPromptOverride || '',
        llmProvider: agentData.llmProvider as any || 'openai',
        llmModel: agentData.llmModel || 'gpt-4-turbo-preview',
        llmTemperature: agentData.llmTemperature || 0,
        disabledSensitivityRules: agentData.disabledSensitivityRules || [],
        externalDb: {
          dbType: (agentData.externalDb?.dbType as any) || 'postgresql',
          host: agentData.externalDb?.host || 'localhost',
          port: agentData.externalDb?.port || 5432,
          databaseName: agentData.externalDb?.databaseName || '',
          username: agentData.externalDb?.username || '',
          password: '',
          sslEnabled: agentData.externalDb?.sslEnabled || false,
        },
      })
    }
  }, [agentData, reset])




  const saveMutation = useMutation({
    mutationFn: (data: any) => isNew
      ? agentsApi.create(data)
      : agentsApi.update(id!, data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      queryClient.invalidateQueries({ queryKey: ['agent', id] })
      toast.success(isNew ? 'Agent created' : 'Agent updated')
      if (isNew) {
        navigate(`/admin/agents/${response.data.id}`)
      }
      else {
        navigate(`/admin/agents`)
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to save agent')
    },
  })

  const onSubmit = (data: AgentForm) => {
    // Only include externalDb if it's dirty (modified) OR if it's a new agent
    const shouldIncludeExternalDb = isNew || (dirtyFields.externalDb && Object.keys(dirtyFields.externalDb).length > 0)

    const payload: any = {
      ...data,
      tags: data.tags ? data.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      externalDb: shouldIncludeExternalDb ? {
        ...data.externalDb,
        password: data.externalDb.password || '',
      } : undefined,
    }

    // Don't include isActive when creating a new agent
    if (isNew) {
      delete payload.isActive
    }

    saveMutation.mutate(payload)
  }

  const handleTestConnection = async () => {
    if (!id || isNew) return

    setTestingConnection(true)
    try {
      const response = await agentsApi.testConnection(id)
      if (response.data.success) {
        toast.success(`Connection successful(${response.data.latencyMs}ms)`)
      } else {
        toast.error(response.data.message || 'Connection failed')
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Connection test failed')
    } finally {
      setTestingConnection(false)
    }
  }

  const handleRefreshSchema = async () => {
    if (!id || isNew) return

    setRefreshingSchema(true)
    try {
      await schemaApi.refresh(id)
      queryClient.invalidateQueries({ queryKey: ['agent', id] })
      toast.success('Schema refreshed')
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to refresh schema')
    } finally {
      setRefreshingSchema(false)
    }
  }

  const handleGenerateEmbeddings = async () => {
    if (!id || isNew) return

    setGeneratingEmbeddings(true)
    try {
      const response = await embeddingsApi.generate(id)
      toast.success(`Generated ${response.data.embeddingsGenerated} embeddings`)
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to generate embeddings')
    } finally {
      setGeneratingEmbeddings(false)
    }
  }

  if (!isNew && isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <div>
          <button
            onClick={() => navigate('/admin/agents')}
            className="text-blue-600 hover:text-blue-700 mb-2"
          >
            ← Back to Agents
          </button>
          <h1 className="text-3xl font-bold">{isNew ? 'Create Agent' : 'Edit Agent'}</h1>
        </div>
      </div >

      {/* Tabs */}
      < div className="border-b mb-6" >
        <div className="flex gap-6">
          {['general', 'database', 'sensitivity', 'advanced', 'embedding'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === tab
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div >

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="card">
          {activeTab === 'general' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input
                  {...register('name', { required: 'Name is required' })}
                  className="input"
                  placeholder="Sales Analytics Agent"
                />
                {errors.name && (
                  <p className="text-sm text-red-500 mt-1">{errors.name.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea
                  {...register('description')}
                  className="input min-h-[100px]"
                  placeholder="Describe what this agent does..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Tags</label>
                <input
                  {...register('tags')}
                  className="input"
                  placeholder="sales, analytics, reports (comma separated)"
                />
              </div>

              {!isNew && (
                <div>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      {...register('isActive')}
                      className="rounded border-slate-300"
                    />
                    <span className="text-sm font-medium">Active</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {activeTab === 'database' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Database Type</label>
                  <select {...register('externalDb.dbType')} className="input">
                    <option value="postgresql">PostgreSQL</option>
                    <option value="mysql">MySQL</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Host</label>
                  <input
                    {...register('externalDb.host')}
                    className="input"
                    placeholder="localhost"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Port</label>
                  <input
                    type="number"
                    {...register('externalDb.port', { valueAsNumber: true })}
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Database Name</label>
                  <input
                    {...register('externalDb.databaseName')}
                    className="input"
                    placeholder="mydb"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Username</label>
                  <input
                    {...register('externalDb.username')}
                    className="input"
                    placeholder="dbuser"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Password</label>
                  <input
                    type="password"
                    {...register('externalDb.password')}
                    className="input"
                    placeholder={isNew ? 'Enter password' : 'Leave blank to keep existing'}
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    {...register('externalDb.sslEnabled')}
                    className="rounded border-slate-300"
                  />
                  <span className="text-sm font-medium">Enable SSL</span>
                </label>
              </div>

              {!isNew && (
                <div className="flex items-center space-x-4 pt-4 border-t">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={testingConnection}
                    className="btn btn-secondary"
                  >
                    {testingConnection ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Database className="w-4 h-4 mr-2" />
                    )}
                    Test Connection
                  </button>

                  <button
                    type="button"
                    onClick={handleRefreshSchema}
                    disabled={refreshingSchema}
                    className="btn btn-secondary"
                  >
                    {refreshingSchema ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Refresh Schema
                  </button>

                  <button
                    type="button"
                    onClick={handleGenerateEmbeddings}
                    disabled={generatingEmbeddings}
                    className="btn btn-secondary"
                  >
                    {generatingEmbeddings ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Zap className="w-4 h-4 mr-2" />
                    )}
                    Generate Embeddings
                  </button>
                  <button
                    onClick={() => navigate(`/admin/agents/${id}/schema`)}
                    className="text-blue-600 hover:text-blue-700 text-sm flex items-center gap-1"
                  >
                    <Table className="w-4 h-4" />
                    View Full Schema
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'sensitivity' && !isNew && (
            <AgentSensitivitySettings
              agentId={id!}
              disabledRules={watch('disabledSensitivityRules')}
              onToggleRule={(ruleId, isEnabled) => {
                const current = watch('disabledSensitivityRules') || []
                if (isEnabled) {
                  // If enabled, remove from disabled list
                  setValue('disabledSensitivityRules', current.filter(id => id !== ruleId), { shouldDirty: true })
                } else {
                  // If disabled, add to disabled list
                  if (!current.includes(ruleId)) {
                    setValue('disabledSensitivityRules', [...current, ruleId], { shouldDirty: true })
                  }
                }
              }}
            />
          )}

          {activeTab === 'sensitivity' && isNew && (
            <div className="p-8 text-center bg-slate-50 rounded-lg">
              <p className="text-slate-500">Please save the agent first to configure sensitivity rules.</p>
            </div>
          )}

          {activeTab === 'advanced' && (
            <div className="space-y-6">
              {/* LLM Configuration */}
              <div className="border-b pb-6">
                <h3 className="text-lg font-semibold mb-4">LLM Configuration</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">LLM Provider</label>
                    <select {...register('llmProvider')} className="input">
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Model</label>
                    <select {...register('llmModel')} className="input">
                      {LLM_MODELS[(watch('llmProvider') || 'openai') as 'openai' | 'anthropic' | 'openrouter'].map((model: string) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Temperature (0-1)
                      <span className="text-xs text-slate-500 ml-2">Controls randomness in responses</span>
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      {...register('llmTemperature', {
                        valueAsNumber: true,
                        min: 0,
                        max: 1
                      })}
                      className="input"
                      placeholder="0.0"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      0 = More deterministic, 1 = More creative
                    </p>
                  </div>
                </div>
              </div>

              {/* Query Configuration */}
              <div className="border-b pb-6">
                <h3 className="text-lg font-semibold mb-4">Query Configuration</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Max Results Limit</label>
                    <input
                      type="number"
                      {...register('maxResultsLimit', { valueAsNumber: true })}
                      className="input"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Timeout (seconds)</label>
                    <input
                      type="number"
                      {...register('timeoutSeconds', { valueAsNumber: true })}
                      className="input"
                    />
                  </div>
                </div>
              </div>

              {/* System Prompt */}
              <div>
                <label className="block text-sm font-medium mb-1">System Prompt Override</label>
                <textarea
                  {...register('systemPromptOverride')}
                  className="input min-h-[200px] font-mono text-sm"
                  placeholder="Custom system prompt for this agent..."
                />
              </div>
            </div>
          )}

          {activeTab === 'embedding' && !isNew && (
            <div className="space-y-8 p-6">
              <ApiKeysManagement agentId={id!} />
            </div>
          )}

          {activeTab === 'embedding' && isNew && (
            <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/50 rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700 m-6">
              <p className="text-slate-500">Please save the agent first to manage API keys and embedding.</p>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-4 mt-6">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="btn btn-primary"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {isNew ? 'Create Agent' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div >
  )
}
