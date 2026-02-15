# Neton Storage 模块规范（Phase 1）

> **目标**：轻量级统一存储抽象——借鉴 OpenDAL Operator 概念，Phase 1 只做 Local + S3 两种后端。  
> **验收闭环**：用 Local 和 S3（MinIO）跑通文件的上传、下载、删除、列表。  
> **附带成果**：冻结 v1.0 客户端类模块统一配置规范（`[[sources]]`），database/redis/storage 一步到位。

---

## 0. 前置结论（冻结）

### 0.1 v1.0 配置冻结：客户端类模块统一 `[[sources]]`

**适用范围**：database、redis、storage——所有"客户端类模块"。

**冻结规则**：

| 规则 | 说明 |
|------|------|
| 配置格式 | `[[sources]]` 数组，每个元素必须含 `name` |
| 默认源 | `name = "default"` 为保留名，代表默认源，**必须存在** |
| 旧格式 | `[default]`、`[database.default]`、根级平铺 —— 全部禁止，启动 fail-fast |
| name 约束 | 不可缺失、不可空串、不可重复，违反则 fail-fast |
| 文件名 = 命名空间 | `database.conf` → database 模块；`redis.conf` → redis 模块；`storage.conf` → storage 模块 |

**冻结声明**（写入 Core Spec）：

> v1.0 Frozen：客户端类模块（database/redis/storage）配置统一为 `[[sources]]`，必须包含 `name="default"`；旧 `[default]` 格式不兼容，启动 fail-fast。

#### database.conf

```toml
[[sources]]
name = "default"
driver = "POSTGRESQL"
uri = "postgresql://postgres:password@localhost:5432/myapp"

[[sources]]
name = "analytics"
driver = "MYSQL"
uri = "mysql://root:password@localhost:3306/analytics"
```

#### redis.conf

```toml
[[sources]]
name = "default"
host = "127.0.0.1"
port = 6379
database = 0

[[sources]]
name = "session"
host = "10.0.0.2"
port = 6379
database = 1
```

#### storage.conf

```toml
[[sources]]
name = "default"
type = "local"
basePath = "./uploads"

[[sources]]
name = "oss"
type = "s3"
endpoint = "https://oss-cn-hangzhou.aliyuncs.com"
region = "cn-hangzhou"
bucket = "my-bucket"
accessKey = "LTAI5txxxx"
secretKey = "xxxx"
```

### 0.2 统一解析规则（冻结）

所有客户端类模块统一走：

```kotlin
val cfg = ConfigLoader.loadModuleConfig("storage", configPath, env, args)
val sources = cfg?.get("sources") as? List<Map<String, Any?>>
```

**fail-fast 规则**：

| 条件 | 行为 |
|------|------|
| `sources` 缺失 | fail-fast：`"storage.conf: missing [[sources]]"` |
| `sources` 为空列表 | fail-fast：`"storage.conf: [[sources]] is empty"` |
| 元素缺少 `name` | fail-fast：`"storage.conf: source missing 'name'"` |
| `name` 为空串 | fail-fast：`"storage.conf: source 'name' cannot be blank"` |
| `name` 重复 | fail-fast：`"storage.conf: duplicate source name 'xxx'"` |
| 无 `name = "default"` | fail-fast：`"storage.conf: missing source with name='default'"` |

### 0.3 统一 API 约定（冻结）

所有客户端类模块对外暴露两类对象：

| 对象 | 获取方式 | 说明 |
|------|---------|------|
| **默认客户端** | `ctx.get(StorageOperator::class)` | 返回 `name="default"` 的实例 |
| **多源管理器** | `ctx.get(StorageManager::class)` | `.get("oss")` 获取指定源 |

三个模块统一命名模式：

| 模块 | 默认客户端 | 管理器 |
|------|----------|--------|
| database | `ctx.get(Database::class)` | `ctx.get(DatabaseManager::class).get("analytics")` |
| redis | `ctx.get(RedisClient::class)` | `ctx.get(RedisManager::class).get("session")` |
| storage | `ctx.get(StorageOperator::class)` | `ctx.get(StorageManager::class).get("oss")` |

**Manager 行为冻结**：

```kotlin
interface StorageManager {
    /** 获取指定源；name 不存在 → throw IllegalStateException */
    fun get(name: String): StorageOperator

    /** 获取默认源（等价于 get("default")） */
    fun default(): StorageOperator

    /** 所有已注册的源名称 */
    fun names(): Set<String>
}
```

### 0.4 后端支持策略

| 后端 | 策略 | 说明 |
|------|------|------|
| **Local** | P0，默认 | 本地文件系统，零依赖，开发环境首选 |
| **S3** | P0，必须同批支持 | 兼容 AWS S3 / MinIO / 阿里云 OSS / 腾讯云 COS / Cloudflare R2 |
| FTP/SFTP | P2，按需 | 留扩展接口，Phase 1 不实现 |
| 数据库 | 不做 | 不是存储模块的职责 |

### 0.5 命名冻结表（Phase 1 起生效）

| 能力 | 命名 | 说明 |
|------|------|------|
| 统一接口 | `StorageOperator` | 借鉴 OpenDAL Operator 概念 |
| 多源管理 | `StorageManager` | 管理多个 StorageOperator 实例 |
| 组件 | `StorageComponent` | NetonComponent 生命周期 |
| 配置 | `StorageConfig` | DSL 配置类 |
| 写入 | `write(path, data)` | 上传/写入文件 |
| 读取 | `read(path)` | 下载/读取文件 |
| 删除 | `delete(path)` | 删除文件 |
| 存在 | `exists(path)` | 判断文件是否存在 |
| 元信息 | `stat(path)` | 获取文件元信息（大小、修改时间等） |
| 列表 | `list(path)` | 列出目录/前缀下的文件 |
| 复制 | `copy(src, dst)` | 复制文件 |
| 移动 | `move(src, dst)` | 移动/重命名文件 |
| 预签名读 | `presignRead(path, ttl)` | 生成预签名读取 URL（S3） |
| 预签名写 | `presignWrite(path, ttl)` | 生成预签名上传 URL（S3） |

