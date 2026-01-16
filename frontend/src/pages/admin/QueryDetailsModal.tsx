
import { Fragment, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { X, Clock, XCircle, Code, MessageSquare, Activity, ChevronDown, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { clsx } from 'clsx'
import { auditApi } from '@/services/api'
import NodeStateViewer from '@/components/admin/NodeStateViewer'

interface QueryDetailsModalProps {
    queryId: string | null
    isOpen: boolean
    onClose: () => void
}

export default function QueryDetailsModal({ queryId, isOpen, onClose }: QueryDetailsModalProps) {
    const [activeTab, setActiveTab] = useState<'pipeline' | 'llm' | 'sql'>('pipeline')

    const { data: detailsData, isLoading } = useQuery({
        queryKey: ['query-details', queryId],
        queryFn: () => auditApi.getQueryDetails(queryId!),
        enabled: !!queryId && isOpen,
    })

    const details = detailsData?.data

    if (!isOpen) return null

    return (
        <Transition.Root show={isOpen} as={Fragment}>
            <Dialog as="div" className="relative z-50" onClose={onClose}>
                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity" />
                </Transition.Child>

                <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
                    <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
                        <Transition.Child
                            as={Fragment}
                            enter="ease-out duration-300"
                            enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                            enterTo="opacity-100 translate-y-0 sm:scale-100"
                            leave="ease-in duration-200"
                            leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                            leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                        >
                            <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white dark:bg-slate-900 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-4xl max-h-[90vh] flex flex-col">
                                {isLoading ? (
                                    <div className="p-12 text-center">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
                                        <p className="mt-4 text-slate-500">Loading details...</p>
                                    </div>
                                ) : details ? (
                                    <>
                                        <div className="px-6 py-4 border-b dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
                                            <div>
                                                <Dialog.Title as="h3" className="text-lg font-semibold leading-6 text-slate-900 dark:text-white">
                                                    Query Analysis
                                                </Dialog.Title>
                                                <div className="flex items-center mt-1 space-x-2 text-sm text-slate-500">
                                                    <Clock className="w-4 h-4" />
                                                    <span>{format(new Date(details.createdAt), 'MMM d, yyyy HH:mm:ss')}</span>
                                                    <span className="mx-1">•</span>
                                                    <span>{details.executionTimeMs}ms</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center space-x-4">
                                                <div className="text-right">
                                                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                                                        {details.user ? `${details.user.firstName || ''} ${details.user.lastName || ''}`.trim() || details.user.email : (details.apiKeyName ? `API: ${details.apiKeyName}` : 'System')}
                                                    </div>
                                                    <div className="text-xs text-slate-500">
                                                        {details.user?.email || (details.apiKeyId ? `Key ID: ${details.apiKeyId.substring(0, 8)}...` : 'Automated')}
                                                    </div>
                                                </div>
                                                <span className={clsx(
                                                    'px-2.5 py-0.5 rounded-full text-xs font-medium',
                                                    details.isSuccess
                                                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                                )}>
                                                    {details.isSuccess ? 'Success' : 'Failed'}
                                                </span>
                                                <button onClick={onClose} className="text-slate-400 hover:text-slate-500">
                                                    <X className="w-5 h-5" />
                                                </button>
                                            </div>
                                        </div>

                                        <div className="p-6 bg-slate-50 dark:bg-slate-950/30 border-b dark:border-slate-800">
                                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">User Query</h4>
                                            <div className="bg-white dark:bg-slate-800 p-3 rounded-md border dark:border-slate-700 text-slate-900 dark:text-slate-100">
                                                {details.userMessage}
                                            </div>
                                        </div>

                                        <div className="flex border-b dark:border-slate-800 px-6">
                                            <button
                                                onClick={() => setActiveTab('pipeline')}
                                                className={clsx(
                                                    "py-3 px-4 text-sm font-medium border-b-2 transition-colors",
                                                    activeTab === 'pipeline' ? "border-primary-600 text-primary-600" : "border-transparent text-slate-500 hover:text-slate-700"
                                                )}
                                            >
                                                <Activity className="w-4 h-4 inline-block mr-2" />
                                                Pipeline Flow
                                            </button>
                                            <button
                                                onClick={() => setActiveTab('llm')}
                                                className={clsx(
                                                    "py-3 px-4 text-sm font-medium border-b-2 transition-colors",
                                                    activeTab === 'llm' ? "border-primary-600 text-primary-600" : "border-transparent text-slate-500 hover:text-slate-700"
                                                )}
                                            >
                                                <MessageSquare className="w-4 h-4 inline-block mr-2" />
                                                LLM Calls ({details.llmCalls?.length || 0})
                                            </button>
                                            <button
                                                onClick={() => setActiveTab('sql')}
                                                className={clsx(
                                                    "py-3 px-4 text-sm font-medium border-b-2 transition-colors",
                                                    activeTab === 'sql' ? "border-primary-600 text-primary-600" : "border-transparent text-slate-500 hover:text-slate-700"
                                                )}
                                            >
                                                <Code className="w-4 h-4 inline-block mr-2" />
                                                Generated SQL
                                            </button>
                                        </div>

                                        <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-slate-900">
                                            {activeTab === 'pipeline' && (
                                                <div className="space-y-4">
                                                    {(details.pipelineExecutions || []).map((step: any, index: number) => (
                                                        <div key={step.id} className="relative flex items-start">
                                                            <div className={clsx(
                                                                "absolute left-0 top-0 mt-1.5 h-full w-0.5 bg-slate-200 dark:bg-slate-800",
                                                                index === (details.pipelineExecutions.length - 1) && "h-2"
                                                            )} style={{ left: '0.6rem' }} />
                                                            <div className="relative flex items-center justify-center flex-shrink-0 w-5 h-5 bg-white dark:bg-slate-900 border-2 border-primary-600 rounded-full z-10">
                                                                <div className="w-2 h-2 bg-primary-600 rounded-full" />
                                                            </div>
                                                            <div className="ml-4 min-w-0 flex-1">
                                                                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border dark:border-slate-700 shadow-sm">
                                                                    <div className="flex items-center justify-between mb-2">
                                                                        <h5 className="text-sm font-medium text-slate-900 dark:text-white capitalize">
                                                                            {step.nodeName.replace(/_/g, ' ')}
                                                                        </h5>
                                                                        <span className="text-xs text-slate-500 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                                                                            {step.durationMs}ms
                                                                        </span>
                                                                    </div>
                                                                    {step.error && (
                                                                        <div className="mt-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                                                                            {step.error}
                                                                        </div>
                                                                    )}
                                                                    {step.nodeState && (
                                                                        <details className="mt-2 text-xs">
                                                                            <summary className="text-primary-600 cursor-pointer hover:underline mb-2 font-medium">View Node State Updates</summary>
                                                                            <NodeStateViewer state={step.nodeState} />
                                                                        </details>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {(!details.pipelineExecutions || details.pipelineExecutions.length === 0) && (
                                                        <p className="text-center text-slate-500 py-8">No pipeline execution steps recorded.</p>
                                                    )}
                                                </div>
                                            )}

                                            {activeTab === 'llm' && (
                                                <div className="space-y-4">
                                                    {(details.llmCalls || []).map((call: any) => (
                                                        <LlmCallItem key={call.id} call={call} />
                                                    ))}
                                                    {(!details.llmCalls || details.llmCalls.length === 0) && (
                                                        <p className="text-center text-slate-500 py-8">No LLM calls recorded.</p>
                                                    )}
                                                </div>
                                            )}

                                            {activeTab === 'sql' && (
                                                <div className="relative">
                                                    {details.generatedSql ? (
                                                        <pre className="p-4 bg-slate-950 text-slate-200 rounded-lg overflow-x-auto text-sm font-mono">
                                                            {details.generatedSql}
                                                        </pre>
                                                    ) : (
                                                        <div className="text-center text-slate-500 py-12 bg-slate-50 dark:bg-slate-900 rounded-lg border border-dashed">
                                                            No SQL was generated for this query.
                                                        </div>
                                                    )}
                                                    {details.sqlDialect && (
                                                        <div className="mt-4 inline-block bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded text-xs font-medium text-slate-600 dark:text-slate-400 uppercase">
                                                            Dialect: {details.sqlDialect}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <div className="p-12 text-center text-slate-500">
                                        Failed to load details.
                                    </div>
                                )}
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </div>
            </Dialog>
        </Transition.Root>
    )
}

function LlmCallItem({ call }: { call: any }) {
    const [isOpen, setIsOpen] = useState(false)

    return (
        <div className="border dark:border-slate-700 rounded-lg overflow-hidden bg-white dark:bg-slate-800 shadow-sm">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
            >
                <div className="flex items-center space-x-3">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                    <div>
                        <div className="flex items-center space-x-2">
                            <span className="font-semibold text-sm text-slate-900 dark:text-white capitalize">{call.nodeName.replace(/_/g, ' ')}</span>
                            <span className="text-xs bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 px-2 py-0.5 rounded-full border border-primary-100 dark:border-primary-800">
                                {call.llmModel}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center space-x-4 text-sm text-slate-500">
                    <span className="flex items-center">
                        <Clock className="w-3 h-3 mr-1" />
                        {call.durationMs}ms
                    </span>
                    {call.error && (
                        <span className="text-red-500 flex items-center">
                            <XCircle className="w-4 h-4 mr-1" />
                            Error
                        </span>
                    )}
                </div>
            </button>

            {isOpen && (
                <div className="p-4 border-t dark:border-slate-700 space-y-4">
                    {call.systemPrompt && (
                        <div>
                            <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">System Prompt</h5>
                            <div className="bg-slate-900 text-slate-300 p-3 rounded text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
                                {call.systemPrompt}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">User Prompt</h5>
                            <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded border dark:border-slate-700 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">
                                {call.prompt}
                            </div>
                        </div>
                        <div>
                            <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Response</h5>
                            <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded border dark:border-slate-700 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">
                                {call.response || <span className="text-slate-400 italic">No response</span>}
                            </div>
                        </div>
                    </div>

                    {call.error && (
                        <div>
                            <h5 className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-1">Error</h5>
                            <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 p-3 rounded text-sm font-mono">
                                {call.error}
                            </div>
                        </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t dark:border-slate-700 mt-2">
                        {call.tokenUsage ? (
                            <div className="flex space-x-4 text-xs text-slate-500">
                                <span title="Input Tokens">
                                    <span className="font-semibold text-slate-400">Input:</span> {call.tokenUsage.prompt_tokens || 0}
                                </span>
                                <span title="Output Tokens">
                                    <span className="font-semibold text-slate-400">Output:</span> {call.tokenUsage.completion_tokens || 0}
                                </span>
                                <span title="Total Tokens">
                                    <span className="font-semibold text-slate-700 dark:text-slate-300">Total:</span> {call.tokenUsage.total_tokens || 0}
                                </span>
                            </div>
                        ) : (
                            <div className="text-xs text-slate-500">
                                Tokens: N/A
                            </div>
                        )}
                        <div className="text-xs text-slate-400">
                            ID: {call.id}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
