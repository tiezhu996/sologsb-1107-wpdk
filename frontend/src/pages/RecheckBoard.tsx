import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Grid, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { RulerInput } from '../components/common/RulerInput'
import { StatBadge } from '../components/common/StatBadge'
import { useMouldStore } from '../stores/mouldStore'
import { useRecheckStore } from '../stores/recheckStore'
import { useRunStore } from '../stores/runStore'
import { useSampleStore } from '../stores/sampleStore'
import { RECHECK_SEVERITIES, RECHECK_STATUSES, type RecheckOrder, type RecheckSeverity, type RecheckStatus } from '../types/recheck-order'
import { calculateDeviation, getGapConclusion, isGapOutOfTolerance } from '../utils/stripe'

function formatMoment(value?: string): string {
  return value ? value.replace('T', ' ').slice(0, 16) : '—'
}

export default function RecheckBoard() {
  const orders = useRecheckStore((state) => state.orders)
  const recheckError = useRecheckStore((state) => state.error)
  const syncOrders = useRecheckStore((state) => state.syncOrders)
  const submitRecheck = useRecheckStore((state) => state.submitRecheck)
  const runs = useRunStore((state) => state.sheetRuns)
  const runError = useRunStore((state) => state.error)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const moulds = useMouldStore((state) => state.moulds)
  const mouldError = useMouldStore((state) => state.error)
  const loadMoulds = useMouldStore((state) => state.loadMoulds)
  const samples = useSampleStore((state) => state.paperSamples)
  const sampleError = useSampleStore((state) => state.error)
  const loadSamples = useSampleStore((state) => state.loadSamples)
  const [statusFilter, setStatusFilter] = useState<RecheckStatus | '全部'>('全部')
  const [severityFilter, setSeverityFilter] = useState<RecheckSeverity | '全部'>('全部')
  const [inspector, setInspector] = useState('')
  const [draftGaps, setDraftGaps] = useState<Record<number, number>>({})
  const [submittingId, setSubmittingId] = useState<number | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void loadRuns()
    void loadMoulds()
    void loadSamples()
    void syncOrders()
  }, [loadMoulds, loadRuns, loadSamples, syncOrders])

  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs])
  const mouldById = useMemo(() => new Map(moulds.map((mould) => [mould.id, mould])), [moulds])
  const sampleById = useMemo(() => new Map(samples.map((sample) => [sample.id, sample])), [samples])
  const filteredOrders = useMemo(
    () => orders.filter((order) => (statusFilter === '全部' || order.status === statusFilter) && (severityFilter === '全部' || order.severity === severityFilter)),
    [orders, severityFilter, statusFilter],
  )
  const pendingCount = orders.filter((order) => order.status === '待检').length
  const passedCount = orders.filter((order) => order.status === '已通过').length
  const failedCount = orders.filter((order) => order.status === '未通过').length
  const severeCount = orders.filter((order) => order.severity === '严重').length

  const handleSubmit = async (order: RecheckOrder) => {
    if (order.id === undefined || !inspector.trim()) return
    const gap = draftGaps[order.id] ?? order.originGap
    if (!(gap > 0)) return
    setSubmittingId(order.id)
    const ok = await submitRecheck(order.id, gap, inspector)
    setSubmittingId(null)
    if (ok) {
      setDraftGaps((current) => {
        const next = { ...current }
        delete next[order.id as number]
        return next
      })
      setMessage(`工单 ${order.orderNo} 复检已登记`)
    }
  }

  const error = recheckError ?? runError ?? mouldError ?? sampleError

  return (
    <Stack spacing={3}>
      <Box>
        <Typography component="h1" variant="h3" color="#344a34">复检工单台</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.75 }}>
          帘纹间距偏离标准值超过 ±0.2 mm 或透光匀度不达“均匀”的工序会自动开立待检工单，检验员在此登记复检间距。
        </Typography>
      </Box>

      {error && <Alert severity="warning">{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <StatBadge label="待检工单" value={pendingCount} detail="等待检验员登记复检" tone={pendingCount ? 'warning' : 'neutral'} />
        <StatBadge label="未通过工单" value={failedCount} detail="纸帘已改记待修补" tone={failedCount ? 'warning' : 'neutral'} />
        <StatBadge label="已通过工单" value={passedCount} detail="实测值已写回工序" tone="bamboo" />
        <StatBadge label="严重工单" value={severeCount} detail="间距与匀度同时命中" tone={severeCount ? 'warning' : 'neutral'} />
      </Box>

      <Card>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Grid container spacing={1.5} alignItems="center">
            <Grid item xs={6} sm={4} md={2.5}>
              <TextField select fullWidth size="small" label="状态" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as RecheckStatus | '全部')} SelectProps={{ native: true }}>
                <option value="全部">全部状态</option>
                {RECHECK_STATUSES.map((option) => <option key={option} value={option}>{option}</option>)}
              </TextField>
            </Grid>
            <Grid item xs={6} sm={4} md={2.5}>
              <TextField select fullWidth size="small" label="级别" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as RecheckSeverity | '全部')} SelectProps={{ native: true }}>
                <option value="全部">全部级别</option>
                {RECHECK_SEVERITIES.map((option) => <option key={option} value={option}>{option}</option>)}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4} md={3}>
              <TextField fullWidth size="small" label="检验员" value={inspector} onChange={(event) => setInspector(event.target.value)} placeholder="登记检验员姓名" inputProps={{ 'data-testid': 'field-inspector' }} />
            </Grid>
            <Grid item xs={6} md={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">工单数</Typography>
                <Typography variant="h5" data-testid="count-recheck">{filteredOrders.length}</Typography>
              </Box>
            </Grid>
            <Grid item xs={6} md={2}>
              <Button fullWidth variant="outlined" onClick={() => { setStatusFilter('全部'); setSeverityFilter('全部') }}>重置</Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <TableContainer component={Card}>
        <Table sx={{ minWidth: 1080 }}>
          <TableHead>
            <TableRow>
              <TableCell>工单 / 开单时间</TableCell>
              <TableCell>工序与纸帘</TableCell>
              <TableCell>命中项</TableCell>
              <TableCell>级别</TableCell>
              <TableCell>状态</TableCell>
              <TableCell align="right">复检登记 / 结果</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredOrders.map((order) => {
              const run = runById.get(order.runId)
              const mould = mouldById.get(order.mouldId)
              const sample = order.sampleId === undefined ? undefined : sampleById.get(order.sampleId)
              const standardGap = mould?.stripeGap ?? order.standardGap
              const isPending = order.status === '待检'
              const draftGap = order.id === undefined ? order.originGap : draftGaps[order.id] ?? order.originGap
              const draftDeviation = calculateDeviation(draftGap, standardGap)
              const draftExceeded = isGapOutOfTolerance(draftDeviation)
              return (
                <TableRow key={order.id ?? order.orderNo} data-testid="row-recheck" hover sx={{ bgcolor: isPending ? '#fff7d9' : undefined }}>
                  <TableCell>
                    <Typography sx={{ fontWeight: 750 }}>{order.orderNo}</Typography>
                    <Typography variant="caption" color="text.secondary">{formatMoment(order.createdAt)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{run ? `${run.runNo} · ${run.runDate}` : '工序待关联'}</Typography>
                    <Typography variant="caption" color="text.secondary">{mould?.mouldNo ?? '纸帘待关联'} · 标准 {standardGap.toFixed(2)} mm</Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                      {order.gapHit && (
                        <Chip size="small" color="warning" label={`间距超差 ${order.originDeviation > 0 ? '+' : ''}${order.originDeviation.toFixed(2)} mm`} />
                      )}
                      {order.evennessHit && (
                        <Chip size="small" color="warning" variant="outlined" label={sample ? `匀度${sample.evenness} · ${sample.sampleNo}` : '匀度不匀'} />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={order.severity === '严重' ? 'error' : 'default'} label={order.severity} />
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={order.status === '待检' ? 'warning' : order.status === '已通过' ? 'success' : 'error'} label={order.status} />
                  </TableCell>
                  <TableCell align="right" sx={{ minWidth: 300 }}>
                    {isPending ? (
                      <Stack direction="row" spacing={1.5} alignItems="flex-start" justifyContent="flex-end">
                        <Box sx={{ width: 220 }}>
                          <RulerInput
                            label="复检间距"
                            value={draftGap}
                            onChange={(value) => {
                              if (order.id !== undefined) setDraftGaps((current) => ({ ...current, [order.id as number]: value }))
                            }}
                            min={0.1}
                            max={5}
                            step={0.01}
                            testId={order.id === undefined ? undefined : `row-recheckGap-${order.id}`}
                            helperText={<Typography component="span" variant="caption" color={draftExceeded ? 'warning.dark' : 'text.secondary'}>{getGapConclusion(draftDeviation)}（{draftDeviation > 0 ? '+' : ''}{draftDeviation.toFixed(2)} mm）</Typography>}
                            compact
                          />
                        </Box>
                        <Button
                          size="small"
                          variant="contained"
                          color={draftExceeded ? 'warning' : 'primary'}
                          disabled={order.id === undefined || !inspector.trim() || submittingId === order.id || !(draftGap > 0)}
                          onClick={() => void handleSubmit(order)}
                          data-testid={order.id === undefined ? undefined : `submit-recheck-${order.id}`}
                          sx={{ mt: 2.5, whiteSpace: 'nowrap' }}
                        >
                          提交复检
                        </Button>
                      </Stack>
                    ) : (
                      <Box>
                        <Typography variant="body2">
                          复检 {order.recheckGap?.toFixed(2)} mm（{order.recheckDeviation !== undefined && order.recheckDeviation > 0 ? '+' : ''}{order.recheckDeviation?.toFixed(2)} mm）· {order.inspector}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatMoment(order.closedAt)} 关闭，工单已离开待检，不再受理复检
                        </Typography>
                      </Box>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {filteredOrders.length === 0 && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5 }}>没有符合筛选条件的复检工单</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Snackbar open={Boolean(message)} autoHideDuration={2600} onClose={() => setMessage('')} message={message} />
    </Stack>
  )
}
