# 部署与跨平台指南

> 本指南介绍 Neton 应用的构建、运行、配置注入、跨平台支持以及生产环境部署方案。Neton 基于 Kotlin/Native 编译为原生二进制，具备极小体积、毫秒级启动和低内存占用等特性，非常适合容器化和边缘计算场景。

---

## 一、构建原生二进制

### 1.1 构建命令

以 helloworld 示例为例：

```bash
# macOS ARM64
./gradlew :examples:helloworld:linkDebugExecutableMacosArm64
./gradlew :examples:helloworld:linkReleaseExecutableMacosArm64

# Linux x64
./gradlew :examples:helloworld:linkDebugExecutableLinuxX64
./gradlew :examples:helloworld:linkReleaseExecutableLinuxX64

# Linux ARM64
./gradlew :examples:helloworld:linkDebugExecutableLinuxArm64
./gradlew :examples:helloworld:linkReleaseExecutableLinuxArm64

# Windows x64
./gradlew :examples:helloworld:linkDebugExecutableMingwX64
./gradlew :examples:helloworld:linkReleaseExecutableMingwX64
```

构建产物位于：

```
build/bin/macosArm64/releaseExecutable/helloworld.kexe     # macOS ARM64
build/bin/linuxX64/releaseExecutable/helloworld.kexe       # Linux x64
build/bin/linuxArm64/releaseExecutable/helloworld.kexe     # Linux ARM64
build/bin/mingwX64/releaseExecutable/helloworld.exe        # Windows x64
```

### 1.2 二进制特性

| 指标 | 数值 | 说明 |
|------|------|------|
| **文件大小** | ~3.5 MB | 无 JVM、无运行时依赖，单文件部署 |
| **启动时间** | ~3 ms | 毫秒级冷启动，适合 Serverless 和快速扩缩容 |
| **内存占用** | ~20 MB | 空载运行时的基础内存，远低于 JVM 应用 |

与 JVM 应用的对比：

```
JVM 应用：~200MB 内存、~3s 启动、~30MB jar + JRE
Neton (Native)：  ~20MB 内存、~3ms 启动、~3.5MB 单文件
```

---

## 二、启动参数与配置注入

### 2.1 启动参数

```bash
# 直接运行
./helloworld.kexe

# 指定端口
./helloworld.kexe --port=9090

# 指定运行环境（加载对应的环境配置）
./helloworld.kexe --env=prod

# 组合使用
./helloworld.kexe --port=9090 --env=prod
```

| 参数 | 说明 |
|------|------|
| `--port=&lt;N&gt;` | HTTP 监听端口 |
| `--env=&lt;name&gt;` | 运行环境名称，用于加载 `application.&lt;env&gt;.conf` |

### 2.2 环境变量覆盖

Neton 支持通过环境变量覆盖配置：

```bash
# 通过环境变量设置端口
NETON_PORT=8081 ./helloworld.kexe

# 通过环境变量设置运行环境
NETON_ENV=prod ./helloworld.kexe
```

### 2.3 配置注入优先级

Neton 的配置系统采用分层覆盖策略，优先级从高到低：

```
CLI 参数（--port=9090）
  > 环境变量（NETON_PORT=9090）
    > 环境配置文件（application.prod.conf）
      > 基础配置文件（application.conf）
        > 代码默认值（DSL defaultConfig）
```

**示例**：

```
application.conf 中 port = 8080
application.prod.conf 中 port = 80
环境变量 NETON_PORT=9090
CLI 参数 --port=3000

最终生效：port = 3000（CLI 最高优先级）
```

### 2.4 配置文件结构

配置文件位于 `config/` 目录，使用 TOML 格式：

```
config/
  application.conf           # 基础配置（所有环境共享）
  application.dev.conf       # 开发环境覆盖配置
  application.prod.conf      # 生产环境覆盖配置
```

基础配置示例（`config/application.conf`）：

```toml
[application]
name = "my-service"
debug = true

[server]
port = 8080
host = "0.0.0.0"

[logging]
level = "DEBUG"

[redis]
host = "localhost"
port = 6379
keyPrefix = "neton"
```

生产环境覆盖（`config/application.prod.conf`）：

