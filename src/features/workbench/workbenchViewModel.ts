import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createId,
  createInitialDocument,
  createPlan,
  type DeskItem,
  type DeviceType,
  type LayoutAnalysis,
  type WorkspaceDocument,
  type WorkspacePlan,
  type WorkspaceStatus,
} from '../../shared/models'
import { clampDeskSize, clampItemDimension } from '../../shared/layoutRules'
import { moveCanvasItem, rotateCanvasItem } from '../canvas/canvasViewModel'
import { createMaterialDraft } from '../materials/materialsViewModel'
import { inspectPlan } from '../inspection/inspectionViewModel'
import { LocalWorkspaceRepository, type WorkspaceRepository } from './workspaceRepository'
import { BrowserPlanFileIo, exportFilename, type PlanFileIo } from './planFileIo'
import {
  APP_VERSION,
  createPlanEnvelope,
  detectImportConflict,
  parsePlanFile,
  PlanFileError,
  resolveImport,
  type ImportStrategy,
  type ParsedPlanFile,
} from '../../shared/planExchange'

export interface PendingImport {
  parsed: ParsedPlanFile
  existing: WorkspacePlan
  kind: 'diverged' | 'identical'
  by: 'id' | 'name'
}

export interface WorkspaceViewModel {
  status: WorkspaceStatus
  document: WorkspaceDocument | null
  activePlan: WorkspacePlan | null
  selectedItem: DeskItem | null
  analysis: LayoutAnalysis
  issueIds: string[]
  issueCount: number
  feedback: string
  feedbackTone: 'ok' | 'error'
  isPreviewOpen: boolean
  pendingImport: PendingImport | null
  isChecklistOpen: boolean
  checklistGeneratedAt: Date | null
  selectItem: (id: string | null) => void
  addItem: (type: DeviceType) => void
  removeItem: (id: string) => void
  moveItem: (id: string, x: number, y: number) => void
  rotateItem: (id: string, delta: number) => void
  updateItem: (id: string, patch: Partial<Pick<DeskItem, 'widthMm' | 'heightMm' | 'x' | 'y'>>) => void
  updateDesk: (field: 'deskWidthMm' | 'deskHeightMm', value: number) => void
  createNewPlan: () => void
  duplicatePlan: () => void
  selectPlan: (id: string) => void
  deleteCurrentPlan: () => void
  openPreview: () => void
  closePreview: () => void
  exportActivePlan: () => Promise<void>
  importPlanFile: () => Promise<void>
  resolvePendingImport: (strategy: ImportStrategy) => Promise<void>
  cancelPendingImport: () => void
  openChecklist: () => void
  closeChecklist: () => void
}

const emptyInspection = { analysis: { overlapIds: [], outOfBoundsIds: [], coveragePercent: 0, status: 'clear' as const }, issueIds: [], issueCount: 0 }

