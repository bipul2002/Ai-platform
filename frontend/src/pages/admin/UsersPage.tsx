import { useState, useEffect } from 'react'

import { Plus, User, Mail, Pencil, Trash2, X, Shield } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { usersApi } from '@/services/api'
import { AgentAccessModal } from '@/components/admin/AgentAccessModal'

export default function UsersPage() {
    const [users, setUsers] = useState([])
    const [isModalOpen, setIsModalOpen] = useState(false)
    const { register, handleSubmit, reset } = useForm()
    const [agentAccessModal, setAgentAccessModal] = useState<{
        isOpen: boolean;
        userId: string | null;
        userName: string;
    }>({
        isOpen: false,
        userId: null,
        userName: '',
    })

    useEffect(() => {
        fetchUsers()
    }, [])

    const fetchUsers = async () => {
        try {
            const res = await usersApi.list()
            setUsers(res.data)
        } catch (error) {
            // toast.error('Failed to load users') // Silent fail if just empty or not auth
        }
    }

    const [editingUser, setEditingUser] = useState<any>(null)

    const onSubmit = async (data: any) => {
        try {
            if (editingUser) {
                await usersApi.update(editingUser.id, data)
                toast.success('User updated successfully')
            } else {
                await usersApi.invite(data)
                toast.success('Invitation sent')
            }
            setIsModalOpen(false)
            setEditingUser(null)
            reset()
            fetchUsers()
        } catch (error: any) {
            toast.error(error.response?.data?.message || `Failed to ${editingUser ? 'update' : 'invite'} user`)
        }
    }

    const handleEdit = (user: any) => {
        setEditingUser(user)
        reset({
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role
        })
        setIsModalOpen(true)
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this user?')) return
        try {
            await usersApi.delete(id)
            toast.success('User deleted')
            fetchUsers()
        } catch (error) {
            toast.error('Failed to delete user')
        }
    }

    const handleManageAgentAccess = (user: any) => {
        setAgentAccessModal({
            isOpen: true,
            userId: user.id,
            userName: `${user.firstName} ${user.lastName}`,
        })
    }

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Team Members</h1>
                    <p className="text-slate-500">Manage your organization's users</p>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="btn btn-primary flex items-center gap-2"
                >
                    <Plus className="w-4 h-4" />
                    Invite User
                </button>
            </div>

            <div className="card overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 font-medium">
                        <tr>
                            <th className="px-4 py-3">User</th>
                            <th className="px-4 py-3">Role</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Last Login</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {users.map((u: any) => (
                            <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
                                            <User className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <div className="font-medium text-slate-900 dark:text-white">
                                                {u.firstName} {u.lastName}
                                            </div>
                                            <div className="text-xs text-slate-500 flex items-center gap-1">
                                                <Mail className="w-3 h-3" />
                                                {u.email}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium capitalize
                        ${u.role === 'super_admin' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                                            u.role === 'admin' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                                'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                                        }
                    `}>
                                        {u.role.replace('_', ' ')}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`inline-flex w-2 h-2 rounded-full ${u.isActive ? 'bg-green-500' : 'bg-slate-300'}`} />
                                </td>
                                <td className="px-4 py-3 text-slate-500">
                                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <div className="flex justify-end gap-2">
                                        {u.role === 'viewer' && (
                                            <button
                                                onClick={() => handleManageAgentAccess(u)}
                                                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400 hover:text-purple-600 transition-colors"
                                                title="Manage Agent Access"
                                            >
                                                <Shield className="w-4 h-4" />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleEdit(u)}
                                            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400 hover:text-blue-600 transition-colors"
                                        >
                                            <Pencil className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(u.id)}
                                            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-400 hover:text-red-600 transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-lg w-full max-w-md shadow-xl border border-slate-200 dark:border-slate-800">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                                {editingUser ? 'Edit User' : 'Invite User'}
                            </h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-500">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-slate-300">Email</label>
                                <input
                                    type="email"
                                    {...register('email', { required: true })}
                                    className="input w-full"
                                    placeholder="colleague@company.com"
                                    disabled={!!editingUser}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1 dark:text-slate-300">First Name</label>
                                    <input {...register('firstName')} className="input" placeholder="John" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 dark:text-slate-300">Last Name</label>
                                    <input {...register('lastName')} className="input w-full" placeholder="Doe" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-slate-300">Role</label>
                                <select {...register('role')} className="input">
                                    <option value="viewer">Viewer</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>
                            <div className="flex justify-end gap-2 mt-6">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="btn btn-ghost">Cancel</button>
                                <button type="submit" className="btn btn-primary">
                                    {editingUser ? 'Update User' : 'Send Invite'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {agentAccessModal.userId && (
                <AgentAccessModal
                    userId={agentAccessModal.userId}
                    userName={agentAccessModal.userName}
                    isOpen={agentAccessModal.isOpen}
                    onClose={() => setAgentAccessModal({ isOpen: false, userId: null, userName: '' })}
                />
            )}
        </div>
    )
}
