# 配置指南

Neton 使用 TOML 格式作为唯一的配置文件格式，配置文件存放在项目根目录的 `config/` 目录下。框架提供分层覆盖机制，支持从文件、环境变量和命令行参数多个来源加载配置。

## TOML 格式简介

TOML（Tom's Obvious Minimal Language）是一种注重可读性的配置文件格式。Neton 选用 TOML 是因为其语法清晰、类型明确，适合表达层级化的应用配置。

基本语法：

```toml
# 这是注释
key = "字符串值"
number = 8080
flag = true

[section]          # 表（section），对应嵌套 Map
key = "value"

[[array_of_tables]]  # 表数组，对应 List<Map>
name = "item1"

[[array_of_tables]]
name = "item2"
```

## 主配置文件

应用的主配置文件为 `config/application.conf`，包含全局应用配置、服务器配置和日志配置。

### 完整示例

```toml
# config/application.conf

[application]
name = "HelloWorld Example"
debug = true

[server]
port = 8080
host = "0.0.0.0"

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

[[logging.sinks]]
name = "all"
file = "logs/all.log"
levels = "ALL"
```

## 配置节详解

### [application] -- 应用信息

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `name` | String | `"neton"` | 应用名称，用于日志、Banner 显示 |
| `debug` | Boolean | `false` | 调试模式开关 |

### [server] -- HTTP 服务器

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `port` | Int | `8080` | 监听端口 |
| `host` | String | `"0.0.0.0"` | 绑定地址 |

### [logging] -- 日志

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `level` | String | `"INFO"` | 全局最低日志级别（TRACE/DEBUG/INFO/WARN/ERROR） |

#### [logging.async] -- 异步日志

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | Boolean | `false` | 是否启用异步日志 |
| `queueSize` | Int | `8192` | 异步队列容量 |
| `flushEveryMs` | Int | `200` | 定时刷新间隔（毫秒） |
| `flushBatchSize` | Int | `64` | 批量刷新大小 |
| `shutdownFlushTimeoutMs` | Int | `2000` | 关机时刷新超时（毫秒） |

#### [[logging.sinks]] -- 日志输出目标

每个 sink 定义一个日志输出规则，使用 TOML 表数组语法（双方括号）：

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `name` | String | sink 名称，用于标识 |
| `file` | String | 输出文件路径 |
| `levels` | String | 匹配的日志级别，逗号分隔或 `"ALL"` |
| `route` | String | 可选，日志路由匹配（如 `"http.access"`） |

## 模块配置文件

除主配置外，各模块拥有独立的配置文件，遵循 **文件名 = 命名空间** 的规则：

| 模块 | 配置文件 | 说明 |
|------|----------|------|
| 数据库 | `config/database.conf` | 数据库连接配置 |
| 路由 | `config/routing.conf` | 路由组定义 |
| Redis | `config/redis.conf` | Redis 连接配置 |
| 安全 | `config/security.conf` | 安全模块配置 |

### 数据库配置示例

```toml
# config/database.conf
[default]
driver = "MEMORY"
uri = "sqlite::memory:"
debug = true
```

### 路由组配置示例

```toml
# config/routing.conf
debug = false

[[groups]]
group = "admin"
mount = "/admin"

[[groups]]
group = "app"
mount = "/app"
```

路由组定义了 URL 前缀与组名的映射关系，安全策略、控制器扫描等功能都基于路由组工作。

## 分层覆盖优先级

Neton 的配置加载遵循严格的优先级顺序，高优先级的值会覆盖低优先级：

```
CLI 命令行参数 (最高)
    |
    v
环境变量 (NETON_ 前缀)
    |
    v
环境配置文件 (application.{env}.conf)
    |
    v
基础配置文件 (application.conf)
    |
    v
框架默认值 (最低)
```

### 环境变量覆盖

以 `NETON_` 为前缀的环境变量会自动映射为配置项。`__`（双下划线）表示层级分隔符，路径转为小写：

```bash
# NETON_SERVER__PORT=9090  ->  server.port = 9090
# NETON_APPLICATION__DEBUG=false  ->  application.debug = false
export NETON_SERVER__PORT=9090
export NETON_APPLICATION__DEBUG=false
```

