# TLS

Connects OpenSSL's socket-free TLS engine to io byte streams.

## Implemented capabilities

`tlsConnect`, `tlsAccept` and `TlsStream`; separate `tls-http` and `tls-websocket` artifacts provide HTTPS/WSS connectors.

## Integration

Coordinate: `com.netonstream:tls`. Provide trust roots and the expected peer name/IP, configure ALPN, then wrap a TCP stream. Servers supply a certificate chain and private key. System-root helpers are not a substitute for peer verification.

See [integration and versions](./versions.md). Do not treat a source version below as a confirmed published release.

## Support and limitations

Native targets exclude 32-bit Android. JVM support depends on OpenSSL JNI, not pure JVM TLS. System trust extraction is platform-specific; the iOS helper does not enumerate system roots.

## Validation records

TLS, HTTPS and WSS tests and SPEC records are the validation entry points. Runtime targets, JNI deployment and certificate-store behavior need separate validation.

These are repository records, not protocol or performance tests rerun for this documentation update. See the [support matrix](./support.md) for the distinction between declared targets and runtime validation.

## Source evidence

Reviewed on 2026-10-12 at `6e32d23efa3421955358336086ebe517b8e3a06f`. Build-declared version: `0.3.0` (not a Central publication confirmation).

- [Source and usage](https://github.com/netonframework/tls)
- [Targets and dependencies](https://github.com/netonframework/tls/blob/main/tls/build.gradle.kts)
- [Design and validation records](https://github.com/netonframework/tls/blob/main/SPEC.md)

Links follow main and may change. The conclusions here refer to the recorded review revision.
