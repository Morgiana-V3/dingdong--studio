import { compactRaster } from './raster-image.cjs'
import { net, nativeImage } from 'electron'
import type { ImageLoader } from './dingdong-document.cjs'

export const loadDingdongImage: ImageLoader = async (url, budget, signal) => {
  const response = await net.fetch(url, {
    credentials: 'omit',
    signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`配图 HTTP ${response.status}`)
  }
  if (
    !response.body ||
    !/^image\/(png|jpeg|webp|gif)(?:;|$)/i.test(response.headers.get('content-type') || '')
  ) {
    await response.body?.cancel()
    throw new Error('配图格式不支持')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) {
        break
      }
      size += next.value.length
      if (size > 8000000) {
        throw new Error('配图过大')
      }
      chunks.push(next.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  const buffer = Buffer.concat(chunks)
  const mime = response.headers.get('content-type')!.split(';')[0].toLowerCase()
  if (buffer.length <= budget) {
    return `data:${mime};base64,` + buffer.toString('base64')
  }
  if (mime === 'image/gif') {
    throw new Error('动图超过离线图片预算')
  }
  const original = nativeImage.createFromBuffer(buffer)
  if (original.isEmpty()) {
    if (mime === 'image/webp')
      return compactRaster('data:image/webp;base64,' + buffer.toString('base64'), budget, signal)
    throw new Error('配图格式不可用')
  }
  for (const width of [1200, 960, 720, 480, 320, 240, 160]) {
    const size = original.getSize()
    const image = original.resize({
      width: Math.max(
        1,
        Math.floor(Math.min(width, size.width, (2400 * size.width) / size.height)),
      ),
    })
    const png = image.toPNG()
    if (png.length <= budget) {
      return 'data:image/png;base64,' + png.toString('base64')
    }
    for (const quality of [82, 65, 45, 30]) {
      const encoded = image.toJPEG(quality)
      if (encoded.length <= budget) {
        return 'data:image/jpeg;base64,' + encoded.toString('base64')
      }
    }
  }
  throw new Error('配图压缩后仍超过预算')
}
