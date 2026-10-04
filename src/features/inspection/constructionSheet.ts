import { analyzeLayout } from '../../shared/layoutRules'
import { getDeviceDefinition, type WorkspacePlan } from '../../shared/models'

export interface ConstructionSheetRow {
  id: string
  label: string
  shortLabel: string
  widthMm: number
  heightMm: number
  x: number
  y: number
  rotation: number
  issues: string[]
}

export interface ConstructionSheet {
  planName: string
  deskWidthMm: number
  deskHeightMm: number
  generatedAt: string
  coveragePercent: number
  rows: ConstructionSheetRow[]
  issueSummary: string[]
}

/** 从方案当前状态构建施工清单，打印内容始终与编辑状态一致。 */
export function buildConstructionSheet(plan: WorkspacePlan, generatedAt = new Date().toISOString()): ConstructionSheet {
  const analysis = analyzeLayout(plan)
  const rows = plan.items.map((item) => {
    const definition = getDeviceDefinition(item.type)
    const issues: string[] = []
    if (analysis.overlapIds.includes(item.id)) issues.push('重叠')
    if (analysis.outOfBoundsIds.includes(item.id)) issues.push('越界')
    return {
      id: item.id,
      label: definition.label,
      shortLabel: definition.shortLabel,
      widthMm: item.widthMm,
      heightMm: item.heightMm,
      x: Math.round(item.x),
      y: Math.round(item.y),
      rotation: Math.round(item.rotation),
      issues,
    }
  })
  const issueSummary: string[] = []
  if (analysis.overlapIds.length > 0) issueSummary.push(`${analysis.overlapIds.length} 件设备与其他设备重叠`)
  if (analysis.outOfBoundsIds.length > 0) issueSummary.push(`${analysis.outOfBoundsIds.length} 件设备超出桌面边界`)
  if (issueSummary.length === 0) issueSummary.push('布局检查通过，无重叠或越界')
  return {
    planName: plan.name,
    deskWidthMm: plan.deskWidthMm,
    deskHeightMm: plan.deskHeightMm,
    generatedAt,
    coveragePercent: analysis.coveragePercent,
    rows,
    issueSummary,
  }
}
