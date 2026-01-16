import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/LoginPage'
import ChatPage from '@/pages/ChatPage'
import EmbedChatPage from '@/pages/EmbedChatPage'
import AgentsPage from '@/pages/admin/AgentsPage'
import AgentDetailPage from '@/pages/admin/AgentDetailPage'
import AgentSensitivityPage from './pages/admin/AgentSensitivityPage'
import SchemaPage from '@/pages/admin/SchemaPage'
import SensitivityPage from '@/pages/admin/SensitivityPage'
import VerifyPage from '@/pages/VerifyPage'
import OrganizationsPage from '@/pages/admin/OrganizationsPage'
import OrganizationUsersPage from '@/pages/admin/OrganizationUsersPage'
import UsersPage from '@/pages/admin/UsersPage'
import AuditPage from '@/pages/admin/AuditPage'
import DashboardPage from '@/pages/admin/DashboardPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthStore()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (user?.role !== 'super_admin' && user?.role !== 'admin') {
    return <Navigate to="/chat" replace />
  }

  return <>{children}</>
}

function ChatRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()

  // Redirect super_admins to dashboard, but allow admins and viewers to access chat
  if (user?.role === 'super_admin') {
    return <Navigate to="/admin/dashboard" replace />
  }

  return <>{children}</>
}

function RootRedirect() {
  const { user } = useAuthStore()

  // Viewers go to chat, admins to dashboard
  if (user?.role === 'viewer') {
    return <Navigate to="/chat" replace />
  }

  if (user?.role === 'super_admin' || user?.role === 'admin') {
    return <Navigate to="/admin/dashboard" replace />
  }

  return <Navigate to="/chat" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route path="/embed" element={<EmbedChatPage />} />

      <Route path="/" element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route index element={<RootRedirect />} />
        <Route path="chat" element={<ChatRoute><ChatPage /></ChatRoute>} />
        <Route path="chat/:agentId" element={<ChatRoute><ChatPage /></ChatRoute>} />

        {/* Admin Routes */}
        <Route path="admin" element={<AdminRoute><AgentsPage /></AdminRoute>} />
        <Route path="admin/dashboard" element={<AdminRoute><DashboardPage /></AdminRoute>} />
        <Route path="admin/agents" element={<AdminRoute><AgentsPage /></AdminRoute>} />
        <Route path="admin/agents/:id" element={<AdminRoute><AgentDetailPage /></AdminRoute>} />
        <Route path="admin/agents/:id/schema" element={<AdminRoute><SchemaPage /></AdminRoute>} />
        <Route path="admin/agents/:id/sensitivity" element={<AdminRoute><AgentSensitivityPage /></AdminRoute>} />
        <Route path="admin/sensitivity" element={<AdminRoute><SensitivityPage /></AdminRoute>} />
        <Route path="admin/audit" element={<ProtectedRoute><AuditPage /></ProtectedRoute>} />
        <Route path="admin/organizations" element={<AdminRoute><OrganizationsPage /></AdminRoute>} />
        <Route path="admin/organizations/:id/users" element={<AdminRoute><OrganizationUsersPage /></AdminRoute>} />
        <Route path="admin/users" element={<AdminRoute><UsersPage /></AdminRoute>} />
      </Route >
    </Routes >
  )
}
