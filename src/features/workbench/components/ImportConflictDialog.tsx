import { Copy, GitMerge, Layers, Replace, TriangleAlert, X } from 'lucide-react'
import type { ParsedPlanFile, ImportStrategy } from '../../../shared/planExchange'
import type { WorkspacePlan } from '../../../shared/models'

interface ImportConflictDialogProps {
  parsed: ParsedPlanFile
  existing: WorkspacePlan
  kind: 'diverged' | 'identical'
  by: 'id' | 'name'
  onChoose: (strategy: ImportStrategy) => void
  onCancel: () => void
}

const STRATEGIES: Array<{
  strategy: ImportStrategy
  icon: typeof GitMerge
  title: string
  desc: (incoming: WorkspacePlan, existing: WorkspacePlan) => string
}> = [
  {
    strategy: 'merge',
    icon: GitMerge,
    title: '合并到现有方案',
    desc: (incoming, current) => `同 id 设备以导入为准（最多替换 ${Math.min(current.items.length, incoming.items.length)} 件），新设备追加，桌面自动放大到放得下`,
  },
  {
    strategy: 'overwrite',
    icon: Replace,
    title: '覆盖现有方案',
    desc: (_incoming, current) => `「${current.name}」将被文件内容完全替换，此操作保存后不可撤销`,
  },
  {
    strategy: 'copy',
    icon: Copy,
    title: '另存为新方案',
    desc: (incoming) => `保留现有方案不动，「${incoming.name}」以副本形式导入`,
  },
]

export function ImportConflictDialog({ parsed, existing, kind, by, onChoose, onCancel }: ImportConflictDialogProps) {
  const incoming = parsed.plan
  const isIdentical = kind === 'identical'
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="import-conflict-title">
      <section className="dialog-modal import-dialog">
        <header className="dialog-header">
          <div>
            <span className="eyebrow">IMPORT CONFLICT</span>
            <h2 id="import-conflict-title">{isIdentical ? '已存在相同的方案' : '方案重名且内容不同'}</h2>
            <p>
              {by === 'id' ? '文件来自这台方案的另一个版本' : '本地已有同名方案'}：本地「{existing.name}」（{existing.items.length} 件设备，{existing.deskWidthMm} × {existing.deskHeightMm} mm）
              vs 导入文件（{incoming.items.length} 件设备，{incoming.deskWidthMm} × {incoming.deskHeightMm} mm）
            </p>
          </div>
          <button className="close-preview" aria-label="取消导入" onClick={onCancel} type="button"><X size={18} /></button>
        </header>

        {isIdentical ? (
          <div className="identical-note">
            <Layers size={16} />
            <span>两边内容逐一致，合并或覆盖都不会带来变化。可以直接另存一份，或取消本次导入。</span>
          </div>
        ) : (
          <div className="conflict-warning">
            <TriangleAlert size={16} />
            <span>请选择处理方式。在你确认前，本地方案不会被改动。</span>
          </div>
        )}

        <div className="strategy-list">
          {STRATEGIES.map(({ strategy, icon: Icon, title, desc }) => {
            const disabled = isIdentical && strategy !== 'copy'
            return (
              <button
                className={`strategy-card ${disabled ? 'is-disabled' : ''}`}
                disabled={disabled}
                key={strategy}
                onClick={() => onChoose(strategy)}
                type="button"
              >
                <span className="strategy-icon"><Icon size={17} /></span>
                <span className="strategy-copy"><strong>{title}</strong><small>{desc(incoming, existing)}</small></span>
              </button>
            )
          })}
        </div>

        <footer className="dialog-footer">
          <span className="dialog-meta">文件导出于 {new Date(parsed.envelope.exportedAt).toLocaleString('zh-CN')} · 格式 v{parsed.envelope.formatVersion}</span>
          <button className="dialog-cancel" onClick={onCancel} type="button">取消导入</button>
        </footer>
      </section>
    </div>
  )
}