---

## 1. Phase 1（P0）能力清单

| 编号 | 能力 | 验收标准 |
|------|------|----------|
| **P0-1** | Local 文件存储 | read/write/delete/exists/stat/list/copy/move 全链路可用 |
| **P0-2** | S3 协议存储 | 同上 + presignRead/presignWrite；MinIO 验证通过 |
| **P0-3** | AWS Signature V4 | 纯 Kotlin 实现签名算法，不依赖外部 native binding |
| **P0-4** | 多源配置 | `[[sources]]` 支持多源，StorageManager 按 name 获取 |
| **P0-5** | StorageComponent 集成 | 遵循 NetonComponent 生命周期，绑定到 NetonContext |
| **P0-6** | 跨平台支持 | macosArm64/macosX64/linuxX64/linuxArm64/mingwX64 全部编译通过 |

---

## 2. StorageOperator 接口（冻结）

```kotlin
interface StorageOperator {
    /** 后端类型标识："local" | "s3" */
    val scheme: String

    /** 当前源的配置名称（对应 [[sources]] 的 name） */
    val name: String

    // ===== 核心操作 =====

    /** 写入文件；path 为相对路径（如 "avatars/1.jpg"）。Phase 1 仅适用于 ≤32MB 小文件，大文件请使用 Phase 2 writeStream */
    suspend fun write(path: String, data: ByteArray, options: WriteOptions = WriteOptions())

    /** 读取文件内容。Phase 1 仅适用于 ≤32MB 小文件，大文件请使用 Phase 2 readStream */
    suspend fun read(path: String): ByteArray

    /** 删除文件 */
    suspend fun delete(path: String)

    /** 判断文件是否存在 */
    suspend fun exists(path: String): Boolean

    /** 获取文件元信息 */
    suspend fun stat(path: String): FileStat

    /** 列出目录/前缀下的文件 */
    suspend fun list(path: String, options: ListOptions = ListOptions()): List<FileEntry>

    /** 复制文件 */
    suspend fun copy(src: String, dst: String)

    /** 移动/重命名文件 */
    suspend fun move(src: String, dst: String)

    // ===== 预签名（S3 专属，Local 抛 UnsupportedOperationException） =====

    /** 生成预签名读取 URL */
    suspend fun presignRead(path: String, ttl: Duration): String

    /** 生成预签名上传 URL */
    suspend fun presignWrite(path: String, ttl: Duration): String
}
```

**设计说明**：

- `path` 统一为**相对路径**，不含前导 `/`。示例：`"uploads/avatar.jpg"`、`"documents/2026/02/report.pdf"`。
- Local 后端：`basePath + "/" + path` 拼接为绝对路径。
- S3 后端：`path` 直接作为 object key。
- `presignRead` / `presignWrite`：Local 后端抛 `UnsupportedOperationException`（本地文件不需要预签名）。
- Phase 1 的 `write` 为**整体写入**（ByteArray），不支持流式；大文件分片上传（Multipart Upload）留 Phase 2。

**⚠ Phase 1 内存限制（冻结）**：

`write(path, ByteArray)` 和 `read(path): ByteArray` 会将**整个文件内容加载到内存**。对于超大文件（>100MB），存在 OOM / GC 压力 / 延迟爆炸风险。

| 约束 | 说明 |
|------|------|
| 适用场景 | 头像、附件、配置文件等中小文件（< 32MB） |
| 不适用场景 | 视频、大型备份、网盘等超大文件 |
| HTTP 层配合 | **强烈建议**在 neton-http 配置 `maxBodyBytes`（默认 16MB 或 32MB），超过返回 `413 Payload Too Large`，避免用户误用 Phase 1 API 上传大文件导致进程 OOM |
| Phase 2 解决方案 | 增加 `writeStream` / `readStream` + S3 Multipart Upload |

**Phase 1 冻结结论**：ByteArray API 仅适用于小文件（≤ 32MB）；大文件必须使用 Phase 2 streaming API。

**两层防护**：
- **Storage 层**：API 为 ByteArray，不保证安全处理大文件。即使绕过 HTTP（如 job/cli 场景直接调用 `write(ByteArray)`），超大 ByteArray 仍然会导致 OOM。
- **HTTP 层**：`server.maxBodyBytes`（建议默认 16-32MB）+ 413 响应，在入口拦截大请求。两层配合才能真正防止 OOM。

**实现建议（非冻结，不约束具体实现方式）**：

虽然 API 是 ByteArray，实现层仍应尽量减少中间拷贝，降低内存峰值（从 ~2x 降到 ~1x）：

| 操作 | 建议 |
|------|------|
| Local write | 按 chunk 写入文件，避免将 ByteArray 额外复制到中间 buffer |
| S3 write | 将 ByteArray 包装为 Ktor `ByteReadChannel` 作为 request body 发送，避免构造额外副本 |
| Local read | 先 stat 获取 size，预分配 ByteArray，一次性读入，避免多次拼接扩容 |
| S3 read | 从 response body 流式读取，预分配（Content-Length 已知时）或 grow buffer，避免中间多份累积 |

> 这些是性能最佳实践，不是行为契约。实现方可根据实际情况调整策略。

---

## 3. 数据结构（冻结）

### 3.1 FileStat — 文件元信息

```kotlin
data class FileStat(
    val path: String,
    val size: Long,                   // 字节数
    val lastModified: Long,           // epoch millis
    val isDirectory: Boolean,
    val contentType: String? = null    // MIME 类型（S3 从 Content-Type 头获取；Local 按扩展名推断）
)
```

