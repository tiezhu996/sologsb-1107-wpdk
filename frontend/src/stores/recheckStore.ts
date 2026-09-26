import { create } from 'zustand'
import type { RecheckGrade, RecheckOrder, RecheckState } from '../types/recheck-order'
import { db, plain } from '../utils/db'
import { calculateDeviation, isGapOutOfTolerance } from '../utils/stripe'
import { useMouldStore } from './mouldStore'
import { useRunStore } from './runStore'

interface RecheckStore {
  orders: RecheckOrder[]
  isLoading: boolean
  loaded: boolean
  error: string | null
  loadOrders: () => Promise<void>
  syncOrders: () => Promise<void>
  registerRecheck: (id: number, recheckGap: number, inspector: string) => Promise<RecheckState | null>
}

function sortOrders(orders: RecheckOrder[]): RecheckOrder[] {
  return [...orders].sort((a, b) => {
    if (a.state === '待检' && b.state !== '待检') return -1
    if (a.state !== '待检' && b.state === '待检') return 1
    return b.openedAt.localeCompare(a.openedAt)
  })
}

export const useRecheckStore = create<RecheckStore>((set, get) => ({
  orders: [],
  isLoading: false,
  loaded: false,
  error: null,
  loadOrders: async () => {
    if (get().loaded) return
    set({ isLoading: true, error: null })
    try {
      const orders = await db.recheckOrders.toArray()
      set({ orders: sortOrders(orders), isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '复检工单读取失败，请检查浏览器存储权限' })
    }
  },
  syncOrders: async () => {
    set({ error: null })
    try {
      const [runs, samples, moulds, existing] = await Promise.all([
        db.sheetRuns.toArray(),
        db.paperSamples.toArray(),
        db.moulds.toArray(),
        db.recheckOrders.toArray(),
      ])
      const mouldById = new Map(moulds.map((mould) => [mould.id, mould]))
      const orderByRun = new Map(existing.map((order) => [order.runId, order]))
      const toCreate: RecheckOrder[] = []
      const toRefresh: { id: number; gapIssue: boolean; evennessIssue: boolean; grade: RecheckGrade }[] = []
      for (const run of runs) {
        if (run.id === undefined) continue
        const mould = mouldById.get(run.mouldId)
        if (!mould) continue
        const gapIssue = isGapOutOfTolerance(calculateDeviation(run.measuredGap, mould.stripeGap))
        const evennessIssue = samples.some((sample) => sample.runId === run.id && sample.evenness !== '均匀')
        if (!gapIssue && !evennessIssue) continue
        const grade: RecheckGrade = gapIssue && evennessIssue ? '严重' : '一般'
        const prior = orderByRun.get(run.id)
        if (!prior) {
          toCreate.push({
            orderNo: `FJ-${run.runNo}`,
            runId: run.id,
            mouldId: run.mouldId,
            gapIssue,
            evennessIssue,
            grade,
            state: '待检',
            openedAt: new Date().toISOString(),
            schemaRev: 2,
          })
        } else if (
          prior.id !== undefined &&
          prior.state === '待检' &&
          (prior.gapIssue !== gapIssue || prior.evennessIssue !== evennessIssue || prior.grade !== grade)
        ) {
          toRefresh.push({ id: prior.id, gapIssue, evennessIssue, grade })
        }
      }
      if (toCreate.length > 0) await db.recheckOrders.bulkAdd(plain(toCreate))
      for (const refresh of toRefresh) {
        const { id, ...changes } = refresh
        await db.recheckOrders.update(id, changes)
      }
      const orders = await db.recheckOrders.toArray()
      set({ orders: sortOrders(orders), isLoading: false, loaded: true })
    } catch {
      set({ isLoading: false, error: '复检工单同步失败，请检查浏览器存储权限' })
    }
  },
  registerRecheck: async (id, recheckGap, inspector) => {
    set({ error: null })
    try {
      const order = await db.recheckOrders.get(id)
      if (!order) {
        set({ error: '复检工单不存在，请刷新后重试' })
        return null
      }
      if (order.state !== '待检') {
        set({ error: '该工单已离开待检，不再受理新的复检' })
        return null
      }
      const [run, mould] = await Promise.all([db.sheetRuns.get(order.runId), db.moulds.get(order.mouldId)])
      if (!run || run.id === undefined || !mould || mould.id === undefined) {
        set({ error: '工单关联的工序或纸帘缺失，无法复检' })
        return null
      }
      const deviation = calculateDeviation(recheckGap, mould.stripeGap)
      const passed = !isGapOutOfTolerance(deviation)
      const nextState: RecheckState = passed ? '已通过' : '未通过'
      const closedAt = new Date().toISOString()
      await db.recheckOrders.update(id, {
        state: nextState,
        inspector: inspector.trim(),
        recheckGap,
        recheckDeviation: deviation,
        closedAt,
        schemaRev: 2,
      })
      if (passed) {
        await useRunStore.getState().updateMeasuredGap(run.id, recheckGap, mould.stripeGap)
      } else {
        await useMouldStore.getState().setMouldState(mould.id, '待修补')
      }
      set((state) => ({
        orders: sortOrders(
          state.orders.map((item) =>
            item.id === id
              ? { ...item, state: nextState, inspector: inspector.trim(), recheckGap, recheckDeviation: deviation, closedAt, schemaRev: 2 }
              : item,
          ),
        ),
      }))
      return nextState
    } catch {
      set({ error: '复检登记失败，请稍后重试' })
      return null
    }
  },
}))
