import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Search,
  Database,
  Trash2,
  Edit,
  CheckCircle,
  XCircle,
  Activity
} from 'lucide-react'

import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { agentsApi } from '@/services/api'

export default function AgentsPage() {
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['agents', search, showInactive],
    queryFn: () => agentsApi.list({
      search: search || undefined,
      isActive: showInactive ? undefined : true
    }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => agentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Agent deleted')
    },
    onError: () => {
      toast.error('Failed to delete agent')
    },
  })

  const agents = data?.data?.data || []

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"?`)) {
      deleteMutation.mutate(id)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Agents</h1>
          <p className="text-slate-500 mt-1">Manage your AI query agents</p>
        </div>
        <Link to="/admin/agents/new" className="btn btn-primary">
          <Plus className="w-4 h-4 mr-2" />
          Create Agent
        </Link>
      </div>

      <div className="card mb-6">
        <div className="flex items-center space-x-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="input pl-10"
            />
          </div>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span className="text-sm">Show inactive</span>
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="card">
          <div className="animate-pulse space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 bg-slate-100 dark:bg-slate-800 rounded-lg" />
            ))}
          </div>
        </div>
      ) : agents.length === 0 ? (
        <div className="card text-center py-12">
          <Database className="w-12 h-12 mx-auto text-slate-300 mb-4" />
          <h3 className="text-lg font-medium mb-2">No agents found</h3>
          <p className="text-slate-500 mb-4">Create your first agent to get started</p>
          <Link to="/admin/agents/new" className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            Create Agent
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {agents.map((agent: any) => (
            <div
              key={agent.id}
              className="card hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/admin/agents/${agent.id}`)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3">
                    <h3 className="text-lg font-semibold">{agent.name}</h3>
                    {agent.isActive ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300">
                        <XCircle className="w-3 h-3 mr-1" />
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-slate-500 mt-1 line-clamp-1">
                    {agent.description || 'No description'}
                  </p>

                  <div className="flex items-center space-x-6 mt-3 text-sm text-slate-500">
                    <span className="flex items-center">
                      <Database className="w-4 h-4 mr-1" />
                      {agent.dbType || 'Not configured'}
                    </span>
                    <span className="flex items-center">
                      <Activity className="w-4 h-4 mr-1" />
                      {agent.queryCount || 0} queries
                    </span>
                    {agent.lastUsedAt && (
                      <span>
                        Last used: {format(new Date(agent.lastUsedAt), 'MMM d, yyyy')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
                  <Link
                    to={`/admin/agents/${agent.id}`}
                    className="btn btn-ghost p-2"
                  >
                    <Edit className="w-4 h-4" />
                  </Link>
                  <button
                    onClick={() => handleDelete(agent.id, agent.name)}
                    className="btn btn-ghost p-2 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
