const FORMATS = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function isBrowserImage(file: File): boolean {
  return FORMATS.has(file.type) && file.size <= 20 * 1024 * 1024
}

export async function compressBrowserImage(file: File): Promise<Blob> {
  if (!isBrowserImage(file)) throw new Error('请选择不超过 20MB 的 JPG、PNG 或 WebP 图片')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器无法处理此图片')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const output = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('压缩失败')), 'image/webp', 0.82)
    })
    return output.size < file.size ? output : file
  } finally {
    bitmap.close()
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
