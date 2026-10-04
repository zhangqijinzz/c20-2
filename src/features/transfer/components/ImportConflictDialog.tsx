import { CopyPlus, GitMerge, Replace, X } from 'lucide-react'
import type { ConflictResolution, PendingImport } from '../planTransfer'

interface ImportConflictDialogProps {
  pending: PendingImport
  onResolve: (resolution: ConflictResolution) => void
  onCancel: () => void
}

export function ImportConflictDialog({ pending, onResolve, onCancel }: ImportConflictDialogProps) {
  const { plan, conflict } = pending
  const reason = conflict.kind === 'content'
    ? `已存在同一方案「${conflict.existingPlanName}」，但文件中的内容与其不一致。`
    : `已存在同名方案「${conflict.existingPlanName}」，但内容并不相同。`
  return (
    <div className="preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="import-conflict-title">
      <section className="import-conflict-modal">
        <header className="preview-modal-header">
          <div><span className="eyebrow">IMPORT CONFLICT</span><h2 id="import-conflict-title">导入遇到冲突</h2><p>{reason} 请选择处理方式，取消则不做任何改动。</p></div>
          <button className="close-preview" aria-label="取消导入" onClick={onCancel} type="button"><X size={18} /></button>
        </header>
        <div className="import-conflict-summary">
          <span>待导入：<strong>{plan.name}</strong></span>
          <span>{plan.items.length} 件设备 · {plan.deskWidthMm} × {plan.deskHeightMm} mm</span>
        </div>
        <div className="import-conflict-actions">
          <button className="conflict-option" onClick={() => onResolve('merge')} type="button">
            <GitMerge size={16} /><span><strong>合并</strong><small>把文件中的新设备并入现有方案，已有设备保持不变</small></span>
          </button>
          <button className="conflict-option" onClick={() => onResolve('overwrite')} type="button">
            <Replace size={16} /><span><strong>覆盖</strong><small>用文件中的方案替换现有方案，现有内容将丢失</small></span>
          </button>
          <button className="conflict-option" onClick={() => onResolve('copy')} type="button">
            <CopyPlus size={16} /><span><strong>另存一份</strong><small>作为新方案导入，现有方案完全不受影响</small></span>
          </button>
        </div>
        <footer className="preview-footer">
          <span className="import-conflict-note">无论选择哪种方式，导入失败都会保持现有方案原样。</span>
          <button className="preview-done" onClick={onCancel} type="button">取消导入</button>
        </footer>
      </section>
    </div>
  )
}
