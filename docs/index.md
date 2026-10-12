---
layout: home
hero:
  name: Neton
  text: From networking to applications
  tagline: A Kotlin/Native application framework and independent networking stack. Custom I/O, HTTP, WebSocket, QUIC and HTTP/3, with OpenSSL-backed TLS and cryptography and msgtrans messaging.
  actions:
    - theme: brand
      text: Build an application
      link: /guide/quick-start
    - theme: alt
      text: Explore the stack
      link: /ecosystem/
    - theme: alt
      text: RPC and messaging
      link: /ecosystem/msgtrans

features:
  - title: Application framework
    details: Routing, authorization, data access, caching, jobs and logging, assembled at compile time with KSP for native services.
    link: /guide/
  - title: Async I/O
    details: Reactors, TCP/UDP, buffers and coroutine scheduling. Use io independently, without the Neton framework.
    link: /ecosystem/io
  - title: HTTP and realtime
    details: HTTP/1.1, HTTP/2, connection pooling and WebSocket. Protocol libraries and framework sessions are separate layers.
    link: /ecosystem/http
  - title: QUIC and HTTP/3
    details: Multiplexed transport over UDP and a separate HTTP/3 implementation, with explicit support boundaries and extension gaps.
    link: /ecosystem/http3
  - title: TLS and OpenSSL
    details: OpenSSL Kotlin bindings, TLS streams and HTTPS/WSS connectors, without reinventing cryptography.
    link: /ecosystem/tls
  - title: Messaging and RPC transport
    details: msgtrans supplies request correlation, one-way messaging, backpressure and TCP/QUIC/WebSocket transports, independent of the framework.
    link: /ecosystem/msgtrans
---

## One ecosystem, two entry points

Start with the [framework guide](/guide/) to build an application or the [standalone libraries](/ecosystem/) to build your own network service. HTTP/2 is part of http; HTTP/3 evolves separately. Using a protocol library does not require the whole framework.

::: info Capabilities, platforms and versions
Current sources use Kotlin 2.4.20; the framework remains on its 1.0 Beta development line. Libraries release independently and source versions do not confirm artifact availability. Read the [support matrix](/ecosystem/support) and [integration/version guide](/ecosystem/versions) for implemented capabilities, recorded validation and limitations.
:::
