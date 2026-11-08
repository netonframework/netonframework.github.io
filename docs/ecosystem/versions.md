# Integration and versions

## Two paths

**Application development:** start with the [framework quick start](/guide/quick-start) and its adapter-managed dependencies. Do not override a framework dependency merely because a protocol library has a newer version.

**Standalone libraries:** choose the artifact without depending on the Neton framework. All short names below use group `com.netonstream`.

| Purpose | Artifact |
|---|---|
| I/O and stream conformance | `io` / `io-testkit` (tests only) |
| HTTP/1.1 and HTTP/2 | `http` |
| TLS, HTTPS and WSS integration | `tls` / `tls-http` / `tls-websocket` |
| OpenSSL bindings | `openssl` |
| WebSocket | `websocket` |
| QUIC and its test double | `quic` / `quic-testkit` (tests only) |
| HTTP/3 | `http3` |
| Messaging and RPC transport | `msgtrans` / `msgtrans-quic` / `msgtrans-websocket` |

```kotlin
// Configuration sketch: pin ioVersion to a tested, resolvable release.
commonMain.dependencies {
    implementation("com.netonstream:io:$ioVersion")
}
```

This is not a complete copy-paste project. Define the version variable and check targets and dependencies in the selected library's Gradle configuration.

## Independent versions, explicit release status

Libraries evolve independently and need not share the Framework version. The published baseline checked on 2026-11-09 is Framework 1.1.2, io 0.4.1, HTTP / TLS / WebSocket / QUIC / HTTP3 0.3.1, OpenSSL wrapper 4.1.0-1 (upstream OpenSSL 4.1.0), msgtrans 0.5.1 (QUIC / WebSocket adapters 0.2.1 each), and PulseKit / pulsekit-android 0.3.1.

Framework 1.1.2 upgrades the shared cryptography stack while preserving the public API and Kotlin/KSP toolchain. Its modules, KSP artifact and BOM are aligned at 1.1.2. Wrapper 4.1.0-1 fixes Windows Kotlin/Native linking against upstream OpenSSL 4.1.0; use this wrapper revision rather than the original 4.1.0 artifact. Duplicate entries in database source JARs were also removed, with a publication regression gate added.

[Release CI](https://github.com/netonframework/neton/actions/runs/42532494358) passed on the exact release source. All 345 payloads plus their 345 signatures were read back from Central. A fresh-cache public application using Central only completed two Release builds and two healthy start/graceful-stop cycles, releasing its listening port each time. The separate 24-hour low-load HTTP soak uses the previous dependency baseline and does not certify this upgrade; neither long-duration nor performance certification is claimed by this release.

Exact coordinates, release source revisions and Central root metadata digests live in [release-baseline.json](https://github.com/netonframework/neton/blob/main/tools/ci/release-baseline.json). The [release gate](https://github.com/netonframework/netonframework.github.io/blob/main/docs/zh-hans/spec/release-gate.md#published-stack-baseline-110-onward) distinguishes publication availability, resolved dependencies, platform execution and long-duration stability evidence. QUIC / HTTP3 / msgtrans / PulseKit are independent extensions, not all certified by the Framework HTTP/WebSocket gate. A published `0.x` artifact does not automatically promise a stable 1.x API.

Neither source version declarations nor Maven's `latest` field replace fixed-version acceptance. Independent `neton-ai:0.1.0` shares historical coordinates with Framework beta releases: pin it explicitly rather than automatically choosing the greatest metadata version. AI is outside the Framework BOM and this transport baseline.

Current Kotlin/Native projects use Kotlin 2.4.20. Prefer the compiler used to publish the chosen artifact and revalidate compiler or dependency upgrades. JVM bytecode/metadata compatibility and Native KLIB compatibility are different concerns.

## Development versus publication

Use explicit composite builds for local integration. Local caches or uncommitted sibling changes are not release dependencies. Validate published coordinates in a clean environment and record versions, platforms, interoperability and failures.

Keep test doubles, test certificates, `io-testkit` and `quic-testkit` out of production dependencies. Verify native/JNI architecture and deployment separately.

## Documentation ownership

User guides live in neton-docs; KDoc, implementation specifications and raw validation records stay with code. Update both public languages together, recording dates, revisions, limitations and evidence. Do not copy entire SPECs or promote internal draft plans into user-facing commitments.
