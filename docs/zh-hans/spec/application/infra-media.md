# infra 媒体标准

> 标识：NETON-APP-INFRA-MEDIA
> 日期：2026-10-15 · 状态：Draft r2（关联契约、临时文件生命周期、按引用授权、并发安全清理）
> 归属：`neton-application-module-infra`（在现有文件上传能力上扩展）
> 适用：所有需要图片、视频、音频、附件的模块与产品，例如新闻配图、商品图、评论图片、用户头像、视频源文件。

## 1. 原则

- **一个入口**：所有媒体经 infra 上传、存储、处理和访问。业务模块不自己对接对象存储，也不自己转码。
- **只存引用**：业务数据保存 `MediaRef(fileId)`，不保存 URL。访问地址由 infra 按访问者、存储配置和派生规格生成；更换存储或 CDN 时业务数据不变。
- **业务类型驱动**：每类上传是一个 businessType，由拥有它的模块注册，策略随类型走。
- **访问控制归拥有者**：公开或仅本人的规则由 infra 直接判断；依赖业务状态的访问（例如会员可见的文章里的图片）回调拥有模块判断。一句话：**infra 负责文件与派生资源；业务模块决定对象能否被访问；二者通过授权契约协作。**
- **上传成功不等于可以使用**：上传得到的是临时文件，经业务模块确认关联后才进入生命周期（§6）。
- **只管平台托管的文件**：外部链接（来源原文、合作方跳转）不是媒体，由业务模块按 `ExternalLink` 保存；需要纳入平台的外部文件经服务端转存（§4.3）。

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

## 6. 关联与生命周期

### 6.1 状态

```
上传完成 ──► temporary ──attach──► attached ──最后一个引用 detach──► orphaned ──宽限期──► deleted
               │                       ▲                                   │
               └──宽限期内未关联──► deleted       └──── 宽限期内重新 attach ────┘
```

### 6.2 关联契约

```kotlin
interface MediaService {
    /** 确认关联。失败时返回明确原因，不静默放行。 */
    suspend fun attach(fileId: String, owner: ObjectRef, usage: String, actor: Actor): AttachResult
    suspend fun detach(fileId: String, owner: ObjectRef, usage: String)
    /** 对象删除时解除它的全部引用。 */
    suspend fun detachAll(owner: ObjectRef)
    suspend fun resolve(refs: List<MediaRef>, viewer: Viewer?, variant: String? = null): Map<String, MediaView>
    suspend fun importFromUrl(businessType: String, url: String, owner: ObjectRef, actor: Actor): MediaRef
}
```

`attach` 的校验，任何一项不通过都拒绝：

| 校验 | 规则 |
| --- | --- |
| 存在性 | 文件存在，状态不是 deleted 或清理中 |
| 用途匹配 | 文件的 businessType 允许用于 `usage`（由 businessType 注册时声明可用于哪些用途） |
| 处理状态 | 视频等需要处理的文件，未处理完成时只能关联到声明接受处理中状态的用途 |
| 归属 | temporary 文件只能由上传者本人关联；已关联文件被其他对象再次引用时，businessType 必须声明允许复用，且操作者对原文件有读取权限 |
| 数量与大小 | 用途可声明单个对象的引用数量上限（如评论最多 9 张图） |

- **多重引用**：`media_references(file_id, owner_type, owner_id, usage)` 一行一个引用。删除对象只解除自己的引用，其他对象不受影响。
- **并发安全**：attach 与清理对同一文件互斥（按文件加行锁）。清理任务只处理在锁内确认引用数为 0 且已过宽限期的文件；已进入清理的文件拒绝 attach，已开始 attach 的文件不会被清理。
- **宽限期**：temporary 和 orphaned 文件的保留期按 businessType 配置（默认 temporary 24 小时、orphaned 7 天），覆盖「上传后编辑很久才保存」「撤销删除」等情况。

## 7. 访问与地址

### 7.1 访问判断

| businessType 的访问方式 | 判断 |
| --- | --- |
| `PUBLIC` | 任何人可读 |
| `OWNER` | 仅上传者可读 |
| `DELEGATED` | 逐个引用调用引用对象所属模块的 `ObjectAccessPolicy.check(viewer, owner, "view")`，**任一引用对象对访问者可见即允许**；没有引用的 temporary 文件只有上传者可读 |

### 7.2 地址

- `PUBLIC`：可以使用长期地址（公开桶或 CDN）。
- `OWNER`、`DELEGATED`：**只签发短期签名地址**（默认 10 分钟），不生成永久公开地址。引用对象变为不可见后，不再签发新地址，已签发的地址到期失效。
- 同一文件既有公开引用也有私密引用时，按访问方式统一走签名地址。不因为某个引用公开，就给文件一个永久公开地址。
- `resolve` 是批量接口；处理中的视频返回 `status=processing`。

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
| M1 | businessType 注册表开放、临时文件与 attach / detach 校验、`DELEGATED` 访问与短期签名地址、`resolve`、并发安全清理、服务端转存 |
| M2 | 图片派生版本（按首个产品的需要安排，不阻塞 M1） |
| M3 | 分片 / 断点续传、秒传 |
| M4 | 视频处理（探测、转码、截帧、HLS）、处理器可替换 |

内容平台首个闭环只依赖 M1；M2 视产品需要；M3、M4 在大文件或视频场景立项时同步排期。
