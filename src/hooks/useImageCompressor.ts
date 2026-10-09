import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface CompressFileItem {
  id: string
  file: File
  status: 'pending' | 'processing' | 'done' | 'failed'
  error?: string
}

interface CompressTask {
  filename: string
  data?: Uint8Array
  path?: string
  index: number
}

interface CompressResultItem {
  filename: string
  original_size: number
  final_size: number
  status: string
  error?: string
}

export function useImageCompressor() {
  const [files, setFiles] = useState<CompressFileItem[]>([])
  const [outputDir, setOutputDir] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return
    const newFiles = Array.from(fileList)
      .filter((f) => f.type.startsWith('image/'))
      .filter((f) => f.size <= 200 * 1024 * 1024)
      .slice(0, 50)
      .map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        status: 'pending' as const,
      }))

    setFiles((prev) => [...prev, ...newFiles].slice(0, 50))
  }, [])

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const clearFiles = useCallback(() => {
    setFiles([])
    setProgress(0)
  }, [])

  const selectOutputDir = useCallback(async () => {
    const dir = await invoke<string | null>('pick_output_directory')
    if (dir) setOutputDir(dir)
  }, [])

  const BATCH_SIZE = 8

  const processFiles = useCallback(async () => {
    if (files.length === 0) return
    setIsProcessing(true)
    setProgress(0)

    let dir = outputDir
    if (!dir) {
      dir = (await invoke<string | null>('pick_output_directory')) || ''
      if (!dir) {
        setIsProcessing(false)
        return
      }
      setOutputDir(dir)
    }

    const pending = files.filter(
      (f) => f.status !== 'done' && f.status !== 'failed'
    )

    for (let batchStart = 0; batchStart < pending.length; batchStart += BATCH_SIZE) {
      const batch = pending.slice(batchStart, batchStart + BATCH_SIZE)

      setFiles((prev) =>
        prev.map((item) =>
          batch.some((b) => b.id === item.id)
            ? { ...item, status: 'processing' as const }
            : item
        )
      )

      // Build tasks: read file data for files without a filesystem path.
      // Files from drag-and-drop or file input have a path; pasted files don't.
      const tasks: CompressTask[] = []
      for (const f of batch) {
        const filePath = (f.file as any).path as string | undefined
        const task: CompressTask = {
          filename: f.file.name,
          index: batchStart + tasks.length + 1,
        }
        if (filePath) {
          task.path = filePath
        } else {
          const arrayBuffer = await f.file.arrayBuffer()
          task.data = new Uint8Array(arrayBuffer)
        }
        tasks.push(task)
      }

      try {
        const results = await invoke<CompressResultItem[]>('compress_images', {
          files: tasks,
          outputDir: dir,
        })

        // Results preserve input order (rayon collect preserves order)
        setFiles((prev) =>
          prev.map((item) => {
            const idx = batch.findIndex((b) => b.id === item.id)
            if (idx === -1) return item
            const res = results[idx]
            if (!res) {
              return {
                ...item,
                status: 'failed' as const,
                error: '后端未返回此文件的结果',
              }
            }
            return {
              ...item,
              status: res.status === 'failed' ? 'failed' : 'done',
              error: res.error,
            }
          })
        )
      } catch (e) {
        console.error(`[useImageCompressor] Batch failed:`, e)
        setFiles((prev) =>
          prev.map((item) =>
            batch.some((b) => b.id === item.id)
              ? { ...item, status: 'failed' as const, error: String(e) }
              : item
          )
        )
      }

      setProgress(batchStart + batch.length)
    }

    setIsProcessing(false)
  }, [files, outputDir])

  return {
    files,
    outputDir,
    isProcessing,
    progress,
    addFiles,
    removeFile,
    clearFiles,
    selectOutputDir,
    processFiles,
  }
}
