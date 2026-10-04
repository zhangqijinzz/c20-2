import { createId, DEVICE_DEFINITIONS, type DeskItem, type WorkspaceDocument, type WorkspacePlan } from '../../shared/models'

export const PLAN_FILE_TYPE = 'focusdesk.plan'
export const PLAN_FILE_VERSION = 1

export interface PlanFileEnvelope {
  fileType: typeof PLAN_FILE_TYPE
  formatVersion: number
  exportedAt: string
  plan: WorkspacePlan
}

export type ConflictResolution = 'merge' | 'overwrite' | 'copy'
export type ImportResolution = ConflictResolution | 'auto'

export interface ImportConflict {
  kind: 'identical' | 'content' | 'name'
  existingPlanId: string
  existingPlanName: string
}

export interface PendingImport {
  plan: WorkspacePlan
  conflict: ImportConflict
}

export type ParsePlanFileResult = { ok: true; plan: WorkspacePlan } | { ok: false; error: string }

const DEVICE_TYPES = new Set(DEVICE_DEFINITIONS.map((device) => device.type))

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isDeskItem(value: unknown): value is DeskItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<DeskItem>
  return (
    typeof item.id === 'string' &&
    typeof item.type === 'string' &&
    DEVICE_TYPES.has(item.type as DeskItem['type']) &&
    isFiniteNumber(item.widthMm) &&
    isFiniteNumber(item.heightMm) &&
    isFiniteNumber(item.x) &&
    isFiniteNumber(item.y) &&
    isFiniteNumber(item.rotation)
  )
}

function isWorkspacePlan(value: unknown): value is WorkspacePlan {
  if (!value || typeof value !== 'object') return false
  const plan = value as Partial<WorkspacePlan>
  return (
    typeof plan.id === 'string' &&
    typeof plan.name === 'string' &&
    isFiniteNumber(plan.deskWidthMm) &&
    isFiniteNumber(plan.deskHeightMm) &&
    Array.isArray(plan.items) &&
    plan.items.every(isDeskItem) &&
    typeof plan.updatedAt === 'string'
  )
}

export function serializePlan(plan: WorkspacePlan, exportedAt = new Date().toISOString()): string {
  const envelope: PlanFileEnvelope = { fileType: PLAN_FILE_TYPE, formatVersion: PLAN_FILE_VERSION, exportedAt, plan }
  return JSON.stringify(envelope, null, 2)
}

/**
 * 解析方案文件。版本高于当前支持的明确拒绝；数据不完整整体拒绝，
 * 绝不会返回半个方案。
 */
export function parsePlanFile(raw: string): ParsePlanFileResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: '文件不是有效的 JSON，无法导入' }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: '文件内容不是 FocusDesk 方案' }
  const envelope = parsed as Partial<PlanFileEnvelope>
  if (envelope.fileType !== PLAN_FILE_TYPE) return { ok: false, error: '这不是 FocusDesk 方案文件' }
  const version = envelope.formatVersion
  if (typeof version !== 'number' || !Number.isInteger(version)) return { ok: false, error: '方案文件缺少有效的版本号' }
  if (version > PLAN_FILE_VERSION) {
    return { ok: false, error: `文件由更新的版本（v${version}）导出，当前最高支持 v${PLAN_FILE_VERSION}，请升级后再导入` }
  }
  if (version < 1) return { ok: false, error: `文件版本 v${version} 过旧，无法识别` }
  if (!isWorkspacePlan(envelope.plan)) return { ok: false, error: '方案数据不完整或已损坏，未导入任何内容' }
  return { ok: true, plan: envelope.plan }
}

function itemsEqual(first: DeskItem, second: DeskItem): boolean {
  return (
    first.id === second.id &&
    first.type === second.type &&
    first.widthMm === second.widthMm &&
    first.heightMm === second.heightMm &&
    first.x === second.x &&
    first.y === second.y &&
    first.rotation === second.rotation
  )
}

/** 比较两个方案的实际内容（忽略 updatedAt 时间戳）。 */
export function plansEquivalent(first: WorkspacePlan, second: WorkspacePlan): boolean {
  return (
    first.name === second.name &&
    first.deskWidthMm === second.deskWidthMm &&
    first.deskHeightMm === second.deskHeightMm &&
    first.items.length === second.items.length &&
    first.items.every((item, index) => itemsEqual(item, second.items[index]))
  )
}

export function detectConflict(plan: WorkspacePlan, document: WorkspaceDocument): ImportConflict | null {
  const sameId = document.plans.find((existing) => existing.id === plan.id)
  if (sameId) {
    return plansEquivalent(sameId, plan)
      ? { kind: 'identical', existingPlanId: sameId.id, existingPlanName: sameId.name }
      : { kind: 'content', existingPlanId: sameId.id, existingPlanName: sameId.name }
  }
  const sameName = document.plans.find((existing) => existing.name === plan.name)
  if (sameName) return { kind: 'name', existingPlanId: sameName.id, existingPlanName: sameName.name }
  return null
}

function dedupePlanName(name: string, plans: WorkspacePlan[]): string {
  const taken = new Set(plans.map((plan) => plan.name))
  if (!taken.has(name)) return name
  const base = `${name}（导入）`
  if (!taken.has(base)) return base
  let index = 2
  while (taken.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

/**
 * 根据选择的处理方式计算导入后的新文档。
 * 纯函数：先完整算出结果再返回，任何一步不满足条件都直接抛错，
 * 传入的 document 与 plan 不会被修改，现有方案保持原样。
 */
export function applyImport(
  document: WorkspaceDocument,
  imported: WorkspacePlan,
  resolution: ImportResolution,
  now = new Date().toISOString(),
): WorkspaceDocument {
  const conflict = detectConflict(imported, document)

  switch (resolution) {
    case 'auto': {
      if (conflict) throw new Error('导入与现有方案冲突，需要选择处理方式')
      return { ...document, plans: [...document.plans, imported], activePlanId: imported.id }
    }
    case 'overwrite': {
      if (!conflict || conflict.kind === 'identical') throw new Error('没有可覆盖的冲突方案')
      const plans = document.plans.map((plan) => (plan.id === conflict.existingPlanId ? imported : plan))
      return { ...document, plans, activePlanId: imported.id }
    }
    case 'copy': {
      const copy: WorkspacePlan = {
        ...imported,
        id: createId('plan'),
        name: dedupePlanName(imported.name, document.plans),
        items: imported.items.map((item) => ({ ...item, id: createId('item') })),
        updatedAt: now,
      }
      return { ...document, plans: [...document.plans, copy], activePlanId: copy.id }
    }
    case 'merge': {
      if (!conflict || conflict.kind === 'identical') throw new Error('没有可合并的冲突方案')
      const plans = document.plans.map((plan) => {
        if (plan.id !== conflict.existingPlanId) return plan
        const existingIds = new Set(plan.items.map((item) => item.id))
        const additions = imported.items.filter((item) => !existingIds.has(item.id))
        return { ...plan, items: [...plan.items, ...additions], updatedAt: now }
      })
      return { ...document, plans, activePlanId: conflict.existingPlanId }
    }
  }
}
