'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { LayoutDashboard } from 'lucide-react'
import Link from 'next/link'
import { SidebarShell } from '@/components/sidebar/SidebarShell'
import { UserNav } from '@/components/auth/UserNav'
import { useAppShell } from '@/context/AppShellContext'
import {
  deleteSession,
  listSessions,
  updateSessionTitle,
  type SessionSummary,
} from '@/lib/session-api'
import {
  getCachedSessions,
  removeCachedSession,
  setCachedSessions,
  updateCachedSession,
} from '@/components/sidebar/session-list-cache'

export default function UtilitySidebar() {
  const { t } = useTranslation()
  const router = useRouter()
  const { activeSessionId, setActiveSessionId } = useAppShell()
  const [sessions, setSessions] = useState<SessionSummary[]>(() => getCachedSessions())
  const [loadingSessions, setLoadingSessions] = useState(false)
  const hasLoadedSessionsRef = useRef(getCachedSessions().length > 0)

  const refreshSessions = useCallback(async (options?: { force?: boolean }) => {
    if (!hasLoadedSessionsRef.current) {
      setLoadingSessions(true)
    }
    try {
      const nextSessions = await listSessions(50, 0, {
        force: options?.force,
      })
      setCachedSessions(nextSessions)
      setSessions(nextSessions)
      hasLoadedSessionsRef.current = true
    } catch (error) {
      console.error('Failed to load sessions', error)
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  const handleNewChat = useCallback(() => {
    setActiveSessionId(null)
    router.push('/chat')
  }, [router, setActiveSessionId])

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      setActiveSessionId(sessionId)
      router.push(`/chat/${sessionId}`)
    },
    [router, setActiveSessionId]
  )

  const handleRenameSession = useCallback(async (sessionId: string, title: string) => {
    const updated = await updateSessionTitle(sessionId, title)
    const sessionUpdate = {
      title: updated.title,
      updated_at: updated.updated_at,
    }
    updateCachedSession(sessionId, sessionUpdate)
    setSessions(prev =>
      prev.map(session =>
        session.session_id === sessionId ? { ...session, ...sessionUpdate } : session
      )
    )
  }, [])

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (!window.confirm(t('Delete this chat history?'))) return
      await deleteSession(sessionId)
      removeCachedSession(sessionId)
      setSessions(prev => prev.filter(session => session.session_id !== sessionId))
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
      }
    },
    [activeSessionId, setActiveSessionId, t]
  )

  return (
    <SidebarShell
      showSessions
      sessions={sessions}
      activeSessionId={activeSessionId}
      loadingSessions={loadingSessions}
      onNewChat={handleNewChat}
      onSelectSession={handleSelectSession}
      onRenameSession={handleRenameSession}
      onDeleteSession={handleDeleteSession}
      footerSlot={<UserNav />}
    />
  )
}
