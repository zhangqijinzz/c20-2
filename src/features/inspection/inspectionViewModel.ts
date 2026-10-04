import { analyzeLayout } from '../../shared/layoutRules'
import { getDeviceDefinition, type DeskItem, type LayoutAnalysis, type WorkspacePlan } from '../../shared/models'

export interface InspectionState {
  analysis: LayoutAnalysis
  issueIds: string[]
  issueCount: number
}

export function inspectPlan(plan: WorkspacePlan): InspectionState {
  const analysis = analyzeLayout(plan)
  const issueIds = [...new Set([...analysis.overlapIds, ...analysis.outOfBoundsIds])]
  return { analysis, issueIds, issueCount: issueIds.length }
}

export function describeItemIssue(item: DeskItem, analysis: LayoutAnalysis): string {
  const overlapping = analysis.overlapIds.includes(item.id)
  const outOfBounds = analysis.outOfBoundsIds.includes(item.id)
  if (overlapping && outOfBounds) return '与其他设备重叠，且超出桌面边界'
  if (overlapping) return '与其他设备发生重叠'
  if (outOfBounds) return '超出桌面边界'
  return ''
}

export interface IssueReportEntry {
  item: DeskItem
  label: string
  detail: string
}

export interface IssueReport {
  entries: IssueReportEntry[]
  hasIssues: boolean
}

// 按画布上的设备顺序生成问题摘要，保证清单打印出来和编辑时看到的状态一一对应。
export function buildIssueReport(plan: WorkspacePlan, analysis: LayoutAnalysis): IssueReport {
  const entries = plan.items
    .filter((item) => analysis.overlapIds.includes(item.id) || analysis.outOfBoundsIds.includes(item.id))
    .map((item) => ({
      item,
      label: getDeviceDefinition(item.type).label,
      detail: describeItemIssue(item, analysis),
    }))
  return { entries, hasIssues: entries.length > 0 }
}
