'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { SidebarShell } from '@/components/sidebar/SidebarShell'
import { UserNav } from '@/components/auth/UserNav'
import { useUnifiedChat } from '@/context/UnifiedChatContext'
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

export default function WorkspaceSidebar() {
  const { t } = useTranslation()
  const router = useRouter()
  const { newSession, selectedSessionId, sessionStatuses, sidebarRefreshToken } = useUnifiedChat()
  const [sessions, setSessions] = useState<SessionSummary[]>(() => getCachedSessions())
  const [loadingSessions, setLoadingSessions] = useState(false)
  const hasLoadedSessionsRef = useRef(getCachedSessions().length > 0)
  const lastRefreshTokenRef = useRef(sidebarRefreshToken)
  const deletingSessionIdsRef = useRef(new Set<string>())

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

  // First mount shows the skeleton; subsequent refreshes triggered by
  // ``sidebarRefreshToken`` (STREAM_END, server-side session bind,
  // turn deletion) silently swap in the new list. Resetting the ref
  // each refresh briefly re-renders the loading skeleton, which the
  // user perceives as a flicker on every message send / Answer Now.
  useEffect(() => {
    const force = lastRefreshTokenRef.current !== sidebarRefreshToken
    lastRefreshTokenRef.current = sidebarRefreshToken
    void refreshSessions({ force })
  }, [refreshSessions, sidebarRefreshToken])

  const orderedSessions = sessions
    .map((session, index) => {
      const runtime = sessionStatuses[session.session_id]
      return {
        index,
        session: runtime
          ? {
              ...session,
              status: runtime.status,
              active_turn_id: runtime.activeTurnId || session.active_turn_id,
            }
          : session,
      }
    })
    .sort((a, b) => {
      const aPriority = a.session.status === 'running' ? 0 : 1
      const bPriority = b.session.status === 'running' ? 0 : 1
      if (aPriority !== bPriority) return aPriority - bPriority
      return a.index - b.index
    })
    .map(({ session }) => session)

  const handleNewChat = () => {
    newSession()
    router.push('/chat')
  }

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      router.push(`/chat/${sessionId}`)
    },
    [router]
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
      if (deletingSessionIdsRef.current.has(sessionId)) return
      if (!window.confirm(t('Delete this chat history?'))) return
      deletingSessionIdsRef.current.add(sessionId)
      try {
        await deleteSession(sessionId)
        removeCachedSession(sessionId)
        setSessions(prev => prev.filter(session => session.session_id !== sessionId))
        if (selectedSessionId === sessionId) {
          newSession()
          router.push('/chat')
        }
      } finally {
        deletingSessionIdsRef.current.delete(sessionId)
      }
    },
    [newSession, router, selectedSessionId, t]
  )

  return (
    <SidebarShell
      showSessions
      sessions={orderedSessions}
      activeSessionId={selectedSessionId}
      loadingSessions={loadingSessions}
      onNewChat={handleNewChat}
      onSelectSession={handleSelectSession}
      onRenameSession={handleRenameSession}
      onDeleteSession={handleDeleteSession}
      footerSlot={<UserNav />}
    />
  )
}
