# koishi-plugin-xhs-parser-fork

这是 [nook4sh](https://github.com/nook4sh) 的 koishi-plugin-xhs-parser 的 fork 版，修复了小红书新版短链无法解析的问题。

小红书 / RedNote 链接解析插件，支持普通链接、`xhslink.com` 短链和聊天平台卡片消息中的链接提取，可选合并转发。

## 功能

- 解析 `https://www.xiaohongshu.com/explore/...`
- 解析 `https://www.xiaohongshu.com/discovery/item/...`
- 解析 `https://xhslink.com/...`，例如 `http://xhslink.com/m/AixEkyLwpfs`
- 从 Koishi 卡片元素的 `data` 字段、转义 JSON、普通文本中提取小红书链接
- 支持图片、视频链接、原文链接和基础互动数据返回
- 支持视频直链发送，或先下载首个视频后以 Buffer / base64 / file URL 模式发送
- 支持 OneBot / Red 适配器的合并转发元素

## 配置项

### 基础设置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 开启小红书链接和卡片解析。 |
| `parseMode` | `link, card` | 选择解析普通链接、卡片消息或同时解析两者。 |
| `waitTip` | 空 | 解析前发送的提示语。保持为空时不发送提示。 |

### 发送设置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `useForward` | `false` | 使用合并转发发送解析结果，主要适用于 OneBot 和 Red 适配器。 |
| `quote` | `true` | 普通发送时引用触发解析的消息。 |
| `middleware` | `false` | 以前置中间件模式捕获消息，可以优先于其他插件处理。小红书链接因消息被其他插件提前拦截而无法解析时可开启，通常无需开启。 |
| `parseLimit` | `3` | 单条消息最多解析的链接数量，可设置为 1 至 10。 |
| `minimumInterval` | `180` | 同一频道内相同链接的去重间隔，单位为秒。设置为 `0` 时不去重。 |

### 内容设置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `imageSendMode` | `url` | 图片发送方式。支持 `url`、`buffer`、`base64` 和 `file`。 |
| `imageFormat` | `jpeg` | 图片返回格式。支持 `jpeg`、`png`、`webp`、`heic`、`avif` 和保留原图格式的 `auto`。 |
| `showImages` | `true` | 返回笔记图片。 |
| `maxImages` | `9` | 单篇笔记最多发送的图片数量，可设置为 0 至 18。 |
| `maxDescLength` | `160` | 描述最大字数。设置为 `0` 时不展示描述。 |
| `descTruncateSuffix` | `...(已截断)` | 描述超过最大字数时追加的文字。 |
| `showVideo` | `true` | 返回笔记视频。 |
| `downloadVideoAsFile` | `false` | 先由 Koishi 下载首个视频再发送。下载失败时自动回退视频直链。 |
| `videoDownloadMode` | `buffer` | 下载视频后的发送方式。支持 `buffer`、`base64` 和 `file`。仅在 `downloadVideoAsFile` 开启时生效。 |
| `maxDownloadedVideoSizeMB` | `20` | 下载视频的大小上限，单位为 MB。超过上限时回退视频直链，设置为 `0` 时不限制。 |
| `maxVideoSendSizeMB` | `100` | 视频发送大小上限，单位为 MB。超过上限时不发送视频，设置为 `0` 时不限制。 |
| `showStats` | `true` | 展示点赞、收藏、评论和分享数据。 |
| `showLink` | `true` | 展示原始笔记链接。 |

#### 图片发送方式

| 模式 | 行为 | 适用场景 |
| --- | --- | --- |
| `url` | 直接发送小红书图片远程地址，不下载图片。 | 默认方式，速度快且资源占用低。可能受到防盗链和网络环境影响。 |
| `buffer` | Koishi 下载图片后以二进制 Buffer 发送。 | 推荐用于解决沙盒或适配器无法直接访问小红书图片的问题。 |
| `base64` | Koishi 下载图片后转换成 data URL 发送。 | 用于需要内联图片数据的适配器，消息体会明显增大。 |
| `file` | Koishi 下载图片到临时文件，再通过 `file://` 地址发送。 | 适合同机运行的 NapCat 等本地网关。临时图片会在十分钟后清理。 |

非 `url` 模式会携带小红书页面 Referer 下载图片。单张图片下载失败时会回退为远程地址，不影响同篇笔记中的其他内容。

#### 视频发送方式

| 配置 | 行为 |
| --- | --- |
| `downloadVideoAsFile: false` | 不下载视频，直接发送小红书视频直链。 |
| `downloadVideoAsFile: true` | 先由 Koishi 下载首个视频。下载失败时回退视频直链。 |
| `videoDownloadMode: buffer` | 使用二进制 Buffer 发送，通常最推荐。 |
| `videoDownloadMode: base64` | 转换成 `base64://...` 发送，适合部分 OneBot 实现。 |
| `videoDownloadMode: file` | 写入系统临时目录并通过 `file://` 地址发送，适合 NapCat 等本地网关。 |

下载模式只处理每篇笔记的首个视频，避免单次消息消耗过多带宽。

### 网络与调试

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `userAgent` | 内置浏览器 User Agent | 请求小红书页面和下载图片时使用的 User Agent。 |
| `cookie` | 空 | 可选的小红书 Cookie。遇到风控或无法读取页面数据时可填写。 |
| `timeout` | `15` | 网络请求超时时间，单位为秒，可设置为 3 至 60。 |
| `showError` | `false` | 解析失败时向聊天发送错误提示。 |
| `loggerinfo` | `false` | 输出链接解析、媒体下载、大小判断和失败回退等调试日志。 |

## 更新日志

### 0.1.6

1. 调整 npm 发布配置，允许从 Koishi 工作区发布插件。

### 0.1.5

1. 支持 `xhslink.cn` 新版小红书分享短链。
2. 新增 `url`、`buffer`、`base64` 和 `file` 四种图片发送方式。
3. 非 URL 模式下载单张图片失败时自动回退远程地址，避免整篇笔记解析失败。
