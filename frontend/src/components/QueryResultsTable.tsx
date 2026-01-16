import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { messagesApi } from '@/services/messages'
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react'

interface QueryResultsTableProps {
    messageId: string
    initialData: any[]
    totalRows: number
}

export function QueryResultsTable({
    messageId,
    initialData,
    totalRows
}: QueryResultsTableProps) {
    const [page, setPage] = useState(1)
    const [data, setData] = useState(initialData)
    const pageSize = 10

    const { data: paginatedData, isLoading } = useQuery({
        queryKey: ['message-results', messageId, page],
        queryFn: async () => {
            if (page === 1) return { data: initialData }
            const res = await messagesApi.getResults(messageId, page, pageSize)
            return res.data
        },
        enabled: page > 1
    })

    useEffect(() => {
        if (page === 1) {
            setData(initialData)
        } else if (paginatedData?.data) {
            setData(paginatedData.data)
        }
    }, [paginatedData, page, initialData])

    const totalPages = Math.ceil(totalRows / pageSize)

    if (!data || data.length === 0) {
        return null
    }

    const columns = Object.keys(data[0])

    return (
        <div className="mt-4">
            {/* Table */}
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800">
                        <tr>
                            {columns.map((key) => (
                                <th
                                    key={key}
                                    className="px-3 py-2 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider"
                                >
                                    {key}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
                        {data.map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800">
                                {columns.map((col) => (
                                    <td
                                        key={col}
                                        className="px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-300"
                                    >
                                        {typeof row[col] === 'object' && row[col] !== null
                                            ? JSON.stringify(row[col])
                                            : String(row[col] ?? '')}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 text-sm">
                    <span className="text-slate-500 dark:text-slate-400">
                        Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, totalRows)} of {totalRows}
                    </span>
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1 || isLoading}
                            className="btn btn-sm flex items-center space-x-1 disabled:opacity-50"
                        >
                            <ChevronLeft className="w-4 h-4" />
                            <span>Previous</span>
                        </button>
                        <span className="px-3 py-1 text-slate-600 dark:text-slate-300">
                            Page {page} of {totalPages}
                        </span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages || isLoading}
                            className="btn btn-sm flex items-center space-x-1 disabled:opacity-50"
                        >
                            <span>Next</span>
                            <ChevronRight className="w-4 h-4" />
                        </button>
                        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-primary-500" />}
                    </div>
                </div>
            )}
        </div>
    )
}
