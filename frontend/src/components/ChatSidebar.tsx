import { useState, useRef, useEffect } from 'react'
import { Plus, MessageSquare, Trash2, Edit2, Check, X, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { Conversation } from '@/services/conversations'
import { format } from 'date-fns'

interface ChatSidebarProps {
    conversations: Conversation[]
    selectedId: string | null
    onSelect: (id: string) => void
    onNewChat: () => void
    onDelete: (id: string, e: React.MouseEvent) => void
    onRename: (id: string, newTitle: string) => void
    processingConversations?: Record<string, boolean>
    customization?: {
        primaryColor?: string
        backgroundColor?: string
    }
}

export function ChatSidebar({
    conversations,
    selectedId,
    onSelect,
    onNewChat,
    onDelete,
    onRename,
    processingConversations = {},
    customization
}: ChatSidebarProps) {
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editTitle, setEditTitle] = useState('')
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    // Scroll to top when the latest conversation changes
    useEffect(() => {
        if (conversations.length > 0 && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0
        }
    }, [conversations])

    const startEditing = (conv: Conversation, e: React.MouseEvent) => {
        e.stopPropagation()
        setEditingId(conv.id)
        setEditTitle(conv.title || 'Untitled Conversation')
    }

    const cancelEditing = (e: React.MouseEvent) => {
        e.stopPropagation()
        setEditingId(null)
        setEditTitle('')
    }

    const saveEditing = (id: string, e: React.MouseEvent) => {
        e.stopPropagation()
        if (editTitle.trim()) {
            onRename(id, editTitle.trim())
        }
        setEditingId(null)
    }

    const handleKeyDown = (id: string, e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            if (editTitle.trim()) {
                onRename(id, editTitle.trim())
            }
            setEditingId(null)
        } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setEditingId(null)
        }
    }

    return (
        <div
            className="w-64 flex-shrink-0 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex flex-col h-full"
            style={customization?.backgroundColor ? { backgroundColor: customization.backgroundColor } : {}}
        >
            <div className="p-4">
                <button
                    onClick={onNewChat}
                    className={clsx(
                        "btn w-full justify-start space-x-2 text-white",
                        !customization?.primaryColor && "btn-primary"
                    )}
                    style={customization?.primaryColor ? { backgroundColor: customization.primaryColor } : {}}
                >
                    <Plus className="w-4 h-4" />
                    <span>New Chat</span>
                </button>
            </div>

            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-2 space-y-1">
                {conversations.map((conv) => (
                    <div key={conv.id} className="relative group">
                        {editingId === conv.id ? (
                            <div className="px-3 py-2 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-primary-200 ring-1 ring-primary-200 flex items-center w-full max-w-full overflow-hidden space-x-2">
                                <input
                                    type="text"
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                    // Stop propagation to prevent selecting the chat while typing
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => handleKeyDown(conv.id, e)}
                                    className="flex-1 min-w-0 bg-transparent border-none focus:ring-0 p-0 text-sm font-medium"
                                    autoFocus
                                />
                                <button onClick={(e) => saveEditing(conv.id, e)} className="p-1.5 rounded-md bg-green-500/10 text-green-600 hover:bg-green-500/20 hover:text-green-700 transition-colors flex-shrink-0">
                                    <Check className="w-4 h-4 stroke-[2.5]" />
                                </button>
                                <button onClick={cancelEditing} className="p-1.5 rounded-md bg-slate-400/10 text-slate-500 hover:bg-slate-400/20 hover:text-slate-600 transition-colors flex-shrink-0">
                                    <X className="w-4 h-4 stroke-[2.5]" />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => onSelect(conv.id)}
                                className={clsx(
                                    'w-full text-left px-3 py-3 rounded-lg transition-colors relative flex items-start space-x-3 pr-16', // Added padding right for actions
                                    selectedId === conv.id
                                        ? 'bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 ring-1 ring-slate-200 dark:ring-slate-700'
                                        : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                                )}
                            >
                                <MessageSquare
                                    className={clsx(
                                        "w-4 h-4 mt-1 flex-shrink-0",
                                        selectedId === conv.id ? "text-primary-500" : "text-slate-400"
                                    )}
                                    style={(selectedId === conv.id && customization?.primaryColor) ? { color: customization.primaryColor } : {}}
                                />
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                        <p className={clsx(
                                            "text-sm font-medium truncate",
                                            selectedId === conv.id ? "text-slate-900 dark:text-slate-100" : "text-slate-700 dark:text-slate-300"
                                        )}>
                                            {conv.title || 'Untitled Conversation'}
                                        </p>
                                        {processingConversations[conv.id] && (
                                            <Loader2
                                                className="w-3 h-3 animate-spin text-primary-500 ml-2"
                                                style={customization?.primaryColor ? { color: customization.primaryColor } : {}}
                                            />
                                        )}
                                    </div>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        {format(new Date(conv.updatedAt || conv.updated_at || conv.created_at || conv.start_time || Date.now()), 'MMM d, h:mm a')}
                                    </p>
                                </div>

                                {/* Actions Group */}
                                <div
                                    className={clsx(
                                        "absolute right-2 top-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm rounded p-0.5",
                                        selectedId === conv.id ? "opacity-100" : ""
                                    )}
                                >
                                    <div
                                        className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-primary-500 cursor-pointer"
                                        onClick={(e) => startEditing(conv, e)}
                                        title="Rename"
                                    >
                                        <Edit2 className="w-3.5 h-3.5" />
                                    </div>
                                    <div
                                        className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-slate-400 hover:text-red-500 cursor-pointer"
                                        onClick={(e) => onDelete(conv.id, e)}
                                        title="Delete"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </div>
                                </div>
                            </button>
                        )}
                    </div>
                ))}

                {conversations.length === 0 && (
                    <div className="text-center py-8 text-slate-400 text-sm">
                        <p>No conversations yet</p>
                    </div>
                )}
            </div>
        </div>
    )
}
