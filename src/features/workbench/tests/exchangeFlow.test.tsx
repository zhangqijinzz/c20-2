// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { createPlan, type WorkspaceDocument } from '../../../shared/models'
import { createPlanEnvelope, APP_VERSION, parsePlanFile } from '../../../shared/planExchange'
import { LocalWorkspaceRepository } from '../workspaceRepository'
import type { StorageService } from '../storageService'
import type { PlanFileIo } from '../planFileIo'
import { useWorkspaceViewModel } from '../workbenchViewModel'

function memoryStorage(initial: string | null = null): StorageService & { value: string | null; failWrites: boolean } {
  const store = { value: initial, failWrites: false }
  return {
    get value() { return store.value },
    set value(next) { store.value = next },
    get failWrites() { return store.failWrites },
    set failWrites(next) { store.failWrites = next },
    read: async () => store.value,
    write: async (next) => {
      if (store.failWrites) throw new Error('storage down')
      store.value = next
    },
  }
}

function fakeFileIo(): PlanFileIo & { nextFile: string | null; saves: string[] } {
  const state = { nextFile: null as string | null, saves: [] as string[] }
  return {
    get nextFile() { return state.nextFile },
    set nextFile(value) { state.nextFile = value },
    get saves() { return state.saves },
    save: ((filename: string, content: string) => { void filename; state.saves.push(content) }) as PlanFileIo['save'],
    pick: (async () => (state.nextFile === null ? null : { name: 'plan.focusdesk.json', text: state.nextFile })) as PlanFileIo['pick'],
  }
}

function renderHook<Result>(useHook: () => Result) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  let current!: Result
  function Harness() {
    current = useHook()
    return null
  }
  act(() => { root.render(createElement(Harness)) })
  return {
    get result() { return current },
    async settle() {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    },
    unmount() { act(() => { root.unmount() }) },
  }
}

async function envelopeText(plan: Parameters<typeof createPlanEnvelope>[0]): Promise<string> {
  return JSON.stringify(await createPlanEnvelope(plan, APP_VERSION))
}

describe('workspace view model exchange orchestration', () => {
  let mounted: ReturnType<typeof renderHook<ReturnType<typeof useWorkspaceViewModel>>> | null = null

  afterEach(() => {
    mounted?.unmount()
    mounted = null
    document.body.innerHTML = ''
  })

  it('exports the active plan into a parseable envelope file', async () => {
    const storage = memoryStorage()
    const io = fakeFileIo()
    const harness = renderHook(() => useWorkspaceViewModel(new LocalWorkspaceRepository(storage), io))
    mounted = harness
    await harness.settle()
    const activeName = harness.result.activePlan!.name

    await act(async () => { await harness.result.exportActivePlan() })

    expect(io.saves).toHaveLength(1)
    const parsed = await parsePlanFile(io.saves[0])
    expect(parsed.plan.name).toBe(activeName)
  })

  it('imports a non-conflicting plan, persists it, then switches to it', async () => {
    const storage = memoryStorage()
    const io = fakeFileIo()
    const harness = renderHook(() => useWorkspaceViewModel(new LocalWorkspaceRepository(storage), io))
    mounted = harness
    await harness.settle()
    const before = harness.result.document!
    const incoming = createPlan('同事发来的方案', false)
    io.nextFile = await envelopeText(incoming)

    await act(async () => { await harness.result.importPlanFile() })

    expect(harness.result.document!.plans).toHaveLength(before.plans.length + 1)
    expect(harness.result.activePlan!.name).toBe('同事发来的方案')
    const stored = JSON.parse(storage.value!) as WorkspaceDocument
    expect(stored.plans.some((plan) => plan.name === '同事发来的方案')).toBe(true)
  })

  it('keeps everything intact when the imported file cannot be parsed', async () => {
    const storage = memoryStorage()
    const io = fakeFileIo()
    const harness = renderHook(() => useWorkspaceViewModel(new LocalWorkspaceRepository(storage), io))
    mounted = harness
    await harness.settle()
    const snapshot = JSON.stringify(harness.result.document)
    io.nextFile = 'definitely not a plan file'

    await act(async () => { await harness.result.importPlanFile() })

    expect(JSON.stringify(harness.result.document)).toBe(snapshot)
    expect(harness.result.pendingImport).toBeNull()
    expect(harness.result.feedbackTone).toBe('error')
    expect(storage.value).toBeNull()
  })

  it('rolls back nothing-mutated when persistence fails mid-import', async () => {
    const storage = memoryStorage()
    const io = fakeFileIo()
    const harness = renderHook(() => useWorkspaceViewModel(new LocalWorkspaceRepository(storage), io))
    mounted = harness
    await harness.settle()
    const snapshot = JSON.stringify(harness.result.document)
    io.nextFile = await envelopeText(createPlan('新方案', false))
    storage.failWrites = true

    await act(async () => { await harness.result.importPlanFile() })

    expect(JSON.stringify(harness.result.document)).toBe(snapshot)
    expect(harness.result.status).toBe('error')
    expect(harness.result.feedback).toContain('保持原样')
    expect(harness.result.pendingImport).toBeNull()
  })

  it('waits for a decision on name/content conflict and supports cancel / overwrite', async () => {
    const storage = memoryStorage()
    const io = fakeFileIo()
    const harness = renderHook(() => useWorkspaceViewModel(new LocalWorkspaceRepository(storage), io))
    mounted = harness
    await harness.settle()
    const active = harness.result.activePlan!
    const beforeItems = active.items.length
    const incoming = { ...JSON.parse(JSON.stringify(active)), name: active.name, items: [], updatedAt: new Date().toISOString() }
    io.nextFile = await envelopeText(incoming)

    await act(async () => { await harness.result.importPlanFile() })
    expect(harness.result.pendingImport).not.toBeNull()
    expect(harness.result.pendingImport!.kind).toBe('diverged')
    // 等待决策期间，活动方案原封不动
    expect(harness.result.activePlan!.items).toHaveLength(beforeItems)

    await act(async () => { harness.result.cancelPendingImport() })
    expect(harness.result.pendingImport).toBeNull()
    expect(harness.result.activePlan!.items).toHaveLength(beforeItems)

    // 再次撞名，这次选择覆盖
    io.nextFile = await envelopeText(incoming)
    await act(async () => { await harness.result.importPlanFile() })
    await act(async () => { harness.result.resolvePendingImport('overwrite') })
    expect(harness.result.pendingImport).toBeNull()
    expect(harness.result.activePlan!.id).toBe(active.id)
    expect(harness.result.activePlan!.items).toHaveLength(0)
  })
})
