import { BackendStatus } from './BackendStatus'

export default function App() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-3xl font-bold">Studio Bars</h1>
      <p style={{ color: 'var(--muted)' }}>Phase 0 foundation. No features yet.</p>
      <div
        className="my-4 rounded-xl p-4"
        style={{ background: 'var(--paper)', color: 'var(--paper-ink)' }}
      >
        Writing pad placeholder
      </div>
      <BackendStatus />
    </main>
  )
}
