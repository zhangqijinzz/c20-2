import { describe, expect, it } from 'vitest'
import { createInitialDocument, createItem, createPlan, type WorkspaceDocument, type WorkspacePlan } from '../../../shared/models'
import {
  applyImport,
  detectConflict,
  parsePlanFile,
  PLAN_FILE_VERSION,
  plansEquivalent,
  serializePlan,
} from '../planTransfer'

function makeDocument(): { document: WorkspaceDocument; plan: WorkspacePlan } {
  const document = createInitialDocument()
  return { document, plan: document.plans[0] }
}

describe('plan file round trip', () => {
  it('serializes and parses back to the same plan', () => {
    const { plan } = makeDocument()
    const parsed = parsePlanFile(serializePlan(plan))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.plan).toEqual(plan)
  })

  it('restores an identical plan on another document via auto import', () => {
    const { plan } = makeDocument()
    const shared: WorkspacePlan = { ...plan, name: '共享给同事的方案' }
    const target = createInitialDocument()
    const parsed = parsePlanFile(serializePlan(shared))
    if (!parsed.ok) throw new Error('parse failed')
    const next = applyImport(target, parsed.plan, 'auto')
    const restored = next.plans.find((candidate) => candidate.id === shared.id)
    expect(restored).toEqual(shared)
    expect(next.activePlanId).toBe(shared.id)
    expect(next.plans).toHaveLength(target.plans.length + 1)
  })
})

describe('plan file version handling', () => {
  it('rejects files from a newer version explicitly', () => {
    const { plan } = makeDocument()
    const envelope = JSON.parse(serializePlan(plan)) as { formatVersion: number }
    envelope.formatVersion = PLAN_FILE_VERSION + 1
    const parsed = parsePlanFile(JSON.stringify(envelope))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('更新的版本')
  })

  it('rejects files without a valid version', () => {
    const { plan } = makeDocument()
    const envelope = JSON.parse(serializePlan(plan)) as Record<string, unknown>
    delete envelope.formatVersion
    expect(parsePlanFile(JSON.stringify(envelope)).ok).toBe(false)
  })

  it('rejects damaged or foreign files without importing anything', () => {
    expect(parsePlanFile('{broken').ok).toBe(false)
    expect(parsePlanFile('"just a string"').ok).toBe(false)
    expect(parsePlanFile(JSON.stringify({ fileType: 'other.app', formatVersion: 1 })).ok).toBe(false)
    const { plan } = makeDocument()
    const envelope = JSON.parse(serializePlan(plan)) as { plan: Record<string, unknown> }
    delete envelope.plan.items
    const parsed = parsePlanFile(JSON.stringify(envelope))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('未导入任何内容')
  })

  it('rejects plans with invalid items rather than importing half', () => {
    const { plan } = makeDocument()
    const envelope = JSON.parse(serializePlan(plan)) as { plan: { items: unknown[] } }
    envelope.plan.items = [...plan.items.slice(0, 1), { id: 'item-x', type: 'hologram' }]
    expect(parsePlanFile(JSON.stringify(envelope)).ok).toBe(false)
  })
})

describe('conflict detection', () => {
  it('detects identical plans', () => {
    const { document, plan } = makeDocument()
    expect(detectConflict(plan, document)?.kind).toBe('identical')
  })

  it('detects same id with different content', () => {
    const { document, plan } = makeDocument()
    const changed: WorkspacePlan = { ...plan, items: [...plan.items, createItem('lamp', 2)] }
    expect(detectConflict(changed, document)?.kind).toBe('content')
  })

  it('detects same name with different id', () => {
    const { document, plan } = makeDocument()
    const renamed: WorkspacePlan = { ...plan, id: 'plan-other', items: [] }
    const conflict = detectConflict(renamed, document)
    expect(conflict?.kind).toBe('name')
    expect(conflict?.existingPlanId).toBe(plan.id)
  })

  it('returns null when there is no conflict', () => {
    const { document } = makeDocument()
    const incoming = createPlan('全新方案', false)
    expect(detectConflict(incoming, document)).toBeNull()
  })
})