### 3.2 FileEntry — 列表条目

```kotlin
data class FileEntry(
    val path: String,
    val size: Long,
    val lastModified: Long,
    val isDirectory: Boolean
)
```

### 3.3 WriteOptions — 写入选项

```kotlin
data class WriteOptions(
    val contentType: String? = null,  // 不指定则按扩展名推断
    val overwrite: Boolean = true     // false 时文件已存在则抛异常（见下方说明）
)
```

**`overwrite = false` 实现规则（冻结）**：

| 后端 | 实现方式 |
|------|---------|
| Local | 先 `exists()` 检查，文件已存在 → 抛 `StorageAlreadyExistsException` |
| S3 | PutObject 请求附加 `If-None-Match: *` header；若服务端返回 `412 Precondition Failed` → 抛 `StorageAlreadyExistsException` |

> **注意**：并非所有 S3 兼容服务都支持 `If-None-Match`（如部分旧版 MinIO）。若服务端忽略此 header 导致静默覆盖，属于服务端行为，框架不做额外兜底。文档和 CHANGELOG 中标注此为 best-effort 语义。

### 3.4 ListOptions — 列表选项

```kotlin
data class ListOptions(
    val recursive: Boolean = false,   // true 递归列出子目录
    val maxResults: Int = 1000        // 最大返回条数
)
```

---

## 4. Local 后端实现规范

### 4.1 配置

```toml
[[sources]]
name = "default"
type = "local"
basePath = "./uploads"    # 基础路径，相对于工作目录或绝对路径
```

```kotlin
data class LocalStorageConfig(
    val name: String,
    val basePath: String
)
```

### 4.2 操作映射

| StorageOperator 方法 | Local 实现 |
|---------------------|-----------|
| `write(path, data)` | 创建父目录（递归 mkdir）→ open → write → close |
| `read(path)` | open → read → close |
| `delete(path)` | unlink（文件）/ rmdir（空目录） |
| `exists(path)` | stat 不报错 → true |
| `stat(path)` | platform.posix.stat() 获取 size、mtime |
| `list(path)` | opendir → readdir 循环 → closedir |
| `copy(src, dst)` | read(src) → write(dst) |
| `move(src, dst)` | rename()；跨设备时 fallback 为 copy + delete |
| `presignRead` | 抛 `UnsupportedOperationException` |
| `presignWrite` | 抛 `UnsupportedOperationException` |

### 4.3 平台差异处理

Local 后端使用平台原生文件 I/O，需要 `posixMain` + `mingwX64Main` 分别实现（与 neton-logging FileSinkNative 模式一致）。

| 操作 | posixMain (macOS/Linux) | mingwX64Main (Windows) |
|------|------------------------|----------------------|
| mkdir | `mkdir(path, 0755u)` | `mkdir(path)` — 无 mode 参数 |
| stat | `platform.posix.stat()` | `platform.posix.stat()` — 相同 |
| opendir/readdir | `platform.posix.opendir/readdir` | `platform.posix.opendir/readdir` — MinGW 支持 |
| rename | `platform.posix.rename()` | `platform.posix.rename()` — 相同 |
| unlink | `platform.posix.unlink()` | `platform.posix.unlink()` — 相同 |

**差异极小**，主要是 `mkdir` 的 mode 参数。可将文件 I/O 抽象为 `expect/actual` 的 `FileSystem` 内部接口，posixMain 和 mingwX64Main 各自实现。

### 4.4 路径安全

- **禁止路径穿越**：path 中不允许 `..`，检测到则抛 `IllegalArgumentException`。
- **禁止绝对路径**：path 不允许以 `/` 或 `\` 开头。
- **路径分隔符**：内部统一用 `/`，Windows 输出时转换。

---

## 5. S3 后端实现规范

### 5.1 配置

```toml
[[sources]]
name = "oss"
type = "s3"
endpoint = "https://s3.amazonaws.com"  # 或 MinIO / 阿里云 OSS 地址
region = "us-east-1"
bucket = "my-bucket"
accessKey = "AKIAIOSFODNN7EXAMPLE"
secretKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
pathStyle = false                       # true 用于 MinIO（http://host/bucket/key）
```

```kotlin
data class S3StorageConfig(
    val name: String,
    val endpoint: String,
    val region: String,
    val bucket: String,
    val accessKey: String,
    val secretKey: String,
    val pathStyle: Boolean = false      // MinIO 需要 true
)
```

**pathStyle 说明**：
- `false`（默认）：虚拟主机风格 `https://bucket.s3.amazonaws.com/key`
- `true`：路径风格 `https://s3.amazonaws.com/bucket/key`（MinIO、本地 S3 网关常用）

**URL 拼接规则（冻结）**：

给定 `endpoint = "https://host:port"`（或 `http://host:port`），`bucket = "my-bucket"`，`key = "path/to/file.jpg"`：

| pathStyle | 请求 URL | Host header |
|-----------|---------|-------------|
| `true` | `{endpoint}/{bucket}/{key}` → `https://host:port/my-bucket/path/to/file.jpg` | `host:port` |
| `false` | `{scheme}://{bucket}.{host}:{port}/{key}` → `https://my-bucket.host:port/path/to/file.jpg` | `my-bucket.host:port` |

**实现注意事项**：
- endpoint 必须解析出 scheme、host、port 三部分（端口省略时 https=443，http=80）
- `pathStyle=false` 时，Host header 必须包含 bucket 前缀，签名中的 Host 必须与实际请求一致
- MinIO 本地开发（`http://127.0.0.1:9000`）**必须** `pathStyle=true`，因为 IP 地址不支持虚拟主机风格

### 5.2 操作映射

