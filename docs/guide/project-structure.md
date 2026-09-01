# Project structure

This chapter covers Neton's module layout, the standard directory conventions, the configuration
files and the KSP code generation step.

## Modules

Neton is modular: each module has a clear responsibility and is pulled in only when needed.

| Module | What it provides | Required |
|---|---|---|
| `neton-core` | Framework core: startup, the component model (`NetonComponent`), the runtime container, configuration loading, HTTP abstractions (`HttpContext`, `HttpRequest`, `HttpResponse`) and the security context | Yes |
| `neton-logging` | Structured logging: one Logger API, JSON output, asynchronous writes, sink routing, traceId / spanId propagation, automatic redaction | Yes |
| `neton-http` | HTTP: the inbound server adapter plus the outbound `HttpClient`, streaming, SSE and the error model | Yes |
| `neton-routing` | Routing: route resolution, route groups, directory-based grouping, DSL registration, controller binding | Yes |
| `neton-security` | Security: the two-layer Authenticator + Guard architecture with JWT and mock authenticators (**session authentication is not built in for 1.0**) and annotation-driven authorization | No |
| `neton-redis` | Redis client: connection management, core commands, distributed locks (`@Lock` / `LockManager`) | No |
| `neton-cache` | Two-tier caching: L1 in-process plus L2 Redis, with `@Cacheable` / `@CachePut` / `@CacheEvict` | No |
| `neton-database` | Database access: the entity + table model, a type-safe query DSL, the logic layer, sqlx4k driver integration | No |
| `neton-storage` | Storage abstraction: local and S3 backends, `StorageOperator` / `StorageManager`, multi-source `[[sources]]` configuration | No |
| `neton-jobs` | Scheduling: `@Job` plus `JobScheduler`, supporting cron / fixedRate and SINGLE_NODE / ALL_NODES | No |
| `neton-ai` | AI abstraction: generateText / streamText / tool loop / router / usage, OpenAI-compatible and Anthropic | No |
| `neton-ksp` | Compile-time code generation for `@Controller`, `@Table`, `@Logic`, `@Job`, `@NetonConfig` and friends — routes, parameter binding, tables and the config SPI | No (recommended) |
| `neton-validation` | Validation annotations and compile-time validator generation | No |

::: tip Minimum set
A minimal Neton application needs only `neton-core`, `neton-logging`, `neton-http` and
`neton-routing`. Add the rest as your requirements demand.
:::

## Standard layout

Neton projects follow the Kotlin Multiplatform layout with a few framework conventions on top:

```
my-neton-app/
├── build.gradle.kts                  # build script
├── settings.gradle.kts               # project settings
├── config/                           # configuration directory
│   ├── application.conf              # main configuration (TOML)
│   ├── application.dev.conf          # development overrides (optional)
│   ├── application.prod.conf         # production overrides (optional)
│   └── routing.conf                  # route group configuration (optional)
├── src/
│   ├── commonMain/
│   │   └── kotlin/
│   │       ├── Main.kt               # entry point
│   │       ├── controller/           # controllers
│   │       │   ├── HomeController.kt
│   │       │   ├── admin/            # controllers in the "admin" route group
│   │       │   │   └── AdminController.kt
│   │       │   └── app/              # controllers in the "app" route group
│   │       │       └── AppController.kt
│   │       ├── config/               # application config classes
│   │       │   └── AppSecurityConfig.kt
│   │       ├── model/                # data models
│   │       └── module/               # business modules (optional)
│   │           └── payment/
│   │               └── controller/
│   └── macosArm64Main/
│       └── kotlin/                   # platform-specific code
└── build/
    └── generated/
        └── ksp/                      # KSP output (generated)
```

### Controller directory convention

Route groups map onto the package structure:

- controllers directly under `controller/` belong to the default group
- controllers under `controller/admin/` belong to the `admin` group (mounted through `routing.conf`)
- controllers under `controller/app/` belong to the `app` group
- `module/<name>/controller/` supports modular organisation

At compile time KSP reads each controller's package path, resolves its route group and generates
the matching registration code.

## Configuration files

### application.conf

The main configuration file. TOML, placed in `config/`, loaded automatically at startup.

```toml
[application]
name = "my-app"
debug = true

[server]
port = 8080

[logging]
level = "INFO"

[logging.async]
enabled = true
queueSize = 8192
flushEveryMs = 200
flushBatchSize = 64
shutdownFlushTimeoutMs = 2000

[[logging.sinks]]
name = "access"
file = "logs/access.log"
levels = "INFO"
route = "http.access"

[[logging.sinks]]
name = "error"
file = "logs/error.log"
levels = "ERROR,WARN"
```

Precedence, highest first:

1. command-line arguments and environment variables
2. environment-specific `application.<env>.conf`
3. the main `application.conf`
4. framework defaults

### routing.conf

Declares route groups and the prefix each is mounted at:

```toml
[[groups]]
group = "admin"
mount = "/admin"

[[groups]]
group = "app"
mount = "/app"
```

The `mount` field supplies the URL prefix. An `/index` route in the `admin` group is served at
`/admin/index`.

## KSP code generation

Neton generates code at compile time with KSP (Kotlin Symbol Processing), which is what lets it
avoid reflection and runtime scanning entirely.

### How it works

1. You write annotated code (`@Controller`, `@Get`, `@NetonConfig`, …)
2. During compilation the KSP processors read those annotations
3. Route registration, parameter binding, config SPI and other code is written to `build/generated/ksp/`
4. The generated code is compiled into the native binary alongside your own

### What gets generated

| Annotation | Generated output |
|---|---|
| `@Controller` with `@Get` / `@Post` / … | Route registration, argument binding, controller instantiation |
| `@NetonConfig` | Config SPI registration (`ConfigRegistryProvider`) |
| `@Table` (entity) | The table object, `EntityMeta`, the row mapper and the `update(id) { }` extension |
| `@Logic` | Logic instantiation and dependency wiring |
| `@Job` | Scheduled job registration |
| Validation annotations | Compile-time validators |

### Build configuration

```kotlin
plugins {
    alias(libs.plugins.ksp)
}

dependencies {
    add("kspMacosArm64", project(":neton-ksp"))
}

// make sure KSP runs before compilation
tasks.named("compileKotlinMacosArm64").configure {
    dependsOn(tasks.named("kspKotlinMacosArm64"))
}

// add the generated code to the source set
kotlin.sourceSets.named("macosArm64Main") {
    kotlin.srcDir("build/generated/ksp/macosArm64/macosArm64Main/kotlin")
}
```

::: info Without KSP
You can still register routes by hand with the DSL. See
[Routing and controllers](./routing.md).
:::

## Further reading

- [Quick start](./quick-start.md) — create your first Neton project
- [Routing and controllers](./routing.md) — controller annotations and route groups in depth
