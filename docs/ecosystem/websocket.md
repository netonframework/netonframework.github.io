# WebSocket

A standalone RFC 6455 implementation; framework sessions are a separate layer.

## Implemented capabilities

Client/server handshakes, masking, fragmentation, UTF-8 checks, control frames, close handshakes and optional permessage-deflate (off by default). The current build includes JVM.

## Integration

Coordinate: `com.netonstream:websocket`. Standalone users establish connections with `accept` / `client` / `connect`, then `receive` / `send`; use `tls-websocket` for WSS. Neton applications use framework sessions and routes from `neton-websocket`, rather than exposing protocol objects to business code.

See [integration and versions](./versions.md). Do not treat a source version below as a confirmed published release.

## Support and limitations

Protocol control-frame handling is not an application keepalive policy. Active heartbeats, slow-consumer handling, global budgets, identity and subscriptions belong to a session runtime or application. Evaluate memory and CPU costs before enabling compression.

## Validation records

README records 517 Autobahn cases in each direction with compression: 512 OK, 2 NON-STRICT and 3 INFORMATIONAL. This is not an all-strict pass or a high-concurrency guarantee for the current sources.

These are repository records, not protocol or performance tests rerun for this documentation update. See the [support matrix](./support.md) for the distinction between declared targets and runtime validation.

## Source evidence

Reviewed on 2026-10-12 at `c34cbecba7fba2be6084e8f97cc19dea463047d0`. Build-declared version: `0.3.0` (not a Central publication confirmation).

- [Source and usage](https://github.com/netonframework/websocket)
- [Targets and dependencies](https://github.com/netonframework/websocket/blob/main/websocket/build.gradle.kts)
- [Design and validation records](https://github.com/netonframework/websocket/blob/main/SPEC.md)

Links follow main and may change. The conclusions here refer to the recorded review revision.
