# OpenSSL Kotlin

Kotlin bindings and wrappers for OpenSSL, not a new cryptographic or TLS implementation.

## Implemented capabilities

Static OpenSSL, Native C bindings, socket-free `TlsContext` / `TlsEngine`, AEAD, header protection, HKDF/HMAC, randomness and a QUIC TLS facade.

## Integration

Coordinate: `com.netonstream:openssl`. Use tls for network TLS; use this library directly for protocol or cryptographic integration. Manage context lifetimes and trust explicitly, respecting retry and buffer-ownership rules.

See [integration and versions](./versions.md). Do not treat a source version below as a confirmed published release.

## Support and limitations

Versions follow OpenSSL, with wrapper revision suffixes. The minimum line is 4.0.x. JVM access uses JNI and is described as in progress in README; Native coverage does not imply equivalent JVM/Android support. Source builds select the host target by default.

## Validation records

`VALIDATION.md` records build and runtime results. Linking successfully does not establish trust-store behavior, protocol interoperability or performance.

These are repository records, not protocol or performance tests rerun for this documentation update. See the [support matrix](./support.md) for the distinction between declared targets and runtime validation.

## Source evidence

Reviewed on 2026-10-12 at `4d30e9005c3c2b31a25e91b66c298651824474db`. Build-declared version: `4.0.2-3` (not a Central publication confirmation).

- [Source and usage](https://github.com/netonframework/openssl-kotlin)
- [Targets and dependencies](https://github.com/netonframework/openssl-kotlin/blob/main/gradle.properties)
- [Design and validation records](https://github.com/netonframework/openssl-kotlin/blob/main/VALIDATION.md)

Links follow main and may change. The conclusions here refer to the recorded review revision.
