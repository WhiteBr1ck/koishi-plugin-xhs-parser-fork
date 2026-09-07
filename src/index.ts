import { Context, Logger, Schema, h } from 'koishi'
import os from 'node:os'
import path from 'node:path'
import nodeUrl from 'node:url'
import { promises as fs } from 'node:fs'
import { buildXhsMessages, extractXhsLinks, fetchXhsNote, XhsNote } from './parser'

export const name = 'xhs-parser-fork'

const logger = new Logger(name)
const VIDEO_TOO_LARGE_MESSAGE = '[视频文件过大，跳过解析]'

export interface Config {
  enabled: boolean
  parseMode: ('link' | 'card')[]
  waitTip?: string | null
  useForward: boolean
  quote: boolean
  middleware: boolean
  parseLimit: number
  minimumInterval: number
  userAgent: string
  cookie?: string
  timeout: number
  imageFormat: 'jpeg' | 'png' | 'webp' | 'heic' | 'avif' | 'auto'
  imageSendMode: 'url' | 'buffer' | 'base64' | 'file'
  showImages: boolean
  maxImages: number
  maxDescLength: number
  descTruncateSuffix: string
  showVideo: boolean
  downloadVideoAsFile: boolean
  videoDownloadMode: 'buffer' | 'file' | 'base64'
  maxDownloadedVideoSizeMB: number
  maxVideoSendSizeMB: number
  showStats: boolean
  showLink: boolean
  showError: boolean
  loggerinfo: boolean
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    enabled: Schema.boolean().default(true).description('开启小红书链接/卡片解析。'),
    parseMode: Schema.array(Schema.union([
      Schema.const('link').description('普通链接'),
      Schema.const('card').description('卡片消息'),
    ])).role('checkbox').default(['link', 'card']).description('选择解析来源。'),
    waitTip: Schema.union([
      Schema.const(null).description('不发送提示'),
      Schema.string().description('解析前发送提示语').default('正在解析小红书链接...'),
    ]).default(null).description('等待提示。'),
  }).description('基础设置'),
  Schema.object({
    useForward: Schema.boolean().default(false).description('开启合并转发。主要适用于 onebot / red 适配器。').experimental(),
    quote: Schema.boolean().default(true).description('普通发送时引用原消息。'),
    middleware: Schema.boolean().default(false).description('以前置中间件模式捕获消息。可以优先于其他插件捕获消息。当小红书链接因消息被其他插件提前拦截而无法解析时可开启，通常无需开启。').experimental(),
    parseLimit: Schema.number().min(1).max(10).step(1).default(3).description('单条消息最多解析的链接数量。'),
    minimumInterval: Schema.number().min(0).max(3600).step(1).default(180).description('同频道同链接去重间隔，单位秒。0 表示不去重。'),
  }).description('发送设置'),
  Schema.object({
    imageSendMode: Schema.union([
      Schema.const('url').description('直接发送小红书图片远程地址（默认）'),
      Schema.const('buffer').description('先下载图片，再以二进制 Buffer 方式发送（推荐，可缓解防盗链问题）'),
      Schema.const('base64').description('先下载图片，再转换成 data URL 发送'),
      Schema.const('file').description('先下载图片，写入临时文件并通过 file:// URL 发送（适合 NapCat 等本地网关场景）'),
    ]).default('url').description('图片发送方式。url 不下载图片，其他模式会先下载后发送。'),
    imageFormat: Schema.union([
      Schema.const('jpeg').description('jpeg'),
      Schema.const('png').description('png'),
      Schema.const('webp').description('webp'),
      Schema.const('heic').description('heic'),
      Schema.const('avif').description('avif'),
      Schema.const('auto').description('原图格式'),
    ]).default('jpeg').description('图片返回格式。'),
    showImages: Schema.boolean().default(true).description('返回图片。'),
    maxImages: Schema.number().min(0).max(18).step(1).default(9).description('单个笔记最多发送图片数。'),
    maxDescLength: Schema.number().min(0).max(2000).step(10).default(160).description('描述最大字数。设为 0 时不展示描述。'),
    descTruncateSuffix: Schema.string().default('...(已截断)').description('描述超出最大字数时追加的截断标志。'),
    showVideo: Schema.boolean().default(true).description('返回视频元素。'),
    downloadVideoAsFile: Schema.boolean().default(false).description('尝试先下载首个视频再发送，缓解 QQ / OneBot 等平台直链“资源已过期”的问题。会增加带宽消耗。'),
    videoDownloadMode: Schema.union([
      Schema.const('buffer').description('使用二进制 Buffer 方式发送视频（推荐）'),
      Schema.const('base64').description('使用 base64:// 段发送视频（OneBot 常用格式，buffer 失败时可尝试）'),
      Schema.const('file').description('写入临时文件并通过 file:// URL 发送（Napcat 等特殊环境）'),
    ]).default('buffer').description('下载视频后的发送方式。'),
    maxDownloadedVideoSizeMB: Schema.number().min(0).max(2048).step(1).default(20).description('下载视频大小上限，单位 MB。超过后自动回退为发送视频直链；设为 0 表示不限制。'),
    maxVideoSendSizeMB: Schema.number().min(0).max(2048).step(1).default(100).description('视频发送大小上限，单位 MB。超过后不发送视频，包括直链；设为 0 表示不限制。'),
    showStats: Schema.boolean().default(true).description('展示点赞、收藏、评论、分享数据。'),
    showLink: Schema.boolean().default(true).description('展示原文链接。'),
  }).description('内容设置'),
  Schema.object({
    userAgent: Schema.string().default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0').description('请求小红书页面时使用的 User-Agent。'),
    cookie: Schema.string().role('textarea').default('').description('可选 Cookie。遇到风控或无法读取页面数据时可填写。'),
    timeout: Schema.number().min(3).max(60).step(1).default(15).description('请求超时时间，单位秒。'),
    showError: Schema.boolean().default(false).description('解析失败时向聊天发送错误提示。'),
    loggerinfo: Schema.boolean().default(false).description('输出调试日志。').experimental(),
  }).description('网络与调试'),
])

