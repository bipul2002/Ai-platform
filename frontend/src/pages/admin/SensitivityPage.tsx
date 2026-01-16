import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Shield, Trash2, Edit, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'
import { sensitivityApi } from '@/services/api'

export default function SensitivityPage() {
  const [showModal, setShowModal] = useState(false)
  const [editingRule, setEditingRule] = useState<any>(null)
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['sensitivity-global'],
    queryFn: () => sensitivityApi.getGlobal(),
  })

  const rules = data?.data || []

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sensitivityApi.deleteGlobal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sensitivity-global'] })
      toast.success('Rule deleted')
    },
    onError: () => {
      toast.error('Failed to delete rule')
    },
  })

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this rule?')) {
      deleteMutation.mutate(id)
    }
  }

  const getSensitivityColor = (level: string) => {
    switch (level) {
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
      case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300'
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300'
      case 'low': return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
      default: return 'bg-slate-100 text-slate-800'
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Sensitivity Rules</h1>
          <p className="text-slate-500 mt-1">
            Configure global and per-agent sensitive data detection
          </p>
        </div>
        <button
          onClick={() => {
            setEditingRule(null)
            setShowModal(true)
          }}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Rule
        </button>
      </div>

      {isLoading ? (
        <div className="card">
          <div className="animate-pulse space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded-lg" />
            ))}
          </div>
        </div>
      ) : rules.length === 0 ? (
        <div className="card text-center py-12">
          <Shield className="w-12 h-12 mx-auto text-slate-300 mb-4" />
          <h3 className="text-lg font-medium mb-2">No sensitivity rules</h3>
          <p className="text-slate-500 mb-4">Add rules to detect and mask sensitive data</p>
          <button
            onClick={() => setShowModal(true)}
            className="btn btn-primary"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Rule
          </button>
        </div>
      ) : (
        <div className="card">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 font-medium">Pattern</th>
                <th className="text-left py-3 px-4 font-medium">Type</th>
                <th className="text-left py-3 px-4 font-medium">Sensitivity</th>
                <th className="text-left py-3 px-4 font-medium">Masking</th>
                <th className="text-left py-3 px-4 font-medium">Status</th>
                <th className="text-right py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule: any) => (
                <tr key={rule.id} className="border-b last:border-b-0">
                  <td className="py-3 px-4">
                    <div>
                      <span className="font-medium">{rule.patternValue}</span>
                      {rule.description && (
                        <p className="text-sm text-slate-500">{rule.description}</p>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-slate-500">{rule.patternType}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={clsx(
                      'px-2 py-0.5 text-xs font-medium rounded-full',
                      getSensitivityColor(rule.sensitivityLevel)
                    )}>
                      {rule.sensitivityLevel}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm">{rule.maskingStrategy}</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={clsx(
                      'px-2 py-0.5 text-xs font-medium rounded-full',
                      rule.isActive
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
                        : 'bg-slate-100 text-slate-600'
                    )}>
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => {
                        setEditingRule(rule)
                        setShowModal(true)
                      }}
                      className="btn btn-ghost p-2"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="btn btn-ghost p-2 text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <SensitivityModal
          rule={editingRule}
          onClose={() => {
            setShowModal(false)
            setEditingRule(null)
          }}
        />
      )}
    </div>
  )
}

function SensitivityModal({ rule, onClose }: { rule: any; onClose: () => void }) {
  const [formData, setFormData] = useState({
    patternType: rule?.patternType || 'column_name',
    patternValue: rule?.patternValue || '',
    patternRegex: rule?.patternRegex || '',
    sensitivityLevel: rule?.sensitivityLevel || 'high',
    maskingStrategy: rule?.maskingStrategy || 'full',
    description: rule?.description || '',
    isActive: rule?.isActive ?? true,
  })

  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (data: any) => rule
      ? sensitivityApi.updateGlobal(rule.id, data)
      : sensitivityApi.createGlobal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sensitivity-global'] })
      toast.success(rule ? 'Rule updated' : 'Rule created')
      onClose()
    },
    onError: () => {
      toast.error('Failed to save rule')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (rule) {
      mutation.mutate(formData)
    } else {
      // Remove isActive from create payload - it defaults to true on backend
      const { isActive, ...createData } = formData
      mutation.mutate(createData)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-lg p-6 m-4">
        <h2 className="text-xl font-bold mb-4">
          {rule ? 'Edit Rule' : 'Add Sensitivity Rule'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Pattern Type</label>
              <select
                value={formData.patternType}
                onChange={(e) => setFormData({ ...formData, patternType: e.target.value })}
                className="input"
              >
                <option value="column_name">Column Name</option>
                <option value="value_pattern">Value Pattern</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Sensitivity Level</label>
              <select
                value={formData.sensitivityLevel}
                onChange={(e) => setFormData({ ...formData, sensitivityLevel: e.target.value })}
                className="input"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Pattern Value</label>
            <input
              type="text"
              value={formData.patternValue}
              onChange={(e) => setFormData({ ...formData, patternValue: e.target.value })}
              className="input"
              placeholder="password, ssn, credit_card..."
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Regex Pattern (optional)</label>
            <input
              type="text"
              value={formData.patternRegex}
              onChange={(e) => setFormData({ ...formData, patternRegex: e.target.value })}
              className="input font-mono text-sm"
              placeholder="(?i)^password$|password_hash"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Masking Strategy</label>
            <select
              value={formData.maskingStrategy}
              onChange={(e) => setFormData({ ...formData, maskingStrategy: e.target.value })}
              className="input"
            >
              <option value="full">Full (***REDACTED***)</option>
              <option value="partial">Partial (Show first/last chars)</option>
              <option value="hash">Hash (HASH:abc123)</option>
              <option value="redact">Redact ([REDACTED])</option>
              <option value="tokenize">Tokenize (TOK_abc123)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="input"
              placeholder="Describe when this rule applies..."
            />
          </div>

          {rule && (
            <div>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="rounded border-slate-300"
                />
                <span className="text-sm font-medium">Active</span>
              </label>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending} className="btn btn-primary">
              {mutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {rule ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
