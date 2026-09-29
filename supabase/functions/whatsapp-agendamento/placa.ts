export function normalizarPlaca(bruto: string): string {
  return String(bruto ?? '').toUpperCase().replace(/[\s-]/g, '')
}

export function placasCorrespondem(a: string, b: string): boolean {
  const normalizada = normalizarPlaca(a)
  return normalizada !== '' && normalizada === normalizarPlaca(b)
}
