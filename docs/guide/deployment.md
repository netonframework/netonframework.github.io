# Deployment and targets

> This guide covers building, running, injecting configuration, cross-platform support and
> production deployment. Neton compiles to a native binary through Kotlin/Native — small, fast to
> start and light on memory, which suits containers and edge deployments.

---

## 1. Building a native binary

### 1.1 Commands

Taking the helloworld example:

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

Output lands in:

```
build/bin/macosArm64/releaseExecutable/helloworld.kexe     # macOS ARM64
build/bin/linuxX64/releaseExecutable/helloworld.kexe       # Linux x64
build/bin/linuxArm64/releaseExecutable/helloworld.kexe     # Linux ARM64
build/bin/mingwX64/releaseExecutable/helloworld.exe        # Windows x64
```

### 1.2 What you get

| Metric | Value | Notes |
|---|---|---|
| **Size** | ~3.5 MB | No JVM, no runtime dependencies, a single file |
| **Startup** | ~3 ms | Cold start in milliseconds, which suits serverless and rapid scaling |
| **Memory** | ~20 MB | Idle resident memory, far below an equivalent JVM service |

For comparison:

```
JVM service:     ~200 MB memory, ~3 s startup, ~30 MB jar plus a JRE
Neton (native):  ~20 MB memory,  ~3 ms startup, ~3.5 MB single file
```

---

## 2. Arguments and configuration

### 2.1 Command-line arguments

```bash
./helloworld.kexe

./helloworld.kexe --server.port=9090

# select the environment, loading the matching config file
./helloworld.kexe --env=prod

./helloworld.kexe --server.port=9090 --env=prod
```

| Argument | Meaning |
|---|---|
| `--server.port=<N>` | HTTP listen port, matching `[server] port` in `application.conf` |
| `--env=<name>` | Environment name, selecting `application.<env>.conf` |

### 2.2 Environment variables

```bash
NETON_SERVER__PORT=8081 ./helloworld.kexe

NETON_ENV=prod ./helloworld.kexe
```

### 2.3 Precedence

```
CLI arguments (--server.port=9090)
  > environment variables (NETON_SERVER__PORT=9090)
    > environment file (application.prod.conf)
      > base file (application.conf)
        > code defaults (the DSL)
```

For example:

```
application.conf       port = 8080
application.prod.conf  port = 80
NETON_SERVER__PORT     9090
--server.port          3000

effective: port = 3000
```

### 2.4 File layout

```
config/
  application.conf           # shared by every environment
  application.dev.conf       # development overrides
  application.prod.conf      # production overrides
```

`config/application.conf`:

```toml
[application]
name = "my-service"
debug = true

[server]
port = 8080

[logging]
level = "DEBUG"
```

`config/application.prod.conf`:

```toml
[application]
debug = false

[server]
port = 80

[logging]
level = "INFO"
```

::: warning Two things this file cannot do
`server.host` is **not supported** in 1.0 — the bind address is hard-coded to `0.0.0.0`.

Redis is **not** configured here. It reads its own `config/redis.conf` with keys at the root level
and no `[redis]` section, following the "filename = namespace" convention. The same applies to
`database.conf`, `routing.conf` and `cache.conf`.
:::

---

## 3. Structured logging in production

Logs are JSON by default, which every collection platform can ingest.

### 3.1 Format

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

### 3.2 Recommended production configuration

Separate access, error and full logs:

```toml
[logging]
level = "INFO"

[logging.async]
enabled = true
queueSize = 8192
flushEveryMs = 200
flushBatchSize = 64
shutdownFlushTimeoutMs = 2000

# access log
[[logging.sinks]]
name = "access"
file = "logs/access.log"
levels = "INFO"
route = "http.access"

# errors
[[logging.sinks]]
name = "error"
file = "logs/error.log"
levels = "ERROR,WARN"

# everything
[[logging.sinks]]
name = "all"
file = "logs/all.log"
levels = "ALL"
```

### 3.3 Collection

- Ingest the JSON files and filter by `traceId` to reconstruct one request.
- In containers you can equally write to stdout and let the platform collect it.

---

## 4. Platform support

### 4.1 Current status

| Platform | Target | Status | Notes |
|---|---|---|---|
| **macOS ARM64** | `macosArm64` | Supported | Apple Silicon (M1/M2/M3/M4) |
| **macOS x64** | `macosX64` | Supported except `neton-database` | Its driver, sqlx4k, publishes no `macosX64` artifact |
| **Linux x64** | `linuxX64` | Supported | x86_64 servers |
| **Linux ARM64** | `linuxArm64` | Supported | ARM servers: AWS Graviton, Raspberry Pi |
| **Windows x64** | `mingwX64` | Supported | x86_64 via MinGW |
| **Windows ARM64** | — | Not supported | Kotlin/Native provides no `mingwArm64` target |

### 4.2 Multi-target builds

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

