# Support and validation

Reviewed on 2026-10-12. Each library page records its source revision and evidence entry points. **Declared targets, successful compilation, runtime tests, interoperability and production validation are distinct.** This update reviews code and records; it does not rerun CI, devices or benchmarks.

## Build-declared targets

| Library | Linux / macOS Native | Windows Native | iOS | Android Native | JVM |
|---|---|---|---|---|---|
| io | Declared | Declared | Declared | 32/64-bit | Declared |
| http (including HTTP/2) | Declared | Declared | Declared | 32/64-bit | Declared |
| websocket | Declared | Declared | Declared | 32/64-bit | Declared |
| tls / quic | Declared | Declared | Declared | 64-bit | Declared, OpenSSL JNI required |
| openssl | Target selection | Target selection | Target selection | 64-bit | In progress; JNI binary required |
| http3 | Declared | Declared | Declared | 64-bit | Not declared |
| msgtrans core | Declared | Not declared | Declared | Opt-in, not published by default | Declared |

Targets come from Gradle configuration. Android JVM and Android Native are different artifacts; emulator, device and desktop results are not interchangeable. A JVM target does not establish JNI coverage for every host. OpenSSL target and toolchain requirements constrain its consumers.

## Recorded validation and limits

| Library | Repository records | Not established by these records |
|---|---|---|
| io | Stream conformance, lifecycle, fairness; Linux/macOS/Windows/JVM records | Current commit passes on every device |
| http | h2spec 145/145, curl, smuggling vectors, streaming upload | Full RFC certification or adapter feature parity |
| websocket | Bidirectional Autobahn including compression; NON-STRICT/INFORMATIONAL remain | All-strict pass or unlimited concurrency |
| quic | quinn and multi-implementation Interop Runner, with intermittent failures retained | Every feature or interop combination passes |
| http3 | h3spec 49/49 and scoped h3/h3-quinn/aioquic interop | Dynamic QPACK, WebTransport or HTTP Datagrams |
| tls / openssl | TLS regression and platform build/runtime records | Every trust-store and JNI deployment validated |
| msgtrans | Rust peer scripts and session-contract tests | All language clients or a complete typed RPC framework |

## Before deployment

1. Pin library, compiler and dependency versions and verify artifact availability.
2. Test correctness, cancellation, close, resource limits and security configuration on the deployment target.
3. Record peer versions and interop scenarios, including failures.
4. Validate performance separately: throughput, tail latency, errors, CPU, memory and slow clients.

Detailed historical audits remain in the internal `docs/zh-hans/stack/` directory of neton-docs, not published as current user guides.

