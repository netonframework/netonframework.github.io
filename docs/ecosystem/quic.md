# QUIC

A QUIC transport over io UDP and OpenSSL TLS, usable by HTTP/3 or custom protocols.

## Implemented capabilities

Endpoints, connections, multiplexed streams, flow control, loss recovery, congestion control, datagrams, real TLS 1.3, resumption, 0-RTT and key updates. The current build adds a JVM target.

## Integration

Coordinate: `com.netonstream:quic`. Configure certificates, trust roots and ALPN, create a UDP endpoint, then accept or initiate connections. Bound connections, streams and buffers and close them explicitly. Account for replay before using 0-RTT for application operations.

See [integration and versions](./versions.md). Do not treat a source version below as a confirmed published release.

## Support and limitations

Native excludes 32-bit Android; JVM requires io UDP and OpenSSL JNI. Server 0.5-RTT sending is not guaranteed. Unsupported or failing Interop Runner cases such as v2 / connectionmigration must not be advertised as complete.

## Validation records

SPEC §11.18 records interoperability with quinn, quic-go and ngtcp2, including intermittent handshakeloss / handshakecorruption failures. Real TLS, impaired networks and long-running operation need ongoing regression testing; no all-pass claim is made.

These are repository records, not protocol or performance tests rerun for this documentation update. See the [support matrix](./support.md) for the distinction between declared targets and runtime validation.

## Source evidence

Reviewed on 2026-10-12 at `ae552743044cb374a8ecaed78cf4a836e3ee279f`. Build-declared version: `0.3.0` (not a Central publication confirmation).

- [Source and usage](https://github.com/netonframework/quic)
- [Targets and dependencies](https://github.com/netonframework/quic/blob/main/quic/build.gradle.kts)
- [Design and validation records](https://github.com/netonframework/quic/blob/main/SPEC.md)

Links follow main and may change. The conclusions here refer to the recorded review revision.
