import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Building2, Pencil, Users } from 'lucide-react'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { organizationsApi } from '@/services/api'

export default function OrganizationsPage() {
    const navigate = useNavigate()
    const [orgs, setOrgs] = useState([])
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingOrg, setEditingOrg] = useState<any>(null)
    const { register, handleSubmit, reset, setValue } = useForm()

    useEffect(() => {
        fetchOrgs()
    }, [])

    useEffect(() => {
        if (editingOrg) {
            setValue('name', editingOrg.name)
            setValue('slug', editingOrg.slug)
        } else {
            reset()
        }
    }, [editingOrg, setValue, reset])

    const fetchOrgs = async () => {
        try {
            const res = await organizationsApi.list()
            setOrgs(res.data)
        } catch (error) {
            toast.error('Failed to load organizations')
        }
    }

    const onSubmit = async (data: any) => {
        try {
            if (editingOrg) {
                await organizationsApi.update(editingOrg.id, data)
                toast.success('Organization updated')
            } else {
                await organizationsApi.create(data)
                toast.success('Organization created')
            }
            setIsModalOpen(false)
            setEditingOrg(null)
            reset()
            fetchOrgs()
        } catch (error: any) {
            const message = error.response?.data?.message || (editingOrg ? 'Failed to update organization' : 'Failed to create organization')
            toast.error(message)
        }
    }

    const handleEdit = (org: any) => {
        setEditingOrg(org)
        setIsModalOpen(true)
    }

    const handleManageUsers = (org: any) => {
        navigate(`/admin/organizations/${org.id}/users`)
    }

    const handleCloseModal = () => {
        setIsModalOpen(false)
        setEditingOrg(null)
        reset()
    }

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Organizations</h1>
                    <p className="text-slate-500">Manage tenant organizations</p>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="btn btn-primary flex items-center gap-2"
                >
                    <Plus className="w-4 h-4" />
                    New Organization
                </button>
            </div>

            <div className="card overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 font-medium">
                        <tr>
                            <th className="px-4 py-3">Name</th>
                            <th className="px-4 py-3">Slug</th>
                            <th className="px-4 py-3">Created At</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {orgs.map((org: any) => (
                            <tr key={org.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                <td className="px-4 py-3 font-medium text-slate-900 dark:text-white flex items-center gap-2">
                                    <Building2 className="w-4 h-4 text-slate-400" />
                                    {org.name}
                                </td>
                                <td className="px-4 py-3 text-slate-500">{org.slug}</td>
                                <td className="px-4 py-3 text-slate-500">{new Date(org.createdAt).toLocaleDateString()}</td>
                                <td className="px-4 py-3 text-right">
                                    <button
                                        onClick={() => handleManageUsers(org)}
                                        className="text-slate-400 hover:text-primary-600 mr-2"
                                        title="Manage users"
                                    >
                                        <Users className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleEdit(org)}
                                        className="text-slate-400 hover:text-primary-600 mr-2"
                                        title="Edit organization"
                                    >
                                        <Pencil className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Edit Organization Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-lg w-full max-w-md">
                        <h2 className="text-xl font-bold mb-4 text-slate-900 dark:text-white">
                            {editingOrg ? 'Edit Organization' : 'New Organization'}
                        </h2>
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-slate-300">Name</label>
                                <input {...register('name', { required: true })} className="input" placeholder="Acme Inc." />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 dark:text-slate-300">Slug</label>
                                <input {...register('slug', { required: true })} className="input" placeholder="acme" />
                            </div>
                            <div className="flex justify-end gap-2 mt-6">
                                <button type="button" onClick={handleCloseModal} className="btn btn-ghost">Cancel</button>
                                <button type="submit" className="btn btn-primary">
                                    {editingOrg ? 'Update' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
