import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Edit } from 'lucide-react'
import {
    getAgentSensitivityRules,
    createAgentSensitivityRule,
    updateAgentSensitivityRule,
    deleteAgentSensitivityRule
} from '../../../services/api'

interface SensitivityRule {
    id: string
    patternType: 'column_name' | 'table_name' | 'value_pattern'
    patternValue: string
    patternRegex?: string
    sensitivityLevel: 'low' | 'medium' | 'high' | 'critical'
    maskingStrategy: 'full' | 'partial' | 'hash' | 'redact' | 'tokenize'
    description?: string
    isActive: boolean
}

interface SchemaSensitiveColumn {
    id: string
    tableName: string
    columnName: string
    dataType: string
    isSensitive: boolean
    sensitivityLevel?: 'low' | 'medium' | 'high' | 'critical'
    maskingStrategy?: 'full' | 'partial' | 'hash' | 'redact' | 'tokenize'
    adminDescription?: string
}

export default function AgentSensitivitySettings({
    agentId,
    disabledRules,
    onToggleRule
}: {
    agentId: string
    disabledRules?: string[]
    onToggleRule?: (ruleId: string, isEnabled: boolean) => void
}) {
    const queryClient = useQueryClient()
    const navigate = useNavigate()

    const [showRuleForm, setShowRuleForm] = useState(false)
    const [editingRule, setEditingRule] = useState<SensitivityRule | null>(null)

    const { data: sensitivityData, isLoading } = useQuery({
        queryKey: ['agent-sensitivity', agentId],
        queryFn: () => getAgentSensitivityRules(agentId),
        enabled: !!agentId,
    })

    const createMutation = useMutation({
        mutationFn: (data: Partial<SensitivityRule>) => createAgentSensitivityRule(agentId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agent-sensitivity', agentId] })
            setShowRuleForm(false)
            setEditingRule(null)
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ ruleId, data }: { ruleId: string; data: Partial<SensitivityRule> }) =>
            updateAgentSensitivityRule(agentId, ruleId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agent-sensitivity', agentId] })
            setShowRuleForm(false)
            setEditingRule(null)
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (ruleId: string) => deleteAgentSensitivityRule(agentId, ruleId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agent-sensitivity', agentId] })
        },
    })

    const globalRules = sensitivityData?.data?.globalRules || []
    const schemaSensitiveColumns = sensitivityData?.data?.schemaSensitiveColumns || []
    const agentRules = sensitivityData?.data?.agentRules || []

    const handleSubmit = (data: Partial<SensitivityRule>) => {
        if (editingRule) {
            updateMutation.mutate({ ruleId: editingRule.id, data })
        } else {
            // Remove isActive from create payload - it defaults to true on backend
            const { isActive, ...createData } = data
            createMutation.mutate(createData)
        }
    }

    if (isLoading) {
        return <div className="p-8">Loading...</div>
    }

    return (
        <div className="space-y-6">
            {/* Global Rules */}
            <div>
                <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
                    <span className="text-2xl">🌐</span>
                    Global Rules (Inherited)
                </h2>
                <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                    {globalRules.length === 0 ? (
                        <p className="text-slate-500 text-sm">No global rules defined</p>
                    ) : (
                        globalRules.map((rule: SensitivityRule) => {
                            const isEnabled = !disabledRules?.includes(rule.id)
                            return (
                                <div key={rule.id} className={`p-3 rounded border flex items-center justify-between transition-colors ${isEnabled ? 'bg-white border-slate-200' : 'bg-slate-100 border-slate-200 opacity-75'}`}>
                                    <div className="flex items-center gap-3 flex-1">
                                        {onToggleRule && (
                                            <input
                                                type="checkbox"
                                                checked={isEnabled}
                                                onChange={(e) => onToggleRule(rule.id, e.target.checked)}
                                                className="rounded border-slate-300 w-4 h-4 text-primary-600 focus:ring-primary-500"
                                            />
                                        )}
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded">
                                                    {rule.patternValue}
                                                </span>
                                                <span className={`text-xs px-2 py-1 rounded ${rule.maskingStrategy === 'full' ? 'bg-red-100 text-red-700' :
                                                    rule.maskingStrategy === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-blue-100 text-blue-700'
                                                    }`}>
                                                    {rule.maskingStrategy}
                                                </span>
                                                <span className={`text-xs px-2 py-1 rounded ${rule.sensitivityLevel === 'critical' ? 'bg-red-100 text-red-700' :
                                                    rule.sensitivityLevel === 'high' ? 'bg-orange-100 text-orange-700' :
                                                        rule.sensitivityLevel === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                                            'bg-green-100 text-green-700'
                                                    }`}>
                                                    {rule.sensitivityLevel}
                                                </span>
                                                {!isEnabled && (
                                                    <span className="text-xs px-2 py-1 rounded bg-gray-200 text-gray-600 font-medium">
                                                        Disabled for Agent
                                                    </span>
                                                )}
                                            </div>
                                            {rule.description && (
                                                <p className="text-sm text-slate-600 mt-1">{rule.description}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>
            </div>

            {/* Database-Level Sensitivity Rules */}
            <div>
                <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
                    <span className="text-2xl">📊</span>
                    Database-Level Sensitivity Rules
                </h2>
                <p className="text-sm text-slate-500 mb-3">
                    Columns marked as sensitive in the schema metadata.{' '}
                    <button
                        type="button"
                        onClick={() => navigate(`/admin/agents/${agentId}/schema`)}
                        className="text-blue-600 hover:text-blue-700 font-medium"
                    >
                        Edit in Schema Explorer →
                    </button>
                </p>
                <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                    {schemaSensitiveColumns.length === 0 ? (
                        <p className="text-slate-500 text-sm">
                            No columns marked as sensitive in schema
                        </p>
                    ) : (
                        schemaSensitiveColumns.map((col: SchemaSensitiveColumn) => (
                            <div key={col.id} className="bg-white p-3 rounded border flex items-center justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-sm bg-blue-50 px-2 py-1 rounded text-blue-700">
                                            {col.tableName}.{col.columnName}
                                        </span>
                                        <span className="text-xs text-slate-500">
                                            ({col.dataType})
                                        </span>
                                        {col.maskingStrategy && (
                                            <span className={`text-xs px-2 py-1 rounded ${col.maskingStrategy === 'full' ? 'bg-red-100 text-red-700' :
                                                col.maskingStrategy === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                                                    'bg-blue-100 text-blue-700'
                                                }`}>
                                                {col.maskingStrategy}
                                            </span>
                                        )}
                                        {col.sensitivityLevel && (
                                            <span className={`text-xs px-2 py-1 rounded ${col.sensitivityLevel === 'critical' ? 'bg-red-100 text-red-700' :
                                                col.sensitivityLevel === 'high' ? 'bg-orange-100 text-orange-700' :
                                                    col.sensitivityLevel === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-green-100 text-green-700'
                                                }`}>
                                                {col.sensitivityLevel}
                                            </span>
                                        )}
                                    </div>
                                    {col.adminDescription && (
                                        <p className="text-sm text-slate-600 mt-1">{col.adminDescription}</p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => navigate(`/admin/agents/${agentId}/schema`)}
                                    className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1"
                                >
                                    <Edit className="w-3 h-3" />
                                    Edit
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Agent-Specific Rules */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <span className="text-2xl">🔒</span>
                        Agent-Specific Rules
                    </h2>
                    <button
                        type="button"
                        onClick={() => {
                            setEditingRule(null)
                            setShowRuleForm(true)
                        }}
                        className="btn btn-primary"
                    >
                        + Add Rule
                    </button>
                </div>

                {showRuleForm && (
                    <RuleForm
                        rule={editingRule}
                        onSubmit={handleSubmit}
                        onCancel={() => {
                            setShowRuleForm(false)
                            setEditingRule(null)
                        }}
                        isLoading={createMutation.isPending || updateMutation.isPending}
                    />
                )}

                <div className="space-y-2">
                    {agentRules.length === 0 ? (
                        <div className="bg-slate-50 rounded-lg p-8 text-center">
                            <p className="text-slate-500">No agent-specific rules defined</p>
                            <p className="text-sm text-slate-400 mt-1">
                                Click "Add Rule" to create custom masking rules for this agent
                            </p>
                        </div>
                    ) : (
                        agentRules.map((rule: SensitivityRule) => (
                            <div key={rule.id} className="bg-white p-4 rounded-lg border hover:shadow-sm transition-shadow">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded">
                                                {rule.patternValue}
                                            </span>
                                            <span className={`text-xs px-2 py-1 rounded ${rule.maskingStrategy === 'full' ? 'bg-red-100 text-red-700' :
                                                rule.maskingStrategy === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                                                    'bg-blue-100 text-blue-700'
                                                }`}>
                                                {rule.maskingStrategy}
                                            </span>
                                            <span className={`text-xs px-2 py-1 rounded ${rule.sensitivityLevel === 'critical' ? 'bg-red-100 text-red-700' :
                                                rule.sensitivityLevel === 'high' ? 'bg-orange-100 text-orange-700' :
                                                    rule.sensitivityLevel === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-green-100 text-green-700'
                                                }`}>
                                                {rule.sensitivityLevel}
                                            </span>
                                            {!rule.isActive && (
                                                <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">
                                                    Inactive
                                                </span>
                                            )}
                                        </div>
                                        {rule.description && (
                                            <p className="text-sm text-slate-600">{rule.description}</p>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setEditingRule(rule)
                                                setShowRuleForm(true)
                                            }}
                                            className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (confirm('Delete this rule?')) {
                                                    deleteMutation.mutate(rule.id)
                                                }
                                            }}
                                            className="text-red-600 hover:text-red-700 text-sm font-medium"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    )
}

function RuleForm({
    rule,
    onSubmit,
    onCancel,
    isLoading,
}: {
    rule: SensitivityRule | null
    onSubmit: (data: Partial<SensitivityRule>) => void
    onCancel: () => void
    isLoading: boolean
}) {
    const [formData, setFormData] = useState<Partial<SensitivityRule>>(
        rule || {
            patternType: 'column_name',
            patternValue: '',
            sensitivityLevel: 'medium',
            maskingStrategy: 'partial',
            isActive: true,
        }
    )

    return (
        <div className="bg-white border rounded-lg p-6 mb-4 shadow-sm">
            <h3 className="font-semibold mb-4">{rule ? 'Edit Rule' : 'New Rule'}</h3>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium mb-1">Pattern Type</label>
                    <select
                        value={formData.patternType}
                        onChange={(e) => setFormData({ ...formData, patternType: e.target.value as any })}
                        className="input"
                    >
                        <option value="column_name">Column Name</option>
                        <option value="table_name">Table Name</option>
                        <option value="value_pattern">Value Pattern</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">Pattern Value</label>
                    <input
                        type="text"
                        value={formData.patternValue}
                        onChange={(e) => setFormData({ ...formData, patternValue: e.target.value })}
                        className="input"
                        placeholder="e.g., email, password, ssn"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">Sensitivity Level</label>
                    <select
                        value={formData.sensitivityLevel}
                        onChange={(e) => setFormData({ ...formData, sensitivityLevel: e.target.value as any })}
                        className="input"
                    >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">Masking Strategy</label>
                    <select
                        value={formData.maskingStrategy}
                        onChange={(e) => setFormData({ ...formData, maskingStrategy: e.target.value as any })}
                        className="input"
                    >
                        <option value="full">Full (***REDACTED***)</option>
                        <option value="partial">Partial (ab***@example.com)</option>
                        <option value="hash">Hash (HASH:a1b2c3...)</option>
                        <option value="redact">Redact ([REDACTED])</option>
                        <option value="tokenize">Tokenize (TOK_abc123)</option>
                    </select>
                </div>

                <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">Description (Optional)</label>
                    <textarea
                        value={formData.description || ''}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="input"
                        rows={2}
                        placeholder="Describe when this rule applies..."
                    />
                </div>

                {rule && (
                    <div className="col-span-2 flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={formData.isActive}
                            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                            className="rounded"
                        />
                        <label className="text-sm">Active</label>
                    </div>
                )}
            </div>

            <div className="flex gap-2 mt-4">
                <button
                    type="button"
                    onClick={() => onSubmit(formData)}
                    disabled={isLoading || !formData.patternValue}
                    className="btn btn-primary"
                >
                    {isLoading ? 'Saving...' : rule ? 'Update Rule' : 'Create Rule'}
                </button>
                <button type="button" onClick={onCancel} className="btn btn-secondary">
                    Cancel
                </button>
            </div>
        </div>
    )
}