```toml
[application]
debug = false

[server]
port = 80

[logging]
level = "INFO"

[redis]
host = "redis.internal"
password = "secret"
```

---

## 三、结构化日志（生产环境）

Neton 默认输出 JSON 格式的结构化日志，天然适配各类日志采集平台。

### 3.1 日志输出格式

```json
{
  "ts": "2026-02-14T10:21:33.123Z",
  "level": "INFO",
  "service": "user-service",
  "env": "prod",
  "traceId": "req-1707900093-a1b2c3",
  "msg": "http.access",
  "method": "GET",
  "path": "/api/users/1",
  "status": 200,
  "latencyMs": 12
}
```

### 3.2 生产日志配置

建议的生产环境日志配置，将访问日志、错误日志、全量日志分文件存储：

```toml
[logging]
level = "INFO"

[logging.async]
enabled = true
queueSize = 8192
flushEveryMs = 200
flushBatchSize = 64
shutdownFlushTimeoutMs = 2000

# 访问日志
[[logging.sinks]]
name = "access"
file = "logs/access.log"
levels = "INFO"
route = "http.access"

# 错误日志
[[logging.sinks]]
name = "error"
file = "logs/error.log"
levels = "ERROR,WARN"

# 全量日志
[[logging.sinks]]
name = "all"
file = "logs/all.log"
levels = "ALL"
```

### 3.3 日志采集

- **日志采集**：采集 JSON 日志文件，可按 `traceId` 过滤串联请求链路。
- **stdout 模式**：容器化部署时也可将日志输出到 stdout，由容器平台统一采集。

---

## 四、跨平台支持

### 4.1 当前支持状态

| 平台 | 目标名称 | 状态 | 说明 |
|------|---------|------|------|
| **macOS ARM64** | `macosArm64` | 完全支持 | Apple Silicon（M1/M2/M3/M4） |
| **Linux x64** | `linuxX64` | 完全支持 | x86_64 架构服务器 |
| **Linux ARM64** | `linuxArm64` | 完全支持 | ARM 架构服务器（AWS Graviton、树莓派等） |
| **Windows x64** | `mingwX64` | 完全支持 | x86_64 架构，基于 MinGW |
| **Windows ARM64** | — | 不支持 | Kotlin/Native 尚未提供 `mingwArm64` 目标 |

### 4.2 多目标构建配置

Neton 已内置全部 4 个目标平台的支持，Gradle 配置示例：

```kotlin
kotlin {
    macosArm64 {
        binaries { executable { entryPoint = "main" } }
    }
    linuxX64 {
        binaries { executable { entryPoint = "main" } }
    }
    linuxArm64 {
        binaries { executable { entryPoint = "main" } }
    }
    mingwX64 {
        binaries { executable { entryPoint = "main" } }
    }
}
```

各平台的构建命令：

```bash
# macOS ARM64
./gradlew linkReleaseExecutableMacosArm64

# Linux x64
./gradlew linkReleaseExecutableLinuxX64

# Linux ARM64
./gradlew linkReleaseExecutableLinuxArm64

# Windows x64
./gradlew linkReleaseExecutableMingwX64
```

::: warning 交叉编译说明
Kotlin/Native 需要在目标平台（或对应的交叉编译工具链）上构建。例如，Linux 二进制通常需要在 Linux 主机上构建，Windows 二进制需要在 Windows 主机或安装了 MinGW 工具链的环境上构建。macOS 二进制需要在 macOS 上构建。
:::

---

## 五、Docker 部署

Neton 编译为无依赖的原生二进制，可以使用 `scratch`（空镜像）作为基础镜像，镜像体积极小。

### 5.1 Dockerfile

```dockerfile
# 多阶段构建（可选）：在构建机上编译
# FROM gradle:8.14-jdk21 AS build
# WORKDIR /app
# COPY . .
# RUN ./gradlew :examples:helloworld:linkReleaseExecutableLinuxX64

# 最终镜像：从空镜像开始
FROM scratch

# 复制原生二进制
COPY build/bin/linuxX64/releaseExecutable/app /app

# 复制配置文件
COPY config/ /config/

# 暴露端口
EXPOSE 8080

# 启动命令
ENTRYPOINT ["/app", "--env=prod"]
```

