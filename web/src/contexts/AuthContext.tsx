// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.
// Proprietary software — see LICENSE in the repository root.
// https://zyvor.dev · info@zyvor.dev

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { login as apiLogin, logout as apiLogout, getSession } from '../api/auth'

interface AuthContextType {
  isAuthenticated: boolean
  username: string
  /** UNIX username is `root` (session administration). */
  isRoot: boolean
  sessionId: string
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  username: '',
  isRoot: false,
  sessionId: '',
  loading: true,
  login: async () => {},
  logout: async () => {},
})

/** Login page is outside the router; normalize URL before mounting the authenticated shell. */
function clearLoginPathFromUrl() {
  if (window.location.pathname === '/login') {
    window.history.replaceState(null, '', '/')
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [username, setUsername] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [loading, setLoading] = useState(true)

  // Check existing session on mount
  useEffect(() => {
    getSession()
      .then((session) => {
        if (session.authenticated) clearLoginPathFromUrl()
        setIsAuthenticated(session.authenticated)
        setUsername(session.username || '')
        setSessionId(typeof session.session_id === 'string' ? session.session_id : '')
      })
      .catch(() => {
        setIsAuthenticated(false)
        setSessionId('')
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (user: string, pass: string) => {
    await apiLogin(user, pass)
    const session = await getSession()
    clearLoginPathFromUrl()
    setIsAuthenticated(session.authenticated)
    setUsername(session.username || user)
    setSessionId(typeof session.session_id === 'string' ? session.session_id : '')
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    setIsAuthenticated(false)
    setUsername('')
    setSessionId('')
  }, [])

  return (
    <AuthContext.Provider value={{ isAuthenticated, username, isRoot: username === 'root', sessionId, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
