import { LayoutDashboard } from 'lucide-react'

export default function DashboardPage() {
    return (
        <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
                <LayoutDashboard className="w-8 h-8 text-primary-600" />
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
                    <p className="text-slate-500">Platform overview and statistics</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="card p-6 border-l-4 border-l-primary-500">
                    <h3 className="text-lg font-semibold mb-2 text-slate-900 dark:text-white">Welcome, Super Admin</h3>
                    <p className="text-slate-500">Select an option from the sidebar to manage organizations, audit logs, or system settings.</p>
                </div>
            </div>
        </div>
    )
}
