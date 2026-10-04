import { Printer, X } from 'lucide-react'
import { getDeviceDefinition, type LayoutAnalysis, type WorkspacePlan } from '../../../shared/models'
import { APP_VERSION } from '../../../shared/planExchange'
import { buildIssueReport } from '../../inspection/inspectionViewModel'

interface PrintChecklistProps {
  plan: WorkspacePlan
  analysis: LayoutAnalysis
  generatedAt: Date
  onClose: () => void
}

function formatCoordinate(value: number): string {
  return `${Math.round(value)}`
}

export function PrintChecklist({ plan, analysis, generatedAt, onClose }: PrintChecklistProps) {
  const report = buildIssueReport(plan, analysis)
  const generatedText = generatedAt.toLocaleString('zh-CN', { hour12: false })
  return (
    <div className="dialog-backdrop print-backdrop" role="dialog" aria-modal="true" aria-labelledby="checklist-title">
      <section className="dialog-modal checklist-modal">
        <header className="dialog-header screen-only">
          <div>
            <span className="eyebrow">BUILD SHEET</span>
            <h2 id="checklist-title">施工清单预览</h2>
            <p>打印内容与当前编辑状态一致，关闭后继续编辑不会影响已打印的文件。</p>
          </div>
          <button className="close-preview" aria-label="关闭清单" onClick={onClose} type="button"><X size={18} /></button>
        </header>

        <div className="print-sheet">
          <div className="sheet-head">
            <div>
              <p className="sheet-brand">FOCUSDESK · 施工清单</p>
              <h3>{plan.name}</h3>
            </div>
            <table className="sheet-meta">
              <tbody>
                <tr><th>桌面尺寸</th><td>{plan.deskWidthMm} × {plan.deskHeightMm} mm</td></tr>
                <tr><th>设备数量</th><td>{plan.items.length} 件</td></tr>
                <tr><th>占用率</th><td>{analysis.coveragePercent}%</td></tr>
                <tr><th>生成时间</th><td>{generatedText}</td></tr>
              </tbody>
            </table>
          </div>

          <table className="sheet-table">
            <thead>
              <tr>
                <th className="col-index">序号</th>
                <th>设备名称</th>
                <th>尺寸（宽 × 深 mm）</th>
                <th>坐标（X, Y mm）</th>
                <th>旋转</th>
                <th>当前问题摘要</th>
              </tr>
            </thead>
            <tbody>
              {plan.items.map((item, index) => {
                const definition = getDeviceDefinition(item.type)
                const issue = report.entries.find((entry) => entry.item.id === item.id)
                return (
                  <tr key={item.id}>
                    <td className="col-index">{index + 1}</td>
                    <td>{definition.label}</td>
                    <td>{item.widthMm} × {item.heightMm}</td>
                    <td>({formatCoordinate(item.x)}, {formatCoordinate(item.y)})</td>
                    <td>{Math.round(item.rotation)}°</td>
                    <td>{issue ? issue.detail : '正常'}</td>
                  </tr>
                )
              })}
              {plan.items.length === 0 && (
                <tr><td colSpan={6} className="sheet-empty">当前方案还没有设备</td></tr>
              )}
            </tbody>
          </table>

          <div className={`sheet-issues ${report.hasIssues ? '' : 'is-clear'}`}>
            <strong>问题摘要：</strong>
            {report.hasIssues
              ? report.entries.map((entry, index) => (
                <span className="issue-chip" key={entry.item.id}>{index + 1}. {entry.label}（{formatCoordinate(entry.item.x)}, {formatCoordinate(entry.item.y)}）— {entry.detail}；</span>
              ))
              : <span>检查全部通过，无重叠、无越界，可按表施工。</span>}
          </div>

          <div className="sheet-foot">
            <span>施工人签字：__________________</span>
            <span>验收日期：__________________</span>
            <span>FocusDesk v{APP_VERSION}</span>
          </div>
        </div>

        <footer className="dialog-footer screen-only">
          <span className="dialog-meta">共 {plan.items.length} 件设备 · {report.hasIssues ? `${report.entries.length} 个待处理问题` : '检查通过'}</span>
          <button className="dialog-primary" onClick={() => window.print()} type="button"><Printer size={15} /> 打印 / 另存为 PDF</button>
        </footer>
      </section>
    </div>
  )
}