| StorageOperator 方法 | S3 API | HTTP 方法 |
|---------------------|--------|-----------|
| `write(path, data)` | PutObject | `PUT /{key}` |
| `read(path)` | GetObject | `GET /{key}` |
| `delete(path)` | DeleteObject | `DELETE /{key}` |
| `exists(path)` | HeadObject | `HEAD /{key}`（200=存在，404=不存在） |
| `stat(path)` | HeadObject | `HEAD /{key}`（Content-Length、Last-Modified、Content-Type） |
| `list(path)` | ListObjectsV2 | `GET /?list-type=2&prefix={path}`（见下方 recursive 语义） |
| `copy(src, dst)` | CopyObject | `PUT /{dst}` + `x-amz-copy-source: /{bucket}/{encodedSrc}`（src 需 percent-encode） |
| `move(src, dst)` | CopyObject + DeleteObject | copy → delete |
| `presignRead(path, ttl)` | Presigned URL | Query String 签名（GET） |
| `presignWrite(path, ttl)` | Presigned URL | Query String 签名（PUT） |

**`list()` recursive 语义（冻结）**：

| `ListOptions.recursive` | S3 请求参数 | 效果 |
|--------------------------|-----------|------|
| `false`（默认） | `delimiter=/` | 只返回当前"目录"下的直接子项，子目录作为 `CommonPrefixes` 返回（`isDirectory=true`） |
| `true` | 不传 `delimiter` | 返回 prefix 下所有层级的 object，平铺列出 |

Local 后端同理：`recursive=false` 时只列出一级子项，`recursive=true` 时递归遍历所有子目录。

**目录条目返回规则（冻结）**：

| `recursive` | 后端 | 目录条目行为 |
|-------------|------|-------------|
| `false` | S3 | `CommonPrefixes` 中的每个前缀转为 `FileEntry(isDirectory=true, path="prefix/")`，path **保留尾部 `/`** |
| `false` | Local | 子目录返回 `FileEntry(isDirectory=true, path="dirname/")`，path **保留尾部 `/`** |
| `true` | S3 | 只返回 object entries（`isDirectory=false`）；S3 没有真正的"目录"概念 |
| `true` | Local | 只返回文件 entries（`isDirectory=false`）；跳过目录本身，只递归其内容 |

> **约定**：`isDirectory=true` 的条目 `size=0`、`lastModified=0`（S3 CommonPrefixes 不提供这些信息）。调用方通过尾部 `/` 或 `isDirectory` 判断是否为目录。

### 5.3 AWS Signature V4 签名（纯 Kotlin 实现）

**依赖**：cryptography-kotlin（HMAC-SHA256）+ SHA-256 哈希。

**时间格式（冻结）**：

| 名称 | 格式 | 示例 |
|------|------|------|
| `amzDate` | `YYYYMMDD'T'HHMMSS'Z'` | `20260214T093000Z` |
| `dateStamp` | `YYYYMMDD` | `20260214` |

所有签名时间一律使用 **UTC**，不允许偏移量。文档中不再使用"ISO 8601"来描述此格式。

**签名流程**（冻结）：

```
1. CanonicalRequest = HTTPMethod + "\n" + CanonicalURI + "\n" + CanonicalQueryString + "\n"
                    + CanonicalHeaders + "\n" + SignedHeaders + "\n" + HashedPayload

2. StringToSign = "AWS4-HMAC-SHA256" + "\n" + amzDate + "\n"
               + Scope(dateStamp/region/s3/aws4_request) + "\n" + SHA256(CanonicalRequest)

3. SigningKey = HMAC(HMAC(HMAC(HMAC("AWS4" + secretKey, dateStamp), region), "s3"), "aws4_request")

4. Signature = HexEncode(HMAC(SigningKey, StringToSign))

5. Authorization = "AWS4-HMAC-SHA256 Credential=accessKey/scope, SignedHeaders=..., Signature=..."
```

**CanonicalRequest 构造规则（冻结）**：

| 规则 | 说明 |
|------|------|
| CanonicalHeaders | 所有参与签名的 header **key 转小写**，value 前后 trim，多个连续空格折叠为单个空格 |
| SignedHeaders | 参与签名的 header key 按**字典序升序**排列，`;` 分隔 |
| CanonicalURI | URI 路径部分做 percent-encode（RFC 3986），但**保留 `/` 不编码** |
| CanonicalQueryString | 每个 query 参数的 key 和 value 分别 percent-encode，然后按 key 字典序排列，`&` 连接 |

**HashedPayload 规则（冻结）**：

| 场景 | HashedPayload 值 | 说明 |
|------|------------------|------|
| 普通请求（PUT/GET/DELETE/HEAD） | `SHA256(payload)` | payload 为空时 hash 空字节串（`e3b0c44298fc...`） |
| Presigned URL | `"UNSIGNED-PAYLOAD"` | 字面量字符串，不做实际 hash；最兼容（AWS/MinIO/OSS/R2 均支持） |

**`x-amz-content-sha256` header（冻结）**：Phase 1 **总是发送**此 header，值与 HashedPayload 一致。

- 普通请求：`x-amz-content-sha256: <hex(SHA256(payload))>`
- 此 header 同时参与 CanonicalHeaders 签名

> **理由**：总是发送此 header 可确保 AWS、MinIO、阿里云 OSS、R2 全部兼容，且便于调试签名问题。不发送时部分 S3 兼容服务会 403。

**实现结构**：

```kotlin
internal object AwsV4Signer {
    /** 计算 Authorization header */
    suspend fun sign(
        method: String,
        url: String,
        headers: Map<String, String>,
        payload: ByteArray,
        accessKey: String,
        secretKey: String,
        region: String,
        service: String = "s3"
    ): Map<String, String>  // 返回需要附加的 headers（Authorization、x-amz-date 等）

    /** 生成 Presigned URL（Query String 签名） */
    suspend fun presign(
        method: String,
        url: String,
        accessKey: String,
        secretKey: String,
        region: String,
        ttl: Duration,
        service: String = "s3"
    ): String  // 返回完整的预签名 URL
}
```

