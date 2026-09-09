# Request object pooling — audit and design

Goal (from the user): don't allocate a fresh HttpContext/Request/Response per
request. Pre-build a bounded set of request-object skeletons; a request leases
one, fills it, and returns it after every consumer is done. This is the
fasthttp/Netty model, not caching request data.

Not the goal: bypass Kotlin/Native GC (pooled objects stay on the GC heap; the
win is fewer allocations and less garbage, not escaping GC), and not a single
shared mutable map for per-request data (that races under concurrency).

## Candidate per-request allocation points (source estimate — NOT measured bytes)

These are construction sites read from the code, not a runtime count of
allocations or bytes. Treat as candidates to measure, not a finished audit.

FFI boundary (hyper4k `submit`), per request:
- method / path / query: each `copyToByteArray().decodeToString()` → a transient
  ByteArray + a String (≈6 allocations)
- rawHeaderBytes, body: one ByteArray each (2)
- `Hyper4kRequest` object (1)
- coroutine: `scope.launch(UNDISPATCHED)` continuation/Job state (several)

neton dispatch, per request:
- `BufferedHttpRequest` (+2 function refs for singleHeader/headersProvider)
- `BufferedHttpContext`, `BufferedHttpRequestView`
- `ArgsView` (+2 lambdas for query scan)
- `DispatchOutcome` (data class)
- `BufferedHttpResponse` (+ response body bytes)
- `toHyper4k` → `Hyper4kResponse` (+ encoded header bytes)

≈25–30 *construction sites* (not a measured allocation/byte count). Split:
- **Poolable skeletons** (structure stable, fields refillable): Hyper4kRequest,
  BufferedHttpRequest, BufferedHttpContext, BufferedHttpRequestView, ArgsView,
  BufferedHttpResponse, Hyper4kResponse.
- **Per-request data** (content differs each request): the FFI-copied strings and
  the header/body/response byte arrays. Content cannot be pooled; the *buffers*
  can be, separately, with a return-after-write contract.
- **Coroutine state**: not pooled (do not reuse a completed Job/continuation).

## Design: a bounded `RequestSlot` pool

```
RequestSlot (one per in-flight request) — owned by neton-http only
  ├─ BufferedHttpContext + Request view + Response state (framework objects)
  ├─ reusable param/header containers
  └─ optional borrowed buffer (from a separate sized buffer pool)

Layer separation: the slot holds ONLY neton-http framework state. The Hyper4k
adapter owns its own transport/conversion objects (Hyper4kRequest/Response) and
cooperates via a completion/borrow contract — the framework pool is not bound to
Hyper4k types.

lease → init(fields) → dispatch → await ALL consumers done → reset → return
```

### Non-negotiable safety rules (a leak here corrupts a different user's request)

1. **One slot per request; never shared while live.** Return must be safe from
   whatever thread the coroutine resumed on, without a single global lock becoming
   the bottleneck (shard the pool, or a lock-free stack).
2. **"Done" is not "handler returned."** Streaming responses, async writes and
   managed sub-tasks must all have finished before return; cancellation and
   exceptions go through the same single release path (return exactly once).
3. **reset clears every request reference:** identity, exception, body, response
   headers, attributes, callbacks. An exception-inflated large buffer is dropped,
   not kept in the pool forever.
4. **Application code must not retain the context past the request.** Background
   work copies what it needs. A version/generation counter on the slot can catch
   some use-after-return in debug, but is not a correctness guarantee.

### Rollout

- Behind a flag; the plain per-request-allocation path stays as the A/B control.
- Bounded: separate knobs for pre-warmed slots, max in-flight, max retained bytes.
  Do NOT hardcode 65535 as a default — idle servers must not hold max memory, and
  connections != request slots (one h2 connection multiplexes several).
- Acceptance is NOT just RPS: allocation bytes/request, CPU/request, p99, peak
  RSS, and behaviour under overload + recovery. Must also pass cancel, streaming,
  slow-consumer, disconnect and cross-thread-resume tests with no cross-request
  data bleed.

## Why not a thread-local single request object

A request can suspend and resume on a different thread, so a thread-local
"one live request object" would be handed to the wrong request. Slots must be
leased/returned explicitly, not bound to a thread.

## First increment: an internal RequestSlot lifecycle prototype

Not "pool all public objects." Build and test the lifecycle state machine first,
on internal (non-escaping) state only:

    FREE -> LEASED -> CLOSING -> RESET -> FREE

