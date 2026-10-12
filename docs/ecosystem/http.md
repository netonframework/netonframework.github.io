# HTTP/1.1 & HTTP/2

An HTTP protocol library, not the framework router or authentication layer. HTTP/2 is part of this library, not a separate http2 artifact.

## Implemented capabilities

HTTP/1.1 and HTTP/2 clients and servers, streaming bodies, upgrades and CONNECT, same-port protocol selection, and the `neton.http.client.Client` connection pool.

## Integration

Coordinate: `com.netonstream:http`. Pass an io `IoStream` to `Http1ServerConfig`, `Http2ServerConfig` or `AutoServerConfig`. Prefer the Neton framework for application development. Standalone clients use `Client.builder()` and `tls-http` for HTTPS. Consume or properly close response bodies to allow connection reuse.

See [integration and versions](./versions.md). Do not treat a source version below as a confirmed published release.

## Support and limitations

The current build declares Native and JVM targets. TLS is separate, and HTTP/3 is not included. A protocol feature is not automatically exposed by every framework adapter.

## Validation records

SPEC/README record h2spec 145/145, curl interoperability, smuggling vectors and streaming upload tests. These cover specific versions and scenarios, not every HTTP/2 behavior or deployment.

These are repository records, not protocol or performance tests rerun for this documentation update. See the [support matrix](./support.md) for the distinction between declared targets and runtime validation.

## Source evidence

Reviewed on 2026-10-12 at `a402ccd50157a8b313ded97e6a3fce12bc43b6da`. Build-declared version: `0.3.0` (not a Central publication confirmation).

- [Source and usage](https://github.com/netonframework/http)
- [Targets and dependencies](https://github.com/netonframework/http/blob/main/http/build.gradle.kts)
- [Design and validation records](https://github.com/netonframework/http/blob/main/SPEC.md)

Links follow main and may change. The conclusions here refer to the recorded review revision.