**代码量估计**：签名算法 ~200 行。

### 5.4 HTTP 客户端

使用 Ktor HttpClient，各平台引擎：

| 平台 | Ktor 引擎 |
|------|----------|
| macOS (Arm64/X64) | Darwin |
| Linux (X64/Arm64) | CIO |
| Windows (mingwX64) | WinHttp |

**S3StorageOperator 内部持有一个 Ktor HttpClient 实例**，在 `StorageComponent.init()` 时创建。

```kotlin
internal class S3StorageOperator(
    override val name: String,
    private val config: S3StorageConfig,
    private val httpClient: HttpClient,
    private val logger: Logger?
) : StorageOperator {
    override val scheme = "s3"
    // ...
}
```

### 5.5 错误处理

| S3 HTTP 状态码 | 映射 |
|----------------|------|
| 200/204 | 成功 |
| 404 | `exists()` 返回 false；其他操作抛 `StorageNotFoundException` |
| 403 | 抛 `StorageAccessDeniedException` |
| 其他 4xx/5xx | 抛 `StorageException(message, statusCode)` |

```kotlin
open class StorageException(message: String, cause: Throwable? = null) : Exception(message, cause)
class StorageNotFoundException(path: String) : StorageException("Not found: $path")
class StorageAccessDeniedException(path: String) : StorageException("Access denied: $path")
class StorageAlreadyExistsException(path: String) : StorageException("Already exists: $path")
```

---

## 6. StorageComponent 组件（冻结）

### 6.1 组件定义

```kotlin
object StorageComponent : NetonComponent<StorageConfig> {

    override fun defaultConfig(): StorageConfig = StorageConfig()

    override suspend fun init(ctx: NetonContext, config: StorageConfig) {
        // 1. 加载配置文件 + DSL 合并
        val sources = loadSources(ctx, config)

        // 2. 验证（fail-fast）
        validateSources(sources)

        // 3. 创建各源的 Operator
        val logger = ctx.getOrNull(LoggerFactory::class)?.get("neton.storage")
        val operators = sources.associate { src ->
            src.name to createOperator(src, logger)
        }

        // 4. 构建 Manager 并绑定
        val manager = DefaultStorageManager(operators)
        ctx.bind(StorageManager::class, manager)
        ctx.bind(StorageOperator::class, manager.default())
    }
}
```

### 6.2 配置类

```kotlin
data class StorageConfig(
    /** DSL 中手动添加的源（优先级高于配置文件） */
    val sources: MutableList<SourceConfig> = mutableListOf()
) {
    /** DSL 语法糖：添加一个源 */
    fun source(name: String, block: SourceConfig.() -> Unit) {
        sources.add(SourceConfig(name = name).apply(block))
    }
}

data class SourceConfig(
    var name: String = "default",
    var type: String = "local",         // "local" | "s3"

    // Local 配置
    var basePath: String = "./uploads",

    // S3 配置
    var endpoint: String = "",
    var region: String = "",
    var bucket: String = "",
    var accessKey: String = "",
    var secretKey: String = "",
    var pathStyle: Boolean = false
)
```

### 6.3 DSL 语法糖

```kotlin
fun Neton.LaunchBuilder.storage(block: StorageConfig.() -> Unit) {
    install(StorageComponent, block)
}
```

**使用示例**：

```kotlin
// 方式 1：纯配置文件（storage.conf 定义 [[sources]]）
Neton.run(args) {
    storage { }
}

// 方式 2：纯 DSL
Neton.run(args) {
    storage {
        source("default") {
            type = "local"
            basePath = "./uploads"
        }
        source("oss") {
            type = "s3"
            endpoint = "https://oss-cn-hangzhou.aliyuncs.com"
            region = "cn-hangzhou"
            bucket = "my-bucket"
            accessKey = "xxx"
            secretKey = "xxx"
        }
    }
}

// 方式 3：DSL + 配置文件混合（DSL 优先）
Neton.run(args) {
    storage {
        source("default") {
            type = "local"
            basePath = "/data/uploads"  // 覆盖配置文件中的值
        }
    }
}
```

### 6.4 配置合并规则

**优先级**（从高到低）：
1. DSL 中定义的 source（按 name 匹配覆盖）
2. storage.conf 中的 `[[sources]]`
3. 环境变量覆盖（`STORAGE_DEFAULT_BASE_PATH` → default 源的 basePath）

**合并逻辑（冻结）**：按 `name` 匹配，**字段级 merge**，非整体替换。

| 场景 | 行为 |
|------|------|
| DSL 与配置文件有同名 source | 按字段合并：DSL 中显式设置的字段覆盖配置文件同名字段；DSL 中未设置的字段继承配置文件的值 |
| 配置文件有但 DSL 中没有的 source | 原样保留 |
| DSL 有但配置文件中没有的 source | 作为新源追加 |

**示例**：

```toml
# storage.conf
[[sources]]
name = "default"
type = "local"
basePath = "/var/uploads"
```

```kotlin
// DSL 只覆盖 basePath，type 继承配置文件
storage {
    source("default") {
        basePath = "/data/uploads"
    }
}
// 最终：type="local", basePath="/data/uploads"
```

---

## 7. StorageManager 接口（冻结）

```kotlin
interface StorageManager {
    /** 获取指定名称的存储源；不存在则抛 IllegalStateException */
    fun get(name: String): StorageOperator

    /** 获取默认存储源（等价于 get("default")） */
    fun default(): StorageOperator

    /** 所有已注册的源名称 */
    fun names(): Set<String>
}
```

**实现**：

