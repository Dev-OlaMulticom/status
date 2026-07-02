import { execFile } from 'node:child_process'
import { logger } from './logger'

/**
 * Run a bash command and return its stdout, or null on failure.
 */
export function runLinuxCommand(command: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'bash',
      ['-lc', command],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        const value = String(stdout ?? '').trim()
        resolve(value || null)
      },
    )
  })
}

/**
 * Check if a CLI tool exists on the system PATH.
 */
export async function commandExists(name: string): Promise<boolean> {
  const result = await runLinuxCommand(
    `command -v ${name} >/dev/null 2>&1 && echo yes || echo no`,
    2000,
  )
  return result === 'yes'
}

/**
 * Return the first regex capture group matched in content, or null.
 */
export function extractFirstMatch(content: string | null, regexes: RegExp[]): string | null {
  if (!content) return null
  for (const regex of regexes) {
    const match = content.match(regex)
    if (match?.[1]) return String(match[1]).trim()
  }
  return null
}

/**
 * Sleep for `ms` milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Safe JSON stringify — returns empty string on error.
 */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/**
 * Escape HTML special characters.
 */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
