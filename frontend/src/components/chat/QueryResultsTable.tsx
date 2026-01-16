import { useState } from 'react';
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { aiRuntimeApi } from '@/services/api';
import { RefreshCw } from 'lucide-react';

interface QueryResultsTableProps {
    agentId: string;
    sql: string;
    messageId: string;
    autoLoad?: boolean; // If true, auto-load results. If false, show skeleton until user clicks refresh
}

export const QueryResultsTable = ({ agentId, sql, messageId, autoLoad = true }: QueryResultsTableProps) => {
    const [page, setPage] = useState(1);
    const pageSize = 10;
    const [manuallyLoaded, setManuallyLoaded] = useState(false);
    const queryClient = useQueryClient();

    // Check if data for page 1 exists in cache - this indicates results were previously loaded
    const page1Data = queryClient.getQueryData(['query-results', messageId, 1]);
    const hasBeenLoadedBefore = !!page1Data;

    // Enable fetching if: autoLoad is true, user clicked Load Results, or data was loaded before
    const shouldFetch = autoLoad || manuallyLoaded || hasBeenLoadedBefore;

    const { data, isLoading, error, isFetching } = useQuery({
        queryKey: ['query-results', messageId, page],
        queryFn: async () => {
            const res = await aiRuntimeApi.post('/api/query/execute', {
                agent_id: agentId,
                sql,
                page,
                page_size: pageSize
            });
            return res.data;
        },
        placeholderData: keepPreviousData,
        staleTime: 5 * 60 * 1000, // Cache for 5 minutes
        enabled: shouldFetch, // Only fetch if autoLoad is true or user clicked refresh
    });

    // Check if data exists in cache (already loaded previously)
    const cachedData = queryClient.getQueryData(['query-results', messageId, page]);
    const hasDataInCache = !!cachedData;

    // Show skeleton placeholder for messages that haven't loaded data yet OR while loading
    const showSkeleton = (!shouldFetch && !hasDataInCache) || (isLoading && !data);

    if (showSkeleton) {
        return (
            <div className="mt-4 relative">
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                {[...Array(5)].map((_, i) => (
                                    <th
                                        key={i}
                                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                    >
                                        <div className="h-4 bg-gray-300 rounded animate-pulse w-20"></div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {[...Array(5)].map((_, rowIndex) => (
                                <tr key={rowIndex} className="hover:bg-gray-50">
                                    {[...Array(5)].map((_, colIndex) => (
                                        <td key={colIndex} className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                                            <div className="h-4 bg-gray-200 rounded animate-pulse w-24"></div>
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Loading overlay or Refresh button */}
                <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                    {isLoading ? (
                        <div className="flex items-center gap-3 px-6 py-3 bg-white rounded-lg shadow-lg">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                            <span className="text-gray-700">Loading results...</span>
                        </div>
                    ) : (
                        <button
                            onClick={() => setManuallyLoaded(true)}
                            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-lg"
                        >
                            <RefreshCw className="w-5 h-5" />
                            <span>Load Results</span>
                        </button>
                    )}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600">Error loading results: {(error as Error).message}</p>
            </div>
        );
    }

    // Use cached data if query is not enabled but data exists in cache
    const displayData = data || cachedData;

    if (!displayData?.data || displayData.data.length === 0) {
        return (
            <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-gray-600">No results found.</p>
            </div>
        );
    }

    const columns = Object.keys(displayData.data[0]);

    return (
        <div className="mt-4 relative">
            {isFetching && (
                <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
            )}
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            {columns.map((col) => (
                                <th
                                    key={col}
                                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                    {col}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {displayData.data.map((row: any, i: number) => (
                            <tr key={i} className="hover:bg-gray-50">
                                {columns.map((col) => (
                                    <td key={col} className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                                        {row[col] !== null && row[col] !== undefined ? String(row[col]) : '-'}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between mt-4 px-4">
                <div className="text-sm text-gray-600">
                    Showing {((page - 1) * pageSize) + 1} - {Math.min(page * pageSize, displayData.pagination.totalCount)} of {displayData.pagination.totalCount} results
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Previous
                    </button>

                    <span className="px-4 py-2 text-sm text-gray-700">
                        Page {page} of {displayData.pagination.totalPages}
                    </span>

                    <button
                        onClick={() => setPage((p) => p + 1)}
                        disabled={page >= displayData.pagination.totalPages}
                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
};