### 5.2 构建与运行

```bash
# 构建 Docker 镜像
docker build -t my-neton-app:latest .

# 运行容器
docker run -d \
  --name my-app \
  -p 8080:8080 \
  -e NETON_PORT=8080 \
  my-neton-app:latest
```

### 5.3 镜像大小对比

```
Neton (scratch + 原生二进制)：~4 MB
Go 应用 (scratch)：           ~10-20 MB
Java 应用 (eclipse-temurin)：  ~300-400 MB
Node.js 应用 (node:alpine)：   ~150-200 MB
```

---

## 六、Kubernetes 部署

### 6.1 Deployment 模板

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: neton-app
  labels:
    app: neton-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: neton-app
  template:
    metadata:
      labels:
        app: neton-app
    spec:
      containers:
        - name: neton-app
          image: my-neton-app:latest
          ports:
            - containerPort: 8080
          env:
            - name: NETON_ENV
              value: "prod"
            - name: NETON_PORT
              value: "8080"
          resources:
            requests:
              memory: "32Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 1
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 1
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: neton-app-svc
spec:
  selector:
    app: neton-app
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
```

### 6.2 资源配置说明

得益于 Neton 的低资源占用，Kubernetes 资源配额可以设置得非常低：

| 资源 | 建议值 | 说明 |
|------|--------|------|
| **memory requests** | 32Mi | 基础内存占用约 20MB |
| **memory limits** | 128Mi | 预留业务数据和突发流量的余量 |
| **cpu requests** | 50m | 空闲时 CPU 占用极低 |
| **cpu limits** | 500m | 根据业务负载调整 |

### 6.3 关键特性

- **极速启动**：~3ms 启动时间意味着 Pod 几乎瞬间就绪，`initialDelaySeconds` 可设为 1 秒。
- **快速扩缩容**：配合 HPA（Horizontal Pod Autoscaler），Neton 应用可在秒级完成扩缩容，非常适合突发流量场景。
- **低资源成本**：单节点可部署更多 Pod，显著降低集群资源成本。

---

## 七、健康检查端点

建议为生产应用注册 `/health` 健康检查端点，供 Kubernetes、负载均衡器和监控系统探测：

```kotlin
@Controller
class HealthController {

    @Get("/health")
    @AllowAnonymous
    suspend fun health(): String {
        return """{"status":"UP"}"""
    }
}
```

更完善的健康检查可以包含依赖组件的状态：

```kotlin
@Get("/health")
@AllowAnonymous
suspend fun health(ctx: HttpContext): String {
    val redisOk = try {
        ctx.getRedis().exists("health:ping")
        true
    } catch (e: Exception) {
        false
    }

    val status = if (redisOk) "UP" else "DEGRADED"
    return """{"status":"$status","redis":$redisOk}"""
}
```

---

## 八、生产部署清单

部署到生产环境前，建议检查以下事项：

| 项目 | 建议 |
|------|------|
| **构建模式** | 使用 Release 构建（`linkReleaseExecutable*`），Debug 构建包含调试符号，体积更大 |
| **运行环境** | 通过 `--env=prod` 或 `NETON_ENV=prod` 指定，加载生产配置 |
| **日志级别** | 生产环境设为 INFO 或 WARN，关闭 DEBUG |
| **异步日志** | 启用 `[logging.async]`，减少 IO 对请求延迟的影响 |
| **Redis 密码** | 生产环境 Redis 必须设置密码 |
| **健康检查** | 注册 `/health` 端点，配置存活和就绪探针 |
| **资源限制** | Kubernetes 中设置 memory/cpu limits，防止资源泄漏 |
| **配置隔离** | 敏感配置（密码、密钥）通过环境变量或 Kubernetes Secret 注入，不写入配置文件 |

---

## 九、相关文档

- [核心架构](../spec/core.md) -- Neton 的整体架构设计与启动流程
- [HTTP 规范](../spec/http.md) -- HTTP 适配器、请求处理流程
- [日志规范](../spec/logging.md) -- 结构化日志、Multi-Sink、异步写入
- [项目路线图](../spec/roadmap.md) -- 跨平台支持等未来计划
