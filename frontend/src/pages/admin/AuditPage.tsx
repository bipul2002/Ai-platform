import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Database, Filter } from 'lucide-react'
import { format } from 'date-fns'
import { clsx } from 'clsx'
import { auditApi, organizationsApi, agentsApi, agentApiKeysApi, usersApi } from '@/services/api'
import { useAuthStore } from '@/store/auth'
import QueryDetailsModal from './QueryDetailsModal'

export default function AuditPage() {
  const { user } = useAuthStore()
  const isSuperAdmin = user?.role === 'super_admin'
  const isViewer = user?.role === 'viewer'
  const [activeTab, setActiveTab] = useState<'logs' | 'queries'>(isViewer ? 'queries' : 'logs')
  const [orgs, setOrgs] = useState([])
  const [agents, setAgents] = useState([])
  const [keys, setKeys] = useState([])
  const [adminUsers, setAdminUsers] = useState([])
  const [filters, setFilters] = useState({
    action: '',
    agentId: '',
    apiKeyId: '',
    userId: '',
    startDate: '',
    endDate: '',
    organizationId: '',
    page: 1,
  })

  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)

  useEffect(() => {
    if (isSuperAdmin) {
      fetchOrgs()
    }
    fetchAgents()
    fetchUsers()
  }, [isSuperAdmin, filters.organizationId])

  useEffect(() => {
    if (filters.agentId) {
      fetchKeys()
    } else {
      setKeys([])
      setFilters(prev => ({ ...prev, apiKeyId: '' }))
    }
  }, [filters.agentId])

  const fetchKeys = async () => {
    try {
      const res = await agentApiKeysApi.list(filters.agentId)
      // Agent API Keys list returns an array directly
      setKeys(Array.isArray(res.data) ? res.data : (res.data?.data || []))
    } catch (error) {
      console.error('Failed to load API keys', error)
      setKeys([])
    }
  }

  const fetchAgents = async () => {
    try {
      // If super admin and no org selected, we might not want to fetch all agents or backend might return empty
      // But let's try fetching. 
      const params: any = { limit: 100 }
      if (filters.organizationId) params.organizationId = filters.organizationId

      const res = await agentsApi.list(params)
      setAgents(res.data.data)
    } catch (error) {
      console.error('Failed to load agents', error)
      setAgents([])
    }
  }

  const fetchOrgs = async () => {
    try {
      const res = await organizationsApi.list()
      setOrgs(res.data)
    } catch (error) {
      console.error('Failed to load organizations', error)
    }
  }

  const fetchUsers = async () => {
    try {
      const params: any = {}
      if (filters.organizationId) params.organizationId = filters.organizationId
      const res = await usersApi.list(params.organizationId)
      // Handle both { data: [...] } and { data: { data: [...] } } formats
      const userData = Array.isArray(res.data) ? res.data : (res.data?.data || [])
      setAdminUsers(userData)
    } catch (error) {
      console.error('Failed to load users', error)
      setAdminUsers([])
    }
  }

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['audit-logs', filters],
    queryFn: () => {
      const cleanFilters: any = { ...filters }
      Object.keys(cleanFilters).forEach(key => {
        if (!cleanFilters[key]) delete cleanFilters[key]
      })
      return auditApi.getLogs(cleanFilters)
    },
    enabled: activeTab === 'logs',
  })

  const { data: queriesData, isLoading: queriesLoading } = useQuery({
    queryKey: ['audit-queries', filters],
    queryFn: () => {
      const cleanFilters: any = { ...filters }
      Object.keys(cleanFilters).forEach(key => {
        if (!cleanFilters[key]) delete cleanFilters[key]
      })
      return auditApi.getQueries(cleanFilters)
    },
    enabled: activeTab === 'queries',
  })

  const logs = logsData?.data?.data || []
  const queries = queriesData?.data?.data || []



  const getActionColor = (action: string) => {
    if (action.includes('created')) return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
    if (action.includes('deleted')) return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
    if (action.includes('updated')) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
    if (action.includes('failed')) return 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300'
    return 'bg-slate-100 text-slate-800'
  }

  return (
    <div>
      {/* ... Header ... */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{isViewer ? 'My Query History' : 'Audit Logs'}</h1>
          <p className="text-slate-500 mt-1">{isViewer ? 'View your query history and technical details' : 'View system activity and query history'}</p>
        </div>
      </div>

      {/* ... Tabs ... */}
      <div className="border-b mb-6">
        <div className="flex space-x-8">
          {!isViewer && (
            <button
              onClick={() => setActiveTab('logs')}
              className={clsx(
                'pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center',
                activeTab === 'logs'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              <FileText className="w-4 h-4 mr-2" />
              Activity Logs
            </button>
          )}
          <button
            onClick={() => setActiveTab('queries')}
            className={clsx(
              'pb-3 px-1 text-sm font-medium border-b-2 transition-colors flex items-center',
              activeTab === 'queries'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            <Database className="w-4 h-4 mr-2" />
            Query History
          </button>
        </div>
      </div>

      {/* ... Filters ... */}
      <div className="card mb-6">
        <div className="flex items-center space-x-4 flex-wrap gap-y-4">
          <Filter className="w-5 h-5 text-slate-400" />

          {isSuperAdmin && (
            <select
              value={filters.organizationId}
              onChange={(e) => setFilters({ ...filters, organizationId: e.target.value, page: 1 })}
              className="input w-auto min-w-[200px]"
            >
              <option value="">All Organizations</option>
              <option value="null">System (Super Admin)</option>
              {orgs.map((org: any) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          )}

          <select
            value={filters.agentId}
            onChange={(e) => setFilters({ ...filters, agentId: e.target.value, page: 1 })}
            className="input w-auto min-w-[200px]"
          >
            <option value="">All Agents</option>
            {agents.map((agent: any) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>

          {!isViewer && (
            <select
              value={filters.userId}
              onChange={(e) => setFilters({ ...filters, userId: e.target.value, page: 1 })}
              className="input w-auto min-w-[200px]"
            >
              <option value="">All Users</option>
              {adminUsers.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.firstName || u.lastName ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : u.email}
                </option>
              ))}
            </select>
          )}

          {!isViewer && filters.agentId && (
            <select
              value={filters.apiKeyId}
              onChange={(e) => setFilters({ ...filters, apiKeyId: e.target.value, page: 1 })}
              className="input w-auto min-w-[200px]"
            >
              <option value="">All API Keys</option>
              {keys.map((key: any) => (
                <option key={key.id} value={key.id}>{key.name}</option>
              ))}
            </select>
          )}

          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilters({ ...filters, startDate: e.target.value, page: 1 })}
            className="input w-auto"
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => setFilters({ ...filters, endDate: e.target.value, page: 1 })}
            className="input w-auto"
          />
          {activeTab === 'logs' && (
            <select
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value, page: 1 })}
              className="input w-auto"
            >
              <option value="">All actions</option>
              <option value="agent_created">Agent Created</option>
              <option value="agent_updated">Agent Updated</option>
              <option value="agent_deleted">Agent Deleted</option>
              <option value="schema_ingested">Schema Ingested</option>
              <option value="schema_refreshed">Schema Refreshed</option>
              <option value="query_executed">Query Executed</option>
              <option value="query_failed">Query Failed</option>
            </select>
          )}
        </div>
      </div>

      {activeTab === 'logs' ? (
        <div className="card">
          {logsLoading ? (
            <div className="animate-pulse space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded-lg" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              No audit logs found
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Timestamp</th>
                  <th className="text-left py-3 px-4 font-medium">Action</th>
                  <th className="text-left py-3 px-4 font-medium">User</th>
                  <th className="text-left py-3 px-4 font-medium">Resource</th>
                  <th className="text-left py-3 px-4 font-medium">Status</th>
                  <th className="text-left py-3 px-4 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: any) => (
                  <tr key={log.id} className="border-b last:border-b-0">
                    <td className="py-3 px-4 text-sm text-slate-500">
                      {format(new Date(log.createdAt), 'MMM d, yyyy HH:mm:ss')}
                    </td>
                    <td className="py-3 px-4">
                      <span className={clsx(
                        'px-2 py-0.5 text-xs font-medium rounded-full',
                        getActionColor(log.action)
                      )}>
                        {log.action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm whitespace-nowrap">
                      {log.userName ? (
                        <div>
                          <p className="font-medium text-slate-700">{log.userName}</p>
                          <p className="text-xs text-slate-500">{log.userEmail}</p>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">System</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm">
                      {log.resourceType && (
                        <span className="text-slate-500">
                          {log.resourceType}
                          {log.resourceId && `: ${log.resourceId.substring(0, 8)}...`}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {log.isSuccess ? (
                        <span className="text-green-600">Success</span>
                      ) : (
                        <span className="text-red-600">Failed</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-500">
                      {log.details && Object.keys(log.details).length > 0 && (
                        <code className="text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                          {JSON.stringify(log.details).substring(0, 50)}...
                        </code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card">
          {queriesLoading ? (
            <div className="animate-pulse space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-lg" />
              ))}
            </div>
          ) : queries.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              No query history found
            </div>
          ) : (
            <div className="space-y-4">
              {queries.map((query: any) => (
                <div
                  key={query.id}
                  className="border rounded-lg p-4 hover:border-primary-300 dark:hover:border-primary-800 cursor-pointer transition-colors"
                  onClick={() => {
                    setSelectedQueryId(query.id)
                    setIsDetailsOpen(true)
                  }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-medium">{query.userMessage}</p>
                      <p className="text-sm text-slate-500 mt-1">
                        {format(new Date(query.createdAt), 'MMM d, yyyy HH:mm:ss')}
                        {query.executionTimeMs && ` • ${query.executionTimeMs}ms`}
                        {query.apiKeyName && (
                          <span className="ml-2 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                            Key: {query.apiKeyName}
                          </span>
                        )}
                        {query.userName && (
                          <span className="ml-2 px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-xs font-medium">
                            User: {query.userName}
                          </span>
                        )}
                      </p>
                    </div>
                    <span className={clsx(
                      'px-2 py-0.5 text-xs font-medium rounded-full',
                      query.isSuccess
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
                    )}>
                      {query.isSuccess ? 'Success' : 'Failed'}
                    </span>
                  </div>

                  {query.generatedSql && (
                    <div className="mt-3 p-3 bg-slate-900 rounded-lg overflow-x-auto">
                      <code className="text-xs text-slate-300 font-mono">
                        {query.generatedSql}
                      </code>
                    </div>
                  )}

                  {query.errorMessage && (
                    <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded text-sm text-red-600 dark:text-red-400">
                      {query.errorMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-6 border-t pt-4">
        <p className="text-sm text-slate-500">
          {(() => {
            const data = activeTab === 'logs' ? logsData?.data : queriesData?.data;
            const limit = data?.limit || 10;
            const total = data?.total || 0;
            const startIndex = (filters.page - 1) * limit + 1;
            const endIndex = Math.min(filters.page * limit, total);
            return (
              <>
                Showing <span className="font-medium">{startIndex}</span> to <span className="font-medium">{endIndex}</span> of <span className="font-medium">{total}</span> results
              </>
            );
          })()}
        </p>
        <div className="flex space-x-2">
          <button
            onClick={() => setFilters({ ...filters, page: Math.max(1, filters.page - 1) })}
            disabled={filters.page === 1}
            className="btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1 text-sm"
          >
            Previous
          </button>
          <button
            onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
            className="btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1 text-sm"
            disabled={(() => {
              const data = activeTab === 'logs' ? logsData?.data : queriesData?.data;
              const total = data?.total || 0;
              const limit = data?.limit || 10;
              const totalPages = Math.ceil(total / limit);
              return filters.page >= totalPages || total === 0;
            })()}
          >
            Next
          </button>
        </div>
      </div>

      <QueryDetailsModal
        queryId={selectedQueryId}
        isOpen={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
      />
    </div>
  )
}
