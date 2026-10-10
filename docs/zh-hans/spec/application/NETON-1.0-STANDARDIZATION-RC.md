# NETON-1.0-STANDARDIZATION-RC — Executable Checklist

Scope-locked 1.0 surface hardening. **No** HTTP Dispatcher / KSP rework / Kotlin 2.4 / Gradle P3 / repository-service rename.

**Status: STD-0 through STD-4 and APP-COMPOSITE are DONE.**

Scope note: STANDARDIZATION-RC validates module-level compile, tests, docs/API cleanup, and aggregate application compilation.

Repos touched:
- `Neton/neton` (framework: database, docs)
- `Neton/neton-application` (upstream: providers, naming, docs)
- `privchat/privchat-application` (**fork** of neton-application — synced STD-0 + STD-3)

Fork rule: fix upstream `neton-application` first, then apply the same change to `privchat-application` as a **separate commit in that repo**. Never mix the two repos in one commit.

### Commit trail
- STD-0 upstream `neton-application`: `fix(system): placeholder providers must not fake success (STD-0)`
- STD-0 fork `privchat-application`: `fix(system): placeholder providers must not fake success (STD-0 fork sync)`
- STD-2 `neton`: `b8b858a fix(database): remove unimplemented typed projection API (STD-2)`
- STD-1 `neton`: `f6da05c fix(database): fail fast on invalid database config (STD-1)`
- STD-3 upstream `neton-application`: `refactor(infra): remove redundant App prefix from file classes (STD-3)`
- STD-3 fork `privchat-application`: `refactor(infra): ... (STD-3 fork sync)`
- STD-4A `neton`: `00d0665 refactor(database): remove deprecated TableDefRegistry.find() (STD-4A)`
- STD-4B `neton`: `0086377 docs: mark obsolete http-client design docs + turn neton-http TODO into Roadmap (STD-4B)`
- STD-4C `neton-application`: module-template-spec Prefer/Avoid labels + this spec update

### APP-COMPOSITE conclusion
- `:application` aggregate compile is a documented build entry (`.github/workflows/backend-ci.yml:73` in both repos; README; `scripts/release-gate-smoke.sh` consumes `application.kexe`).
- External module repositories remain independently buildable through their own `settings.gradle.kts`.
- Aggregate applications compose sibling repositories as source subprojects and substitute stable module coordinates with those projects.
- Both `neton-application` and `privchat-application` aggregate macOS ARM64 compilation pass without local publication or cyclic `includeBuild` wiring.

