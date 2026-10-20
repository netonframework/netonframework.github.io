---
name: neton-application-development
description: Develop, extend, debug, or review Neton Application distributions, forks, backend business modules and their paired admin frontend modules. Apply module ownership, DTO and migration conventions, identity realms, shared security services, RBAC, i18n and acceptance tests. Use for business features built on Neton Application, not unrelated Kotlin or React projects or framework-only internals.
---

# Neton Application development

Implement the requested business behavior using the existing application capabilities and version-compatible Neton contracts. A review request remains a review. Skills guide execution; tests and business acceptance establish correctness.

## Resolve the project and requirements

1. Read repository instructions, status and relevant changes. Identify the distribution/fork, module repositories, frontend host and versions from settings, build inputs, package manifests and dependency locks. Do not assume every sibling module is installed.
2. Locate canonical specs and current implementations with [the application map](references/application-map.md). Read the applicable framework contracts directly if the framework skill is not installed; this skill does not depend on its availability.
3. For a new domain, make states, allowed transitions, actor/ownership rules, money/units and concurrency invariants explicit before implementation. Reuse agreed requirements; ask only for materially missing business decisions. Do not invent pricing, approval or retention policy.
4. Follow applicable accepted specs. Historical reviews are regression inputs, not a list of still-open defects. If the spec and current code differ, identify the version and conflict; do not restore an old implementation merely because an old example used it.

## Place the work correctly

- The distribution assembles modules and product configuration. Place reusable domain behavior in its owning module; inspect extension ports before coupling modules or adding code to the shell.
- system owns administrator identity, shared security contracts, RBAC, MFA, verification and settings infrastructure. account owns end-user identity/session policy. member owns membership features. infra owns infrastructure services. Reuse installed payment/platform or other domains through their supported boundaries.
- Controllers bind/validate requests and call Logic; Logic owns business state transitions and transactions; Table owns persistence access through framework DbContext. Do not access another module's tables when an established service/port is the intended boundary.
- Use `@Module` and actual KSP registry inputs. Declare dependencies including modules whose migration seed data you read or modify. Update distribution dependencies and registry inputs consistently; do not hand-edit generated manifests.
- A fork may add business modules, branding, configuration and deliberate product behavior. Keep upstream reusable changes in their owning repositories. Do not bulk edit/push unrelated siblings or assume authority to publish/deploy.

## Data and API contracts

- Core business resources use a single `id: Long` primary key; persistent binary flags use Int 0/1, with status 1 enabled and 0 disabled. Multi-state fields need explicit domain constants. These are Application conventions, not universal Neton rules.
- Write APIs accept validated DTOs, not persistence Models. Keep response DTOs free of password hashes, secrets and internal-only fields.
- Follow the existing resource contract: `/page`, `/list`, `/simple-list`, `/get/{id}`, `/create`, `/update`, `/delete/{id}`, `/delete-list?ids=...`. Singleton/current-user resources are documented exceptions. Business-key reads use `/get-by-*`; domain actions use explicit verbs.
- Use pageNo/pageSize for requests and inspect the actual shared PageResponse for response fields. Do not silently rename wire fields. Check Long IDs and monetary values for lossless frontend transport.
- Use parameterized SQL/typed DSL and `DbContext.transaction`. No parallel operations sharing one transaction, swallowed cancellation, or side effects presented as transactionally committed when they are not. Reuse the event/outbox contract for reliable external effects where required.
- Add a new versioned migration in its owner. Never modify applied SQL or run DDL on normal startup. SQL is embedded: rebuild before migration tests. Verify supported dialects from the selected distribution, not old README claims. Explicit PostgreSQL ID seeds require correct sequence advancement.

## Identity and security changes

Read `application/identity-realm.md` plus the touched services before changing authentication. Reuse `SystemSecurityConfig`, `TokenRealmRegistry`, realm implementations and session services. The distribution must not recreate its own authentication bridge.

- Verify realm, token type, subject state and revocation/version on access and refresh paths. Equal numeric IDs in admin/account are different principals. A token with no realm cannot default into a privileged realm.
- Use the backend's permission evaluator and matching frontend helper. Hidden UI is not access control. Verify object ownership for user-scoped resources independently of route permissions.
- Preserve MFA three-state login: first factor may return a bounded challenge; issue a usable session only after required verification/enrollment. Never treat a challenge as an access token.
- Reuse VerificationCodeService, LoginThrottle, network admission and session revocation rather than raw Redis keys or new local counters. Use trusted `clientAddress`, not caller-supplied forwarding headers or a fresh private IP parser.
- Authorization, password, MFA and account-state changes must follow the existing invalidation contract. Inspect dependency-failure behavior; do not claim revocation is enforced merely because an optional service was invoked.
- Do not log passwords, tokens, TOTP seeds or verification codes. Preserve Cookie/CSRF, secret validation, audit and provider-failure semantics. A drafted CAPTCHA/provider design is not permission to report an integration complete.

## Paired frontend work

Read the frontend branch of the source map only when the task includes UI/API consumption. Put business pages, API adapters and translations in their module; use front-runtime for HTTP/session/permission/i18n and front-kit for UI primitives. Register pages through the existing manifest and distribution registry. Do not put reusable business pages in the shell or create a second client/token store.

Use existing brand and locale APIs, stable message keys, locale-aware formatting and declared currency/units. Follow module permission strings exactly. Handle loading, empty, failure, unauthorized and retry states; preserve workspace instance state and accessible focus behavior. Never copy API server state into a second UI-state authority.

## Acceptance and handoff

Select tests by the changed behavior using [the verification map](references/application-map.md#verification). Include negative outcomes, object ownership, duplicate/concurrent requests and rollback when they affect correctness. Security work requires cross-domain/token-type and revocation tests; a successful login alone is insufficient.

Inspect environment variables, setup and cleanup before running integration scripts. Use disposable local databases/Redis and scoped test accounts. Browser acceptance should run headless unless the user asks to see it. Distinguish real-database results from fake adapters and opt-in tests that returned without running.

Record changed repositories, relevant contracts, executed checks, business acceptance outcomes and unresolved gaps. Update the canonical spec only when behavior/contracts actually change; do not manufacture completion from a green typecheck or historical report. Never claim perfect business logic from skill compliance alone.
