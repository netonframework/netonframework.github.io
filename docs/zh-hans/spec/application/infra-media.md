# infra 媒体标准

> 标识：NETON-APP-INFRA-MEDIA
> 日期：2026-10-15 · 状态：Draft
> 归属：`neton-application-module-infra`（在现有文件上传能力上扩展）
> 适用：所有需要图片、视频、音频、附件的模块与产品，例如新闻配图、商品图、评论图片、用户头像、视频源文件。

## 1. 原则

- **一个入口**：所有媒体经 infra 上传、存储、处理和访问。业务模块不自己对接对象存储，也不自己转码。
- **只存引用**：业务数据保存 `MediaRef(fileId)`，不保存 URL。访问地址由 infra 按访问者、存储配置和派生规格生成；更换存储或 CDN 时业务数据不变。
- **业务类型驱动**：每类上传是一个 businessType，由拥有它的模块注册，策略随类型走。
- **访问控制归拥有者**：公开或仅本人的规则由 infra 直接判断；依赖业务状态的访问（例如会员可见的文章里的图片）回调拥有模块判断。

## 2. 现状（2026-10-15）

| 能力 | 现状 |
| --- | --- |
| 用户端单文件上传 `POST /app/infra/file/upload`（multipart，`file` + `businessType`） | 已有 |
| businessType 策略：MIME 白名单、大小上限、可见性（PUBLIC / PRIVATE） | 已有，但策略表是内置默认值，模块不能注册 |
| 内容寻址存储路径（`{businessType}/{sha256 前缀}/{sha256}.{ext}`）与 fileId | 已有 |
| `GET /app/infra/file/get/{fileId}` 按可见性读取 | 已有 |
| 后台上传、预签名地址、多存储配置（主存储切换） | 已有 |
| 图片处理策略 `ImagePolicy` | 只有字段，未执行 |
| 分片 / 断点续传、视频处理、委托授权、引用登记与清理 | 没有 |

本规范描述补齐后的标准；已有接口保持语义不变并纳入标准。

## 3. 业务类型注册

```kotlin
mediaRegistry.register(
    MediaBusinessType(
        code = "content.image",                     // <模块>.<用途>
        kinds = setOf(MediaKind.IMAGE),             // IMAGE / VIDEO / AUDIO / FILE
        allowedMimeTypes = setOf("image/jpeg", "image/png", "image/webp", "image/gif"),
        maxSizeBytes = 20 * MB,
        access = MediaAccess.DELEGATED,             // PUBLIC / OWNER / DELEGATED
        image = ImagePolicy(variants = listOf(
            ImageVariant("thumb", width = 360, fit = Fit.COVER, format = "webp"),
            ImageVariant("large", width = 1440, fit = Fit.INSIDE, format = "webp"),
        )),
        retention = Retention.WhileReferenced(graceDays = 7),
    )
)
```

| 访问方式 | 判断 |
| --- | --- |
| `PUBLIC` | 任何人可读（头像、公开文章配图） |
| `OWNER` | 仅上传者可读（反馈附件、证件） |
| `DELEGATED` | 回调拥有模块的 `MediaAccessPolicy.canRead(viewer, fileId, references)`，拥有模块按引用它的业务对象状态判断 |

- businessType 只能由模块在初始化时注册，未注册的类型拒绝上传。
- 内置类型保留：`member.avatar`、`feedback.attachment` 等现有类型迁入注册表，code 不变。

## 4. 上传

### 4.1 单文件上传

保持现有 `POST /app/infra/file/upload`，适合 ≤ 20MB 的图片和附件；后台上传同理。

### 4.2 分片 / 断点续传

大文件和视频使用：

