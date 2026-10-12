# From I/O to applications in Kotlin/Native

Neton provides both an application framework and independently usable networking libraries. Build a complete service with the framework or use a single protocol library in your own system. Cryptography and the TLS engine come from OpenSSL, not replacement cryptographic algorithms.

## Choose an entry point

| Your goal | Start here |
|---|---|
| Business APIs, authentication and data services | [Framework quick start](/guide/quick-start) |
| Custom TCP/UDP protocols | [io](./io.md) |
| Standalone HTTP clients or servers | [HTTP/1.1 and HTTP/2](./http.md) |
| Secure streams, HTTPS or WSS | [TLS](./tls.md), [OpenSSL](./openssl.md) |
| Bidirectional realtime messages | [WebSocket](./websocket.md) |
| Multiplexed transport or HTTP/3 | [QUIC](./quic.md), [HTTP/3](./http3.md) |
| Request/response, push and RPC transport | [msgtrans](./msgtrans.md) |

## Layers, not lock-in

```text
Application       Neton Framework              Custom apps / msgtrans
Integration       HTTP adapter / WS sessions   TCP / QUIC / WS transport
Protocols         HTTP/1.1 + HTTP/2   WebSocket HTTP/3
Transport         io                 TLS       QUIC
Cryptography                         OpenSSL Kotlin -> OpenSSL C
```

This is a responsibility diagram, not a complete dependency graph. HTTP/3 depends on HTTP common types and QUIC. QUIC uses OpenSSL's QUIC TLS facilities directly, not the TLS stream adapter. WebSocket uses HTTP types for handshakes; a TLS connector supplies WSS.

Framework and protocol APIs are distinct: `com.netonstream:neton-http` integrates with the framework; `com.netonstream:http` implements protocols. The same distinction applies to `neton-websocket` and `websocket`. Replacing an adapter does not automatically enable every protocol.

## Capability is not maturity

The stack contains custom I/O, HTTP, WebSocket, QUIC and HTTP/3 implementations, with differing platform coverage and release progress. Read the [support matrix](./support.md) and [integration/version guide](./versions.md).

This overview reflects a source review on 2026-10-12. Validate production deployments on their target platforms. Performance claims need workloads, hardware, build versions and error metrics.

