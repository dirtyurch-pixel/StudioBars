import { createContext, useContext } from 'react'

export type Kind = 'info' | 'error' | 'success'
export type ToastFn = (message: string, kind?: Kind) => void

export const ToastContext = createContext<ToastFn>(() => {})
export const useToast = () => useContext(ToastContext)
