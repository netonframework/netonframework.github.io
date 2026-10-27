# Neton Framework and Neton Application

Neton is positioned around backend application development: APIs, services and business systems. Native networking supports that goal; developers do not need to assemble a protocol stack to implement ordinary business features.

## Two layers, different responsibilities

| | Neton Framework | Neton Application |
| --- | --- | --- |
| Role | General-purpose backend application framework | Modular business application foundation built on the framework |
| Provides | Routing, dependency injection, configuration, data access, transactions and security extension points | Reusable application modules, product assembly and paired administration frontend modules |
| Owns | Programming model, component lifecycle and infrastructure abstractions | Business identities, permissions, application workflows and module integration |
| Start here when | You want to implement a service with your own domain model | You want to reuse business capabilities and extend a distribution |

Application uses Framework; it does not replace it. Framework does not require Application or its business conventions.

## Assemble a business application

Application separates product assembly from reusable modules. For example, system owns administrator identity and permissions, account owns end-user identity, and infra supplies shared infrastructure such as file handling. Products select compatible modules and add their own business logic and presentation.

Extensions should use documented contracts, configuration and registration mechanisms. Reuse existing capabilities instead of accessing another module's tables or adding product-specific branches to shared modules. A modular foundation does not mean every product is available without development.

Module availability, media processing and content-platform capabilities vary by version. A design specification is not proof of a released implementation; check the selected module's source, documentation and acceptance evidence.

## Where networking belongs

The [technical architecture and networking ecosystem](/ecosystem/) describe the underlying I/O and protocol libraries. These can also be used independently. Backend application code normally works through framework APIs rather than protocol internals.

## Get started

- Build a service with the [Framework quick start](./quick-start.md).
- Explore the [Application repository](https://github.com/neton-application/neton-application) and its module/dependency declarations before selecting a distribution.
- Use the [development skills](https://github.com/netonframework/netonframework.github.io/tree/main/skills) for version-aware implementation guidance; installation is optional and does not replace tests.

Positioning and assembly boundaries checked on 2026-10-27 against Framework `804e770` and Application `95185a7`. This is not a release or runtime acceptance claim.
