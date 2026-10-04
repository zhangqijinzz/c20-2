import { createId, DEVICE_DEFINITIONS, type DeskItem, type DeviceType, type WorkspaceDocument, type WorkspacePlan } from './models'

// 交换文件的独立版本线：它描述的是“文件格式”，与浏览器内 WorkspaceDocument.version 解耦。
// 语义化：major 不兼容直接拒绝；同 major 下，文件 minor 比当前新也拒绝（旧版本读不懂新数据）。
export const EXCHANGE_MAGIC = 'focusdesk.plan'
export const FORMAT_MAJOR = 1
export const FORMAT_MINOR = 0
export const FORMAT_VERSION = `${FORMAT_MAJOR}.${FORMAT_MINOR}`
export const EXCHANGE_FILE_EXTENSION = '.focusdesk.json'

// 与 package.json 保持同步；会写进交换文件，用于追溯来源版本。
export const APP_VERSION = '0.1.0'

export type ImportStrategy = 'merge' | 'overwrite' | 'copy'

export interface PlanEnvelope {
  magic: string
  formatVersion: string
  appVersion: string
  exportedAt: string
  checksum: string
  checksumAlgorithm: 'sha256'
  plan: WorkspacePlan
}

export interface ParsedPlanFile {
  envelope: PlanEnvelope
  plan: WorkspacePlan
}

export type ImportConflict =
  | { kind: 'none' }
  | { kind: 'diverged'; existing: WorkspacePlan; by: 'id' | 'name' }
  | { kind: 'identical'; existing: WorkspacePlan; by: 'id' | 'name' }

export type PlanFileErrorCode =
  | 'not-json'
  | 'not-envelope'
  | 'format-unsupported'
  | 'version-ahead'
  | 'checksum-mismatch'
  | 'payload-invalid'

export class PlanFileError extends Error {
  constructor(readonly code: PlanFileErrorCode, message: string) {
    super(message)
    this.name = 'PlanFileError'
  }
}

/* ------------------------------------------------------------------ */
/* 哈希：优先 SubtleCrypto（导出/导入同算法），不可用时用 cyrb53 兜底。 */
/* 校验和只针对 payload 的规范化 JSON，重排文件空白不会被误判为损坏。    */
/* ------------------------------------------------------------------ */

function cyrb53(input: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < input.length; index += 1) {
    const char = input.charCodeAt(index)
    h1 = Math.imul(h1 ^ char, 2654435761)
    h2 = Math.imul(h2 ^ char, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (BigInt(h1 >>> 0) << 32n | BigInt(h2 >>> 0)).toString(16).padStart(13, '0')
}

export async function hashPayload(payload: unknown): Promise<string> {
  const canonical = JSON.stringify(payload)
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return `cyrb53:${cyrb53(canonical)}`
}

// SubtleCrypto 与兜底哈希产出形态不同：混用时按“无法验证”处理，而不是放行。
function checksumLooksComparable(actual: string, expected: string): boolean {
  if (actual === expected) return true
  return (actual.startsWith('cyrb53:') && expected.startsWith('cyrb53:')) ||
    (!actual.startsWith('cyrb53:') && !expected.startsWith('cyrb53:'))
}

/* ---------------------------------- */
/* 导出：生成带版本与校验和的信封文件。 */
/* ---------------------------------- */

export async function createPlanEnvelope(plan: WorkspacePlan, appVersion: string): Promise<PlanEnvelope> {
  const payload = JSON.parse(JSON.stringify(plan)) as WorkspacePlan
  return {
    magic: EXCHANGE_MAGIC,
    formatVersion: FORMAT_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    checksum: await hashPayload(payload),
    checksumAlgorithm: 'sha256',
    plan: payload,
  }
}

/* ---------------------------------- */
/* 解析：任何一步不通过都整体拒绝。     */
/* ---------------------------------- */

interface VersionParts { major: number; minor: number }

function parseSemver(value: unknown): VersionParts | null {
  if (typeof value !== 'string') return null
  const match = /^(\d+)\.(\d+)$/.exec(value)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]) }
}