```bash
./gradlew linkReleaseExecutableMacosArm64
./gradlew linkReleaseExecutableLinuxX64
./gradlew linkReleaseExecutableLinuxArm64
./gradlew linkReleaseExecutableMingwX64
```

::: tip Cross-compiling Linux binaries on macOS
Install a Linux GCC cross toolchain and you can produce Linux executables from macOS without a
Linux host:

```bash
brew tap messense/macos-cross-toolchains
brew install x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu

./gradlew linkReleaseExecutableLinuxX64      # a Linux x64 kexe, built on macOS
```

Custom toolchain paths can be injected through `NETON_LINUX_X64_CC` / `NETON_LINUX_X64_AR` /
`NETON_LINUX_ARM64_CC` / `NETON_LINUX_ARM64_AR`, or the equivalent Gradle properties such as
`neton.linuxX64.cc`. See "Cross-compiling Linux on macOS" in the neton repository README.

⚠️ Cross-compilation only verifies linking. Before releasing you must run the artifact on the
target Linux architecture and smoke-test it. Windows binaries still need a Windows host or a MinGW
toolchain, and macOS binaries must be built on macOS.
:::

---

## 5. Docker

Because the binary has no dependencies, `scratch` works as the base image.

### 5.1 Dockerfile

```dockerfile
# optional multi-stage build
# FROM gradle:8.14-jdk21 AS build
# WORKDIR /app
# COPY . .
# RUN ./gradlew :examples:helloworld:linkReleaseExecutableLinuxX64

FROM scratch

COPY build/bin/linuxX64/releaseExecutable/app /app

COPY config/ /config/

EXPOSE 8080

ENTRYPOINT ["/app", "--env=prod"]
```

### 5.2 Build and run

```bash
docker build -t my-neton-app:latest .

docker run -d \
  --name my-app \
  -p 8080:8080 \
  -e NETON_SERVER__PORT=8080 \
  my-neton-app:latest
```

### 5.3 Image size

```
Neton (scratch + native binary):  ~4 MB
Go (scratch):                     ~10-20 MB
Java (eclipse-temurin):           ~300-400 MB
Node.js (node:alpine):            ~150-200 MB
```

---

## 6. Kubernetes

### 6.1 Deployment

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
            - name: NETON_SERVER__PORT
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

### 6.2 Resource sizing

| Resource | Suggested | Reasoning |
|---|---|---|
| **memory requests** | 32Mi | Baseline usage is around 20 MB |
| **memory limits** | 128Mi | Headroom for working data and traffic spikes |
| **cpu requests** | 50m | Idle CPU usage is negligible |
| **cpu limits** | 500m | Adjust to your workload |

### 6.3 What this buys you

- **Fast start** — a ~3 ms startup means pods are ready almost immediately, so `initialDelaySeconds: 1` is realistic.
- **Fast scaling** — with an HPA, scaling completes in seconds, which suits bursty traffic.
- **Density** — more pods per node, and a smaller cluster bill.

---

## 7. Health checks

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

A fuller check can report dependency status:

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

## 8. Production checklist

| Item | Recommendation |
|---|---|
| **Build mode** | Use release builds (`linkReleaseExecutable*`); debug builds carry symbols and are larger |
| **Environment** | Select it with `--env=prod` or `NETON_ENV=prod` |
| **Log level** | INFO or WARN in production; turn DEBUG off |
| **Async logging** | Enable `[logging.async]` so I/O does not add request latency |
| **Redis password** | Always set one in production |
| **Health endpoint** | Register `/health` and wire the liveness and readiness probes |
| **Resource limits** | Set memory and CPU limits in Kubernetes |
| **Secrets** | Inject passwords and keys through environment variables or Kubernetes secrets, never config files |
| **Rate limits** | Re-check every `@RateLimit` after upgrading to 1.0.0-beta1 — the annotation was not enforced in earlier builds |
| **Migrations** | Run `./application.kexe migrate up` after deploying a new binary and before starting it. Startup **refuses to run** with pending migrations and never migrates automatically. Migration SQL is compiled into the binary, so no `.sql` files are read at runtime |
| **Process replacement** | `systemctl restart` can leave an old process holding the port, sending the new one into a crash loop. The safe sequence is stop → confirm the process exited (`pkill` if needed) → replace the binary → start |
| **EnvironmentFile** | Secrets read directly with `getenv` bypass the configuration chain, so the systemd unit must set `EnvironmentFile=` for them to reach the process |

---

## 9. Related

- [Core specification](/zh-hans/spec/core) (Chinese) — overall architecture and the startup sequence
- [HTTP specification](/zh-hans/spec/http) (Chinese) — the HTTP adapter and request flow
- [Logging specification](/zh-hans/spec/logging) (Chinese) — structured logging, multi-sink, async writes
- [Roadmap](/zh-hans/spec/roadmap) (Chinese) — planned platform work
