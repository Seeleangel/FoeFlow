import { useEffect, useState } from 'react'

interface UseTypewriterOptions {
  speedMs?: number
  maxDurationMs?: number
  onUpdate?: () => void
}

export function useTypewriter(
  text: string,
  options: UseTypewriterOptions = {}
): string {
  const safeText = text ?? ''
  const { speedMs = 30, maxDurationMs = 3000, onUpdate } = options
  const [displayed, setDisplayed] = useState(safeText.length <= 3 ? safeText : '')

  useEffect(() => {
    if (safeText.length <= 3) {
      setDisplayed(safeText)
      return
    }

    let index = 0
    const actualInterval = Math.min(speedMs, maxDurationMs / safeText.length)
    const intervalId = setInterval(() => {
      index += 1
      if (index >= safeText.length) {
        clearInterval(intervalId)
        setDisplayed(safeText)
      } else {
        setDisplayed(safeText.slice(0, index))
      }
      onUpdate?.()
    }, actualInterval)

    return () => clearInterval(intervalId)
  }, [safeText, speedMs, maxDurationMs])

  return displayed
}
