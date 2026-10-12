# I/O

An asynchronous I/O foundation independent of the Neton framework, for custom protocols and long-lived services.

## Implemented capabilities

`IoStream`, `Buffer`, `Framed`, `connect`, `serveTcp`, `bindUdp` and `lookupHost`. Native drivers include kqueue, epoll, io_uring and IOCP; the JVM uses NIO.

## Integration

Coordinate: `com.netonstream:io`. Create connections inside a reactor scope and respect stream thread ownership. Layer TLS, HTTP or a custom codec above I/O. Use `io-testkit` to validate stream wrappers.

See [integration and versions](./versions.md). Do not treat a source version below as a confirmed published release.

## Support and limitations

Native targets cover Linux, Apple, Windows and Android; a JVM target is also declared. Current JVM sources implement UDP with `DatagramChannel`; older README statements that JVM UDP is unavailable are outdated. Platform options are not equivalent. Configure connection, buffer and timeout limits.

## Validation records

JVM UDP receives one datagram per call and does not provide GSO/GRO, per-datagram ECN, source-address selection or destination-address metadata. Native UDP optimizations are not all available on the JVM.

The repository contains stream conformance, cancellation, lifecycle and fairness tests. SPEC retains historical driver runs; this page does not treat those as fresh validation of the current commit.

These are repository records, not protocol or performance tests rerun for this documentation update. See the [support matrix](./support.md) for the distinction between declared targets and runtime validation.

## Source evidence

Reviewed on 2026-10-12 at `c17214131f18bd269d2172a9234396371f79757a`. Build-declared version: `0.4.0` (not a Central publication confirmation).

- [Source and usage](https://github.com/netonframework/io)
- [Targets and dependencies](https://github.com/netonframework/io/blob/main/neton-io/build.gradle.kts)
- [Design and validation records](https://github.com/netonframework/io/blob/main/SPEC.md)

Links follow main and may change. The conclusions here refer to the recorded review revision.
