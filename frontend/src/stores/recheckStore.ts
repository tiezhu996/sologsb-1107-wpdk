import { create } from 'zustand'
import type { RecheckOrder, RecheckStatus } from '../types/recheck-order'
import { db, plain } from '../utils/db'
import { calculateDeviation, isGapOutOfTolerance } from '../utils/stripe'
import { useMouldStore } from './mouldStore'
import { useRunStore } from './runStore'

interface RecheckStore {
  orders: RecheckOrder[]
  isLoading: boolean
  error: string | null
  syncOrders: () => Promise<void>
  submitRecheck: (orderId: number, recheckGap: number, inspector: string) => Promise<boolean>
}

let syncing = false

async function fetchOrders(): Promise<RecheckOrder[]> {
  const orders = await db.recheckOrders.toArray()
  return orders.sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
}

export const useRecheckStore = create<RecheckStore>((set, get) => ({
  orders: [],
  isLoading: false,
  error: null,
  syncOrders: async () => {
    if (syncing) return
    syncing = true
    set({ isLoading: true, error: null })
    try {
      const [runs, samples, moulds] = await Promise.all([
        db.sheetRuns.toArray(),
        db.paperSamples.toArray(),
        db.moulds.toArray(),
      ])
      const mouldById = new Map(moulds.map((mould) => [mould.id, mould]))
      const createdAt = new Date().toISOString()
      const candidates: RecheckOrder[] = []
      for (const run of runs) {
        if (run.id === undefined) continue
        const mould = mouldById.get(run.mouldId)
        const standardGap = mould?.stripeGap ?? run.measuredGap - run.deviation
        const deviation = calculateDeviation(run.measuredGap, standardGap)
        const gapHit = isGapOutOfTolerance(deviation)
        const unevenSample = samples.find((sample) => sample.runId === run.id && sample.evenness !== '均匀')
        const evennessHit = unevenSample !== undefined
        if (!gapHit && !evennessHit) continue
        candidates.push({
          orderNo: `FJ-${run.runNo}`,
          runId: run.id,
          mouldId: run.mouldId,
          sampleId: unevenSample?.id,
          severity: gapHit && evennessHit ? '严重' : '一般',
          gapHit,
          evennessHit,
          standardGap,
          originGap: run.measuredGap,
          originDeviation: deviation,
          status: '待检',
          createdAt,
          schemaRev: 3,
        })
      }
      // 同一槽工序只开立一张工单：已开单（含已关闭）的记录不再重复开
      await db.transaction('rw', db.recheckOrders, async () => {
        const orderedRunIds = new Set((await db.recheckOrders.toArray()).map((order) => order.runId))
        const fresh = candidates.filter((order) => !orderedRunIds.has(order.runId))
        if (fresh.length > 0) await db.recheckOrders.bulkAdd(plain(fresh))
      })
      set({ orders: await fetchOrders(), isLoading: false })
    } catch {
      set({ isLoading: false, error: '复检工单同步失败，请检查浏览器存储权限' })
    } finally {
      syncing = false
    }
  },
  submitRecheck: async (orderId, recheckGap, inspector) => {
    const order = get().orders.find((item) => item.id === orderId) ?? (await db.recheckOrders.get(orderId))
    if (!order || order.id === undefined) {
      set({ error: '复检工单不存在，请刷新后重试' })
      return false
    }
    if (order.status !== '待检') {
      set({ error: `工单 ${order.orderNo} 已离开待检，不再受理新的复检` })
      return false
    }
    if (!(recheckGap > 0) || !inspector.trim()) {
      set({ error: '请先填写检验员与大于 0 的复检间距' })
      return false
    }
    const mould = await db.moulds.get(order.mouldId)
    const standardGap = mould?.stripeGap ?? order.standardGap
    const recheckDeviation = calculateDeviation(recheckGap, standardGap)
    const passed = !isGapOutOfTolerance(recheckDeviation)
    const status: RecheckStatus = passed ? '已通过' : '未通过'
    const changes = {
      status,
      recheckGap,
      recheckDeviation,
      inspector: inspector.trim(),
      closedAt: new Date().toISOString(),
      schemaRev: 3,
    }
    try {
      await db.recheckOrders.update(order.id, changes)
      if (passed) {
        // 回到允许范围：实测值写回抄纸工序
        await useRunStore.getState().updateMeasuredGap(order.runId, recheckGap, standardGap)
      } else {
        // 仍然超差：纸帘改记待修补
        await useMouldStore.getState().setMouldState(order.mouldId, '待修补')
      }
      set((state) => ({
        orders: state.orders.map((item) => (item.id === order.id ? { ...item, ...changes } : item)),
        error: null,
      }))
      return true
    } catch {
      set({ error: '复检登记失败，请稍后重试' })
      return false
    }
  },
}))
