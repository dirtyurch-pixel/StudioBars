import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ToastContext, type Kind, type ToastFn } from './toastContext'

type Toast = { id: number; message: string; kind: Kind }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback<ToastFn>((message, kind = 'info') => {
    const id = Date.now() + Math.random()
    setItems((t) => [...t.slice(-3), { id, message, kind }])
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500)
  }, [])
  const value = useMemo(() => push, [push])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
