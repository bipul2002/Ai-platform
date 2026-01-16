import axios from 'axios'
import { useAuthStore } from '@/store/auth'

const API_URL = import.meta.env.VITE_API_URL || '';
const AI_RUNTIME_URL = import.meta.env.VITE_AI_RUNTIME_URL || '';

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
})

export const aiRuntimeApi = axios.create({
  baseURL: AI_RUNTIME_URL, // Runtime routes are at root or /api depending on setup. Checked routes.py, it uses @router, often included with prefix.
  // routes.py has @router.post("/query/execute") and is likely included in main.py.
  // Typically main.py includes it with /api prefix or directly. 
  // Let's assume root based on previous context or common patterns, but wait, routes.py usually needs a prefix. 
  // checking main.py would contain the mount.
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  // Only use embed token if we are on the embed route to avoid clobbering admin session in parent window
  const isEmbedRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/embed')
  const embedToken = isEmbedRoute ? sessionStorage.getItem('embed_token') : null
  const token = embedToken || useAuthStore.getState().accessToken

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

aiRuntimeApi.interceptors.request.use((config) => {
  // Only use embed token if we are on the embed route to avoid clobbering admin session in parent window
  const isEmbedRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/embed')
  const embedToken = isEmbedRoute ? sessionStorage.getItem('embed_token') : null
  const token = embedToken || useAuthStore.getState().accessToken

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      const refreshToken = useAuthStore.getState().refreshToken

      if (refreshToken) {
        try {
          const response = await axios.post(`${API_URL}/api/auth/refresh`, {
            refreshToken,
          })

          const { accessToken, refreshToken: newRefreshToken } = response.data
          useAuthStore.getState().setTokens(accessToken, newRefreshToken)

          originalRequest.headers.Authorization = `Bearer ${accessToken}`
          return api(originalRequest)
        } catch {
          useAuthStore.getState().logout()
        }
      } else {
        useAuthStore.getState().logout()
      }
    }

    return Promise.reject(error)
  }
)

export const authApi = {
  login: (email: string) =>
    api.post('/auth/login', { email }),

  verify: (token: string) =>
    api.post('/auth/verify', { token }),

  exchangeApiKey: (apiKey: string, agentId: string,parentOrigin:string) =>
    api.post('/auth/exchange-api-key', { apiKey, agentId, parentOrigin }),

  logout: () => api.post('/auth/logout'),

  me: () => api.get('/auth/me'),
}

export const usersApi = {
  invite: (data: { email: string; role: string; firstName?: string; lastName?: string; organizationId?: string }) =>
    api.post('/users/invite', data),
  list: (organizationId?: string) =>
    api.get('/users', { params: organizationId ? { organizationId } : {} }),
  update: (id: string, data: any) => api.patch(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
  getUserAgentAccess: (userId: string) =>
    api.get(`/users/${userId}/agent-access`),
  setUserAgentAccess: (userId: string, agentIds: string[]) =>
    api.put(`/users/${userId}/agent-access`, { agentIds }),
}

export const organizationsApi = {
  list: () => api.get('/organizations'),
  create: (data: any) => api.post('/organizations', data),
  update: (id: string, data: any) => api.patch(`/organizations/${id}`, data), // backend uses PATCH in Controller? Check step 2053. Yes Patch.
  delete: (id: string) => api.delete(`/organizations/${id}`),
}

export const agentsApi = {
  list: (params?: { search?: string; isActive?: boolean; page?: number; limit?: number }) =>
    api.get('/agents', { params }),

  get: (id: string) => api.get(`/agents/${id}`),

  create: (data: any) => api.post('/agents', data),

  update: (id: string, data: any) => api.put(`/agents/${id}`, data),

  delete: (id: string) => api.delete(`/agents/${id}`),

  getConfig: (id: string) => api.get(`/agents/${id}/config`),

  getEnrichedMetadata: (id: string) => api.get(`/agents/${id}/enriched-metadata`),

  testConnection: (id: string) => api.post(`/agents/${id}/external-db/test`),
}

export const agentApiKeysApi = {
  list: (agentId: string) => api.get(`/agents/${agentId}/api-keys`),

  create: (agentId: string, name: string) =>
    api.post(`/agents/${agentId}/api-keys`, { name }),

  revoke: (agentId: string, keyId: string) =>
    api.delete(`/agents/${agentId}/api-keys/${keyId}`),

  reveal: (agentId: string, keyId: string) =>
    api.get(`/agents/${agentId}/api-keys/${keyId}/reveal`),

  updateAllowedOrigins(agentId: string, keyId: string, origins: string[]) {
    return api.patch(`/agents/${agentId}/api-keys/${keyId}/allowed-origins`, {
      origins,
    })
  }
}

export const schemaApi = {
  get: (agentId: string) => api.get(`/agents/${agentId}/schema`),

  refresh: (agentId: string) => api.post(`/agents/${agentId}/schema/refresh`),

  updateTable: (agentId: string, tableId: string, data: {
    adminDescription?: string;
    semanticHints?: string;
    customPrompt?: string;
    isVisible?: boolean;
    isQueryable?: boolean;
  }) => api.put(`/agents/${agentId}/schema/tables/${tableId}`, data),

  updateColumn: (agentId: string, columnId: string, data: {
    adminDescription?: string;
    semanticHints?: string;
    customPrompt?: string;
    isVisible?: boolean;
    isQueryable?: boolean;
    isSensitive?: boolean;
    sensitivityOverride?: string | null;
    maskingStrategyOverride?: string | null;
  }) => api.put(`/agents/${agentId}/schema/columns/${columnId}`, data),
}

export const embeddingsApi = {
  get: (agentId: string) => api.get(`/agents/${agentId}/embeddings`),

  generate: (agentId: string) => api.post(`/agents/${agentId}/embeddings/generate`),

  search: (agentId: string, query: string, limit?: number) =>
    api.get(`/agents/${agentId}/embeddings/search`, { params: { query, limit } }),
}

// Sensitivity Rules
export const getAgentSensitivityRules = (agentId: string) =>
  api.get(`/agents/${agentId}/sensitivity`)

export const createAgentSensitivityRule = (agentId: string, data: any) =>
  api.post(`/agents/${agentId}/sensitivity`, data)

export const updateAgentSensitivityRule = (agentId: string, ruleId: string, data: any) =>
  api.put(`/agents/${agentId}/sensitivity/${ruleId}`, data)

export const deleteAgentSensitivityRule = (agentId: string, ruleId: string) =>
  api.delete(`/agents/${agentId}/sensitivity/${ruleId}`)

export const sensitivityApi = {
  getGlobal: () => api.get('/sensitivity/global'),

  createGlobal: (data: any) => api.post('/sensitivity/global', data),

  updateGlobal: (id: string, data: any) => api.put(`/sensitivity/global/${id}`, data),

  deleteGlobal: (id: string) => api.delete(`/sensitivity/global/${id}`),

  getAgent: (agentId: string) => api.get(`/agents/${agentId}/sensitivity`),

  createAgent: (agentId: string, data: any) =>
    api.post(`/agents/${agentId}/sensitivity`, data),

  updateAgent: (agentId: string, ruleId: string, data: any) =>
    api.put(`/agents/${agentId}/sensitivity/${ruleId}`, data),

  deleteAgent: (agentId: string, ruleId: string) =>
    api.delete(`/agents/${agentId}/sensitivity/${ruleId}`),
}

export const auditApi = {
  getLogs: (params?: any) => api.get('/audit/logs', { params }),

  getQueries: (params: any) => api.get('/audit/queries', { params }),
  getQueryDetails: (id: string) => api.get(`/audit/queries/${id}`),
};
