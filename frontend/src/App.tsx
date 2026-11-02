import { useEffect, useState } from 'react'
import { AuthGate } from './components/AuthGate'
import { LOCAL } from './api'
import { ToastProvider } from './components/Toasts'
import { MusicDrawer } from './music/MusicDrawer'
import { PlayerBar } from './music/PlayerBar'
import { PlayerProvider } from './music/PlayerProvider'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import SongEditor from './pages/SongEditor'
import { useRoute } from './route'

function useOnline() {
  const [on, setOn] = useState(() => navigator.onLine)
  useEffect(() => {
    const a = () => setOn(true)
    const b = () => setOn(false)
    window.addEventListener('online', a)
    window.addEventListener('offline', b)
    return () => {
      window.removeEventListener('online', a)
      window.removeEventListener('offline', b)
    }
  }, [])
  return on
}

export default function App() {
  const route = useRoute()
  const online = useOnline()
  return (
    <AuthGate>
      <ToastProvider>
        {!online && !LOCAL && (
          <div className="banner" role="status">
            You are offline. Changes stay in this window until the connection returns.
          </div>
        )}
        <PlayerProvider>
          {route.name === 'song' ? (
            <SongEditor key={route.id} id={route.id} />
          ) : route.name === 'settings' ? (
            <Settings />
          ) : (
            <Dashboard />
          )}
          <MusicDrawer />
          <PlayerBar />
        </PlayerProvider>
      </ToastProvider>
    </AuthGate>
  )
}
