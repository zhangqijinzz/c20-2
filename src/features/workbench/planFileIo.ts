import { EXCHANGE_FILE_EXTENSION } from '../../shared/planExchange'

// 浏览器文件 IO 与交换逻辑解耦：核心模块不碰 DOM，测试里可以直接喂字符串。
export interface PlanFileIo {
  save(filename: string, content: string): void
  pick(): Promise<{ name: string; text: string } | null>
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80)
  return cleaned || 'workspace-plan'
}

export function exportFilename(planName: string, exportedAt: Date = new Date()): string {
  const stamp = exportedAt.toISOString().slice(0, 19).replace(/[T:]/g, '-')
  return `${sanitizeFilename(planName)}-${stamp}${EXCHANGE_FILE_EXTENSION}`
}

export class BrowserPlanFileIo implements PlanFileIo {
  save(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  pick(): Promise<{ name: string; text: string } | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json'
      input.multiple = false
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        file.text().then((text) => resolve({ name: file.name, text })).catch(reject)
      }
      input.onerror = () => reject(new Error('读取所选文件失败'))
      input.click()
    })
  }
}
