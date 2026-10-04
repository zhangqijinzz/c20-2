import { describe, expect, it } from 'vitest'
import { createInitialDocument, createItem, createPlan, type WorkspaceDocument, type WorkspacePlan } from './models'
import {
  APP_VERSION,
  createPlanEnvelope,
  detectImportConflict,
  EXCHANGE_MAGIC,
  FORMAT_VERSION,
  isFormatVersionSupported,
  parsePlanFile,
  PlanFileError,
  planFingerprint,
  resolveImport,
} from './planExchange'

async function exportText(plan: WorkspacePlan): Promise<string> {
  return JSON.stringify(await createPlanEnvelope(plan, APP_VERSION), null, 2)
}

function documentWith(plans: WorkspacePlan[], activePlanId?: string): WorkspaceDocument {
  return { version: 1, plans, activePlanId: activePlanId ?? plans[0].id }
}

describe('plan envelope export / parse', () => {
  it('round-trips a plan through the envelope', async () => {
    const plan = createPlan('交换测试', true)
    const parsed = await parsePlanFile(await exportText(plan))
    expect(parsed.plan).toEqual(plan)
    expect(parsed.envelope.magic).toBe(EXCHANGE_MAGIC)
    expect(parsed.envelope.formatVersion).toBe(FORMAT_VERSION)
    expect(parsed.envelope.checksumAlgorithm).toBe('sha256')
  })

  it('rejects files that are not json', async () => {
    await expect(parsePlanFile('{broken')).rejects.toMatchObject({ code: 'not-json' })
  })

  it('rejects files missing the magic marker', async () => {
    const envelope = await createPlanEnvelope(createPlan('p', false), APP_VERSION)
    const text = JSON.stringify({ ...envelope, magic: 'something-else' })
    await expect(parsePlanFile(text)).rejects.toMatchObject({ code: 'not-envelope' })
  })

  it('rejects older major versions and unknown version strings', async () => {
    const envelope = await createPlanEnvelope(createPlan('p', false), APP_VERSION)
    await expect(parsePlanFile(JSON.stringify({ ...envelope, formatVersion: '0.9' }))).rejects.toMatchObject({ code: 'format-unsupported' })
    await expect(parsePlanFile(JSON.stringify({ ...envelope, formatVersion: 'banana' }))).rejects.toMatchObject({ code: 'format-unsupported' })
  })

  it('rejects newer minor versions (forward incompatibility) instead of half-reading', async () => {
    const envelope = await createPlanEnvelope(createPlan('p', false), APP_VERSION)
    await expect(parsePlanFile(JSON.stringify({ ...envelope, formatVersion: '1.1' }))).rejects.toMatchObject({ code: 'version-ahead' })
    await expect(parsePlanFile(JSON.stringify({ ...envelope, formatVersion: '2.0' }))).rejects.toMatchObject({ code: 'format-unsupported' })
  })

  it('supports the same major older minor format policy', () => {
    expect(isFormatVersionSupported({ major: 1, minor: 0 })).toBe(true)
    expect(isFormatVersionSupported({ major: 1, minor: 1 })).toBe(false)
    expect(isFormatVersionSupported({ major: 0, minor: 9 })).toBe(false)
    expect(isFormatVersionSupported({ major: 2, minor: 0 })).toBe(false)
  })

  it('rejects tampered payload even though json is intact', async () => {
    const envelope = await createPlanEnvelope(createPlan('p', true), APP_VERSION)
    envelope.plan.deskWidthMm = 999
    await expect(parsePlanFile(JSON.stringify(envelope))).rejects.toMatchObject({ code: 'checksum-mismatch' })
  })

  it('rejects truncated payload where trailing items were dropped', async () => {
    const plan = createPlan('p', true)
    plan.items.push(createItem('lamp'), createItem('speaker'))
    const envelope = await createPlanEnvelope(plan, APP_VERSION)
    envelope.plan.items.pop()
    await expect(parsePlanFile(JSON.stringify(envelope))).rejects.toMatchObject({ code: 'checksum-mismatch' })
  })

  it('rejects structurally invalid payload with a fresh valid checksum', async () => {
    const envelope = await createPlanEnvelope(createPlan('p', false), APP_VERSION)
    const tampered = { ...envelope, plan: { ...envelope.plan, name: '' } }
    // 重新计算校验和，确保拦下来的是结构校验而不是校验和
    const { hashPayload } = await import('./planExchange')
    tampered.checksum = await hashPayload(tampered.plan)
    await expect(parsePlanFile(JSON.stringify(tampered))).rejects.toMatchObject({ code: 'payload-invalid' })
  })

  it('rejects unknown device types from a future data set', async () => {
    const plan = createPlan('p', false)
    plan.items.push(createItem('lamp'))
    const envelope = await createPlanEnvelope(plan, APP_VERSION)
    const tampered = JSON.parse(JSON.stringify(envelope))
    tampered.plan.items[0].type = 'hologram-projector'
    const { hashPayload } = await import('./planExchange')
    tampered.checksum = await hashPayload(tampered.plan)
    await expect(parsePlanFile(JSON.stringify(tampered))).rejects.toMatchObject({ code: 'payload-invalid' })
  })

  it('rejects duplicate item ids inside a plan', async () => {
    const plan = createPlan('p', false)
    const first = createItem('lamp')
    const second = { ...createItem('speaker'), id: first.id }
    plan.items.push(first, second)
    // 校验和对这种数据是合法的（导出端确实这么写了），必须由结构校验拦下来
    await expect(parsePlanFile(await exportText(plan))).rejects.toMatchObject({ code: 'payload-invalid' })
  })

  it('rejects out-of-range desk and item dimensions', async () => {
    const plan = createPlan('p', false)
    plan.deskWidthMm = 200
    await expect(parsePlanFile(await exportText(plan))).rejects.toMatchObject({ code: 'payload-invalid' })
  })
})

