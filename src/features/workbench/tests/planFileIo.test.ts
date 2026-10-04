import { describe, expect, it } from 'vitest'
import { exportFilename, sanitizeFilename } from '../planFileIo'

describe('export filename', () => {
  it('strips characters that are unsafe across operating systems', () => {
    expect(sanitizeFilename('方案 / v2: 初稿?')).toBe('方案_v2_初稿')
    expect(sanitizeFilename('   ')).toBe('workspace-plan')
  })

  it('builds a timestamped filename with the exchange extension', () => {
    const name = exportFilename('我的工作台', new Date('2026-10-04T09:08:07.000Z'))
    expect(name).toBe('我的工作台-2026-10-04-09-08-07.focusdesk.json')
  })
})