export function isFormatVersionSupported(formatVersion: VersionParts): boolean {
  return formatVersion.major === FORMAT_MAJOR && formatVersion.minor <= FORMAT_MINOR
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

const DEVICE_TYPES = new Set<DeviceType>(DEVICE_DEFINITIONS.map((device) => device.type))

function assertItem(value: unknown): asserts value is DeskItem {
  if (!isRecord(value)) throw new PlanFileError('payload-invalid', '设备数据不是对象')
  if (typeof value.id !== 'string' || value.id.length === 0) throw new PlanFileError('payload-invalid', '设备缺少 id')
  if (typeof value.type !== 'string' || !DEVICE_TYPES.has(value.type as DeviceType)) {
    throw new PlanFileError('payload-invalid', `存在不支持的设备类型：${String(value.type)}，请升级后再打开此文件`)
  }
  const dimensions: Array<[keyof DeskItem, unknown]> = [
    ['widthMm', value.widthMm],
    ['heightMm', value.heightMm],
    ['x', value.x],
    ['y', value.y],
    ['rotation', value.rotation],
  ]
  for (const [field, fieldValue] of dimensions) {
    if (!isFiniteNumber(fieldValue)) throw new PlanFileError('payload-invalid', `设备 ${value.id} 的 ${field} 不是数字`)
  }
  const widthMm = value.widthMm as number
  const heightMm = value.heightMm as number
  const rotation = value.rotation as number
  if (widthMm < 40 || widthMm > 2000 || heightMm < 40 || heightMm > 2000) {
    throw new PlanFileError('payload-invalid', `设备 ${value.id} 的尺寸超出允许范围`)
  }
  if (rotation < 0 || rotation >= 360) {
    throw new PlanFileError('payload-invalid', `设备 ${value.id} 的旋转角度不合法`)
  }
}

function assertPlan(value: unknown): asserts value is WorkspacePlan {
  if (!isRecord(value)) throw new PlanFileError('payload-invalid', '方案数据不是对象')
  if (typeof value.id !== 'string' || value.id.length === 0) throw new PlanFileError('payload-invalid', '方案缺少 id')
  if (typeof value.name !== 'string' || value.name.trim().length === 0) throw new PlanFileError('payload-invalid', '方案名称为空')
  if (!isFiniteNumber(value.deskWidthMm) || !isFiniteNumber(value.deskHeightMm)) {
    throw new PlanFileError('payload-invalid', '桌面尺寸不是数字')
  }
  if (value.deskWidthMm < 600 || value.deskWidthMm > 4000 || value.deskHeightMm < 600 || value.deskHeightMm > 4000) {
    throw new PlanFileError('payload-invalid', '桌面尺寸超出允许范围')
  }
  if (!Array.isArray(value.items)) throw new PlanFileError('payload-invalid', '设备列表缺失')
  if (!isIsoDateString(value.updatedAt)) throw new PlanFileError('payload-invalid', '更新时间不合法')
  const itemIds = new Set<string>()
  for (const item of value.items) {
    assertItem(item)
    if (itemIds.has(item.id)) throw new PlanFileError('payload-invalid', `方案内设备 id 重复：${item.id}`)
    itemIds.add(item.id)
  }
}

export async function parsePlanFile(text: string): Promise<ParsedPlanFile> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new PlanFileError('not-json', '文件不是合法的 JSON，可能已损坏或不是 FocusDesk 方案文件')
  }
  if (!isRecord(raw)) throw new PlanFileError('not-envelope', '文件结构不正确，缺少方案信封')

  if (raw.magic !== EXCHANGE_MAGIC) {
    throw new PlanFileError('not-envelope', '这不是 FocusDesk 方案文件（缺少文件标识）')
  }

  const formatVersion = parseSemver(raw.formatVersion)
  if (!formatVersion) {
    throw new PlanFileError('format-unsupported', `无法识别的文件版本：${String(raw.formatVersion)}`)
  }
  if (formatVersion.major !== FORMAT_MAJOR) {
    throw new PlanFileError('format-unsupported', `文件格式版本 v${raw.formatVersion} 与当前版本不兼容，无法安全读取`)
  }
  if (!isFormatVersionSupported(formatVersion)) {
    throw new PlanFileError('version-ahead', `文件由更新的版本导出（v${raw.formatVersion}），请先升级 FocusDesk 再打开`)
  }

  if (typeof raw.checksum !== 'string' || raw.checksum.length === 0) {
    throw new PlanFileError('checksum-mismatch', '文件缺少校验和，无法确认内容完整')
  }
  if (!isRecord(raw.plan)) throw new PlanFileError('payload-invalid', '文件中没有方案数据')
  if (typeof raw.exportedAt !== 'string' || Number.isNaN(Date.parse(raw.exportedAt))) {
    throw new PlanFileError('payload-invalid', '文件导出时间不合法')
  }

  // 先验校验和：任何字节级损坏都会在这里被拦下。
  const actualChecksum = await hashPayload(raw.plan)
  if (!checksumLooksComparable(actualChecksum, raw.checksum)) {
    throw new PlanFileError('checksum-mismatch', '无法用相同的算法校验文件（导出环境与当前环境不一致），已拒绝读取')
  }
  if (actualChecksum !== raw.checksum) {
    throw new PlanFileError('checksum-mismatch', '文件校验和不一致，内容可能已损坏或被修改，已拒绝读取')
  }

  // 校验和通过后再做结构校验，保证读进来的东西一定完整、合法。
  const candidate = JSON.parse(JSON.stringify(raw.plan))
  assertPlan(candidate)

  return { envelope: raw as unknown as PlanEnvelope, plan: candidate }
}

/* ---------------------------------- */
/* 冲突检测与落地：纯函数，便于测试。   */
/* ---------------------------------- */

// 内容指纹：忽略 id、updatedAt（拷贝/不同机器上这些必然不同），
// 规范化空格后比较，名字相同但布局不同即“内容已经不一样”。
export function planFingerprint(plan: WorkspacePlan): string {
  const normalized = {
    name: plan.name.trim(),
    deskWidthMm: plan.deskWidthMm,
    deskHeightMm: plan.deskHeightMm,
    items: plan.items.map((item) => ({
      type: item.type,
      widthMm: item.widthMm,
      heightMm: item.heightMm,
      x: Math.round(item.x),
      y: Math.round(item.y),
      rotation: Math.round(item.rotation),
    })),
  }
  return cyrb53(JSON.stringify(normalized))
}

