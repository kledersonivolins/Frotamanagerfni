import {
  createContext,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import type { EffectiveScope } from '../domain/contracts'
import type { SessionService } from './session'

type AuthStatus = 'anonymous' | 'authenticating' | 'authenticated' | 'error'

interface AuthContextValue {
  status: AuthStatus
  scope: EffectiveScope | null
  error: string | null
  login(email: string, password: string): Promise<void>
  logout(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthProviderProps extends PropsWithChildren {
  service: SessionService
}

export function AuthProvider({ service, children }: AuthProviderProps) {
  const [status, setStatus] = useState<AuthStatus>('anonymous')
  const [scope, setScope] = useState<EffectiveScope | null>(null)
  const [error, setError] = useState<string | null>(null)

  const value = useMemo<AuthContextValue>(() => ({
    status,
    scope,
    error,
    async login(email, password) {
      setStatus('authenticating')
      setError(null)
      try {
        const authenticatedScope = await service.loginOnline(email, password)
        setScope(authenticatedScope)
        setStatus('authenticated')
      } catch (loginError) {
        setScope(null)
        setStatus('error')
        setError(loginError instanceof Error ? loginError.message : 'LOGIN_FAILED')
      }
    },
    async logout() {
      await service.logout()
      setScope(null)
      setStatus('anonymous')
      setError(null)
    },
  }), [error, scope, service, status])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth precisa ser usado dentro de AuthProvider')
  return value
}