export const usage = `
发送小红书链接或平台卡片即可自动解析。

支持示例：

- https://www.xiaohongshu.com/explore/...
- https://www.xiaohongshu.com/discovery/item/...
- https://xhslink.cn/o/...
- http://xhslink.com/m/AixEkyLwpfs
`

export function apply(ctx: Context, config: Config) {
  if (!config.enabled) return

  const recent = new Map<string, number>()

  ctx.middleware(async (session, next) => {
    const content = session.content || session.stripped?.content || ''
    const isCard = /^<\w+\s/i.test(content) || content.includes('data=')

    if (isCard && !config.parseMode.includes('card')) return next()
    if (!isCard && !config.parseMode.includes('link')) return next()

    const links = extractXhsLinks(content).slice(0, config.parseLimit)
    if (!links.length) return next()

    const targets = links.filter((link) => shouldProcess(recent, session.channelId || session.guildId || 'private', link, config.minimumInterval))
    if (!targets.length) return next()

    handleLinks(ctx, session, targets, config).catch((error) => {
      logger.warn(error)
    })

    return next()
  }, config.middleware)
}

async function handleLinks(ctx: Context, session: any, links: string[], config: Config) {
  let waitTipMessageId: string | undefined

  if (config.waitTip) {
    const result = await session.send(`${h.quote(session.messageId)}${config.waitTip}`)
    waitTipMessageId = Array.isArray(result) ? result[0] : result
  }

  try {
    const allMessages: h[] = []

    for (const link of links) {
      if (config.loggerinfo) logger.info(`parse ${link}`)
      let note = await fetchXhsNote(link, config)
      note = await prepareNoteImages(ctx, note, config)
      note = await prepareNoteVideo(ctx, note, config)
      allMessages.push(...buildXhsMessages(note, config, session))
    }

    if (!allMessages.length) return

    if (config.useForward && (session.platform === 'onebot' || session.platform === 'red')) {
      await session.send(h('figure', { children: allMessages }))
      return
    }

    if (config.quote) {
      await session.send(h('message', h.quote(session.messageId), allMessages[0].children))
      for (const message of allMessages.slice(1)) await session.send(message)
      return
    }

    for (const message of allMessages) await session.send(message)
  } catch (error) {
    logger.warn(error)
    if (config.showError) await session.send(`小红书解析失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (waitTipMessageId) {
      await session.bot?.deleteMessage?.(session.channelId, waitTipMessageId).catch?.(() => undefined)
    }
  }
}

async function prepareNoteImages(ctx: Context, note: XhsNote, config: Config): Promise<XhsNote> {
  const mode = config.imageSendMode || 'url'
  const imageUrls = note.imageUrls.slice(0, config.maxImages)

  if (!config.showImages || mode === 'url' || !imageUrls.length) {
    if (config.loggerinfo) {
      logger.info(`skip image download: showImages=${config.showImages}, mode=${mode}, imageUrls=${imageUrls.length}`)
    }
    return note
  }

  const preparedImages: NonNullable<XhsNote['preparedImages']> = []
  const http = ctx.http.extend({
    timeout: config.timeout * 1000,
    headers: {
      'User-Agent': config.userAgent,
      Referer: 'https://www.xiaohongshu.com/',
      ...(config.cookie ? { Cookie: config.cookie } : {}),
    },
  })

  for (const imageUrl of imageUrls) {
    try {
      if (config.loggerinfo) logger.info(`download image start: mode=${mode}, url=${imageUrl}`)

      const file = await http.file(imageUrl)
      const buffer = Buffer.from(file.data)
      if (!buffer.length) throw new Error('empty response data')

      const mimeType = resolveImageMimeType(buffer, file, config.imageFormat)
      if (mode === 'buffer') {
        preparedImages.push({ source: buffer, mimeType })
      } else if (mode === 'base64') {
        preparedImages.push({ source: `data:${mimeType};base64,${buffer.toString('base64')}` })
      } else {
        preparedImages.push({
          source: await createTempImageFile(buffer, mimeType),
        })
      }

      if (config.loggerinfo) {
        logger.info(`download image success: mode=${mode}, size=${formatBytes(buffer.length)}, mime=${mimeType}`)
      }
    } catch (error) {
      preparedImages.push({ source: imageUrl })
      if (config.loggerinfo) {
        logger.info(`download image failed, fallback=direct URL: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  return {
    ...note,
    preparedImages,
  }
}

async function prepareNoteVideo(ctx: Context, note: XhsNote, config: Config): Promise<XhsNote> {
  if (!config.showVideo) {
    if (config.loggerinfo) {
      logger.info('skip video: showVideo=false')
    }
    return note
  }

  const firstVideo = note.videoUrls[0]
  if (!firstVideo) {
    if (config.loggerinfo) logger.info('skip video download: no video URL found')
    return note
  }
  if (!/^https?:\/\//i.test(firstVideo)) {
    if (config.loggerinfo) logger.info(`skip video download: unsupported video URL protocol (${firstVideo})`)
    return note
  }

  const maxSendSizeBytes = getSizeLimitBytes(config.maxVideoSendSizeMB, 100)
  const remoteSize = await getRemoteVideoSize(ctx, firstVideo, config)
  if (remoteSize !== undefined && maxSendSizeBytes && remoteSize > maxSendSizeBytes) {
    if (config.loggerinfo) {
      logger.info(`skip video send: remote size=${formatBytes(remoteSize)}, max=${formatBytes(maxSendSizeBytes)}, url=${firstVideo}`)
    }
    return removeNoteVideos(note)
  }

  if (!config.downloadVideoAsFile) {
    if (config.loggerinfo) {
      logger.info('skip video download: downloadVideoAsFile=false, use direct URL')
    }
    return note
  }

  try {
    if (config.loggerinfo) {
      logger.info(`download first video start: url=${firstVideo}`)
    }

    const file = await ctx.http.file(firstVideo)
    if (!file?.data) {
      if (config.loggerinfo) logger.info('download video failed: empty response data')
      return note
    }

    const buffer = Buffer.from(file.data)
    const mimeType = (file as any).type || (file as any).mime || 'video/mp4'
    const mode = config.videoDownloadMode || 'buffer'
    const maxSizeBytes = config.maxDownloadedVideoSizeMB > 0
      ? config.maxDownloadedVideoSizeMB * 1024 * 1024
      : 0

    if (config.loggerinfo) {
      logger.info(`download first video success: size=${formatBytes(buffer.length)}, mime=${mimeType}, mode=${mode}, max=${maxSizeBytes ? formatBytes(maxSizeBytes) : 'unlimited'}`)
    }

    if (maxSendSizeBytes && buffer.length > maxSendSizeBytes) {
      if (config.loggerinfo) {
        logger.info(`skip video send: downloaded size=${formatBytes(buffer.length)}, max=${formatBytes(maxSendSizeBytes)}`)
      }
      return removeNoteVideos(note)
    }

    if (maxSizeBytes && buffer.length > maxSizeBytes) {
      if (config.loggerinfo) {
        logger.info(`downloaded video exceeds limit: size=${formatBytes(buffer.length)}, max=${formatBytes(maxSizeBytes)}, fallback=direct URL`)
      }
      return note
    }

    const remainingVideoUrls = note.videoUrls.slice(1)

    if (mode === 'buffer') {
      if (config.loggerinfo) {
        logger.info(`use downloaded video buffer: size=${formatBytes(buffer.length)}, remainingVideoUrls=${remainingVideoUrls.length}`)
      }
      return {
        ...note,
        videoBuffer: buffer,
        videoMimeType: mimeType,
        videoUrls: remainingVideoUrls,
      }
    }

    const replacement = mode === 'file'
      ? await createTempVideoFile(buffer, mimeType)
      : `base64://${buffer.toString('base64')}`

    if (config.loggerinfo) {
      logger.info(`use downloaded video ${mode}: src=${mode === 'file' ? replacement : `base64://${formatBytes(buffer.length)} raw`}, remainingVideoUrls=${remainingVideoUrls.length}`)
    }

    return {
      ...note,
      videoBuffer: undefined,
      videoMimeType: mimeType,
      videoUrls: [replacement, ...remainingVideoUrls],
    }
  } catch (error) {
    if (config.loggerinfo) logger.info(`download video failed: ${error instanceof Error ? error.message : String(error)}`)
    return note
  }
}

async function getRemoteVideoSize(ctx: Context, url: string, config: Config): Promise<number | undefined> {
  const maxSendSizeBytes = getSizeLimitBytes(config.maxVideoSendSizeMB, 100)
  if (!maxSendSizeBytes) return undefined

  try {
    if (config.loggerinfo) logger.info(`check remote video size start: url=${url}`)
    const headers = await ctx.http.head(url, { timeout: config.timeout * 1000 })
    const contentLength = headers.get('content-length')
    if (!contentLength) {
      if (config.loggerinfo) logger.info('check remote video size skipped: missing content-length')
      return undefined
    }

    const size = Number.parseInt(contentLength, 10)
    if (!Number.isFinite(size) || size < 0) {
      if (config.loggerinfo) logger.info(`check remote video size skipped: invalid content-length=${contentLength}`)
      return undefined
    }

    if (config.loggerinfo) logger.info(`check remote video size success: size=${formatBytes(size)}, max=${formatBytes(maxSendSizeBytes)}`)
    return size
  } catch (error) {
    if (config.loggerinfo) logger.info(`check remote video size failed: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

function removeNoteVideos(note: XhsNote): XhsNote {
  return {
    ...note,
    videoBuffer: undefined,
    videoUrls: [],
    videoSkippedMessage: VIDEO_TOO_LARGE_MESSAGE,
  }
}

function getSizeLimitBytes(sizeMB: number | undefined, fallbackMB: number): number {
  const normalized = sizeMB ?? fallbackMB
  return normalized > 0 ? normalized * 1024 * 1024 : 0
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function resolveImageMimeType(buffer: Buffer, file: unknown, format: Config['imageFormat']) {
  const reported = (file as any)?.mime || (file as any)?.type
  if (typeof reported === 'string' && reported.toLowerCase().startsWith('image/')) {
    return reported.split(';')[0].trim().toLowerCase()
  }

  if (buffer.length >= 12) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
    if (buffer.toString('ascii', 0, 3) === 'GIF') return 'image/gif'

    const brand = buffer.toString('ascii', 8, 12)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'image/heic'
  }

  if (format === 'auto') return 'image/jpeg'
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`
}

async function createTempImageFile(buffer: Buffer, mimeType: string): Promise<string> {
  const fileName = `xhs-image-${Date.now()}-${Math.random().toString(16).slice(2)}${getImageFileExtension(mimeType)}`
  const filePath = path.join(os.tmpdir(), fileName)
  await fs.writeFile(filePath, buffer)

  const cleanupTimer = setTimeout(() => {
    fs.unlink(filePath).catch(() => undefined)
  }, 10 * 60 * 1000)
  cleanupTimer.unref()

  return nodeUrl.pathToFileURL(filePath).href
}

function getImageFileExtension(mimeType: string) {
  const lower = mimeType.toLowerCase()
  if (lower.includes('png')) return '.png'
  if (lower.includes('webp')) return '.webp'
  if (lower.includes('gif')) return '.gif'
  if (lower.includes('heic') || lower.includes('heif')) return '.heic'
  if (lower.includes('avif')) return '.avif'
  return '.jpg'
}

async function createTempVideoFile(buffer: Buffer, mimeType: string): Promise<string> {
  const fileName = `xhs-video-${Date.now()}-${Math.random().toString(16).slice(2)}${getVideoFileExtension(mimeType)}`
  const filePath = path.join(os.tmpdir(), fileName)
  await fs.writeFile(filePath, buffer)
  return nodeUrl.pathToFileURL(filePath).href
}

function getVideoFileExtension(mimeType: string) {
  const lower = mimeType.toLowerCase()
  if (lower.includes('mp4')) return '.mp4'
  if (lower.includes('webm')) return '.webm'
  if (lower.includes('ogg') || lower.includes('ogv')) return '.ogv'
  if (lower.includes('flv')) return '.flv'
  return '.mp4'
}

function shouldProcess(recent: Map<string, number>, channelId: string, link: string, seconds: number) {
  if (seconds <= 0) return true

  const key = `${channelId}:${link}`
  const now = Date.now()
  const last = recent.get(key)
  if (last && now - last < seconds * 1000) return false

  recent.set(key, now)
  return true
}
