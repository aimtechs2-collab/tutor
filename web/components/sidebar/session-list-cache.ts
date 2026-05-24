import type { SessionSummary } from '@/lib/session-api'

let cachedSessions: SessionSummary[] = []

export function getCachedSessions(): SessionSummary[] {
  return cachedSessions
}

export function setCachedSessions(sessions: SessionSummary[]): void {
  cachedSessions = sessions
}

export function updateCachedSession(
  sessionId: string,
  update: Partial<SessionSummary>
): SessionSummary[] {
  cachedSessions = cachedSessions.map(session =>
    session.session_id === sessionId ? { ...session, ...update } : session
  )
  return cachedSessions
}

export function removeCachedSession(sessionId: string): SessionSummary[] {
  cachedSessions = cachedSessions.filter(session => session.session_id !== sessionId)
  return cachedSessions
}