### 命令行参数覆盖

使用 `--key=value` 格式的命令行参数，key 为点分路径：

```bash
./my-app --server.port=9090 --application.debug=false --env=prod
```

### 环境配置文件

通过 `--env` 参数或 `NETON_ENV` 环境变量指定运行环境（默认 `dev`），框架会自动加载对应的环境配置文件并与基础配置合并：

```bash
# 加载 config/application.prod.conf 覆盖 config/application.conf
./my-app --env=prod
```

```bash
# 通过环境变量指定
export NETON_ENV=prod
./my-app
```

环境解析优先级：`--env=xxx` CLI 参数 > `NETON_ENV` > `ENV` > `NODE_ENV` > 默认 `dev`。

## Config SPI：业务级配置扩展

对于需要在启动时动态配置框架行为的场景（如注册认证器、配置安全策略），Neton 提供 `@NetonConfig` 注解 + `NetonConfigurer` 接口的 SPI 机制。

### 工作原理

1. 业务类使用 `@NetonConfig(component = "xxx")` 标注
2. KSP 在编译期扫描所有标注的类，生成 `NetonConfigRegistry`
3. 框架启动时按 `order` 排序，依次调用 `configure()` 方法

### 示例

```kotlin
import neton.core.component.NetonContext
import neton.core.config.NetonConfig
import neton.core.config.SecurityConfigurer
import neton.core.interfaces.SecurityBuilder

@NetonConfig(component = "security", order = 0)
class AppSecurityConfig : SecurityConfigurer {
    override fun configure(ctx: NetonContext, security: SecurityBuilder) {
        // 通过 ctx 可以访问其他 Service
        // 通过 security 配置认证器和守卫
    }
}
```

### 分层原则

| 层级 | 职责 | 示例 |
|------|------|------|
| **DSL 层** | 安装组件、传递基础参数 | `security { }`、`http { port = 8080 }` |
| **Component 层** | 提供服务能力 | SecurityComponent、HttpComponent |
| **Config SPI 层** | 业务逻辑的声明式配置 | `@NetonConfig("security") class AppSecurityConfig` |

关键约束：
- DSL 只负责安装，禁止写业务逻辑
- Config SPI 只做业务扩展，禁止在其中 install 组件
- 不得跨层调用

### 在入口注册

KSP 生成的 Registry 需要在应用入口注册：

```kotlin
fun main(args: Array<String>) {
    Neton.run(args) {
        // 注册 KSP 生成的配置注册表
        defaultConfigRegistry()?.let { configRegistry(it) }

        http { port = 8080 }
        security { }
        routing { }
    }
}
```

如果项目中没有使用任何 `@NetonConfig` 注解，可以省略 `configRegistry` 调用，框架会使用空的默认实现。

## 配置读取 API

框架内部通过 `ConfigLoader` 加载和读取配置，支持类型安全的访问：

```kotlin
// 加载应用配置
val config = ConfigLoader.loadApplicationConfig(
    configPath = "config",
    environment = "prod",
    args = args
)

// 点分路径读取
val port = ConfigLoader.getInt(config, "server.port")
val name = ConfigLoader.getString(config, "application.name")
val debug = ConfigLoader.getBoolean(config, "application.debug")

// 检查配置是否存在
val hasRedis = ConfigLoader.hasConfig(config, "redis.host")
```

类型不匹配时会抛出 `ConfigTypeException`（fail-fast），报错信息包含路径和来源（FILE/ENV/CLI），便于快速定位问题。

## 最佳实践

1. **敏感信息不入库**：密钥、密码等通过环境变量注入，不写在配置文件中
2. **环境差异用环境文件**：`application.dev.conf` 开发配置，`application.prod.conf` 生产配置
3. **模块配置独立**：数据库配置放 `database.conf`，路由放 `routing.conf`，避免主配置文件过大
4. **CLI 参数用于临时调试**：`--application.debug=true` 临时开启调试，不修改文件

## 相关文档

- [Config SPI 设计规范](/spec/config-spi) -- 配置扩展点的完整设计
- [核心架构规格](/spec/core) -- 框架核心架构说明
- [核心规格](/spec/core) -- Core 模块完整规格
