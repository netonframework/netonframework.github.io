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

Library pages show source-declared versions, not publication confirmations from Maven Central. OpenSSL follows upstream versions plus wrapper revisions; other libraries evolve independently. HTTP/3 still depends on http/quic 0.2.0, while newer HTTP, TLS and QUIC sources use a different dependency set. These are not advertised as a jointly validated release bundle.

Current Kotlin/Native projects use Kotlin 2.4.20. Prefer the compiler used to publish the chosen artifact and revalidate compiler or dependency upgrades. JVM bytecode/metadata compatibility and Native KLIB compatibility are different concerns.

## Development versus publication

Use explicit composite builds for local integration. Local caches or uncommitted sibling changes are not release dependencies. Validate published coordinates in a clean environment and record versions, platforms, interoperability and failures.

Keep test doubles, test certificates, `io-testkit` and `quic-testkit` out of production dependencies. Verify native/JNI architecture and deployment separately.

## Documentation ownership

User guides live in neton-docs; KDoc, implementation specifications and raw validation records stay with code. Update both public languages together, recording dates, revisions, limitations and evidence. Do not copy entire SPECs or promote internal draft plans into user-facing commitments.

