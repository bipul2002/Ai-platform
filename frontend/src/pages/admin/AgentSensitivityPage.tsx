import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
    getAgentSensitivityRules,
    createAgentSensitivityRule,
    updateAgentSensitivityRule,
    deleteAgentSensitivityRule
} from '../../services/api'

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

export default function AgentSensitivityPage() {
    const { id } = useParams()
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const [showRuleForm, setShowRuleForm] = useState(false)
    const [editingRule, setEditingRule] = useState<SensitivityRule | null>(null)
    const [activeTab, setActiveTab] = useState<'rules' | 'forbidden'>('rules')

    const { data: sensitivityData, isLoading } = useQuery({
        queryKey: ['agent-sensitivity', id],
        queryFn: () => getAgentSensitivityRules(id!),
        enabled: !!id,
    })

    const createMutation = useMutation({
        mutationFn: (data: Partial<SensitivityRule>) => createAgentSensitivityRule(id!, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agent-sensitivity', id] })
            setShowRuleForm(false)
            setEditingRule(null)
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ ruleId, data }: { ruleId: string; data: Partial<SensitivityRule> }) =>
            updateAgentSensitivityRule(id!, ruleId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agent-sensitivity', id] })
            setShowRuleForm(false)
            setEditingRule(null)
        },
    })

    const deleteMutation = useMutation({
        mutationFn: (ruleId: string) => deleteAgentSensitivityRule(id!, ruleId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['agent-sensitivity', id] })
        },
    })

    const globalRules = sensitivityData?.data?.globalRules || []
    const agentRules = sensitivityData?.data?.agentRules || []

    const handleSubmit = (data: Partial<SensitivityRule>) => {
        if (editingRule) {
            updateMutation.mutate({ ruleId: editingRule.id, data })
        } else {
            createMutation.mutate(data)
        }
    }

    if (isLoading) {
        return <div className="p-8">Loading...</div>
    }

    return (
        <div className="p-8 max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <button
                        onClick={() => navigate(`/admin/agents/${id}`)}
                        className="text-blue-600 hover:text-blue-700 mb-2"
                    >
                        ← Back to Agent
                    </button>
                    <h1 className="text-3xl font-bold">Sensitivity Rules</h1>
                    <p className="text-slate-600 mt-1">
                        Configure data masking and field restrictions for this agent
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b mb-6">
                <div className="flex gap-4">
                    <button
                        onClick={() => setActiveTab('rules')}
                        className={`px-4 py-2 border-b-2 transition-colors ${activeTab === 'rules'
                            ? 'border-blue-600 text-blue-600 font-medium'
                            : 'border-transparent text-slate-600 hover:text-slate-900'
                            }`}
                    >
                        Masking Rules
                    </button>
                    <button
                        onClick={() => setActiveTab('forbidden')}
                        className={`px-4 py-2 border-b-2 transition-colors ${activeTab === 'forbidden'
                            ? 'border-blue-600 text-blue-600 font-medium'
                            : 'border-transparent text-slate-600 hover:text-slate-900'
                            }`}
                    >
                        Forbidden Fields
                    </button>
                </div>
            </div>

            {activeTab === 'rules' && (
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
                                globalRules.map((rule: SensitivityRule) => (
                                    <div key={rule.id} className="bg-white p-3 rounded border flex items-center justify-between">
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
                                            </div>
                                            {rule.description && (
                                                <p className="text-sm text-slate-600 mt-1">{rule.description}</p>
                                            )}
                                        </div>
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
                                onClick={() => {
                                    setEditingRule(null)
                                    setShowRuleForm(true)
                                }}
                                className="btn-primary"
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
                                                    onClick={() => {
                                                        setEditingRule(rule)
                                                        setShowRuleForm(true)
                                                    }}
                                                    className="text-blue-600 hover:text-blue-700 text-sm"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (confirm('Delete this rule?')) {
                                                            deleteMutation.mutate(rule.id)
                                                        }
                                                    }}
                                                    className="text-red-600 hover:text-red-700 text-sm"
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
            )}

            {activeTab === 'forbidden' && (
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                            <span className="text-2xl">🚫</span>
                            Forbidden Fields
                        </h2>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-8 text-center">
                        <p className="text-slate-500">Forbidden fields management coming soon</p>
                        <p className="text-sm text-slate-400 mt-1">
                            Fields marked as forbidden will be blocked from queries
                        </p>
                    </div>
                </div>
            )}
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

                <div className="col-span-2 flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={formData.isActive}
                        onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                        className="rounded"
                    />
                    <label className="text-sm">Active</label>
                </div>
            </div>

            <div className="flex gap-2 mt-4">
                <button
                    onClick={() => onSubmit(formData)}
                    disabled={isLoading || !formData.patternValue}
                    className="btn-primary"
                >
                    {isLoading ? 'Saving...' : rule ? 'Update Rule' : 'Create Rule'}
                </button>
                <button onClick={onCancel} className="btn-secondary">
                    Cancel
                </button>
            </div>
        </div>
    )
}
