# Delivering a Neton server application

Use this for new services and end-to-end business capabilities. It is an execution
guide, not a substitute for the canonical specifications in the source map.

## Establish the smallest valid application

- Identify the requested endpoints/use cases, identity boundary, persistence needs,
  external calls and target operating systems. Ask only for decisions that materially
  affect behavior. Do not add authentication, AI, queues or storage without a need.
- Resolve a supported Neton/Kotlin/KSP combination and matching spec revision. The
  public reference application is `https://github.com/netonframework/neton-app`.
  Inspect `build.gradle.kts`, `src/commonMain/kotlin/Main.kt`, the welcome controller,
  config and acceptance scripts at the selected revision. Do not assume main uses
  the same APIs as the application's pinned release.
- Keep published dependencies reproducible. Framework modules/KSP align to the chosen
  framework version; optional AI and external adapters have separate version lines.
  Do not introduce sibling source substitutions or unpublished coordinates to hide
  incompatibility. Missing dependencies are blockers to report, not APIs to invent.

## Implement one complete capability

1. Declare request/response contracts and validation from routing/parameter-binding
   specs. Register annotated controllers through KSP. Never hand-edit generated route
   registries, scan classes at runtime, or bypass the framework with a second server.
2. Keep business decisions in services; use constructor injection. Modules declare
   supported dependencies and exports. Generic framework APIs must not acquire the
   new product's table names, roles or permissions.
3. For persistence, use DbContext/Table and explicit migrations. Entities have no
   implicit save behavior. Transactions must follow the existing session; cancellation
   rolls back and propagates. Specify retry/idempotency behavior when duplicate writes
   can occur; do not promise exactly-once delivery from an in-memory event bus.
4. Extend business configuration through Config SPI, with typed validation and secret
   handling. Do not invent environment-variable spellings or read arbitrary process
   environment variables from domain services. Storage DSL overrides and complete
   configurations are distinct in post-beta26 APIs; consult the pinned release.
5. Install resources in the supported lifecycle. Identify who creates, borrows and
   closes each client/pool/worker. Start owned work after initialization and ensure
   graceful stop and startup-failure cleanup. Avoid global identity and orphan scopes.
6. Use request-bound identity and security SPI for protected operations. Test unauthenticated,
   unauthorized and malformed input cases. Keep credentials and sensitive payloads out
   of logs; public errors must not expose internal exceptions or database details.

## Verify and hand off

Select tests from the actual risk, not a fixed quantity. A read-only endpoint does not
need a database harness; a transactional feature does need real database failure tests.

- Compile and link a Native consumer with KSP-generated routes. Test the actual HTTP
  path, including invalid input and requested authorization boundaries.
- For changed transactions, test commit, rollback and relevant concurrency against a
  disposable supported database. Memory mocks alone do not prove database semantics.
- For changed runtime resources, start/stop the application twice and verify cleanup;
  use release binaries when claiming deployment readiness. Do not equate one host's
  debug success with three-platform support.
- For outbound streaming/AI, cover cancellation, timeout, error redaction and borrowed
  client ownership. Provider replay tests are not live service certification.
- Report exact commands/results, dependency/spec revisions, migrations and remaining
  limitations. Commit/push only when authorized. Publishing and deployment require
  their own authorization; skill invocation is not permission to perform them.

## Self-review scenarios

Before handing off, check the decisions against these common requests:

- A new CRUD service should use routes + injected service + explicit migration, not
  Application-specific base entities or a copied admin product.
- An AI-free service must build without `neton-ai` or any model key.
- A requested AI feature should select an explicitly compatible independent AI version,
  reuse the HTTP client contract, and avoid exposing provider SDK internals in domain code.
- A beta26 consumer must not receive post-beta26 `neton.websocket` imports unless the
  task includes a compatible dependency upgrade.
- A focused bug fix should preserve unrelated files and avoid upgrading the entire ecosystem.

These scenarios guide behavioral review; a valid SKILL.md manifest alone proves neither
correct generated applications nor automatic loading by every AI tool.
