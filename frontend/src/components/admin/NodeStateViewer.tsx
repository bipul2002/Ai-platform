

import {
    Code,
    Target,
    RefreshCcw,
    Database,
    Search,
    ChevronRight,
    Info,
    AlertCircle,
    ListFilter
} from 'lucide-react';
import { clsx } from 'clsx';

interface NodeStateViewerProps {
    state: Record<string, any>;
}

export default function NodeStateViewer({ state }: NodeStateViewerProps) {
    if (!state || Object.keys(state).length === 0) {
        return <span className="text-slate-400 italic">Empty state</span>;
    }

    // Predefined keys to show prominently
    const prioritizedKeys = [
        'intent',
        'is_refinement',
        'refinement_intent',
        'needs_schema_search',
        'query_complexity',
        'is_ambiguous',
        'error'
    ];

    const renderValue = (key: string, value: any) => {
        if (value === null || value === undefined) return <span className="text-slate-400">null</span>;

        if (typeof value === 'boolean') {
            const isNegative = (key === 'is_ambiguous' && value === true) || (key === 'needs_schema_search' && value === true);
            return (
                <span className={clsx(
                    "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                    value
                        ? (isNegative ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300")
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                )}>
                    {value ? 'True' : 'False'}
                </span>
            );
        }

        if (key === 'intent' || key === 'refinement_intent' || key === 'error') {
            const isError = key === 'error';
            return (
                <div className={clsx(
                    "p-2 rounded border text-xs whitespace-pre-wrap",
                    isError
                        ? "bg-red-50 border-red-100 text-red-700 dark:bg-red-900/20 dark:border-red-900/30 dark:text-red-300"
                        : "bg-slate-50 border-slate-100 dark:bg-slate-900/50 dark:border-slate-800"
                )}>
                    {typeof value === 'object' ? (
                        <pre className="font-mono">{JSON.stringify(value, null, 2)}</pre>
                    ) : (
                        <span className={clsx("font-medium", !isError && "text-primary-600 dark:text-primary-400")}>{String(value)}</span>
                    )}
                </div>
            );
        }

        if (key === 'canonical_query' || key === 'previous_query') {
            return (
                <details className="group">
                    <summary className="text-primary-600 cursor-pointer hover:underline flex items-center">
                        <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform mr-1" />
                        Show Representation
                    </summary>
                    <pre className="mt-2 text-[10px] bg-slate-900 text-slate-300 p-2 rounded overflow-x-auto">
                        {JSON.stringify(value, null, 2)}
                    </pre>
                </details>
            );
        }

        if (key === 'generated_sql' || key === 'previous_sql') {
            return (
                <div className="mt-1">
                    <pre className="p-3 bg-slate-950 text-slate-200 rounded text-xs font-mono overflow-x-auto">
                        {value}
                    </pre>
                </div>
            );
        }

        if (Array.isArray(value)) {
            if (value.length === 0) return <span className="text-slate-400">[]</span>;

            // Special handling for relevant_schema
            if (key === 'relevant_schema') {
                return (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {value.map((table: any, i: number) => {
                            const displayName = typeof table === 'string'
                                ? table
                                : (table?.name || table?.tableName || (typeof table === 'object' ? JSON.stringify(table).substring(0, 20) + '...' : String(table)));

                            return (
                                <span key={i} className="inline-flex items-center px-2 py-0.5 rounded bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300 border border-primary-100 dark:border-primary-800 text-[10px] font-medium">
                                    <ListFilter className="w-2.5 h-2.5 mr-1" />
                                    {displayName}
                                </span>
                            );
                        })}
                    </div>
                );
            }

            return (
                <details className="group">
                    <summary className="text-slate-500 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300">
                        Array({value.length})
                    </summary>
                    <div className="mt-1 ml-2 border-l-2 border-slate-100 dark:border-slate-800 pl-2">
                        {value.map((item, i) => (
                            <div key={i} className="text-[10px] text-slate-500 py-0.5">
                                • {typeof item === 'object' ? JSON.stringify(item) : String(item)}
                            </div>
                        ))}
                    </div>
                </details>
            );
        }

        if (typeof value === 'object') {
            return (
                <details className="group">
                    <summary className="text-slate-500 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300">
                        Object ({Object.keys(value).length} keys)
                    </summary>
                    <pre className="mt-1 text-[10px] bg-slate-50 dark:bg-slate-900/50 p-2 rounded overflow-x-auto">
                        {JSON.stringify(value, null, 2)}
                    </pre>
                </details>
            );
        }

        return <span className="text-slate-700 dark:text-slate-300">{String(value)}</span>;
    };

    const getIcon = (key: string) => {
        switch (key) {
            case 'is_refinement': return <RefreshCcw className="w-3.5 h-3.5" />;
            case 'intent': return <Target className="w-3.5 h-3.5" />;
            case 'needs_schema_search': return <Search className="w-3.5 h-3.5" />;
            case 'canonical_query': return <Code className="w-3.5 h-3.5" />;
            case 'relevant_schema': return <Database className="w-3.5 h-3.5" />;
            case 'error': return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
            default: return <Info className="w-3.5 h-3.5" />;
        }
    };

    return (
        <div className="grid grid-cols-1 gap-3 mt-2">
            {/* Prioritized Key-Value Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {prioritizedKeys.filter(k => k in state).map(key => (
                    <div key={key} className="bg-white dark:bg-slate-800/50 p-2 rounded border dark:border-slate-800 shadow-sm flex flex-col justify-between">
                        <div className="flex items-center text-[10px] font-semibold text-slate-500 uppercase tracking-tighter mb-1">
                            <span className="mr-1.5 text-slate-400">{getIcon(key)}</span>
                            {key.replace(/_/g, ' ')}
                        </div>
                        <div className="mt-auto">
                            {renderValue(key, state[key])}
                        </div>
                    </div>
                ))}
            </div>

            {/* Full State Details */}
            <div className="space-y-2">
                {Object.entries(state)
                    .filter(([k]) => !prioritizedKeys.includes(k))
                    .map(([key, value]) => (
                        <div key={key} className="flex flex-col border-b border-slate-100 dark:border-slate-800 pb-2 last:border-0">
                            <div className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase flex items-center mb-1">
                                {key.replace(/_/g, ' ')}
                            </div>
                            <div className="text-sm pl-0">
                                {renderValue(key, value)}
                            </div>
                        </div>
                    ))}
            </div>
        </div>
    );
}