describe('import resolutions', () => {
  it('overwrite replaces the existing plan content', () => {
    const { document, plan } = makeDocument()
    const changed: WorkspacePlan = { ...plan, deskWidthMm: 2000, items: [...plan.items, createItem('speaker', 2)] }
    const next = applyImport(document, changed, 'overwrite')
    expect(next.plans).toHaveLength(document.plans.length)
    expect(next.plans.find((candidate) => candidate.id === plan.id)).toEqual(changed)
    expect(next.activePlanId).toBe(plan.id)
  })

  it('copy keeps the existing plan and adds a renamed duplicate', () => {
    const { document, plan } = makeDocument()
    const changed: WorkspacePlan = { ...plan, items: [...plan.items, createItem('lamp', 2)] }
    const next = applyImport(document, changed, 'copy')
    expect(next.plans).toHaveLength(document.plans.length + 1)
    expect(next.plans.find((candidate) => candidate.id === plan.id)).toEqual(plan)
    const copy = next.plans.find((candidate) => candidate.id === next.activePlanId)
    expect(copy).toBeDefined()
    expect(copy?.id).not.toBe(plan.id)
    expect(copy?.name).toBe(`${plan.name}（导入）`)
    expect(copy?.items).toHaveLength(changed.items.length)
    expect(copy?.items.every((item, index) => item.id !== changed.items[index].id)).toBe(true)
  })

  it('merge appends only new items and keeps existing ones untouched', () => {
    const { document, plan } = makeDocument()
    const extra = createItem('stand', 5)
    const changed: WorkspacePlan = {
      ...plan,
      items: [...plan.items.map((item) => ({ ...item, x: item.x + 500 })), extra],
    }
    const next = applyImport(document, changed, 'merge')
    const merged = next.plans.find((candidate) => candidate.id === plan.id)
    expect(next.plans).toHaveLength(document.plans.length)
    expect(merged?.items).toHaveLength(plan.items.length + 1)
    plan.items.forEach((item) => {
      expect(merged?.items.find((candidate) => candidate.id === item.id)).toEqual(item)
    })
    expect(merged?.items.some((candidate) => candidate.id === extra.id)).toBe(true)
  })

  it('merge by name conflict keeps the existing plan id active', () => {
    const { document, plan } = makeDocument()
    const incoming: WorkspacePlan = { ...plan, id: 'plan-elsewhere', items: [...plan.items, createItem('lamp', 3)] }
    const next = applyImport(document, incoming, 'merge')
    expect(next.activePlanId).toBe(plan.id)
    expect(next.plans.some((candidate) => candidate.id === 'plan-elsewhere')).toBe(false)
    expect(next.plans.find((candidate) => candidate.id === plan.id)?.items).toHaveLength(plan.items.length + 1)
  })

  it('auto import throws on conflict instead of guessing', () => {
    const { document, plan } = makeDocument()
    expect(() => applyImport(document, plan, 'auto')).toThrow()
  })

  it('never mutates the existing document, even on failure', () => {
    const { document, plan } = makeDocument()
    const snapshot = JSON.parse(JSON.stringify(document)) as WorkspaceDocument
    const changed: WorkspacePlan = { ...plan, deskHeightMm: 1200 }
    expect(() => applyImport(document, changed, 'auto')).toThrow()
    applyImport(document, changed, 'overwrite')
    applyImport(document, changed, 'copy')
    applyImport(document, changed, 'merge')
    expect(document).toEqual(snapshot)
  })
})

describe('plansEquivalent', () => {
  it('ignores updatedAt timestamps', () => {
    const { plan } = makeDocument()
    const later: WorkspacePlan = { ...plan, updatedAt: new Date(Date.now() + 10000).toISOString() }
    expect(plansEquivalent(plan, later)).toBe(true)
  })
})
