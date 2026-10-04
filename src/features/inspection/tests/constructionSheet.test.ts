import { describe, expect, it } from 'vitest'
import { createPlan, type WorkspacePlan } from '../../../shared/models'
import { analyzeLayout } from '../../../shared/layoutRules'
import { buildConstructionSheet } from '../constructionSheet'

describe('construction sheet', () => {
  it('lists every item with name, size and coordinates matching the plan', () => {
    const plan = createPlan('打印测试', true)
    const sheet = buildConstructionSheet(plan)
    expect(sheet.planName).toBe(plan.name)
    expect(sheet.deskWidthMm).toBe(plan.deskWidthMm)
    expect(sheet.rows).toHaveLength(plan.items.length)
    plan.items.forEach((item, index) => {
      const row = sheet.rows[index]
      expect(row.widthMm).toBe(item.widthMm)
      expect(row.heightMm).toBe(item.heightMm)
      expect(row.x).toBe(Math.round(item.x))
      expect(row.y).toBe(Math.round(item.y))
    })
  })

  it('reflects the current issue state of the plan', () => {
    const plan = createPlan('问题方案', true)
    const broken: WorkspacePlan = {
      ...plan,
      items: plan.items.map((item) => ({ ...item, x: -100 })),
    }
    const analysis = analyzeLayout(broken)
    expect(analysis.outOfBoundsIds.length).toBeGreaterThan(0)
    const sheet = buildConstructionSheet(broken)
    expect(sheet.issueSummary.some((issue) => issue.includes('超出桌面边界'))).toBe(true)
    expect(sheet.rows.every((row) => row.issues.includes('越界'))).toBe(true)
  })

  it('reports a passing summary when the layout is clear', () => {
    const sheet = buildConstructionSheet(createPlan('健康方案', true))
    expect(sheet.issueSummary).toEqual(['布局检查通过，无重叠或越界'])
    expect(sheet.rows.every((row) => row.issues.length === 0)).toBe(true)
  })
})
