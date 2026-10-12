# HTTP/3

A separate HTTP/3 library using http's common types and quic's transport.

## Implemented capabilities

Clients, servers, request streams, trailers, GOAWAY, static-table/literal QPACK and early-data identification.

## Integration

Coordinate: `com.netonstream:http3`. After QUIC negotiates ALPN `h3`, use `asH3()` with a client or server connection. Consume bodies and finish or close request streams. Framework integration is separate; the library's presence does not enable HTTP/3 automatically.

See [integration and versions](./versions.md). Do not treat a source version below as a confirmed published release.

## Support and limitations

Only Native targets are declared; there is no JVM target. Dependencies remain http/quic 0.2.0, so do not assume compatibility with their latest source versions. Dynamic QPACK, server push, WebTransport and HTTP Datagrams are unsupported; QUIC datagrams are not HTTP Datagrams.

## Validation records

README records h3spec 49/49 and scoped interoperability with h3/h3-quinn and aioquic. quiche/curl HTTP/3, real-TLS loss/reordering and comparative performance remain listed as validation gaps.

These are repository records, not protocol or performance tests rerun for this documentation update. See the [support matrix](./support.md) for the distinction between declared targets and runtime validation.

## Source evidence

Reviewed on 2026-10-12 at `9921dd64adbc69899a847ef3579e96c2f7a96aa7`. Build-declared version: `0.2.0` (not a Central publication confirmation).

- [Source and usage](https://github.com/netonframework/http3)
- [Targets and dependencies](https://github.com/netonframework/http3/blob/main/http3/build.gradle.kts)
- [Design and validation records](https://github.com/netonframework/http3/blob/main/SPEC.md)

Links follow main and may change. The conclusions here refer to the recorded review revision.

