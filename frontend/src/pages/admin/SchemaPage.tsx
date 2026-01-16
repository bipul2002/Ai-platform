import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Table, Key, Link as LinkIcon, ChevronDown, ChevronRight, Edit } from 'lucide-react'
import { clsx } from 'clsx'
import toast from 'react-hot-toast'
import { schemaApi } from '@/services/api'
import ColumnEditorModal from './components/ColumnEditorModal'
import TableEditorModal from './components/TableEditorModal'

export default function SchemaPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set())
  const [editingTable, setEditingTable] = useState<any | null>(null)
  const [editingColumn, setEditingColumn] = useState<any | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['schema', id],
    queryFn: () => schemaApi.get(id!),
    enabled: !!id,
  })

  const updateTableMutation = useMutation({
    mutationFn: ({ tableId, data }: { tableId: string; data: any }) =>
      schemaApi.updateTable(id!, tableId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema', id] })
      toast.success('Table updated successfully')
      setEditingTable(null)
    },
    onError: () => {
      toast.error('Failed to update table')
    },
  })

  const updateColumnMutation = useMutation({
    mutationFn: ({ columnId, data }: { columnId: string; data: any }) =>
      schemaApi.updateColumn(id!, columnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema', id] })
      toast.success('Column updated successfully')
      setEditingColumn(null)
    },
    onError: () => {
      toast.error('Failed to update column')
    },
  })

  const schema = data?.data

  const toggleTable = (tableId: string) => {
    const newExpanded = new Set(expandedTables)
    if (newExpanded.has(tableId)) {
      newExpanded.delete(tableId)
    } else {
      newExpanded.add(tableId)
    }
    setExpandedTables(newExpanded)
  }

  const handleSaveTable = (data: any) => {
    if (editingTable) {
      updateTableMutation.mutate({ tableId: editingTable.id, data })
    }
  }

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-slate-100 dark:bg-slate-800 rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center space-x-4 mb-6">
        <button onClick={() => navigate(-1)} className="btn btn-ghost p-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold">Schema Explorer</h1>
          <p className="text-slate-500 mt-1">
            {schema?.stats?.tableCount || 0} tables, {schema?.stats?.columnCount || 0} columns
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {schema?.tables?.map((table: any) => (
          <div key={table.id} className="card">
            <button
              onClick={() => toggleTable(table.id)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center space-x-3">
                <Table className="w-5 h-5 text-primary-600" />
                <div className="text-left">
                  <h3 className="font-semibold">{table.tableName}</h3>
                  <p className="text-sm text-slate-500">
                    {table.schemaName} • {table.columns?.length || 0} columns
                    {table.rowCountEstimate && table.rowCountEstimate > 0 && ` • ~${table.rowCountEstimate.toLocaleString()} rows`}
                  </p>
                </div>
              </div>
              {expandedTables.has(table.id) ? (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {expandedTables.has(table.id) && (
              <div className="mt-4 pt-4 border-t">
                {/* Table Metadata Section */}
                <div className="mb-4 space-y-2">
                  {/* Original DB Comment (read-only) */}
                  {table.originalComment && (
                    <div className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 rounded p-2">
                      <span className="font-medium">DB Comment:</span> {table.originalComment}
                    </div>
                  )}

                  {/* Table Metadata Summary */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Table Metadata</label>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingTable(table)
                        }}
                        className="text-blue-600 hover:text-blue-700 dark:text-blue-400"
                      >
                        <Edit className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
                      {table.adminDescription && (
                        <p><span className="font-medium">Description:</span> {table.adminDescription}</p>
                      )}
                      {table.semanticHints && (
                        <p><span className="font-medium">Semantic Hints:</span> {table.semanticHints}</p>
                      )}
                      {table.customPrompt && (
                        <p><span className="font-medium">Custom Prompt:</span> {table.customPrompt}</p>
                      )}
                      {!table.adminDescription && !table.semanticHints && !table.customPrompt && (
                        <span className="text-slate-400 italic">Click edit to add metadata</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 font-medium">Column</th>
                        <th className="text-left py-2 px-3 font-medium">Type</th>
                        <th className="text-left py-2 px-3 font-medium">Attributes</th>
                        <th className="text-left py-2 px-3 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.columns?.map((column: any) => (
                        <tr key={column.id} className="border-b last:border-b-0">
                          <td className="py-2 px-3">
                            <div className="flex items-center space-x-2">
                              <span className={clsx(
                                'font-medium',
                                column.isSensitive && 'text-orange-600'
                              )}>
                                {column.columnName}
                              </span>
                              {column.isPrimaryKey && (
                                <span title="Primary Key">
                                  <Key className="w-3 h-3 text-yellow-500" />
                                </span>
                              )}
                              {column.isForeignKey && (
                                <span title="Foreign Key">
                                  <LinkIcon className="w-3 h-3 text-blue-500" />
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 font-mono text-xs text-slate-500">
                            {column.dataType}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex space-x-1">
                              {!column.isNullable && (
                                <span className="px-1.5 py-0.5 text-xs rounded bg-slate-100 dark:bg-slate-700">
                                  NOT NULL
                                </span>
                              )}
                              {column.isUnique && (
                                <span className="px-1.5 py-0.5 text-xs rounded bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300">
                                  UNIQUE
                                </span>
                              )}
                              {column.isSensitive && (
                                <span className="px-1.5 py-0.5 text-xs rounded bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300">
                                  SENSITIVE
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingColumn(column)
                              }}
                              className="text-left hover:bg-slate-100 dark:hover:bg-slate-700 rounded px-2 py-1 w-full"
                            >
                              {column.originalComment && (
                                <div className="text-sm text-slate-700 dark:text-slate-300 mb-1">
                                  {column.originalComment}
                                </div>
                              )}
                              {column.adminDescription && (
                                <div className="text-xs text-blue-600 dark:text-blue-400">
                                  Admin: {column.adminDescription}
                                </div>
                              )}
                              {!column.originalComment && !column.adminDescription && (
                                <span className="text-sm text-slate-400 italic">Click to add admin description</span>
                              )}
                              {column.originalComment && !column.adminDescription && (
                                <div className="text-xs text-slate-400 italic mt-1">Click to add admin instructions</div>
                              )}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {schema?.relationships?.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold mb-4">Relationships</h2>
          <div className="card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium">Source</th>
                  <th className="text-left py-2 px-3 font-medium">Target</th>
                  <th className="text-left py-2 px-3 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {schema.relationships.map((rel: any) => (
                  <tr key={rel.id} className="border-b last:border-b-0">
                    <td className="py-2 px-3 font-mono text-xs">
                      {rel.sourceTable}.{rel.sourceColumn}
                    </td>
                    <td className="py-2 px-3 font-mono text-xs">
                      {rel.targetTable}.{rel.targetColumn}
                    </td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300">
                        {rel.relationshipType || 'FK'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Table Editor Modal */}
      {editingTable && (
        <TableEditorModal
          table={editingTable}
          onClose={() => setEditingTable(null)}
          onSave={handleSaveTable}
          isSaving={updateTableMutation.isPending}
        />
      )}

      {/* Column Editor Modal */}
      {editingColumn && (
        <ColumnEditorModal
          column={editingColumn}
          onClose={() => setEditingColumn(null)}
          onSave={(data) => updateColumnMutation.mutate({ columnId: editingColumn.id, data })}
          isSaving={updateColumnMutation.isPending}
        />
      )}
    </div>
  )
}
