# Module Manifest（@Module）设计冻结

> 状态: P1 + P1.1 DONE（2026-06-12）。前置: @Logic P0/P0.1 CLOSED。
> P1.1 注解易用性: @NetonModule 更名 @Module（不留兼容）；id / @Logic.logger 可省略。

## 一句话

模块不再手写完整 ModuleInitializer：`@Module` 让 KSP 生成
`{Id}ModuleManifest`，聚合本模块全部 KSP 产物 + migrations + 手写 runtime
bootstrap；手写 initializer 退化为一行 delegate 薄壳。

## 分层（P1 / P2 边界）

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1 | **模块内部 manifest 化**（本文） | in progress |
| P2 | application 级自动聚合 registry，删 `modules(...)` | 未开始 |

P1 明确**不做**：不删 application `modules(...)`、不做 application auto
registry、不碰 ControllerProcessor、不改 migrations 机制（SQL 仍由 gradle task
embed 进 binary）、不注解化 engine/scheduler/worker。

## 注解

```kotlin
@Module(dependsOn = ["privchat"])   // id 省略 (P1.1)
object GameModule
```

- 标在一个空 object 上（模块声明锚点，不承载逻辑）。
- `id` 可省略（P1.1）。解析顺序：
  1. 显式 id → 必须与 KSP 选项 `neton.moduleId` 一致，不一致是编译错误
     （注解是声明面，KSP arg 是各 processor 共享的机制载体，双源互证）。
  2. 省略 → 取 ksp arg；同时尝试 package 推导（末段，跳过
     init/module/bootstrap），推导成功且与 ksp arg 不一致输出编译警告。
- `dependsOn` 是架构语义，不自动推导，在注解显式声明（取代 ksp arg
  `neton.moduleDependsOn`；两者同时存在时注解优先）。

### @Logic.logger 同步简化（P1.1）

logger 可省略：显式 `@Logic(logger = "...")` 优先（prod 既有日志名必须显式保留）；
省略时自动生成 `<moduleId>.<snake>`（simpleName 去 module Pascal 前缀转
snake_case，如 game 模块 GameRoomLogic → `game.room_logic`）。

## 生成物

`@Module` 存在时，ModuleInitializerProcessor 生成
`neton.module.{id}.generated.{Id}ModuleManifest : ModuleInitializer`
（**不引入新接口** — ModuleInitializer 已经是 manifest 形状）：

```kotlin
object GameModuleManifest : ModuleInitializer {
    override val moduleId = "game"
    override val dependsOn = listOf("privchat")
    override val stats = mapOf("routes" to 117, "logics" to 17)
    override fun migrations(): List<MigrationSource> =
        init.generated.GameMigrationResources.sources   // 按约定 FQN 探测
    override fun initialize(ctx: NetonContext) {
        GameLogicInitializer.initialize(ctx)        // 1. @Logic 装配
        init.GameRuntimeBootstrap.initialize(ctx)   // 2. 手写 runtime（探测到才有）
        GameRouteInitializer.initialize(ctx)        // 3. 路由
        // 4. jobs / validators / configs fragments
    }
}
```

`@Module` 不存在时维持现状（生成 `{Id}ModuleInitializer` 聚合器），
其它模块零影响。

## 约定 FQN 探测（编译期，KSP resolver）

| 探测目标 | FQN 约定 | 存在时 |
|---|---|---|
| migrations | `init.generated.{Id}MigrationResources`（gradle task 生成，`val sources`） | manifest override migrations() |
| runtime bootstrap | `init.{Id}RuntimeBootstrap`（手写 object，`fun initialize(ctx: NetonContext)`） | 在 logic 之后、routes 之前调用 |

migrations 沿用「SQL 编译进 binary」铁律 — 注解**不带** migration path 参数，
K/N 运行期不读 .sql。

## initialize 顺序（冻结）

```
configs → logics(@Logic) → RuntimeBootstrap(手写) → routes → jobs → validators
```

理由：
- bootstrap 里的复杂对象（engine 等）构造期 `ctx.get` @Logic 组件 → logic 必须在前。
- routes 的 controller 是 per-request `ctx.get`，顺序本不敏感，排后只是清晰。
- 想**覆盖**某个 @Logic 组件 → 别标注解（移出 @Logic 即回手写域）；
  generated bind 的 non-overriding 语义保留为防御，不是日常路径。

## 模块侧最终形态

```kotlin
@Module(dependsOn = ["privchat"])
object GameModule

// 手写 runtime（engine/scheduler/watchdog/smoke 等，原 initializer body）
object GameRuntimeBootstrap {
    fun initialize(ctx: NetonContext) { ... }
}

// 薄壳（P1 过渡，P2 在 application 聚合后删除）
object GameModuleInitializer : ModuleInitializer by GameModuleManifest
```

application `Main.kt` 的 `modules(GameModuleInitializer)` **完全不动**。
