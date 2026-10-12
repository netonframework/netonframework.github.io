# msgtrans

A messaging and request/response transport foundation for RPC, not a completed typed RPC framework.

## Implemented capabilities

`Transport`, `Connection`, `ConnectionConfig`, request correlation, one-way messages, timeouts, backpressure and compression. TCP is the base; QUIC/WebSocket are optional modules.

## Integration

Coordinate: `com.netonstream:msgtrans`. Use `Transport.connect`, `Connection.request` for correlated replies and `send` for one-way messages. Applications define payloads and bizType and implement handlers. Add `msgtrans-quic` / `msgtrans-websocket` as needed; their versions do not necessarily match the core.

See [integration and versions](./versions.md). Do not treat a source version below as a confirmed published release.

## Support and limitations

The core declares macOS/Linux/iOS and JVM. Android Native is opt-in and not published by default; Windows Native is not declared. JVM QUIC/secure WebSocket also depend on JNI deployment. Typed RPC, discovery and cross-language business code generation are not implied.

## Validation records

The repository contains a Rust peer, TCP/QUIC/WebSocket interop scripts, cancellation and resource-bound tests. A shared wire format alone does not establish interoperability with TypeScript or other clients.

These are repository records, not protocol or performance tests rerun for this documentation update. See the [support matrix](./support.md) for the distinction between declared targets and runtime validation.

## Source evidence

Reviewed on 2026-10-12 at `2b55bb48c62313f766d99a1067df4fd2aa490ec5`. Build-declared version: `0.5.0` (not a Central publication confirmation).

- [Source and usage](https://github.com/zoujiaqing/msgtrans-kotlin)
- [Targets and dependencies](https://github.com/zoujiaqing/msgtrans-kotlin/blob/main/msgtrans/build.gradle.kts)
- [Design and validation records](https://github.com/zoujiaqing/msgtrans-kotlin/blob/main/SPEC.md)

Links follow main and may change. The conclusions here refer to the recorded review revision.