Acceptance (names don't matter, these behaviours do):
- a slot is never leased to two requests at once;
- on a race among cancel / exception / normal completion, it returns exactly once;
- reset happens only after every consumer that could still touch the slot is done;
- pool exhaustion has a defined policy (no unbounded ad-hoc creation);
- reset leaves no identity, request data or callbacks behind;
- a stale reference cannot read the next request's data after re-lease.

The public HttpContext can be retained by application code, so whether to reuse
it is a SEPARATE compatibility decision — the first version pools internal state
that cannot escape. Start with a simple bounded implementation (a lock is fine);
let tests decide whether contention warrants sharding. Keep the plain
per-request-allocation path as the A/B control. Which object to reuse first is
chosen after measuring which is largest and safest — not assumed.


## Measured: the return path is allocation-free, and only escaping objects benefit

A microbenchmark (5M iterations, 4 MiB heap floor, autotune off, GC epochs counted;
`alloc-probe.kt` here) leasing+closing a pooled Box vs `new` each time:

| | GC cycles over 5M | slots created |
|---|---|---|
| direct `new` (object escapes) | 36 | — |
| pool lease+close | 0 | 1 |

So the array-stack return path allocates nothing (one slot, zero GC over 5M
reuses) — the "allocation-free return" claim holds, measured.

Important caveat that shapes what to pool: when the object does NOT escape the
loop, BOTH direct-new and pool showed 0 GC — Kotlin/Native's escape analysis
already elides non-escaping allocations. Pooling only pays for objects that
genuinely escape (held across suspension, handed to the handler): the
context/request/response skeleton. Do not pool short-lived non-escaping
temporaries; the compiler already handles those. This trims the wiring target.

## Admission policy: the pool is a cache, not a gate

There is exactly ONE admission gate, and it already exists: the engine's
`Semaphore(maxConcurrentRequests)` in `Hyper4kServer.submit` (`slots.tryAcquire()`).
It bounds total in-flight requests and returns 503 when full. That is the limit
that protects memory and the event loop.

The slot pool must NOT add a second gate. Concretely:

- **`lease() == null` degrades to plain allocation, never to a 503.** Pool
  exhaustion means "no reusable skeleton right now", not "server overloaded".
  Falling back to `new` gives exactly the pre-pool behaviour for that request —
  strictly no worse — and the GC reclaims it as before.
- **`maxSlots` bounds resident pooled memory only**, not concurrency. A second
  concurrency counter in the pool would double-count against the semaphore:
  either spurious 503s, or two counters that must be kept in lockstep for no
  benefit. One gate, one source of truth.

### Sizing

Set `maxSlots ≈ maxConcurrentRequests`. Then in steady state every admitted
request finds a free slot, because the semaphore already caps concurrency at
that number. The only misses are transient: a slot is returned (after `reset`)
slightly later than its semaphore permit is released, so a freshly admitted
request can briefly find the pool empty. That request falls back to a fresh
allocation — the return-lag window, not a failure. A small headroom
(`maxSlots = maxConcurrentRequests + N`) shrinks even those misses, at the cost
of N resident skeletons; it is a tuning knob, not a correctness requirement.

### What this does not solve

Sizing and fallback keep the pool safe under exhaustion. They do NOT make wiring
safe: a slot returned while a streaming writer or a cancelled coroutine still
holds it would hand one request's buffers to the next. That is the lease-token +
consumer-refcount contract in `SlotPool.kt`, and it must be proven on the real
dispatch path (cancel / streaming / cross-thread) before the pool is wired —
step 3, deliberately separate from this policy.

## Wiring target (step 3): what actually escapes, and its reset surface

From the escape finding, pool ONLY the objects held across the suspend
`handler.invoke(context, args)` call in `BufferedHttpDispatcher.dispatchOne`.
Enumerated from that path:

| Object | Why it escapes | Reset surface on return |
|---|---|---|
| `BufferedHttpContext` | passed to security, rate-limit and the suspend handler | `requestView`, `sessionOrNull`, `attributesOrNull`, `bufferedResponse`, and the ctor args (`sourceRequest`, `method`, `pathParameters`, `appContext`, `traceId`, `liveResponse`) must become re-fillable `var`s |
| `BufferedHttpRequestView` | reached via `context.request`, lives inside the context | lazy caches `pathOrNull`, `urlOrNull`, `headersOrNull`, `queryParamsOrNull` |
| `BufferedMemoryResponse` | reached via `context.response`, accumulates body/headers | largest reset surface — status, headers, body buffer, committed flag |
| `ArgsView` (line ~320) | passed to the suspend handler | today its two scan lambdas capture `request`, so they allocate per request; pooling it means restructuring to non-capturing form |

Do NOT pool: `DispatchOutcome` (consumed immediately up the stack — K/N already
elides it), the path-parameter `HashMap` and `MatchedRoute` (short-lived, low
value; measure before touching), and the log entries (off the hot path).

### Why step 3 is a refactor, not a drop-in

Every object above is built from `val` constructor fields today. Pooling them
means: (1) make the fields mutable with a `fill(...)` that re-binds a leased
skeleton to the new request, (2) a `reset()` that clears every field in the
table above with no leftover reference to the previous request, (3) remove the
per-request lambda capture in `ArgsView`. Then the lease-token +
consumer-refcount contract must be proven on the live path under cancellation,
streaming, and cross-thread resume — a leaked reference here silently serves one
request's body to the next. This is why wiring is a focused, A/B-gated effort
with the plain-allocation path kept as the control, not a tail-of-session change.
