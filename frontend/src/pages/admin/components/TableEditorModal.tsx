import { useState } from 'react'
import { X } from 'lucide-react'

interface TableEditorModalProps {
    table: any
    onClose: () => void
    onSave: (data: any) => void
    isSaving: boolean
}

export default function TableEditorModal({ table, onClose, onSave, isSaving }: TableEditorModalProps) {
    const [activeTab, setActiveTab] = useState<'description' | 'settings'>('description')
    const [formData, setFormData] = useState({
        adminDescription: table.adminDescription || '',
        semanticHints: table.semanticHints || '',
        customPrompt: table.customPrompt || '',
        isVisible: table.isVisible ?? true,
        isQueryable: table.isQueryable ?? true,
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
                        <h2 className="text-xl font-bold">Edit Table: {table.tableName}</h2>
                        <p className="text-sm text-slate-500 mt-1">
                            {table.schemaName} • {table.columns?.length || 0} columns
                            {table.rowCountEstimate && table.rowCountEstimate > 0 && ` • ~${table.rowCountEstimate.toLocaleString()} rows`}
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
                            {/* Table Info */}
                            <div className="bg-slate-50 dark:bg-slate-900 rounded p-3 text-sm grid grid-cols-2 gap-2">
                                <div><span className="font-medium">Schema:</span> {table.schemaName}</div>
                                <div><span className="font-medium">Columns:</span> {table.columns?.length || 0}</div>
                                {table.rowCountEstimate && table.rowCountEstimate > 0 && (
                                    <div><span className="font-medium">Rows (est):</span> {table.rowCountEstimate.toLocaleString()}</div>
                                )}
                                {table.lastAnalyzedAt && (
                                    <div><span className="font-medium">Last Analyzed:</span> {new Date(table.lastAnalyzedAt).toLocaleDateString()}</div>
                                )}
                            </div>

                            {/* Original DB Comment */}
                            {table.originalComment && (
                                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded p-3">
                                    <label className="text-xs font-medium text-blue-700 dark:text-blue-400 block mb-1">
                                        📄 Database Comment (from external DB)
                                    </label>
                                    <p className="text-sm text-blue-900 dark:text-blue-300">{table.originalComment}</p>
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
                                    placeholder="Add context for AI query generation (e.g., 'Contains user account information, use for authentication queries')"
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
                                    placeholder="e.g., 'user_data', 'transactional', 'audit_log'"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Semantic tags to help AI understand table purpose
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
                                    placeholder="Special instructions for queries involving this table..."
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Custom instructions for AI when this table is used in queries
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
                                            Show this table in schema explorer and to AI
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
                                            Allow AI to use this table in generated queries
                                        </div>
                                    </div>
                                </label>
                            </div>
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
