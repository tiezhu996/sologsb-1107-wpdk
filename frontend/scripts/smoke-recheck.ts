/* eslint-disable no-console */
// 冒烟测试：复检工单自动开单、去重、定级与办结流转（不入库，仅 Node + fake-indexeddb 验证）
import 'fake-indexeddb/auto'
import { db } from '../src/utils/db'
import { useRecheckStore } from '../src/stores/recheckStore'
import { useRunStore } from '../src/stores/runStore'
import { useMouldStore } from '../src/stores/mouldStore'

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`✗ ${message}`)
    process.exitCode = 1
  } else {
    console.log(`✓ ${message}`)
  }
}

async function main() {
  // 种子数据由 populate 写入：工序2/3 仅匀度命中（一般），工序4 双命中（严重），工序7 仅偏差命中（一般）
  await useRecheckStore.getState().syncOrders()
  let orders = useRecheckStore.getState().orders
  assert(orders.length === 4, `首次扫描自动开 4 条待检工单（实际 ${orders.length}）`)
  assert(orders.every((o) => o.state === '待检'), '新工单全部为待检')
  const severe = orders.find((o) => o.runId === 4)
  assert(severe?.grade === '严重' && severe.gapIssue && severe.evennessIssue, '工序4 双命中记为严重')
  assert(orders.find((o) => o.runId === 2)?.grade === '一般', '工序2 仅匀度命中记为一般')
  assert(orders.find((o) => o.runId === 7)?.grade === '一般', '工序7 仅偏差命中记为一般')

  // 重复扫描不再开单
  await useRecheckStore.getState().syncOrders()
  orders = useRecheckStore.getState().orders
  assert(orders.length === 4, `重复扫描不重复开单（实际 ${orders.length}）`)

  // 已通过：复检间距回到允许范围，实测值写回工序
  const order4 = orders.find((o) => o.runId === 4)!
  const passResult = await useRecheckStore.getState().registerRecheck(order4.id!, 1.12, '测试员甲')
  assert(passResult === '已通过', '工序4 复检 1.12mm（偏差 +0.02）置为已通过')
  const run4 = await db.sheetRuns.get(4)
  assert(run4?.measuredGap === 1.12 && run4.deviation === 0.02, `实测值写回工序（measuredGap=${run4?.measuredGap}, deviation=${run4?.deviation}）`)

  // 未通过：仍超差，纸帘改记待修补
  const order7 = orders.find((o) => o.runId === 7)!
  const failResult = await useRecheckStore.getState().registerRecheck(order7.id!, 1.5, '测试员乙')
  assert(failResult === '未通过', '工序7 复检 1.5mm（偏差 +0.25）置为未通过')
  const mould4 = await db.moulds.get(4)
  assert(mould4?.state === '待修补', `纸帘 DL-04 改记待修补（实际 ${mould4?.state}）`)

  // 离开待检后不再受理复检
  const again = await useRecheckStore.getState().registerRecheck(order4.id!, 1.1, '测试员丙')
  assert(again === null, '已办结工单拒绝再次复检')

  // 已办结的工序不再自动开新工单
  await useRecheckStore.getState().syncOrders()
  orders = useRecheckStore.getState().orders
  assert(orders.length === 4, `办结后扫描不重新开单（实际 ${orders.length}）`)

  // 新增超差工序自动开单
  await useRunStore.getState().addRun({
    runNo: 'CB-260709', mouldId: 1, batchId: 1, runDate: '2026-09-26', operator: '测试员',
    stripeDirection: '竖帘纹', dipCount: 2, stackHeight: 40, dryMethod: '火墙', grammage: 33,
    measuredGap: 1.5, deviation: 0.4,
  })
  await useRecheckStore.getState().syncOrders()
  orders = useRecheckStore.getState().orders
  const newOrder = orders.find((o) => o.orderNo === 'FJ-CB-260709')
  assert(orders.length === 5 && newOrder?.state === '待检' && newOrder.grade === '一般', '新增超差工序自动开待检工单')

  // 工作台统计口径
  const pending = orders.filter((o) => o.state === '待检').length
  const failed = orders.filter((o) => o.state === '未通过').length
  assert(pending === 3 && failed === 1, `工作台统计：待检 ${pending} 条、未通过 ${failed} 条（预期 3/1）`)

  console.log(process.exitCode ? '\n存在失败用例' : '\n全部用例通过')
  process.exit(process.exitCode ?? 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