describe('import conflict detection', () => {
  it('sees no conflict for an unrelated plan', () => {
    const existing = createPlan('本地方案', false)
    const incoming = createPlan('同事的方案', false)
    expect(detectImportConflict(incoming, documentWith([existing])).kind).toBe('none')
  })

  it('matches by id even when the name changed and reports divergence', () => {
    const existing = createPlan('旧名字', false)
    existing.items.push(createItem('monitor'))
    const incoming: WorkspacePlan = { ...JSON.parse(JSON.stringify(existing)), name: '新名字', items: [createItem('lamp')] }
    const conflict = detectImportConflict(incoming, documentWith([existing]))
    expect(conflict.kind).toBe('diverged')
    if (conflict.kind === 'diverged') expect(conflict.by).toBe('id')
  })

  it('matches by name when ids differ', () => {
    const existing = createPlan('同一个名字', false)
    existing.items.push(createItem('monitor'))
    const incoming = createPlan('同一个名字', false)
    incoming.items.push(createItem('speaker'))
    const conflict = detectImportConflict(incoming, documentWith([existing]))
    expect(conflict.kind).toBe('diverged')
    if (conflict.kind === 'diverged') expect(conflict.by).toBe('name')
  })

  it('treats a copy with identical layout as identical regardless of ids', () => {
    const existing = createPlan('方案', true)
    const incoming: WorkspacePlan = {
      ...JSON.parse(JSON.stringify(existing)),
      id: 'plan-other-id',
      items: existing.items.map((item) => ({ ...item, id: `item-${item.id}` })),
    }
    expect(detectImportConflict(incoming, documentWith([existing])).kind).toBe('identical')
  })

  it('ignores updatedAt and coordinate rounding in the fingerprint', () => {
    const existing = createPlan('方案', true)
    const incoming = JSON.parse(JSON.stringify(existing)) as WorkspacePlan
    incoming.updatedAt = new Date('2030-01-01').toISOString()
    incoming.items[0].x += 0.2
    expect(planFingerprint(existing)).toBe(planFingerprint(incoming))
  })
})

