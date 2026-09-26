export const RECHECK_STATES = ['待检', '已通过', '未通过'] as const
export type RecheckState = (typeof RECHECK_STATES)[number]

export const RECHECK_GRADES = ['一般', '严重'] as const
export type RecheckGrade = (typeof RECHECK_GRADES)[number]

export interface RecheckOrder {
  id?: number
  orderNo: string
  runId: number
  mouldId: number
  gapIssue: boolean
  evennessIssue: boolean
  grade: RecheckGrade
  state: RecheckState
  openedAt: string
  inspector?: string
  recheckGap?: number
  recheckDeviation?: number
  closedAt?: string
  schemaRev?: number
}

export type RecheckOrderInput = Omit<RecheckOrder, 'id' | 'schemaRev'>