```kotlin
internal class DefaultStorageManager(
    private val operators: Map<String, StorageOperator>
) : StorageManager {

    override fun get(name: String): StorageOperator =
        operators[name] ?: throw IllegalStateException("Storage source '$name' not found. Available: ${operators.keys}")

    override fun default(): StorageOperator = get("default")

    override fun names(): Set<String> = operators.keys
}
```

---

## 8. 模块依赖与 build.gradle.kts

### 8.1 build.gradle.kts

```kotlin
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    macosArm64()
    macosX64()
    linuxX64()
    linuxArm64()
    mingwX64()

    sourceSets {
        val commonMain by getting {
            dependencies {
                implementation(project(":neton-core"))
                implementation(project(":neton-logging"))
                implementation(libs.kotlinx.coroutines.core)
                implementation(libs.kotlinx.serialization.json)
                // S3 签名
                implementation(libs.cryptography.core)
                implementation(libs.cryptography.provider.optimal)
                // S3 HTTP 请求
                implementation(libs.ktor.client.core)
            }
        }

        // Local 后端文件 I/O（平台差异）
        val nativeMain by creating { dependsOn(commonMain) }
        val posixMain by creating { dependsOn(nativeMain) }
        val macosArm64Main by getting { dependsOn(posixMain) }
        val macosX64Main by getting { dependsOn(posixMain) }
        val linuxX64Main by getting { dependsOn(posixMain) }
        val linuxArm64Main by getting { dependsOn(posixMain) }
        val mingwX64Main by getting { dependsOn(nativeMain) }
    }
}
```

### 8.2 libs.versions.toml 新增

```toml
[libraries]
# Ktor Client（neton-storage S3 后端需要）
ktor-client-core = { module = "io.ktor:ktor-client-core", version.ref = "ktor" }
ktor-client-darwin = { module = "io.ktor:ktor-client-darwin", version.ref = "ktor" }
ktor-client-cio = { module = "io.ktor:ktor-client-cio", version.ref = "ktor" }
ktor-client-winhttp = { module = "io.ktor:ktor-client-winhttp", version.ref = "ktor" }
```

### 8.3 平台引擎依赖（冻结）

Ktor HttpClient **不会**自动选择引擎，必须按平台显式声明引擎依赖：

```kotlin
// build.gradle.kts sourceSets 内
val commonMain by getting {
    dependencies {
        implementation(libs.ktor.client.core)
    }
}

// macOS
val macosArm64Main by getting { dependencies { implementation(libs.ktor.client.darwin) } }
val macosX64Main by getting { dependencies { implementation(libs.ktor.client.darwin) } }

// Linux
val linuxX64Main by getting { dependencies { implementation(libs.ktor.client.cio) } }
val linuxArm64Main by getting { dependencies { implementation(libs.ktor.client.cio) } }

// Windows
val mingwX64Main by getting { dependencies { implementation(libs.ktor.client.winhttp) } }
```

| 平台 | 引擎依赖 | 说明 |
|------|---------|------|
| macOS (Arm64/X64) | `ktor-client-darwin` | 基于 NSURLSession |
| Linux (X64/Arm64) | `ktor-client-cio` | 基于 Coroutines I/O |
| Windows (mingwX64) | `ktor-client-winhttp` | 基于 WinHTTP |

---

## 9. 使用示例

### 9.1 Controller 中上传文件

> **注意**：请求内通过 `ctx.appContext` 获取应用级服务，不要使用 `NetonContext.current()`（避免 request-scope 与 application-scope 语义混淆）。

```kotlin
@Controller("/api/files")
class FileController {

    @Post("/upload")
    suspend fun upload(ctx: HttpContext): Map<String, Any> {
        val storage = ctx.appContext.get(StorageOperator::class)
        val body = ctx.request.body()
        val path = "uploads/${currentTimeMillis()}.bin"
        storage.write(path, body, WriteOptions(contentType = ctx.request.contentType))
        return mapOf("path" to path, "size" to body.size)
    }

    @Get("/download/{path}")
    suspend fun download(ctx: HttpContext, @PathVariable path: String): ByteArray {
        val storage = ctx.appContext.get(StorageOperator::class)
        return storage.read(path)
    }

    @Delete("/{path}")
    suspend fun delete(ctx: HttpContext, @PathVariable path: String): Map<String, Boolean> {
        val storage = ctx.appContext.get(StorageOperator::class)
        storage.delete(path)
        return mapOf("deleted" to true)
    }
}
```

### 9.2 多源操作

```kotlin
@Controller("/api/backup")
class BackupController {

    @Post("/sync")
    suspend fun syncToOss(ctx: HttpContext, @PathVariable path: String): Map<String, String> {
        val manager = ctx.appContext.get(StorageManager::class)
        val local = manager.default()           // Local 存储
        val oss = manager.get("oss")            // OSS 存储

        val data = local.read(path)
        oss.write(path, data)

        return mapOf("synced" to path)
    }
}
```

### 9.3 预签名 URL（前端直传）

```kotlin
@Controller("/api/files")
class FileController {

    @Get("/presign-upload")
    suspend fun presignUpload(ctx: HttpContext, @Query("filename") filename: String): Map<String, String> {
        val oss = ctx.appContext.get(StorageManager::class).get("oss")
        val path = "uploads/$filename"
        val uploadUrl = oss.presignWrite(path, 15.minutes)
        return mapOf("uploadUrl" to uploadUrl, "path" to path)
    }
}
```

---

## 10. 实现检查清单

