import { describe, expect, it } from 'vitest'
import { createItem, createPlan } from '../../../shared/models'
import { buildIssueReport, describeItemIssue, inspectPlan } from '../inspectionViewModel'

describe('inspection issue report', () => {
  it('describes each issue kind for the build sheet', () => {
    const plan = createPlan('检查', false)
    const overlapA = { ...createItem('monitor'), x: 0, y: 0, widthMm: 400, heightMm: 200 }
    const overlapB = { ...createItem('keyboard'), x: 100, y: 80, widthMm: 400, heightMm: 200 }
    const outside = { ...createItem('lamp'), x: 5000, y: 5000 }
    const laidOut: typeof plan = { ...plan, items: [overlapA, overlapB, outside] }
    const { analysis } = inspectPlan(laidOut)

    expect(describeItemIssue(overlapA, analysis)).toContain('重叠')
    expect(describeItemIssue(outside, analysis)).toContain('超出桌面边界')

    const report = buildIssueReport(laidOut, analysis)
    expect(report.hasIssues).toBe(true)
    expect(report.entries).toHaveLength(3)
    // 顺序与画布一致，打印结果才能和编辑状态对上
    expect(report.entries.map((entry) => entry.item.id)).toEqual([overlapA.id, overlapB.id, outside.id])
    expect(report.entries[0].label).toBe('显示器')
  })

  it('reports a clear plan as buildable', () => {
    const plan = createPlan('检查', true)
    const { analysis } = inspectPlan(plan)
    const report = buildIssueReport(plan, analysis)
    expect(report.hasIssues).toBe(false)
    expect(report.entries).toHaveLength(0)
  })
})
