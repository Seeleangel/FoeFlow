import { useEffect, useRef } from 'react'
import { Image, FolderOpen, Trash2, Play, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { showToast } from '@/components/ui/toaster'
import { useImageCompressor } from '@/hooks/useImageCompressor'
import { formatBytes } from '@/lib/imageCompress'

interface ImageCompressorPanelProps {
  isActive?: boolean
}

export default function ImageCompressorPanel({ isActive = true }: ImageCompressorPanelProps) {
  const {
    files,
    outputDir,
    isProcessing,
    addFiles,
    removeFile,
    clearFiles,
    selectOutputDir,
    processFiles,
  } = useImageCompressor()

  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isActive) return
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return
      addFiles(e.clipboardData.files)
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [addFiles, isActive])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    addFiles(e.dataTransfer.files)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleProcess = async () => {
    if (files.length === 0) {
      showToast('请先添加图片', 'info')
      return
    }
    await processFiles()
    showToast('处理完成', 'success')
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-stone-100 text-stone-600',
      processing: 'bg-amber-50 text-amber-600',
      done: 'bg-green-50 text-green-600',
      failed: 'bg-red-50 text-red-600',
    }
    const labels: Record<string, string> = {
      pending: '待处理',
      processing: '处理中',
      done: '完成',
      failed: '失败',
    }
    return (
      <span className={`text-xs px-2 py-0.5 rounded font-medium ${styles[status] || styles.pending}`}>
        {labels[status] || status}
      </span>
    )
  }

  return (
    <div className="space-y-4">
      {/* 文件输入区 */}
      <div
        ref={dropRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          files.length > 0
            ? 'border-stone-200 hover:border-stone-300 py-4'
            : 'border-stone-300 hover:border-red-400'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <Image className={`mx-auto text-stone-400 ${files.length > 0 ? 'w-5 h-5' : 'w-10 h-10 mb-3'}`} />
        {files.length === 0 && (
          <>
            <p className="text-stone-600 font-medium">拖拽图片到此处，或点击选择</p>
            <p className="text-xs text-stone-400 mt-1">支持 JPG / PNG / WebP，最多 50 张，单张不超过 200MB</p>
            <p className="text-xs text-stone-400 mt-0.5">也可直接 Ctrl+V 粘贴图片</p>
          </>
        )}
        {files.length > 0 && (
          <p className="text-sm text-stone-500">点击或拖拽添加更多图片</p>
        )}
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="border border-stone-200 rounded-xl bg-white overflow-hidden">
          <div className="max-h-80 overflow-y-auto">
            {files.map((f, idx) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-stone-100 last:border-b-0"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xs text-stone-400 w-6">{idx + 1}</span>
                  <span className="text-sm text-stone-700 truncate">{f.file.name}</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-stone-400">{formatBytes(f.file.size)}</span>
                  {getStatusBadge(f.status)}
                  {f.status === 'failed' && f.error && (
                    <span className="text-xs text-red-500 max-w-[200px] truncate" title={f.error}>
                      {f.error}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFile(f.id)
                    }}
                    className="text-stone-400 hover:text-red-600 transition-colors p-1"
                    disabled={isProcessing}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 操作栏 */}
      {files.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <FolderOpen className="w-4 h-4" />
            <span className="truncate max-w-xs">
              {outputDir || '未选择输出目录'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={selectOutputDir}
              disabled={isProcessing}
            >
              <FolderOpen className="w-3.5 h-3.5 mr-1.5" />
              选择目录
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearFiles}
              disabled={isProcessing}
              className="text-stone-600"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              清空
            </Button>
            <Button
              size="sm"
              onClick={handleProcess}
              disabled={isProcessing}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 mr-1.5" />
                  开始处理
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