| 类别 | 检查项 |
|------|--------|
| **配置** | [ ] `[[sources]]` 解析正确 |
| | [ ] `name` 缺失/空串/重复 → fail-fast |
| | [ ] 无 `name="default"` → fail-fast |
| | [ ] DSL + 配置文件字段级 merge 正确（同名 source 按字段覆盖，非整体替换） |
| **Local** | [ ] write 自动创建父目录 |
| | [ ] read 文件不存在 → StorageNotFoundException |
| | [ ] delete 文件不存在 → 静默成功（幂等） |
| | [ ] exists 正确判断 |
| | [ ] stat 返回 size、lastModified |
| | [ ] list 非递归/递归模式均正确 |
| | [ ] copy/move 正确 |
| | [ ] 路径穿越检测（`..` → IllegalArgumentException） |
| | [ ] posixMain 和 mingwX64Main 均编译通过 |
| **S3** | [ ] PutObject 上传成功 |
| | [ ] GetObject 下载正确 |
| | [ ] DeleteObject 删除成功 |
| | [ ] HeadObject 判断存在/获取元信息 |
| | [ ] ListObjectsV2 列表正确（recursive=false 传 `delimiter=/`，recursive=true 不传） |
| | [ ] recursive=false 时 CommonPrefixes 转为 `FileEntry(isDirectory=true, path 保留尾部 /)` |
| | [ ] recursive=true 时只返回 object entries（isDirectory=false） |
| | [ ] CopyObject 复制正确（x-amz-copy-source key 需 percent-encode） |
| | [ ] presignRead 生成有效预签名 URL |
| | [ ] presignWrite 生成有效预签名 URL |
| | [ ] pathStyle=true（MinIO）可用 |
| | [ ] pathStyle=false（AWS/OSS）可用 |
| **签名** | [ ] AWS Signature V4 签名与 AWS 一致 |
| | [ ] HMAC-SHA256 使用 cryptography-kotlin |
| | [ ] amzDate 格式为 `YYYYMMDD'T'HHMMSS'Z'`，dateStamp 为 `YYYYMMDD`，UTC |
| | [ ] CanonicalHeaders key 小写 + 字典序排列 |
| | [ ] CanonicalURI percent-encode 保留 `/` |
| | [ ] HashedPayload：普通请求用 SHA256(payload)，presign 用 `UNSIGNED-PAYLOAD` |
| | [ ] 总是发送 `x-amz-content-sha256` header |
| | [ ] pathStyle=true URL 拼接：`{endpoint}/{bucket}/{key}` |
| | [ ] pathStyle=false URL 拼接：`{scheme}://{bucket}.{host}/{key}`，Host 含 bucket 前缀 |
| **组件** | [ ] StorageComponent.init() 正确 bind |
| | [ ] ctx.get(StorageOperator::class) 返回 default |
| | [ ] ctx.get(StorageManager::class).get("xxx") 正确 |
| | [ ] StorageManager.get(不存在的名字) → IllegalStateException |
| **异常** | [ ] 404 → StorageNotFoundException |
| | [ ] 403 → StorageAccessDeniedException |
| | [ ] overwrite=false：Local 先 exists 检查；S3 附加 `If-None-Match: *`，412 → StorageAlreadyExistsException |
| **契约测试** | [ ] write → read 内容一致 |
| | [ ] write → exists 为 true |
| | [ ] write → stat.size == data.size |
| | [ ] write → delete → exists 为 false |
| | [ ] list 结果包含刚 write 的文件 |

---

## 11. 实现层结构（建议）

### 11.1 模块目录

```
neton-storage/
├── build.gradle.kts
└── src/
    ├── commonMain/kotlin/neton/storage/
    │   ├── StorageOperator.kt              # 核心接口
    │   ├── StorageManager.kt               # 多源管理接口
    │   ├── StorageComponent.kt             # NetonComponent 组件
    │   ├── StorageConfig.kt                # 配置类
    │   ├── StorageException.kt             # 异常体系
    │   ├── Models.kt                       # FileStat / FileEntry / WriteOptions / ListOptions
    │   ├── internal/
    │   │   ├── DefaultStorageManager.kt    # Manager 实现
    │   │   ├── SourceConfigParser.kt       # [[sources]] 解析
    │   │   └── MimeTypes.kt               # 扩展名 → MIME 类型映射
    │   ├── local/
    │   │   └── LocalStorageOperator.kt     # Local 后端（commonMain 部分）
    │   └── s3/
    │       ├── S3StorageOperator.kt        # S3 后端
    │       └── AwsV4Signer.kt             # AWS Signature V4 签名
    ├── nativeMain/kotlin/neton/storage/local/
    │   └── NativeFileSystem.kt             # expect 声明
    ├── posixMain/kotlin/neton/storage/local/
    │   └── NativeFileSystem.kt             # actual（POSIX 实现）
    └── mingwX64Main/kotlin/neton/storage/local/
        └── NativeFileSystem.kt             # actual（MinGW 实现）
```

### 11.2 NativeFileSystem expect/actual

```kotlin
// nativeMain（expect）
internal expect object NativeFileSystem {
    fun readFile(absolutePath: String): ByteArray
    fun writeFile(absolutePath: String, data: ByteArray)
    fun deleteFile(absolutePath: String)
    fun fileExists(absolutePath: String): Boolean
    fun fileStat(absolutePath: String): NativeFileStat?
    fun listDir(absolutePath: String): List<NativeDirEntry>
    fun mkdirs(absolutePath: String)
    fun rename(src: String, dst: String): Boolean
}
```

### 11.3 代码量估计

| 文件 | 行数 |
|------|------|
| StorageOperator + Models + Exception | ~80 |
| StorageManager + DefaultStorageManager | ~30 |
| StorageComponent + StorageConfig + SourceConfigParser | ~120 |
| LocalStorageOperator | ~100 |
| NativeFileSystem (posixMain) | ~120 |
| NativeFileSystem (mingwX64Main) | ~120 |
| S3StorageOperator | ~200 |
| AwsV4Signer | ~200 |
| MimeTypes | ~50 |
| **合计** | **~1020** |

