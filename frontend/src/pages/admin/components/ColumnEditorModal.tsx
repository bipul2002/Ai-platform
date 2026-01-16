import { useState } from 'react'
import { X } from 'lucide-react'

interface ColumnEditorModalProps {
    column: any
    onClose: () => void
    onSave: (data: any) => void
    isSaving: boolean
}

export default function ColumnEditorModal({ column, onClose, onSave, isSaving }: ColumnEditorModalProps) {
    const [activeTab, setActiveTab] = useState<'description' | 'settings' | 'sensitivity'>('description')
    const [formData, setFormData] = useState({
        adminDescription: column.adminDescription || '',
        semanticHints: column.semanticHints || '',
        customPrompt: column.customPrompt || '',
        isVisible: column.isVisible ?? true,
        isQueryable: column.isQueryable ?? true,
        isSensitive: column.isSensitive ?? false,
        sensitivityOverride: column.sensitivityOverride || null,
        maskingStrategyOverride: column.maskingStrategyOverride || null,
    })

    const handleSubmit = () => {
        onSave(formData)
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b">
                    <div>
                        <h2 className="text-xl font-bold">Edit Column: {column.columnName}</h2>
                        <p className="text-sm text-slate-500 mt-1">
                            {column.dataType} • {column.isNullable ? 'Nullable' : 'Not Null'}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b">
                    {[
                        { id: 'description', label: 'Description' },
                        { id: 'settings', label: 'Settings' },
                        { id: 'sensitivity', label: 'Sensitivity' },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-slate-600 hover:text-slate-900'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === 'description' && (
                        <div className="space-y-4">
                            {/* Column Info */}
                            <div className="bg-slate-50 dark:bg-slate-900 rounded p-3 text-sm grid grid-cols-2 gap-2">
                                <div><span className="font-medium">Type:</span> {column.dataType}</div>
                                <div><span className="font-medium">Nullable:</span> {column.isNullable ? 'Yes' : 'No'}</div>
                                <div><span className="font-medium">Primary Key:</span> {column.isPrimaryKey ? 'Yes' : 'No'}</div>
                                <div><span className="font-medium">Foreign Key:</span> {column.isForeignKey ? 'Yes' : 'No'}</div>
                            </div>

                            {/* Original DB Comment */}
                            {column.originalComment && (
                                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3">
                                    <label className="text-xs font-medium text-blue-700 dark:text-blue-400 block mb-1">
                                        📄 Database Comment (from external DB)
                                    </label>
                                    <p className="text-sm text-blue-900 dark:text-blue-300">{column.originalComment}</p>
                                </div>
                            )}

                            {/* Admin Description */}
                            <div>
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-2">
                                    Admin Description
                                </label>
                                <textarea
                                    value={formData.adminDescription}
                                    onChange={(e) => setFormData({ ...formData, adminDescription: e.target.value })}
                                    className="input text-sm w-full"
                                    rows={4}
                                    placeholder="Add context for AI query generation (e.g., 'Revenue in USD cents, divide by 100 for dollars')"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    💡 Combined with DB comment and passed to AI for better query generation
                                </p>
                            </div>

                            {/* Semantic Hints */}
                            <div>
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-2">
                                    Semantic Hints
                                </label>
                                <input
                                    type="text"
                                    value={formData.semanticHints}
                                    onChange={(e) => setFormData({ ...formData, semanticHints: e.target.value })}
                                    className="input text-sm w-full"
                                    placeholder="e.g., 'user_identifier', 'monetary_value', 'timestamp'"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Semantic tags to help AI understand column purpose
                                </p>
                            </div>

                            {/* Custom Prompt */}
                            <div>
                                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-2">
                                    Custom Query Prompt
                                </label>
                                <textarea
                                    value={formData.customPrompt}
                                    onChange={(e) => setFormData({ ...formData, customPrompt: e.target.value })}
                                    className="input text-sm w-full"
                                    rows={3}
                                    placeholder="Special instructions for queries involving this column..."
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Custom instructions for AI when this column is used in queries
                                </p>
                            </div>
                        </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="space-y-4">
                            <h3 className="font-medium text-slate-700 dark:text-slate-300">Visibility & Query Settings</h3>

                            <div className="space-y-3">
                                <label className="flex items-center gap-3 p-3 border rounded hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.isVisible}
                                        onChange={(e) => setFormData({ ...formData, isVisible: e.target.checked })}
                                        className="rounded"
                                    />
                                    <div>
                                        <div className="font-medium text-sm">Visible in Schema</div>
                                        <div className="text-xs text-slate-500">
                                            Show this column in schema explorer and to AI
                                        </div>
                                    </div>
                                </label>

                                <label className="flex items-center gap-3 p-3 border rounded hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.isQueryable}
                                        onChange={(e) => setFormData({ ...formData, isQueryable: e.target.checked })}
                                        className="rounded"
                                    />
                                    <div>
                                        <div className="font-medium text-sm">Queryable</div>
                                        <div className="text-xs text-slate-500">
                                            Allow AI to use this column in generated queries
                                        </div>
                                    </div>
                                </label>
                            </div>
                        </div>
                    )}

                    {activeTab === 'sensitivity' && (
                        <div className="space-y-4">
                            <h3 className="font-medium text-slate-700 dark:text-slate-300">Data Sensitivity Settings</h3>

                            <label className="flex items-center gap-3 p-3 border rounded hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.isSensitive}
                                    onChange={(e) => setFormData({ ...formData, isSensitive: e.target.checked })}
                                    className="rounded"
                                />
                                <div>
                                    <div className="font-medium text-sm">Mark as Sensitive</div>
                                    <div className="text-xs text-slate-500">
                                        Flag this column as containing sensitive data
                                    </div>
                                </div>
                            </label>

                            {formData.isSensitive && (
                                <>
                                    <div>
                                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-2">
                                            Sensitivity Level Override
                                        </label>
                                        <select
                                            value={formData.sensitivityOverride || ''}
                                            onChange={(e) => setFormData({ ...formData, sensitivityOverride: e.target.value || null })}
                                            className="input text-sm w-full"
                                        >
                                            <option value="">Use Global Rules</option>
                                            <option value="low">Low</option>
                                            <option value="medium">Medium</option>
                                            <option value="high">High</option>
                                            <option value="critical">Critical</option>
                                        </select>
                                        <p className="text-xs text-slate-500 mt-1">
                                            Override global sensitivity rules for this specific column
                                        </p>
                                    </div>

                                    <div>
                                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300 block mb-2">
                                            Masking Strategy Override
                                        </label>
                                        <select
                                            value={formData.maskingStrategyOverride || ''}
                                            onChange={(e) => setFormData({ ...formData, maskingStrategyOverride: e.target.value || null })}
                                            className="input text-sm w-full"
                                        >
                                            <option value="">Use Global Rules</option>
                                            <option value="full">Full (***REDACTED***)</option>
                                            <option value="partial">Partial (ab***@example.com)</option>
                                            <option value="hash">Hash (HASH:a1b2c3...)</option>
                                            <option value="redact">Redact ([REDACTED])</option>
                                            <option value="tokenize">Tokenize (TOK_abc123)</option>
                                        </select>
                                        <p className="text-xs text-slate-500 mt-1">
                                            Override global masking strategy for this specific column
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 p-6 border-t">
                    <button onClick={onClose} className="btn btn-secondary">
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="btn btn-primary"
                        disabled={isSaving}
                    >
                        {isSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>
        </div>
    )
}