export function detectImportConflict(imported: WorkspacePlan, document: WorkspaceDocument): ImportConflict {
  const byId = document.plans.find((plan) => plan.id === imported.id)
  if (byId) {
    return planFingerprint(byId) === planFingerprint(imported)
      ? { kind: 'identical', existing: byId, by: 'id' }
      : { kind: 'diverged', existing: byId, by: 'id' }
  }
  const byName = document.plans.find((plan) => plan.name.trim() === imported.name.trim())
  if (byName) {
    return planFingerprint(byName) === planFingerprint(imported)
      ? { kind: 'identical', existing: byName, by: 'name' }
      : { kind: 'diverged', existing: byName, by: 'name' }
  }
  return { kind: 'none' }
}

function uniqueCopyName(baseName: string, plans: WorkspacePlan[]): string {
  const stem = baseName.replace(/\s*·\s*导入副本(\s*\d+)?$/, '').trim() || baseName.trim()
  const taken = new Set(plans.map((plan) => plan.name))
  const candidate = (suffix: string) => `${stem} · 导入副本${suffix}`
  if (!taken.has(candidate(''))) return candidate('')
  for (let index = 2; index < 1000; index += 1) {
    if (!taken.has(candidate(` ${index}`))) return candidate(` ${index}`)
  }
  return candidate(` ${Date.now()}`)
}

export interface ResolvedImport {
  document: WorkspaceDocument
  resultPlan: WorkspacePlan
  action: ImportStrategy | 'added'
  message: string
}

// 合并：保留原方案，按设备 id 合流——同 id 以导入为准，新设备追加，
// 桌面取两者较大值（只会腾地方，绝不会把设备挤出桌面）。
function mergePlans(existing: WorkspacePlan, incoming: WorkspacePlan): WorkspacePlan {
  const mergedById = new Map<string, DeskItem>()
  for (const item of existing.items) mergedById.set(item.id, { ...item })
  for (const item of incoming.items) mergedById.set(item.id, { ...item })
  return {
    ...existing,
    deskWidthMm: Math.max(existing.deskWidthMm, incoming.deskWidthMm),
    deskHeightMm: Math.max(existing.deskHeightMm, incoming.deskHeightMm),
    items: [...mergedById.values()],
    updatedAt: new Date().toISOString(),
  }
}

// 纯函数计算导入后的文档；不改输入、不落盘。落盘失败时调用方保持原文档不动。
export function resolveImport(
  imported: WorkspacePlan,
  document: WorkspaceDocument,
  strategy: ImportStrategy | 'add',
): ResolvedImport {
  const conflict = detectImportConflict(imported, document)

  if (conflict.kind === 'none' || (conflict.kind === 'identical' && strategy === 'add')) {
    if (conflict.kind === 'identical') {
      // 内容完全一致：什么都不新增，只是切过去看。
      return {
        document: { ...document, activePlanId: conflict.existing.id },
        resultPlan: conflict.existing,
        action: 'added',
        message: `「${conflict.existing.name}」内容与文件完全一致，无需导入`,
      }
    }
    const plan: WorkspacePlan = { ...JSON.parse(JSON.stringify(imported)), updatedAt: new Date().toISOString() }
    return {
      document: { ...document, plans: [...document.plans, plan], activePlanId: plan.id },
      resultPlan: plan,
      action: 'added',
      message: `已导入方案「${plan.name}」`,
    }
  }

  const existing = conflict.existing

  if (strategy === 'merge') {
    const merged = mergePlans(existing, imported)
    return {
      document: { ...document, plans: document.plans.map((plan) => plan.id === existing.id ? merged : plan), activePlanId: merged.id },
      resultPlan: merged,
      action: 'merge',
      message: `已将导入内容合并进「${merged.name}」`,
    }
  }

  if (strategy === 'overwrite') {
    // 覆盖只替换内容，保留原位置与 id，其他方案完全不受影响。
    const replaced: WorkspacePlan = { ...JSON.parse(JSON.stringify(imported)), id: existing.id }
    return {
      document: { ...document, plans: document.plans.map((plan) => plan.id === existing.id ? replaced : plan), activePlanId: replaced.id },
      resultPlan: replaced,
      action: 'overwrite',
      message: `已用导入文件覆盖「${replaced.name}」`,
    }
  }

  const copy: WorkspacePlan = {
    ...JSON.parse(JSON.stringify(imported)),
    id: createId('plan'),
    name: uniqueCopyName(imported.name, document.plans),
    items: imported.items.map((item) => ({ ...item, id: createId('item') })),
    updatedAt: new Date().toISOString(),
  }
  return {
    document: { ...document, plans: [...document.plans, copy], activePlanId: copy.id },
    resultPlan: copy,
    action: 'copy',
    message: `已另存为「${copy.name}」，原有方案保持不变`,
  }
}
