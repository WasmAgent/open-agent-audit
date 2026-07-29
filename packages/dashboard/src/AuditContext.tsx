import { createContext, useContext, useState, useCallback } from 'react'
import { type RawEvent, type AepMeta } from './utils'

export interface ReportSummary {
  eas_score?: number
  eas_grade?: string
  finding_count?: number
  event_count?: number
}

interface AuditState {
  events: RawEvent[]
  fileName: string | null
  fileText: string
  parseError: string | null
  isAepRecord: boolean
  aepMeta: AepMeta | null
  reportRunId: string | null
  reportError: string | null
  reportSummary: ReportSummary | null
  reportGenerating: boolean
  setEvents: (e: RawEvent[]) => void
  setFileName: (n: string | null) => void
  setFileText: (t: string) => void
  setParseError: (e: string | null) => void
  setIsAepRecord: (v: boolean) => void
  setAepMeta: (m: AepMeta | null) => void
  setReportRunId: (id: string | null) => void
  setReportError: (e: string | null) => void
  setReportSummary: (s: ReportSummary | null) => void
  setReportGenerating: (v: boolean) => void
  reset: () => void
}

const AuditContext = createContext<AuditState | null>(null)

export function AuditProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<RawEvent[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileText, setFileText] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [isAepRecord, setIsAepRecord] = useState(false)
  const [aepMeta, setAepMeta] = useState<AepMeta | null>(null)
  const [reportRunId, setReportRunId] = useState<string | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [reportSummary, setReportSummary] = useState<ReportSummary | null>(null)
  const [reportGenerating, setReportGenerating] = useState(false)

  const reset = useCallback(() => {
    setEvents([])
    setFileName(null)
    setFileText('')
    setParseError(null)
    setIsAepRecord(false)
    setAepMeta(null)
    setReportRunId(null)
    setReportError(null)
    setReportSummary(null)
    setReportGenerating(false)
  }, [])

  return (
    <AuditContext.Provider value={{
      events, setEvents,
      fileName, setFileName,
      fileText, setFileText,
      parseError, setParseError,
      isAepRecord, setIsAepRecord,
      aepMeta, setAepMeta,
      reportRunId, setReportRunId,
      reportError, setReportError,
      reportSummary, setReportSummary,
      reportGenerating, setReportGenerating,
      reset,
    }}>
      {children}
    </AuditContext.Provider>
  )
}

export function useAudit(): AuditState {
  const ctx = useContext(AuditContext)
  if (!ctx) throw new Error('useAudit must be used within AuditProvider')
  return ctx
}