| 接口 | 说明 |
| --- | --- |
| `POST /app/infra/media/upload/init` | 参数：businessType、文件名、大小、MIME、整体 sha256（可选）。若内容已存在且调用者有权复用，直接返回 fileId（秒传）；否则返回 uploadId、分片大小、已完成分片 |
| `PUT /app/infra/media/upload/{uploadId}/part/{n}` | 上传一个分片（或返回对象存储的分片预签名地址，客户端直传） |
| `POST /app/infra/media/upload/{uploadId}/complete` | 校验分片和摘要，合并，返回 fileId |
| `DELETE /app/infra/media/upload/{uploadId}` | 放弃，清理已传分片 |

- 未完成的上传会话按过期时间清理。
- 校验失败（大小、MIME 嗅探、摘要不符）在 complete 时拒绝并清理。

### 4.3 服务端转存

供其他模块（如 collect 转存外链图片、视频）调用：`MediaService.importFromUrl(businessType, url, ownerRef)`，带超时、大小上限和 MIME 嗅探，结果同样是 fileId。

## 5. 处理

### 5.1 图片

按 businessType 的 `ImagePolicy` 在上传完成后异步生成派生版本（缩略、裁剪、格式转换、质量），记录尺寸。原图保留。

### 5.2 视频

按 businessType 的 `VideoPolicy` 在上传完成后进入处理队列：

| 步骤 | 产出 |
| --- | --- |
| 探测 | 时长、分辨率、编码、码率、旋转 |
| 转码 | 按规格档（如 360p / 720p / 1080p）输出；可选 HLS 切片 |
| 截帧 | 封面候选图（作为图片派生版本） |
| 完成 | 发出 `infra.media.processed` 事件，失败发出 `infra.media.failed` |

- 处理是 infra 的标准能力；视频领域模块（播放授权、清晰度切换、统计）只消费处理结果，不重复转码。
- 处理器可替换：`MediaProcessor` 接口，默认实现调用本机 ffmpeg，也可以接云端媒体处理服务。

### 5.3 音频与附件

音频只探测时长；附件只做 MIME 嗅探和大小校验。

## 6. 访问与地址

```kotlin
interface MediaService {
    suspend fun resolve(refs: List<MediaRef>, viewer: Viewer?, variant: String? = null): Map<String, MediaView>
    suspend fun reference(fileId: String, owner: ObjectRef)      // 登记引用
    suspend fun unreference(fileId: String, owner: ObjectRef)    // 解除引用
    suspend fun importFromUrl(businessType: String, url: String, owner: ObjectRef): MediaRef
}
// MediaView：fileId, url, mimeType, size, width?, height?, duration?, variants(名称 → url、尺寸), status(processing / ready / failed)
```

- 地址形式由存储配置决定：公开桶地址、签名地址（带有效期）、CDN 地址。`DELEGATED` 和 `OWNER` 类型只给签名地址。
- `resolve` 是批量接口，业务模块在组装响应时一次调用。
- 处理中的视频返回 `status=processing`，客户端显示处理中状态。

## 7. 引用与清理

- 业务模块在保存数据时登记引用（`reference(fileId, owner)`），替换或删除时解除引用。
- 无引用的文件在 businessType 的宽限期后清理；同一内容寻址文件被多个业务引用时，最后一个引用解除后才清理。
- 刚上传、尚未被引用的文件（用户上传后没有提交）在宽限期后同样清理。

## 8. 事件

| 事件 | 投递方式 |
| --- | --- |
| `infra.media.uploaded` | 可重试 |
| `infra.media.processed` / `infra.media.failed` | 可重试 |
| `infra.media.deleted` | 可重试 |

## 9. 后台

存储配置（已有）、businessType 列表（只读，展示注册结果和策略）、文件浏览（按类型、上传者、引用对象）、处理队列与失败重试、存储用量统计。

## 10. 分期

| 期 | 内容 |
| --- | --- |
| M1 | businessType 注册表开放、`DELEGATED` 访问回调、`MediaService.resolve` / 引用登记 / 清理、图片派生版本、服务端转存 |
| M2 | 分片 / 断点续传、秒传 |
| M3 | 视频处理（探测、转码、截帧、HLS）、处理器可替换 |

内容平台套件阶段 0 需要 M1；视频类平台需要 M2、M3。
