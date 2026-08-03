# Application Lifecycle Contract

> Status: Implemented; macOS release smoke passed, Linux/Windows native CI pending
> Track: NETON-LIFECYCLE-P0
> Target: Neton 1.0
> Kotlin baseline: 2.4.0 (KSP plugin 2.3.10)

## 1. Purpose

Neton startup and shutdown are deterministic, observable and resource-safe. Startup is a state
machine rather than a sequence of best-effort callbacks.

```text
CREATED -> REGISTERING -> VALIDATING -> FROZEN -> STARTING -> READY
                                                               |
                                                               v
                                                        STOPPING -> STOPPED
```

Any failure before `READY` aborts startup, closes owned resources and escapes `Neton.run` unchanged.
The framework must never log a startup failure and then return success.

## 2. Startup phases

The authoritative order is:

1. Create `NetonContext`, load environment and configuration.
2. Run `NetonComponent.init` in installation order. Components bind foundational services but do
   not start background work.
3. Apply application configurers that modules may depend on.
4. Validate and topologically sort application modules.
5. Run module manifests. Generated Logic, RuntimeBootstrap, routes, jobs and validators register
   their objects and lifecycle owners.
6. Run `NetonComponent.prepare` in installation order. Prepare consumes the complete module
   registrations and binds finalized services such as the JobScheduler.
7. Execute the pre-serving `onStart` hook and validate required capabilities.
8. Freeze the context.
9. Start components and registered module lifecycles in deterministic order.
10. Start the HTTP adapter last.
11. After the adapter confirms that it is listening, enter `READY` and execute `onReady`.

`init`, configurers, module manifests and `prepare` may bind services. `start`, `onReady` and request
handling may not mutate the application object graph.

## 3. Context freeze

`NetonContext.bind` and `bindIfAbsent` are legal only before `freeze()`.

After freeze:

- `get` and `getOrNull` remain legal.
- binding or replacing a service throws `IllegalStateException`.
- dedicated runtime registries may mutate only through their own explicit, thread-safe APIs.
- freezing more than once is idempotent.

Global `NetonContext.current()`, `inject()` and `get()` accessors are not part of the 1.0 API.
Constructor injection or an explicitly passed `NetonContext` is the standard path.

## 4. Component contract

```kotlin
interface NetonComponent<C : Any> {
    fun defaultConfig(): C
    suspend fun init(ctx: NetonContext, config: C)
    suspend fun configure(ctx: NetonContext) {}
    suspend fun prepare(ctx: NetonContext) {}
    suspend fun start(ctx: NetonContext) {}
    suspend fun stop(ctx: NetonContext) {}
}
```

- `init` creates and binds foundational resources.
- `configure` applies contributions required by module registration.
- `prepare` consumes the complete registration graph and finalizes runtime services.
- `start` activates background work and must not bind services.
- `stop` is idempotent and releases everything owned since successful `init`.

A component whose `init` returned successfully is stopped even if startup fails before its `start`.
A component whose `init` throws must clean resources created inside that incomplete call itself.

## 5. Module resource ownership

RuntimeBootstrap remains an explicit escape hatch for complex application assembly. It may create
clients, pools, coroutine scopes, schedulers, workers and watchers only when it registers a lifecycle
owner with `LifecycleRegistry` before context freeze.

```kotlin
interface NetonLifecycle {
    suspend fun start()
    suspend fun stop()
}

ctx.lifecycle.register("game.timeout-scheduler", scheduler)
```

Lifecycle names are unique. Start follows registration order. Only successfully started entries are
stopped, in reverse order. A start failure triggers reverse stop of earlier entries.

Unowned `CoroutineScope`, `HttpClient`, socket, worker, timer, file watcher or connection pool in a
RuntimeBootstrap is forbidden.

## 6. Failure propagation

- Configuration, component, module, validation, lifecycle and HTTP failures escape `Neton.run`.
- CLI callers therefore terminate with a non-zero status unless they explicitly catch the failure.
- The original startup failure remains the primary failure.
- Cleanup failures are logged with owner, phase and error; they do not stop remaining cleanup and do
  not replace the primary startup failure.
- Framework lifecycle code catches `Throwable` for cleanup, while preserving cancellation semantics
  in application work.
- Compatibility generated initialization must not silently swallow failures.

## 7. Shutdown order

Shutdown is idempotent and follows this order:

1. Enter `STOPPING` and stop accepting HTTP work.
2. Stop registered module lifecycles in reverse successful-start order.
3. Stop successfully initialized components in reverse initialization order.
4. Clear compatibility global context and framework global references.
5. Enter `STOPPED`.

Every stop failure is structured and observable, but best-effort cleanup continues.

On Native targets, Core installs process-wide `SIGINT` and `SIGTERM` handlers immediately before
HTTP startup. The C handler only sets a `sig_atomic_t` flag; a Kotlin coroutine observes the flag
and stops the active adapter. Signal handling therefore enters the same ordered shutdown path and
never invokes Kotlin or suspend code from the asynchronous signal callback. Neton restores the
host process's previous handlers after shutdown, including failed and repeated startup attempts.

## 8. Hooks

- `onStart` is the compatibility pre-serving hook. It runs before freeze and before HTTP starts.
- `onReady` runs once after the HTTP adapter confirms that it is listening. The context is frozen.
- A failing `onStart` aborts startup before serving.
- A failing `onReady` is a startup failure and initiates shutdown.

## 9. Jobs and routes

Generated routes, jobs, validators and Logic services register during module initialization.

JobsComponent must not snapshot jobs in `init`. It consumes the final JobRegistry during `prepare`,
then starts scheduling only in `start`. Therefore every module job is visible before the scheduler
launches.

HTTP is started only after route registration, security finalization, context freeze and lifecycle
startup have completed.

## 10. Acceptance gates

NETON-LIFECYCLE-P0 closes only when:

1. Binding after freeze fails while reads continue to work.
2. Missing module dependencies fail before HTTP starts.
3. Component init/start and module lifecycle failures escape `Neton.run`.
4. Partial startup closes initialized resources in reverse order.
5. Stop failure is recorded and remaining resources still stop.
6. Module jobs are visible when JobsComponent prepares and starts.
7. RuntimeBootstrap background resources have registered lifecycle owners.
8. HTTP starts last, reports READY accurately and stops first.
9. Framework lifecycle tests and the real PrivChat application compile on Kotlin 2.4.0.
10. Native release validation runs on the target's native host: macOS for `macosArm64`, Linux for
    `linuxX64`, and Windows for `mingwX64`. Cross-compilation from macOS is not accepted as evidence
    for Linux or Windows lifecycle behavior.

## 11. Deferred work

- physical `StartupRegistry` / `ServiceProvider` type split
- component dependency DAG and automatic installation ordering
- HTTP Dispatcher unification
- KSP processor architecture refactor
- adopting new Kotlin 2.4 language features in framework code
- Gradle plugin auto-discovery
