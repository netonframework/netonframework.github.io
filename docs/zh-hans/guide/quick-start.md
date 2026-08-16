# 快速开始

本章将带你从零搭建第一个 Neton 应用，在 5 分钟内运行一个 Hello World 服务。

## 环境要求

在开始之前，请确保你的开发环境满足以下条件：

| 工具 | 版本要求 | 说明 |
|------|---------|------|
| Kotlin | 2.4.0 | Neton 基于 Kotlin Multiplatform 构建（见 `gradle/libs.versions.toml`） |
| KSP | 2.3.10 | KSP 插件版本，与 Kotlin 独立管理 |
| Gradle | 8.x | 构建工具，推荐使用 Gradle Wrapper |
| 操作系统 | macOS / Linux / Windows | 支持多平台原生编译 |

::: tip 支持的目标平台
Neton 编译为 Kotlin/Native 原生二进制，当前支持以下目标平台：
- **macOS ARM64** — Apple Silicon（M1/M2/M3/M4）
- **Linux x64** — x86_64 架构服务器
- **Linux ARM64** — ARM 架构服务器（如 AWS Graviton、树莓派）
- **Windows x64** — x86_64 架构（MinGW）
:::

## 第一步：创建项目

创建项目目录并初始化基本结构：

```bash
mkdir hello-neton
cd hello-neton
```

项目目录结构如下：

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

## 第二步：配置构建脚本

创建 `build.gradle.kts`，配置 Kotlin Multiplatform 插件和 Neton 依赖：

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

`com.netonstream:neton` 是**唯一带版本号的坐标**。它拉进一个可运行服务所需的四个模块——
`neton-core`、`neton-logging`、`neton-http`、`neton-routing`——并把其余所有 Neton 模块钉在同一个
发布版本上，所以追加其它模块**不写版本**：

```kotlin
implementation("com.netonstream:neton-database")   // 自动对齐到 1.0.0-beta1
implementation("com.netonstream:neton-redis")
implementation("com.netonstream:neton-cache")
```

| 坐标 | 说明 |
|---|---|
| `neton` | 入口：core + logging + http + routing，附带其余模块的版本约束 |
| `neton-<模块>` | 可选模块——`database`、`redis`、`cache`、`security`、`storage`、`jobs`、`validation`、`ai` |
| `neton-bom` | 只做版本对齐，给不想拉四个基础模块、只要约束的项目：`implementation(platform("com.netonstream:neton-bom:1.0.0-beta1"))` |

可选模块**故意不收进** `neton`：它们带原生库（Rust 数据库驱动、Redis 客户端），Kotlin/Native
静态链接会把用不到的也编进每个二进制；而且 `neton-database` 没有 macOS x64 目标。

## 第三步：编写配置文件

在 `config/` 目录下创建 `application.conf`（TOML 格式）：

```toml
[application]
name = "helloworld"
debug = true

[server]
port = 8080

[logging]
level = "INFO"
```

配置项说明：

- `application.name` -- 应用名称，用于日志标识
- `application.debug` -- 调试模式，开启后输出更详细的日志
- `server.port` -- HTTP 监听端口
- `logging.level` -- 日志级别：`DEBUG`、`INFO`、`WARN`、`ERROR`

## 第四步：编写主程序

创建 `src/commonMain/kotlin/Main.kt`：

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

代码解读：

1. **`Neton.run(args)`** -- 框架入口，启动 Neton 运行时容器
2. **`http { ... }`** -- 安装 HTTP 组件并配置端口
3. **`routing { ... }`** -- 安装路由组件，使用 DSL 定义路由
4. **`get("/")`** -- 注册一个 GET 路由，路径为 `/`，处理函数直接返回字符串作为响应体

::: info DSL 路由 vs 注解路由
上面的示例使用 DSL 方式定义路由，适合简单场景。对于大型项目，推荐使用 `@Controller` + `@Get` 注解方式，配合 KSP 在编译期自动生成路由代码。详见 [路由与控制器](./routing.md)。
:::

## 第五步：构建和运行

执行以下命令编译并运行：

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

启动成功后，你将看到类似以下输出：

```
[INFO] helloworld application started on 0.0.0.0:8080
```

## 第六步：验证

打开另一个终端窗口，使用 `curl` 验证服务是否正常运行：

```bash
curl http://localhost:8080/
```

预期输出：

```
Hello Neton!
```

恭喜！你已经成功运行了第一个 Neton 应用。

## 下一步

现在你已经了解了 Neton 的基本用法，可以继续深入学习：

- [项目结构](./project-structure.md) -- 了解 Neton 的模块划分和目录约定
- [路由与控制器](./routing.md) -- 学习 Controller 注解路由和路由组
- [参数绑定](./parameter-binding.md) -- 掌握约定优于配置的参数绑定机制
- [配置管理](./configuration.md) -- 深入了解 TOML 配置与环境覆盖
