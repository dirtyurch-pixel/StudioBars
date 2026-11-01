export type Health = { status: string; service: string; version: string }

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export async function fetchHealth(signal?: AbortSignal): Promise<Health> {
  const res = await fetch(`${BASE}/health`, { signal })
  if (!res.ok) throw new Error(`Backend replied ${res.status}`)
  return (await res.json()) as Health
}
