import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EffectiveScope } from '../domain/contracts'
import type { SessionService } from './session'
import { AuthProvider, useAuth } from './AuthProvider'

const scope = {
  tenant: 'oficinafni', permissions: ['mobile.access'],
} as EffectiveScope

function Consumer() {
  const auth = useAuth()
  return <button onClick={() => auth.login('user@example.com', 'secret')}>
    {auth.scope?.tenant ?? auth.status}
  </button>
}

describe('AuthProvider', () => {
  it('publishes the authenticated scope after login', async () => {
    const service = {
      loginOnline: async () => scope,
      getOfflineAccess: async () => 'none',
      logout: async () => {},
    } as SessionService

    render(<AuthProvider service={service}><Consumer /></AuthProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'anonymous' }))

    expect(await screen.findByRole('button', { name: 'oficinafni' })).toBeVisible()
  })
})