describe('resolveImport strategies', () => {
  function divergedPair(): { existing: WorkspacePlan; incoming: WorkspacePlan; doc: WorkspaceDocument } {
    const existing = createPlan('方案', false)
    const shared = createItem('monitor')
    shared.x = 100
    shared.y = 100
    const localOnly = createItem('speaker')
    localOnly.id = 'item-local'
    existing.items = [shared, localOnly]
    const incoming: WorkspacePlan = {
      ...JSON.parse(JSON.stringify(existing)),
      items: [],
      updatedAt: new Date().toISOString(),
    }
    const movedShared = { ...shared, x: 700 }
    const incomingOnly = createItem('lamp')
    incomingOnly.id = 'item-incoming'
    incoming.items = [movedShared, incomingOnly]
    incoming.deskWidthMm = 2000
    return { existing, incoming, doc: documentWith([{ ...existing, items: [shared, localOnly] }]) }
  }

  it('appends a non-conflicting plan and activates it', () => {
    const doc = createInitialDocument()
    const incoming = createPlan('外来方案', false)
    const resolved = resolveImport(incoming, doc, 'add')
    expect(resolved.document.plans).toHaveLength(2)
    expect(resolved.document.activePlanId).toBe(resolved.resultPlan.id)
    expect(doc.plans).toHaveLength(1) // 输入文档不被修改
  })

  it('merges by item id: incoming wins shared items, local-only and incoming-only both kept', () => {
    const { existing, incoming, doc } = divergedPair()
    const resolved = resolveImport(incoming, doc, 'merge')
    const plan = resolved.resultPlan
    expect(plan.id).toBe(existing.id)
    expect(plan.items.map((item) => item.id).sort()).toEqual(['item-incoming', 'item-local', incoming.items[0].id].sort())
    const sharedAfter = plan.items.find((item) => item.id === incoming.items[0].id)
    expect(sharedAfter?.x).toBe(700)
    // 桌面取较大值
    expect(plan.deskWidthMm).toBe(2000)
    // 原有文档与入参不被改动
    expect(doc.plans[0].items.find((item) => item.id === incoming.items[0].id)?.x).toBe(100)
    expect(existing.items[0].x).toBe(100)
  })

  it('overwrite replaces content but keeps the original id and slot', () => {
    const doc = createInitialDocument()
    const other = createPlan('旁观方案', false)
    doc.plans.push(other)
    const target = doc.plans[0]
    const incoming: WorkspacePlan = { ...JSON.parse(JSON.stringify(createPlan(target.name, true))), id: target.id }
    incoming.name = target.name
    const resolved = resolveImport(incoming, doc, 'overwrite')
    expect(resolved.document.plans).toHaveLength(2)
    const replaced = resolved.document.plans[0]
    expect(replaced.id).toBe(target.id)
    expect(replaced.items.length).toBe(incoming.items.length)
    expect(resolved.document.plans[1]).toEqual(other)
  })

  it('copy leaves the existing plan untouched and creates a uniquely named duplicate', () => {
    const { incoming, doc } = divergedPair()
    incoming.name = doc.plans[0].name
    const first = resolveImport(incoming, doc, 'copy')
    expect(first.document.plans[0]).toEqual(doc.plans[0])
    expect(first.resultPlan.name).toBe(`${incoming.name} · 导入副本`)
    expect(first.resultPlan.id).not.toBe(incoming.id)
    expect(first.resultPlan.items[0].id).not.toBe(incoming.items[0].id)

    // 再来一份同名：自动编号，不覆盖上一份
    const second = resolveImport(incoming, first.document, 'copy')
    expect(second.resultPlan.name).toBe(`${incoming.name} · 导入副本 2`)
    expect(second.document.plans).toHaveLength(3)
  })

  it('does not duplicate anything when content is identical', () => {
    const existing = createPlan('方案', true)
    const incoming: WorkspacePlan = { ...JSON.parse(JSON.stringify(existing)), id: createItem('lamp').id }
    incoming.id = 'plan-other'
    const resolved = resolveImport(incoming, documentWith([existing]), 'add')
    expect(resolved.document.plans).toHaveLength(1)
    expect(resolved.document.activePlanId).toBe(existing.id)
  })

  it('never throws PlanFileError for control flow and returns a shaped message', async () => {
    try {
      await parsePlanFile('not json')
      throw new Error('should not reach')
    } catch (error) {
      expect(error).toBeInstanceOf(PlanFileError)
      expect((error as PlanFileError).message).toContain('JSON')
    }
  })
})