### Final state (frozen)
1. **NETON-1.0-STANDARDIZATION-RC: CLOSED.** STD-0..STD-4 done; module-level compile + tests + docs.
2. **STD-3 rename fallout fixed.** The `AppFileLogic → FileUploadLogic` rename broke a cross-repo consumer (`neton-application-module-member`, which STD-3's grep missed). Fixed: `MemberProfileLogic.kt` committed as `9daf44b` in that repo; `MemberRuntimeBootstrap.kt:20` one-line change left in the member author's working tree (their WIP) to commit with their branch.
3. **`privchat-application` aggregate compile: PASS** (verified locally, product path green).
4. **APP-COMPOSITE: PASS.** Base and product aggregate builds use the same source-subproject rule.
5. **MODULE-SOURCE-CANONICALIZE-P0: CLOSED.** Cyclic composite wiring and parent-directory-name dependency were removed.
6. **Cross-repo rename lesson captured** in `ENGINEERING_RULES.md` §3.5.1: renaming a public symbol must grep **all** canonical included builds, not only the current app fork tree.

Do not continue expanding this line into unrelated framework work.

---

## STD-0 — Provider false-success (P0) — ✅ DONE (both repos)

Problem (verified with file:line):
- `SmsProvider.send()` → `return true` (logs only; caller records success). Live path via `MessageSendLogic.sendByTemplate:54-68`.
- `EmailProvider.send():20` → `return true`. Same.
- `GoogleSocialProvider.getUserInfo()` → `openId=""`. Guarded downstream by `SocialUserLogic:45` isBlank→400, but provider still fakes a success-shaped result.
- `TelegramSocialProvider.getUserInfo():26` → `openId=""`. Same. `getAuthRedirectUrl` returns `""`.
- All 4 wired into live path in `SystemRuntimeBootstrap:35-41`.

Fix:
- [ ] Add `ProviderNotImplementedException` (extends `neton.core.http.HttpException(NetonErrorCode.SERVICE_UNAVAILABLE, ...)` → HTTP 503) in `module-system/.../logic/provider/`.
- [ ] `SmsProvider.send` / `EmailProvider.send`: throw it instead of `return true`. (Caught by `MessageSendLogic` try/catch → returns false + logs failure = honest.)
- [ ] `GoogleSocialProvider` / `TelegramSocialProvider`: `getUserInfo` throws it (no empty-openId return). `getAuthRedirectUrl` for unimplemented flow throws it too (no empty/misleading URL).
- [ ] Mock policy: placeholders no longer silently succeed. A working dev/test provider must be an explicitly-named injected double, not the default. (No mock framework built in this cut.)
- [ ] Minimal contract tests: each provider method throws `ProviderNotImplementedException` (no `true`, no empty `openId`).
- [ ] Fork sync → same changes in `privchat-application`.

Verify: `:module-system:compileKotlin* + allTests`, provider contract tests pass, aggregate compile.

---

## STD-1 — DatabaseConfig fail-fast (P0) — ✅ DONE (f6da05c)

Problem (`neton/neton-database/.../config/DatabaseConfig.kt`):
- `fromMap():85-89` unknown `driver` string → `catch → MEMORY` (silent).
- `fromMap():91-96` missing `uri` → generates hardcoded default (incl. password).
- URI parsers simplified regex; query options unparsed (`:186` `TODO: 解析查询参数`, `emptyMap()`).
- `validate():54-77` returns `List<String>` but does not itself fail-fast; runs after fromMap fallback.

Fix:
- [ ] `fromMap`: unknown driver → throw (no MEMORY fallback). MEMORY only when `driver` explicitly `"MEMORY"`/`"memory"`.
- [ ] Missing required `uri` for non-MEMORY driver → throw (no hardcoded default DB).
- [ ] Query options: parse into `options` map, or reject unknown options explicitly (no silent `emptyMap()` drop). Decide minimal: parse `?k=v&...` into map.
- [ ] Ensure startup path treats `validate()` non-empty as fatal (fail-fast), not advisory.
- [ ] Contract tests: invalid scheme fails, malformed uri fails, missing uri fails, unknown driver fails, MEMORY only-when-explicit, ENV/CLI override still wins.

Verify: `:neton-database:allTests`, KSP compile, aggregate compile, release-gate-smoke.

---

## STD-2 — select(KProperty1) TODO (P0) — ✅ DONE (b8b858a)

Problem: `EntityQuery.kt:37-44` public interface declares 8 typed `select(KProperty1...)`; impl `SqlxPhase1Query.kt:70-99` all `TODO(...)` → runtime `NotImplementedError`. Working `select(vararg String): ProjectionQuery` already exists (`:63`).

Fix (chosen: remove typed overloads for 1.0; redesign projection DSL in 1.1):
- [ ] Remove the 8 `select(KProperty1...)` declarations from `EntityQuery` interface + their `SqlxPhase1Query` impls + `TypedProjection1..8` types if unused elsewhere.
- [ ] Keep `select(vararg String): ProjectionQuery`.
- [ ] Grep for any caller of typed `select(...)` before removing; if a caller exists, migrate it to string projection.
- [ ] (Alternative if a caller can't migrate: keep behind `@ExperimentalNetonApi` throwing an explicit `UnsupportedOperationException("Typed projection not supported in Neton 1.0")` — but no `TODO()`.)

Verify: `:neton-database:allTests`, KSP compile, aggregate compile.

---

## STD-3 — AppFile* naming + fork sync (P1) — ✅ DONE (both repos; renamed to FileController / FileUploadLogic; routes unchanged)

Problem: `module-infra/.../logic/AppFileLogic.kt` + `controller/app/infra/file/AppFileController.kt`. Package already `controller.app.infra.file` → `App` prefix redundant (ENGINEERING_RULES:116 / module-template-spec:95 use `AppUserController` as the anti-example). Present in both repos.

Fix:
- [ ] `AppFileController` → `FileController`, `AppFileLogic` → `FileLogic`. Route paths unchanged. Update imports, registry, test names (`AppFileLogicStorageKeyTest` → `FileLogicStorageKeyTest`).
- [ ] Fork sync → same rename in `privchat-application`.

Verify: generated routes unchanged, aggregate compile, file API smoke.

---

## STD-4 — Docs / API cleanup (P2) — ✅ DONE (STD-4A find() removed; STD-4B http-client docs OBSOLETE + neton-http Roadmap; STD-4C module-template-spec Prefer/Avoid)

- [x] The obsolete `neton-http-client` module and historical in-repository design docs were removed. Outbound HTTP client APIs live in `neton-http`; canonical documentation lives in `neton-docs`.
- [ ] `neton/neton-http/README.md:200` `## TODO` → `## Roadmap / Deferred after 1.0` with explicit supported/deferred + rationale.
- [ ] `TableDefRegistry.kt:43` `@Deprecated` → add removal version to message (removed in 1.1 or before 1.0 final) or delete if no downstream caller.
- [ ] `module-template-spec.md:95` — lead with positive examples (`controller.app.UserController`), keep `AppUserController` only inside an explicit Anti-pattern section.

Verify: docs render, no dangling references.

---

## Global acceptance (all cuts)

- Core/HTTP/Database/Logging tests pass
- KSP compile pass
- PrivChat aggregate compile pass
- release-gate-smoke pass
- `git status` never mixes unrelated changes (esp. do not touch `privchat-application/scripts/granular-admin-perm-e2e.sh` — its earlier uncommitted change is already gone; working tree clean)
