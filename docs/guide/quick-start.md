# Quick start

Two ways in. The fastest is to clone the starter and run it; the rest of this page builds the
same thing from an empty directory so you can see every piece.

## Clone and run

```bash
git clone https://github.com/netonframework/neton-app.git
cd neton-app
./gradlew run
```

Open `http://localhost:8080/` — you should see **Welcome to Neton**. `/api/hello` returns
JSON. `./gradlew run` compiles a native binary for your machine and starts it; the first build
downloads the Kotlin/Native toolchain and takes a few minutes, later builds take seconds.

The starter is a complete, minimal application: one `@Controller`, one config file, one
versioned dependency. Edit `src/commonMain/kotlin/controller/WelcomeController.kt` and rerun.

## From scratch

### Requirements

| Tool | Version | Notes |
|---|---|---|
| Kotlin | 2.4.0 | Neton is built on Kotlin Multiplatform (see `gradle/libs.versions.toml`) |
| KSP | 2.3.10 | The KSP plugin is versioned independently of Kotlin |
| Gradle | 8.x | Use the Gradle wrapper |
| OS | macOS / Linux / Windows | Native compilation is supported on all three |

::: tip Supported targets
Neton compiles to a Kotlin/Native binary. The current targets are:
- **macOS ARM64** — Apple Silicon (M1/M2/M3/M4)
- **Linux x64** — x86_64 servers
- **Linux ARM64** — ARM servers (AWS Graviton, Raspberry Pi, …)
- **Windows x64** — x86_64 via MinGW

`neton-database` has no macOS x64 target, because its driver (sqlx4k) publishes no
`macosX64` artifact. Every other module builds on Intel Macs.
:::

### 1. Create the project

```bash
mkdir hello-neton
cd hello-neton
```

The layout you are aiming for:

```
hello-neton/
├── build.gradle.kts
├── config/
│   └── application.conf
├── settings.gradle.kts
└── src/
    └── commonMain/
        └── kotlin/
            └── Main.kt
```

### 2. Configure the build

Create `build.gradle.kts` with the Kotlin Multiplatform plugin and the Neton dependencies:

```kotlin
plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

repositories {
    mavenCentral()
}

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

    sourceSets {
        commonMain {
            dependencies {
                implementation("com.netonstream:neton:1.0.0-beta1")
            }
        }
    }
}
```

`com.netonstream:neton` is the only coordinate that carries a version. It pulls in the four
modules a runnable service needs — `neton-core`, `neton-logging`, `neton-http`,
`neton-routing` — and pins every other Neton module to the same release, so you add the rest
**without a version**:

```kotlin
implementation("com.netonstream:neton-database")   // aligned to 1.0.0-beta1 automatically
implementation("com.netonstream:neton-redis")
implementation("com.netonstream:neton-cache")
```

| Coordinate | What it is |
|---|---|
| `neton` | The entry point: core + logging + http + routing, plus version constraints for every other module |
| `neton-<module>` | Optional modules — `database`, `redis`, `cache`, `security`, `storage`, `jobs`, `validation`, `ai` |
| `neton-bom` | Version alignment only, for projects that want the constraints without the four base modules: `implementation(platform("com.netonstream:neton-bom:1.0.0-beta1"))` |

The optional modules are kept out of `neton` on purpose: they link native libraries (a Rust
database driver, a Redis client) that Kotlin/Native would otherwise compile into every binary,
and `neton-database` has no macOS x64 target.

### 3. Write the configuration

Create `config/application.conf` (TOML):

```toml
[application]
name = "helloworld"
debug = true

[server]
port = 8080

[logging]
level = "INFO"
```

- `application.name` — the application name, used to tag log records
- `application.debug` — debug mode; produces more detailed logs
- `server.port` — the HTTP listen port
- `logging.level` — one of `DEBUG`, `INFO`, `WARN`, `ERROR`

### 4. Write the entry point

Create `src/commonMain/kotlin/Main.kt`:

```kotlin
import neton.core.Neton
import neton.http.http
import neton.routing.*

fun main(args: Array<String>) {
    Neton.run(args) {
        http {
            port = 8080
        }
        routing {
            get("/") {
                "Hello Neton!"
            }
        }
    }
}
```

Line by line:

1. **`Neton.run(args)`** — the framework entry point; starts the runtime container
2. **`http { ... }`** — installs the HTTP component and sets the port
3. **`routing { ... }`** — installs the routing component and opens the route DSL
4. **`get("/")`** — registers a `GET /` route whose handler returns the response body directly

::: info DSL routes vs. annotated routes
The example above uses the DSL, which suits small services. For larger projects prefer
`@Controller` + `@Get`, where KSP generates the routing code at compile time. See
[Routing and controllers](./routing.md).
:::

### 5. Build and run

```bash
# macOS ARM64
./gradlew linkDebugExecutableMacosArm64
./build/bin/macosArm64/debugExecutable/hello-neton.kexe

# Linux x64
./gradlew linkDebugExecutableLinuxX64
./build/bin/linuxX64/debugExecutable/hello-neton.kexe

# Linux ARM64
./gradlew linkDebugExecutableLinuxArm64
./build/bin/linuxArm64/debugExecutable/hello-neton.kexe

# Windows x64
./gradlew linkDebugExecutableMingwX64
./build/bin/mingwX64/debugExecutable/hello-neton.exe
```

On a successful start you should see something like:

```
[INFO] helloworld application started on 0.0.0.0:8080
```

### 6. Verify

From another terminal:

```bash
curl http://localhost:8080/
```

Expected output:

```
Hello Neton!
```

That is a complete Neton application.

## Next steps

- [Project structure](./project-structure.md) — module layout and directory conventions
- [Routing and controllers](./routing.md) — annotated routes and route groups
- [Parameter binding](./parameter-binding.md) — how arguments are inferred from a signature
- [Configuration](./configuration.md) — TOML configuration and environment overrides
