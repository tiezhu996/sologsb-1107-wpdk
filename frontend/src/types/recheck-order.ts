export const RECHECK_STATUSES = ['待检', '已通过', '未通过'] as const
export type RecheckStatus = (typeof RECHECK_STATUSES)[number]

export const RECHECK_SEVERITIES = ['一般', '严重'] as const
export type RecheckSeverity = (typeof RECHECK_SEVERITIES)[number]

export interface RecheckOrder {
  id?: number
  orderNo: string
  runId: number
  mouldId: number
  sampleId?: number
  severity: RecheckSeverity
  gapHit: boolean
  evennessHit: boolean
  standardGap: number
  originGap: number
  originDeviation: number
  status: RecheckStatus
  createdAt: string
  inspector?: string
  recheckGap?: number
  recheckDeviation?: number
  closedAt?: string
  schemaRev?: number
}

export type RecheckOrderInput = Omit<RecheckOrder, 'id' | 'schemaRev'>
