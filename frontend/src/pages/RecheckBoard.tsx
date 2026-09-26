import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Chip, Grid, Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { RulerInput } from '../components/common/RulerInput'
import { StatBadge } from '../components/common/StatBadge'
import { useMouldStore } from '../stores/mouldStore'
import { useRecheckStore } from '../stores/recheckStore'
import { useRunStore } from '../stores/runStore'
import { useSampleStore } from '../stores/sampleStore'
import { RECHECK_STATES, type RecheckState } from '../types/recheck-order'
import { calculateDeviation, isGapOutOfTolerance } from '../utils/stripe'

const stateColors: Record<RecheckState, 'warning' | 'success' | 'error'> = {
  待检: 'warning',
  已通过: 'success',
  未通过: 'error',
}

export default function RecheckBoard() {
  const orders = useRecheckStore((state) => state.orders)
  const recheckError = useRecheckStore((state) => state.error)
  const syncOrders = useRecheckStore((state) => state.syncOrders)
  const registerRecheck = useRecheckStore((state) => state.registerRecheck)
  const runs = useRunStore((state) => state.sheetRuns)
  const runError = useRunStore((state) => state.error)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const moulds = useMouldStore((state) => state.moulds)
  const mouldError = useMouldStore((state) => state.error)
  const loadMoulds = useMouldStore((state) => state.loadMoulds)
  const samples = useSampleStore((state) => state.paperSamples)
  const sampleError = useSampleStore((state) => state.error)
  const loadSamples = useSampleStore((state) => state.loadSamples)
  const [stateFilter, setStateFilter] = useState<RecheckState | '全部'>('全部')
  const [inspector, setInspector] = useState('罗青禾')
  const [draftGaps, setDraftGaps] = useState<Record<number, number>>({})
  const [submittingId, setSubmittingId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void loadRuns()
    void loadMoulds()
    void loadSamples()
    void syncOrders()
  }, [loadMoulds, loadRuns, loadSamples, syncOrders])

  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs])
  const mouldById = useMemo(() => new Map(moulds.map((mould) => [mould.id, mould])), [moulds])
  const samplesByRun = useMemo(() => {
    const grouped = new Map<number, string[]>()
    for (const sample of samples) {
      if (sample.evenness === '均匀') continue
      grouped.set(sample.runId, [...(grouped.get(sample.runId) ?? []), `${sample.sampleNo}·${sample.evenness}`])
    }
    return grouped
  }, [samples])
  const filteredOrders = useMemo(
    () => orders.filter((order) => stateFilter === '全部' || order.state === stateFilter),
    [orders, stateFilter],
  )
  const pendingCount = orders.filter((order) => order.state === '待检').length
  const failedCount = orders.filter((order) => order.state === '未通过').length
  const passedCount = orders.filter((order) => order.state === '已通过').length

  const handleRegister = async (orderId: number, orderNo: string, fallbackGap: number) => {
    const recheckGap = draftGaps[orderId] ?? fallbackGap
    if (!inspector.trim() || recheckGap <= 0) return
    setSubmittingId(orderId)
    const result = await registerRecheck(orderId, recheckGap, inspector)
    setSubmittingId(null)
    if (result === '已通过') {
      setNotice(`工单 ${orderNo} 已通过，实测间距已写回工序`)
    } else if (result === '未通过') {
      setNotice(`工单 ${orderNo} 未通过，纸帘已改记待修补`)
    }
  }

  const error = recheckError ?? runError ?? mouldError ?? sampleError

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: { xs: 'flex-start', md: 'center' }, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography component="h1" variant="h3" color="#344a34">复检工单台</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>帘纹偏差超差或匀度未达“均匀”的工序自动开单，检验员在此登记复检间距并办结。</Typography>
        </Box>
        <Button variant="outlined" size="large" onClick={() => void syncOrders()} data-testid="resync-recheck">重新扫描</Button>
      </Box>

      {error && <Alert severity="warning">{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <StatBadge label="待检工单" value={pendingCount} detail="等待检验员登记复检" tone={pendingCount ? 'warning' : 'neutral'} />
        <StatBadge label="未通过工单" value={failedCount} detail="纸帘已改记待修补" tone={failedCount ? 'warning' : 'neutral'} />
        <StatBadge label="已通过工单" value={passedCount} detail="实测值已写回工序" tone="bamboo" />
      </Box>

      <Card>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Grid container spacing={1.5} alignItems="center">
            <Grid item xs={12} sm={5} md={3}>
              <TextField select fullWidth size="small" label="工单状态" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as RecheckState | '全部')} SelectProps={{ native: true }}>
                <option value="全部">全部状态</option>
                {RECHECK_STATES.map((option) => <option key={option} value={option}>{option}</option>)}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={7} md={4}>
              <TextField fullWidth size="small" label="检验员" value={inspector} onChange={(event) => setInspector(event.target.value)} helperText="登记复检时署名为该检验员" inputProps={{ 'data-testid': 'field-inspector' }} />
            </Grid>
            <Grid item xs={6} md={2}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">当前工单</Typography>
                <Typography variant="h5" data-testid="count-recheck">{filteredOrders.length}</Typography>
              </Box>
            </Grid>
            <Grid item xs={6} md={3}><Button fullWidth variant="outlined" onClick={() => setStateFilter('全部')}>重置筛选</Button></Grid>
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
              <TableCell>等级</TableCell>
              <TableCell>状态</TableCell>
              <TableCell>复检登记 / 办结结果</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredOrders.map((order) => {
              const run = runById.get(order.runId)
              const mould = mouldById.get(order.mouldId)
              const standardGap = mould?.stripeGap ?? 0
              const isPending = order.state === '待检'
              const draftGap = order.id === undefined ? (run?.measuredGap ?? standardGap) : draftGaps[order.id] ?? run?.measuredGap ?? standardGap
              const draftDeviation = calculateDeviation(draftGap, standardGap || draftGap)
              const draftExceeded = isGapOutOfTolerance(draftDeviation)
              const evennessNotes = samplesByRun.get(order.runId) ?? []
              return (
                <TableRow key={order.id ?? order.orderNo} data-testid="row-recheck" hover sx={{ bgcolor: isPending && order.grade === '严重' ? '#fff7d9' : undefined }}>
                  <TableCell>
                    <Typography sx={{ fontWeight: 750 }}>{order.orderNo}</Typography>
                    <Typography variant="caption" color="text.secondary">{order.openedAt.slice(0, 16).replace('T', ' ')} 开单</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{run ? `${run.runNo} · ${run.runDate}` : '工序缺失'}</Typography>
                    <Typography variant="caption" color="text.secondary">{mould ? `${mould.mouldNo} · 标准 ${mould.stripeGap.toFixed(2)} mm` : '纸帘缺失'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {order.gapIssue && <Chip size="small" color="warning" variant="outlined" label={`帘纹偏差 ${run && run.deviation > 0 ? '+' : ''}${run?.deviation.toFixed(2) ?? '--'} mm`} />}
                      {order.evennessIssue && <Chip size="small" color="warning" variant="outlined" label={evennessNotes.length ? `匀度 ${evennessNotes.join('、')}` : '匀度未达均匀'} />}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={order.grade === '严重' ? 'error' : 'default'} label={order.grade} />
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={stateColors[order.state]} label={order.state} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 300 }}>
                    {isPending ? (
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                        <RulerInput
                          label="复检间距"
                          value={draftGap}
                          onChange={(value) => {
                            if (order.id !== undefined) setDraftGaps((current) => ({ ...current, [order.id as number]: value }))
                          }}
                          min={0.1}
                          max={5}
                          step={0.01}
                          testId={order.id === undefined ? undefined : `field-recheckGap-${order.id}`}
                          helperText={<Typography component="span" variant="caption" color={draftExceeded ? 'warning.dark' : 'text.secondary'}>按标准 {standardGap.toFixed(2)} mm 重算：{draftDeviation > 0 ? '+' : ''}{draftDeviation.toFixed(2)} mm{draftExceeded ? '，仍超差' : '，回到允许范围'}</Typography>}
                          compact
                        />
                        <Button
                          size="small"
                          variant="contained"
                          color={draftExceeded ? 'warning' : 'primary'}
                          disabled={order.id === undefined || submittingId === order.id || !inspector.trim() || draftGap <= 0}
                          onClick={() => {
                            if (order.id !== undefined) void handleRegister(order.id, order.orderNo, run?.measuredGap ?? standardGap)
                          }}
                          data-testid={order.id === undefined ? undefined : `submit-recheck-${order.id}`}
                          sx={{ mt: 2.5, whiteSpace: 'nowrap' }}
                        >
                          登记复检
                        </Button>
                      </Box>
                    ) : (
                      <>
                        <Typography variant="body2">
                          复检 {order.recheckGap?.toFixed(2) ?? '--'} mm · 偏差 {order.recheckDeviation !== undefined && order.recheckDeviation > 0 ? '+' : ''}{order.recheckDeviation?.toFixed(2) ?? '--'} mm
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {order.inspector || '检验员未署名'} · {order.closedAt ? `${order.closedAt.slice(0, 16).replace('T', ' ')} 办结` : '办结时间待补'}
                        </Typography>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {filteredOrders.length === 0 && (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5 }}>当前没有符合条件的复检工单</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Snackbar open={Boolean(notice)} autoHideDuration={3200} onClose={() => setNotice('')} message={notice} />
    </Stack>
  )
}