export function useWorkspaceViewModel(
  repository?: WorkspaceRepository,
  fileIo: PlanFileIo = new BrowserPlanFileIo(),
): WorkspaceViewModel {
  const repositoryRef = useRef(repository ?? new LocalWorkspaceRepository())
  const fileIoRef = useRef(fileIo)
  const [status, setStatus] = useState<WorkspaceStatus>('loading')
  const [document, setDocument] = useState<WorkspaceDocument | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [feedback, setFeedback] = useState('正在准备你的工作台…')
  const [feedbackTone, setFeedbackTone] = useState<'ok' | 'error'>('ok')
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [isChecklistOpen, setIsChecklistOpen] = useState(false)
  const [checklistGeneratedAt, setChecklistGeneratedAt] = useState<Date | null>(null)
  // 导入确认期间挂起后续导入，避免并发选择把状态搅乱。
  const importLockRef = useRef(false)

  useEffect(() => {
    let active = true
    void repositoryRef.current.load().then((loaded) => {
      if (!active) return
      const nextDocument = loaded ?? createInitialDocument()
      setDocument(nextDocument)
      setStatus('ready')
      setFeedbackTone('ok')
      setFeedback(loaded ? '已恢复上次编辑状态' : '已创建示例工作台，可以直接拖动设备')
    }).catch(() => {
      if (!active) return
      setDocument(createInitialDocument())
      setStatus('error')
      setFeedbackTone('error')
      setFeedback('本地数据读取失败，当前使用临时工作台')
    })
    return () => { active = false }
  }, [])

  const activePlan = useMemo(
    () => document?.plans.find((plan) => plan.id === document.activePlanId) ?? null,
    [document],
  )
  const selectedItem = activePlan?.items.find((item) => item.id === selectedItemId) ?? null
  const inspection = useMemo(() => activePlan ? inspectPlan(activePlan) : emptyInspection, [activePlan])
  const { analysis, issueIds, issueCount } = inspection

  const persist = useCallback(async (nextDocument: WorkspaceDocument, message: string) => {
    setDocument(nextDocument)
    setStatus('saving')
    setFeedback(message)
    setFeedbackTone('ok')
    try {
      await repositoryRef.current.save(nextDocument)
      setStatus('ready')
    } catch {
      setStatus('error')
      setFeedbackTone('error')
      setFeedback('自动保存失败，请检查浏览器本地存储权限')
    }
  }, [])

  const updateActivePlan = useCallback((updater: (plan: WorkspacePlan) => WorkspacePlan, message: string) => {
    if (!document || !activePlan) return
    const nextPlan = { ...updater(activePlan), updatedAt: new Date().toISOString() }
    const nextDocument = { ...document, plans: document.plans.map((plan) => plan.id === nextPlan.id ? nextPlan : plan) }
    void persist(nextDocument, message)
  }, [activePlan, document, persist])

  const selectItem = useCallback((id: string | null) => setSelectedItemId(id), [])

  const addItem = useCallback((type: DeviceType) => {
    if (!activePlan) return
    const draft = createMaterialDraft(type, activePlan.items.length)
    updateActivePlan((plan) => ({ ...plan, items: [...plan.items, draft.item] }), draft.feedback)
    setSelectedItemId(draft.item.id)
  }, [activePlan, updateActivePlan])

  const removeItem = useCallback((id: string) => {
    updateActivePlan((plan) => ({ ...plan, items: plan.items.filter((item) => item.id !== id) }), '设备已移除')
    setSelectedItemId((current) => current === id ? null : current)
  }, [updateActivePlan])

  const moveItem = useCallback((id: string, x: number, y: number) => {
    updateActivePlan((plan) => ({ ...plan, items: moveCanvasItem(plan.items, id, x, y) }), '位置已更新')
  }, [updateActivePlan])

  const rotateItem = useCallback((id: string, delta: number) => {
    updateActivePlan((plan) => ({ ...plan, items: rotateCanvasItem(plan.items, id, delta) }), '角度已更新')
  }, [updateActivePlan])

  const updateItem = useCallback((id: string, patch: Partial<Pick<DeskItem, 'widthMm' | 'heightMm' | 'x' | 'y'>>) => {
    updateActivePlan((plan) => ({
      ...plan,
      items: plan.items.map((item) => item.id === id ? {
        ...item,
        ...patch,
        widthMm: patch.widthMm === undefined ? item.widthMm : clampItemDimension(patch.widthMm, item.widthMm),
        heightMm: patch.heightMm === undefined ? item.heightMm : clampItemDimension(patch.heightMm, item.heightMm),
      } : item),
    }), '尺寸参数已更新')
  }, [updateActivePlan])

  const updateDesk = useCallback((field: 'deskWidthMm' | 'deskHeightMm', value: number) => {
    if (!activePlan) return
    updateActivePlan((plan) => ({ ...plan, [field]: clampDeskSize(value, plan[field]) }), '桌面尺寸已更新')
  }, [activePlan, updateActivePlan])

  const createNewPlan = useCallback(() => {
    if (!document) return
    const plan = createPlan(`工作台 ${document.plans.length + 1}`, false)
    void persist({ ...document, plans: [...document.plans, plan], activePlanId: plan.id }, '已创建空白方案')
    setSelectedItemId(null)
  }, [document, persist])

  const duplicatePlan = useCallback(() => {
    if (!document || !activePlan) return
    const copy: WorkspacePlan = {
      ...activePlan,
      id: createId('plan'),
      name: `${activePlan.name} · 副本`,
      items: activePlan.items.map((item) => ({ ...item, id: createId('item') })),
      updatedAt: new Date().toISOString(),
    }
    void persist({ ...document, plans: [...document.plans, copy], activePlanId: copy.id }, '方案已复制')
    setSelectedItemId(null)
  }, [activePlan, document, persist])

  const selectPlan = useCallback((id: string) => {
    if (!document || !document.plans.some((plan) => plan.id === id)) return
    void persist({ ...document, activePlanId: id }, '已切换方案')
    setSelectedItemId(null)
  }, [document, persist])

  const deleteCurrentPlan = useCallback(() => {
    if (!document || !activePlan || document.plans.length <= 1) {
      setFeedback('至少保留一个工作台方案')
      setFeedbackTone('ok')
      return
    }
    const remaining = document.plans.filter((plan) => plan.id !== activePlan.id)
    void persist({ ...document, plans: remaining, activePlanId: remaining[0].id }, '方案已删除')
    setSelectedItemId(null)
  }, [activePlan, document, persist])

  const openPreview = useCallback(() => setIsPreviewOpen(true), [])
  const closePreview = useCallback(() => setIsPreviewOpen(false), [])

  /* ---------------- 方案交换：导出 ---------------- */

  const exportActivePlan = useCallback(async () => {
    if (!activePlan) return
    try {
      const envelope = await createPlanEnvelope(activePlan, APP_VERSION)
      fileIoRef.current.save(exportFilename(activePlan.name, new Date(envelope.exportedAt)), JSON.stringify(envelope, null, 2))
      setFeedback(`已导出「${activePlan.name}」，可发给同事或在其他设备上导入`)
      setFeedbackTone('ok')
    } catch {
      setFeedback('导出失败，请重试或检查浏览器的下载权限')
      setFeedbackTone('error')
    }
  }, [activePlan])

  /* ---------------- 方案交换：导入 ---------------- */

  // 原子提交：先在内存里得到完整的新文档，落盘成功之后才替换界面状态；
  // 落盘失败则原文档一字不动，错误明确报给用户。
  const commitImport = useCallback(async (parsed: ParsedPlanFile, strategy: ImportStrategy | 'add') => {
    if (!document) return
    const resolved = resolveImport(parsed.plan, document, strategy)
    try {
      await repositoryRef.current.save(resolved.document)
    } catch {
      setPendingImport(null)
      importLockRef.current = false
      setStatus('error')
      setFeedbackTone('error')
      setFeedback('导入保存失败，本地方案保持原样未被修改')
      return
    }
    setDocument(resolved.document)
    setStatus('ready')
    setSelectedItemId(null)
    setPendingImport(null)
    importLockRef.current = false
    setFeedback(resolved.message)
    setFeedbackTone('ok')
  }, [document])

  const importPlanFile = useCallback(async () => {
    if (!document || importLockRef.current) return
    let picked: { name: string; text: string } | null
    try {
      picked = await fileIoRef.current.pick()
    } catch {
      setFeedback('读取所选文件失败，请重试')
      setFeedbackTone('error')
      return
    }
    if (!picked) return // 用户取消了文件选择
    importLockRef.current = true

    let parsed: ParsedPlanFile
    try {
      parsed = await parsePlanFile(picked.text)
    } catch (error) {
      importLockRef.current = false
      const message = error instanceof PlanFileError ? error.message : '文件无法解析，已取消导入'
      setFeedback(message)
      setFeedbackTone('error')
      return
    }

    const conflict = detectImportConflict(parsed.plan, document)
    if (conflict.kind === 'none') {
      await commitImport(parsed, 'add')
      return
    }
    // 有冲突：只挂起待确认状态，绝不在此时改动任何已有方案。
    setPendingImport({ parsed, existing: conflict.existing, kind: conflict.kind, by: conflict.by })
  }, [commitImport, document])

  const resolvePendingImport = useCallback(async (strategy: ImportStrategy) => {
    if (!pendingImport) return
    await commitImport(pendingImport.parsed, strategy)
  }, [commitImport, pendingImport])

  const cancelPendingImport = useCallback(() => {
    setPendingImport(null)
    importLockRef.current = false
    setFeedback('已取消导入，本地方案未改动')
    setFeedbackTone('ok')
  }, [])

  /* ---------------- 施工清单 ---------------- */

  const openChecklist = useCallback(() => {
    setChecklistGeneratedAt(new Date())
    setIsChecklistOpen(true)
  }, [])
  const closeChecklist = useCallback(() => setIsChecklistOpen(false), [])

  return {
    status,
    document,
    activePlan,
    selectedItem,
    analysis,
    issueIds,
    issueCount,
    feedback,
    feedbackTone,
    isPreviewOpen,
    pendingImport,
    isChecklistOpen,
    checklistGeneratedAt,
    selectItem,
    addItem,
    removeItem,
    moveItem,
    rotateItem,
    updateItem,
    updateDesk,
    createNewPlan,
    duplicatePlan,
    selectPlan,
    deleteCurrentPlan,
    openPreview,
    closePreview,
    exportActivePlan,
    importPlanFile,
    resolvePendingImport,
    cancelPendingImport,
    openChecklist,
    closeChecklist,
  }
}
