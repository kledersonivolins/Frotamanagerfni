import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('renders the FrotaManager mobile shell', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'FrotaManager' })).toBeInTheDocument()
  })
  it('oferece navegação para empréstimos e ordens de serviço', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Empréstimos' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Ordens de Serviço' })).toBeVisible()
  })
})
