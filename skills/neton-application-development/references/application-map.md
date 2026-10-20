# Application contracts and implementation map

## Version and source resolution

Inspected on 2026-10-15: Application `8f6c73c`, framework `f03c389`, neton-docs `e6a837b`. This records provenance, not a fixed dependency requirement. Re-read the target distribution's versions and locks on each task.

Canonical specs are in `https://github.com/netonframework/netonframework.github.io`, commonly checked out as `neton-docs`. Spec paths below are relative to `docs/zh-hans/spec/`. Resolve a project-provided location, sibling checkout, or a release-compatible docs revision. Do not require users to have the author's home-directory layout. When offline without specs, use bundled contracts and actual APIs and identify the missing context rather than inventing requirements. An unresolved material contract conflict needs direction; unrelated work can continue.

Discover backend modules through `settings.gradle.kts`, `application/build.gradle.kts` and `scripts/ci/dependencies.lock` when present. Discover frontend modules through `apps/shell/front.modules.ts`, package dependencies and the lockfile. Resolve source files inside those repositories; source paths below are navigation hints, not immutable ABI names.

## Read only the relevant branch

| Task | Canonical spec | Current implementation anchors |
|---|---|---|
| Distribution/feature ownership | `application/SPEC.md`, `application/ENGINEERING_RULES.md`, `application/module-template-spec.md` | Application settings/build inputs; `neton-application-module-template`; installed module `init/` |
| Lifecycle/config/module changes | `lifecycle.md`, `config-spi.md`, `module-manifest.md` | `application/src/commonMain/kotlin/Main.kt`; module RuntimeBootstrap and generated registry inputs |
| Data/model/transactions | `database.md`, `database-session.md`, `application/ENGINEERING_RULES.md` | Module `model/`, `table/`, `logic/`; framework DbContext contracts |
| Schema and seed changes | Migration section of `database.md` | Module `sql/`; application `migration/MigrationCommandRunner.kt`, `MigrationStartupPrecheck.kt`; generated embedded migration resources |
| Identity/session | `application/identity-realm.md` | system `config/SystemSecurityConfig.kt`, `security/TokenRealm.kt`, `RealmAuthenticator.kt`, `AdminTokenRealm.kt`, `SessionRevocation.kt`, `logic/AdminSessionLogic.kt`; account realm and identity adapter |
| Permissions | `application/rbac-spec.md` | system `logic/PermissionLogic.kt`, `security/WildcardPermissionEvaluator.kt`; front-runtime `permission.ts` |
| MFA | `application/mfa.md`, `application/mfa-acceptance.md` | system `logic/MfaLogic.kt`, auth/user MFA controllers; front-system MFA pages |
| Login/SMS/email abuse | `application/auth-abuse-protection-spec.md`, `application/identity-realm.md` | system `logic/VerificationCodeService.kt`, `security/LoginThrottle.kt`, `NetworkAdmission.kt`; account callers |
| Outbound work/jobs/files | `http.md`, `event.md`, `jobs.md`, `storage-spec.md` as needed | Application-owned HTTP client, infra service/worker and lifecycle owners |
| Domain expansion | Corresponding `application/*-module.md` if present | Installed domain API, extension ports and migrations; content/comment/push specs may be Draft, inspect availability first |
| Frontend module | Application engineering/RBAC contracts plus frontend manifest/runtime contracts | front `packages/front-contract/src/index.ts`, `scripts/generate-registry.mts`; selected module `src/manifest.ts` or exported manifest entry |
| Translation/brand/errors | Actual installed frontend contract; canonical frontend spec when available | front-runtime `i18n.tsx`, `messages.ts`, `brand.ts`, `errors.ts`, `client.ts`; `scripts/check-locales.mts` |
| Release/CI | `release-gate.md`, distribution CI | `.github/workflows/backend-ci.yml`, `scripts/ci/checkout-dependencies.sh`, `scripts/ci/dependencies.lock` |

## Known interpretation traps

- Some older architecture/template prose calls system/infra in-tree. Current Application settings resolve canonical sibling repositories. Do not create duplicate in-tree modules based on that prose.
- Authentication now belongs to module-system's SystemSecurityConfig. Historical Application SecurityConfig/bridge examples and the October 11 review are not current implementation instructions.
- Older module-manifest documents contain phase-status notes predating application registry aggregation. Confirm the current processor/build input before copying assembly code.
- Engineering rules contain a historical SQL-comment example with inverted status semantics. Use the explicit binary-field rule and active code: 1 enabled, 0 disabled. Raise the document inconsistency when relevant rather than propagating it.
- Framework examples with automatic table creation are demos; Application uses explicit embedded migrations.
- The frontend README may still point into `privchat-docs`. Follow that reference if present and accessible, recording its draft/version status. Do not declare the entire frontend spec migrated or depend on an uninstalled product checkout. Read actual exported contracts; ask for missing normative detail only if it blocks the change.
- New realm/session/verification and frontend i18n APIs already exist at the inspected baseline. Search before introducing substitutes. Their presence does not prove every error path or deployment configuration passes acceptance.

## Verification

Use the project's wrapper and inspect task/script definitions first. Example commands for the inspected macOS ARM64 development setup, run from Application root:

```sh
./gradlew :module-system:macosArm64Test :module-account:macosArm64Test
./gradlew :application:linkDebugExecutableMacosArm64
```

Select the affected module tests and actual native target, not this entire list for every edit. Read the current CI for Linux release tasks and dependency checkout. Do not update all dependency pins merely to get one feature compiling.

For auth/session changes, `tests/security/realm-session-e2e.sh` starts services, creates/drops a temporary PostgreSQL database, migrates and exercises a real binary. Before running, inspect `APP_BIN`, inherited PG variables, ports and cleanup. Use local disposable infrastructure; never let inherited production PGHOST/credentials select the test destination. Build the binary from the changed source first. A skipped opt-in MFA PostgreSQL test is not database evidence.

When frontend is involved, run from the resolved frontend root, using the scripts that actually exist:

```sh
pnpm typecheck
pnpm test
pnpm build
```

At this baseline typecheck includes registry and locale checks. For module file dependencies, verify the host is consuming the edited version, especially newly added files. UI acceptance uses a real backend for integrated behavior; mocks can test presentation but cannot prove server authorization. Reuse MFA browser acceptance only when its fixtures and prerequisites match the selected version.

For a new business module, acceptance should cover: dependency registration, migration from a clean and an existing schema, valid/invalid DTOs, permissions and resource ownership, transaction rollback, concurrent/duplicate actions where relevant, and paired UI locale/error paths. Add only tests that establish meaningful invariants.
