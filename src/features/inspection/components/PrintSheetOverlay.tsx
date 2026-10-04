import { Printer, TriangleAlert, X } from 'lucide-react'
import type { ConstructionSheet } from '../constructionSheet'

interface PrintSheetOverlayProps {
  sheet: ConstructionSheet
  onClose: () => void
}

export function PrintSheetOverlay({ sheet, onClose }: PrintSheetOverlayProps) {
  return (
    <div className="print-backdrop" role="dialog" aria-modal="true" aria-labelledby="print-sheet-title">
      <section className="print-sheet-modal">
        <header className="preview-modal-header print-sheet-actions">
          <div><span className="eyebrow">CONSTRUCTION SHEET</span><h2 id="print-sheet-title">施工清单</h2><p>内容与当前编辑状态实时一致，打印前可核对。</p></div>
          <div className="print-sheet-buttons">
            <button className="preview-done" onClick={() => window.print()} type="button"><Printer size={15} /> 打印</button>
            <button className="close-preview" aria-label="关闭施工清单" onClick={onClose} type="button"><X size={18} /></button>
          </div>
        </header>
        <div className="print-sheet">
          <header className="print-sheet-heading">
            <div>
              <h3>{sheet.planName}</h3>
              <p>桌面 {sheet.deskWidthMm} × {sheet.deskHeightMm} mm · {sheet.rows.length} 件设备 · 占用率 {sheet.coveragePercent}%</p>
            </div>
            <span>生成时间 {new Date(sheet.generatedAt).toLocaleString()}</span>
          </header>
          <table className="print-sheet-table">
            <thead>
              <tr><th>#</th><th>设备名称</th><th>尺寸（宽 × 深，mm）</th><th>坐标（X, Y，mm）</th><th>旋转</th><th>状态</th></tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, index) => (
                <tr key={row.id}>
                  <td>{index + 1}</td>
                  <td>{row.label}（{row.shortLabel}）</td>
                  <td>{row.widthMm} × {row.heightMm}</td>
                  <td>({row.x}, {row.y})</td>
                  <td>{row.rotation}°</td>
                  <td>{row.issues.length > 0 ? row.issues.join('、') : '正常'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <footer className="print-sheet-summary">
            <strong>问题摘要</strong>
            {sheet.issueSummary.map((issue) => (
              <span key={issue} className={issue.startsWith('布局检查通过') ? '' : 'print-sheet-issue'}>
                {issue.startsWith('布局检查通过') ? issue : <><TriangleAlert size={12} /> {issue}</>}
              </span>
            ))}
          </footer>
        </div>
      </section>
    </div>
  )
}
