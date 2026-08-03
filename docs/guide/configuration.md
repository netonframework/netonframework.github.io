# Configuration

Neton uses TOML as its only configuration format. Files live in `config/` at the project root, and
values are layered from files, environment variables and command-line arguments.

## A note on TOML

TOML (Tom's Obvious Minimal Language) is a readable configuration format with unambiguous types,
which suits hierarchical application configuration.

```toml
# a comment
key = "a string"
number = 8080
flag = true

[section]            # a table, i.e. a nested map
key = "value"

[[array_of_tables]]  # an array of tables, i.e. a List<Map>
name = "item1"

[[array_of_tables]]
name = "item2"
```

## The main file

`config/application.conf` holds global application, server and logging settings.

```toml
# config/application.conf

[application]
name = "HelloWorld Example"
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

[[logging.sinks]]
name = "all"
file = "logs/all.log"
levels = "ALL"
```

## Sections

### [application]

| Option | Type | Default | Meaning |
|---|---|---|---|
| `name` | String | `"neton"` | Application name, used in logs and the startup banner |
| `debug` | Boolean | `false` | Debug mode |

### [server]

| Option | Type | Default | Meaning |
|---|---|---|---|
| `port` | Int | `8080` | Listen port |

::: warning `server.host` is not supported in 1.0
The bind address is hard-coded to `0.0.0.0` (see `KtorHttpAdapter`). Setting `server.host` has
**no effect**.
:::

### [logging]

| Option | Type | Default | Meaning |
|---|---|---|---|
| `level` | String | `"INFO"` | Global minimum level: TRACE / DEBUG / INFO / WARN / ERROR |

#### [logging.async]

| Option | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | Boolean | `false` | Enable asynchronous logging |
| `queueSize` | Int | `8192` | Queue capacity |
| `flushEveryMs` | Int | `200` | Periodic flush interval in milliseconds |
| `flushBatchSize` | Int | `64` | Records per batch flush |
| `shutdownFlushTimeoutMs` | Int | `2000` | Flush timeout on shutdown, in milliseconds |

#### [[logging.sinks]]

Each sink is one output rule, declared with TOML's array-of-tables syntax:

| Option | Type | Meaning |
|---|---|---|
| `name` | String | Sink name |
| `file` | String | Output file path |
| `levels` | String | Matching levels, comma-separated, or `"ALL"` |
| `route` | String | Optional route match, such as `"http.access"` |

## Per-module files

Modules read their own files, following the rule **filename = namespace**:

| Module | File | Contents |
|---|---|---|
| Database | `config/database.conf` | Connection settings |
| Routing | `config/routing.conf` | Route group definitions |
| Redis | `config/redis.conf` | Connection settings |
| Cache | `config/cache.conf` | Named cache definitions |
| Security | `config/security.conf` | Security settings |

### Database

```toml
# config/database.conf
[default]
driver = "MEMORY"
uri = "sqlite::memory:"
debug = true
```

### Route groups

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

Route groups map a URL prefix onto a group name; security policy and controller scanning both work
in terms of groups.

### Caches

```toml
# config/cache.conf
[caches.users]
ttlMs = 300000
maxSize = 10000
enableL1 = true
```

Unknown codecs, non-numeric `ttlMs` / `maxSize` and non-boolean flags are rejected at startup
rather than silently replaced by defaults.

## Precedence

Higher layers override lower ones:

```
CLI arguments (highest)
    |
    v
environment variables (NETON_ prefix)
    |
    v
environment file (application.{env}.conf)
    |
    v
base file (application.conf)
    |
    v
framework defaults (lowest)
```

Note that "not set" is distinct from "set to the default value". A module DSL that explicitly
assigns a value equal to the default still overrides the file — `redis { port = 6379 }` beats a
file saying `6380`.

### Environment variables

Variables prefixed `NETON_` map onto configuration keys. `__` (double underscore) separates levels
and the path is lower-cased:

```bash
# NETON_SERVER__PORT=9090          ->  server.port = 9090
# NETON_APPLICATION__DEBUG=false   ->  application.debug = false
export NETON_SERVER__PORT=9090
export NETON_APPLICATION__DEBUG=false
```

### Command-line arguments

Use `--key=value`, where the key is a dotted path:

```bash
./my-app --server.port=9090 --application.debug=false --env=prod
```

### Environment files

Select the environment with `--env` or `NETON_ENV` (default `dev`). The matching file is loaded
and merged over the base configuration:

```bash
# applies config/application.prod.conf over config/application.conf
./my-app --env=prod
```

```bash
export NETON_ENV=prod
./my-app
```

Resolution order: `--env=xxx` > `NETON_ENV` > `ENV` > `NODE_ENV` > `dev`.

## Config SPI: application-level extension

When you need to configure framework behaviour at startup — registering authenticators, setting
security policy — use the `@NetonConfig` annotation with a `NetonConfigurer` implementation.

### How it works

1. You annotate a class with `@NetonConfig(component = "xxx")`
2. KSP finds every annotated class at compile time and generates a `NetonConfigRegistry`
3. At startup the framework sorts by `order` and calls each `configure()`

### Example

```kotlin
import neton.core.component.NetonContext
import neton.core.config.NetonConfig
import neton.core.config.SecurityConfigurer
import neton.core.interfaces.SecurityBuilder

@NetonConfig(component = "security", order = 0)
class AppSecurityConfig : SecurityConfigurer {
    override fun configure(ctx: NetonContext, security: SecurityBuilder) {
        // ctx reaches other services
        // security registers authenticators and guards
    }
}
```

### Layering

| Layer | Responsibility | Example |
|---|---|---|
| **DSL** | Install components, pass infrastructure parameters | `security { }`, `http { port = 8080 }` |
| **Component** | Provide the capability | `SecurityComponent`, `HttpComponent` |
| **Config SPI** | Declarative application configuration | `@NetonConfig("security") class AppSecurityConfig` |

The constraints:

- The DSL installs; it must not carry business logic
- Config SPI extends behaviour; it must not install components
- Layers must not reach across each other

### Registering at the entry point

The generated registry has to be passed in:

```kotlin
fun main(args: Array<String>) {
    Neton.run(args) {
        // register the KSP-generated config registry
        defaultConfigRegistry()?.let { configRegistry(it) }

        http { port = 8080 }
        security { }
        routing { }
    }
}
```

If your project uses no `@NetonConfig` classes you can omit `configRegistry`; the framework falls
back to an empty implementation.

## Reading configuration

`ConfigLoader` provides type-safe access:

```kotlin
val config = ConfigLoader.loadApplicationConfig(
    configPath = "config",
    environment = "prod",
    args = args
)

val port = ConfigLoader.getInt(config, "server.port")
val name = ConfigLoader.getString(config, "application.name")
val debug = ConfigLoader.getBoolean(config, "application.debug")

val hasRedis = ConfigLoader.hasConfig(config, "redis.host")
```

A type mismatch throws `ConfigTypeException` immediately. The message names the path and the
source (FILE / ENV / CLI), so the offending value is easy to find.

::: warning No arrays in the TOML parser
The parser does not support arrays, so list-valued configuration — CORS origins, for example —
must be supplied through the DSL.
:::

## Recommended practice

1. **Keep secrets out of files.** Inject keys and passwords through environment variables.
2. **Use environment files for environment differences.** `application.dev.conf`, `application.prod.conf`.
3. **Keep module configuration separate.** Database settings in `database.conf`, routing in `routing.conf`, so the main file stays readable.
4. **Use CLI arguments for one-off debugging.** `--application.debug=true` avoids editing a file.

## Related

- [Config SPI specification](/zh-hans/spec/config-spi) (Chinese) — the full design of configuration extension points
- [Core specification](/zh-hans/spec/core) (Chinese) — the framework core