---

## 12. Phase 路线图

### Phase 1（本文档，P0）

- [x] StorageOperator 接口冻结
- [x] StorageManager 多源管理
- [x] Local 后端（read/write/delete/exists/stat/list/copy/move）
- [x] S3 后端（PutObject/GetObject/DeleteObject/HeadObject/ListObjectsV2/CopyObject）
- [x] AWS Signature V4 纯 Kotlin 实现
- [x] Presigned URL（读/写）
- [x] `[[sources]]` 统一配置
- [x] StorageComponent 组件集成
- [x] 跨平台（5 个 Native 目标）

### Phase 2（P1）— 流式读写 + 大文件

- [ ] Multipart Upload（CreateMultipartUpload → UploadPart → CompleteMultipartUpload / AbortMultipartUpload）
- [ ] 流式读写（见下方 API 方向冻结）
- [ ] 上传进度回调
- [ ] 文件 URL 生成（Local 后端映射到 HTTP 路径）

**Phase 2 Streaming API 方向（预冻结）**：

```kotlin
// 不绑定 Flow，不绑定 Ktor Channel；自定义最小抽象
interface ByteReadStream {
    /** 读取数据到 buffer，返回实际读取字节数；-1 表示 EOF */
    suspend fun read(buffer: ByteArray, offset: Int = 0, length: Int = buffer.size): Int
    suspend fun close()
}

interface StorageOperator {
    // Phase 1（已有）
    suspend fun write(path: String, data: ByteArray, options: WriteOptions = WriteOptions())
    suspend fun read(path: String): ByteArray

    // Phase 2（新增）
    suspend fun writeStream(path: String, stream: ByteReadStream, size: Long = -1, options: WriteOptions = WriteOptions())
    suspend fun readStream(path: String): ByteReadStream
}
```

**设计理由**：
- `ByteReadStream` 是最小 suspend I/O 抽象，不依赖 `kotlinx.coroutines.Flow`（避免小块复制 / 调度成本）也不依赖 Ktor `ByteReadChannel`
- Local 后端：直接映射 file read/write
- S3 后端：`writeStream` 内部自动选择 PutObject（小文件）或 Multipart Upload（大文件，阈值可配）
- `size` 参数：S3 PutObject 需要 Content-Length；-1 表示未知（强制 multipart）

**Buffer / Part Size 建议（非冻结）**：

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| `DEFAULT_BUFFER_SIZE` | 64 KB | 单次 `read(buf)` 的默认 buffer 大小；Local 文件 I/O 和网络 I/O 均适合此量级 |
| `MULTIPART_PART_SIZE` | 8 MB | S3 Multipart Upload 每个 part 的大小；S3 要求 ≥5MB，8MB 是常见工程选择 |
| `MULTIPART_THRESHOLD` | 32 MB | 超过此大小自动切换为 Multipart Upload（与 Phase 1 的 ByteArray 上限一致） |

### Phase 3（P2）

- [ ] FTP/SFTP 后端
- [ ] 更多 S3 操作（Tagging、ACL、Lifecycle）
- [ ] 文件变更通知（Watch）

---

## 13. `[[sources]]` 统一配置迁移清单

本次 neton-storage 模块引入的 `[[sources]]` 配置格式，需同步迁移 database 和 redis 模块。

### 13.1 需修改的文件

| 模块 | 文件 | 改动 |
|------|------|------|
| neton-core | ConfigLoader.kt | 添加 `loadSourceConfigs()` 通用解析函数 |
| neton-database | DatabaseComponent.kt | 从 `[default]` 改为读取 `[[sources]]` |
| neton-database | DatabaseConfig.kt | 支持多源配置 |
| neton-database | build.gradle.kts | 不变 |
| neton-redis | RedisComponent.kt | 从根级平铺改为读取 `[[sources]]` |
| neton-redis | RedisConfig.kt | 支持多源配置 |
| neton-redis | build.gradle.kts | 不变 |
| neton-storage | 全部新建 | 直接按新格式实现 |
| examples/* | config/*.conf | 全部改为 `[[sources]]` 格式 |
| neton-docs | 全部相关文档 | 更新配置格式说明 |

### 13.2 新增 Manager 接口

```kotlin
// neton-database
interface DatabaseManager {
    fun get(name: String): Database
    fun default(): Database
    fun names(): Set<String>
}

// neton-redis
interface RedisManager {
    fun get(name: String): RedisClient
    fun default(): RedisClient
    fun names(): Set<String>
}
```

### 13.3 新增 bind

```kotlin
// DatabaseComponent.init()
ctx.bind(Database::class, manager.default())
ctx.bind(DatabaseManager::class, manager)

// RedisComponent.init()
ctx.bind(RedisClient::class, manager.default())
ctx.bind(RedisManager::class, manager)

// StorageComponent.init()
ctx.bind(StorageOperator::class, manager.default())
ctx.bind(StorageManager::class, manager)
```

### 13.4 向后兼容

**不做向后兼容**。v1.0 前的配置格式全部废弃，启动时 fail-fast 并给出明确的迁移提示：

```
ERROR: redis.conf uses legacy format. Please migrate to [[sources]]:

  [[sources]]
  name = "default"
  host = "127.0.0.1"
  port = 6379
```

### 13.5 契约测试

每个模块添加：

```kotlin
@Test
fun `sources must contain default`() {
    val config = mapOf("sources" to listOf(mapOf("name" to "other")))
    assertFailsWith<IllegalStateException> {
        parseSourceConfigs(config)
    }
}

@Test
fun `duplicate name fails`() {
    val config = mapOf("sources" to listOf(
        mapOf("name" to "default"),
        mapOf("name" to "default")
    ))
    assertFailsWith<IllegalStateException> {
        parseSourceConfigs(config)
    }
}
```
