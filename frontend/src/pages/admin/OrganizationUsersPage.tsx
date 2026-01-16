import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, UserPlus, Trash2, Loader2, Building2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { usersApi, organizationsApi } from '@/services/api'

export default function OrganizationUsersPage() {
    const { id: orgId } = useParams()
    const navigate = useNavigate()
    const [users, setUsers] = useState([])
    const [orgName, setOrgName] = useState('')
    const [loading, setLoading] = useState(true)
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
    const { register, handleSubmit, reset } = useForm()

    useEffect(() => {
        if (orgId) {
            loadData()
        }
    }, [orgId])

    const loadData = async () => {
        try {
            setLoading(true)
            const [usersRes, orgsRes] = await Promise.all([
                usersApi.list(orgId),
                organizationsApi.list() // We might want a getById endpoint, but list works for now
            ])

            setUsers(usersRes.data)
            const org = orgsRes.data.find((o: any) => o.id === orgId)
            if (org) setOrgName(org.name)
        } catch (error) {
            toast.error('Failed to load data')
        } finally {
            setLoading(false)
        }
    }

    const onInviteSubmit = async (data: any) => {
        try {
            await usersApi.invite({
                ...data,
                organizationId: orgId
            })
            toast.success('User invited successfully')
            setIsInviteModalOpen(false)
            reset()
            // Refresh list
            const res = await usersApi.list(orgId)
            setUsers(res.data)
        } catch (error: any) {
            // Show specific error message from API
            const message = error.response?.data?.message || 'Failed to invite user'
            toast.error(message)
        }
    }

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
        )
    }

    return (
        <div className="p-6">
            <div className="mb-6">
                <button
                    onClick={() => navigate('/admin/organizations')}
                    className="flex items-center text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 mb-4 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4 mr-1" />
                    Back to Organizations
                </button>

                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <Building2 className="w-6 h-6 text-slate-400" />
                            {orgName} Users
                        </h1>
                        <p className="text-slate-500">Manage users for this organization</p>
                    </div>
                    <button
                        onClick={() => setIsInviteModalOpen(true)}
                        className="btn btn-primary flex items-center gap-2"
                    >
                        <UserPlus className="w-4 h-4" />
                        Invite User
                    </button>
                </div>
            </div>

            <div className="card overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 font-medium">
                        <tr>
                            <th className="px-4 py-3">Email</th>
                            <th className="px-4 py-3">Name</th>
                            <th className="px-4 py-3">Role</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {users.map((user: any) => (
                            <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                <td className="px-4 py-3 text-slate-900 dark:text-white font-medium">{user.email}</td>
                                <td className="px-4 py-3 text-slate-500">
                                    {user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : '-'}
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-1 rounded text-xs ${user.role === 'admin' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                        }`}>
                                        {user.role}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`px-2 py-1 rounded text-xs ${user.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                        }`}>
                                        {user.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <button
                                        className="text-slate-400 hover:text-red-600 transition-colors"
                                        title="Delete user"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {users.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                                    No users found in this organization. Invite one to get started.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Invite User Modal */}
            {isInviteModalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-lg w-full max-w-md shadow-xl border border-slate-200 dark:border-slate-800">
                        <h2 className="text-xl font-bold mb-4 text-slate-900 dark:text-white">
                            Invite User to {orgName}
                        </h2>
                        <form onSubmit={handleSubmit(onInviteSubmit)} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-slate-300">Email</label>
                                <input
                                    {...register('email', { required: true })}
                                    type="email"
                                    className="input w-full"
                                    placeholder="user@example.com"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-slate-300">Role</label>
                                <select {...register('role', { required: true })} className="input w-full">
                                    <option value="viewer">Viewer</option>
                                    <option value="admin">Admin</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1 dark:text-slate-300">First Name</label>
                                    <input {...register('firstName')} className="input w-full" placeholder="John" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 dark:text-slate-300">Last Name</label>
                                    <input {...register('lastName')} className="input w-full" placeholder="Doe" />
                                </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-6">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsInviteModalOpen(false)
                                        reset()
                                    }}
                                    className="btn btn-ghost"
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">Send Invite</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
