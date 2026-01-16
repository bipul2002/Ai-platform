import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { authApi } from '@/services/api'
import { useAuthStore } from '@/store/auth'

export default function VerifyPage() {
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const { login } = useAuthStore()

    useEffect(() => {
        const verifyToken = async () => {
            const token = searchParams.get('token')

            if (!token) {
                toast.error('Invalid link')
                navigate('/login')
                return
            }

            try {
                const response = await authApi.verify(token)
                const { user, accessToken, refreshToken } = response.data

                login(user, accessToken, refreshToken)
                toast.success('Successfully signed in!')

                if (user.role === 'super_admin') {
                    navigate('/admin/dashboard', { replace: true })
                } else {
                    navigate('/chat', { replace: true })
                }
            } catch (error: any) {
                toast.error(error.response?.data?.message || 'Verification failed')
                navigate('/login')
            }
        }

        verifyToken()
    }, [searchParams, navigate, login])

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 dark:from-slate-900 dark:to-slate-800">
            <div className="card text-center p-8">
                <Loader2 className="w-12 h-12 text-primary-600 animate-spin mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Verifying sign in...</h2>
            </div>
        </div>
    )
}
