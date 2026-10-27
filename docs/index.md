---
layout: home
hero:
  name: Neton
  text: Build backend applications. Run native.
  tagline: A Kotlin/Native framework for building backend services and business applications. Routing, dependency injection, database access, security and modular development—with native deployment and no JVM required.
  actions:
    - theme: brand
      text: Build an application
      link: /guide/quick-start
    - theme: alt
      text: Explore Neton Application
      link: /guide/application
    - theme: alt
      text: Framework capabilities
      link: /guide/capabilities

features:
  - title: Build backend services
    details: Controllers, routing, parameter binding and validation provide a consistent foundation for business APIs.
    link: /guide/
  - title: Work with business data
    details: Typed data access, transactions, caching and Redis support application state and business workflows.
    link: /guide/database
  - title: Define access policies
    details: Authentication and authorization extension points keep access decisions explicit and separate from business handlers.
    link: /guide/security
  - title: Assemble modules
    details: Dependency injection, configuration and compile-time registration help organize services without runtime reflection.
    link: /guide/project-structure
  - title: Reuse application capabilities
    details: Neton Application builds on the framework with reusable business modules and a modular administration frontend.
    link: /guide/application
  - title: Deploy native
    details: Compile Kotlin services to native executables without a JVM. Choose supported targets and verify deployment dependencies.
    link: /guide/deployment
---

## Framework foundations, application building blocks

**Neton Framework** provides the programming model and general capabilities for backend services. **Neton Application** builds on it to assemble business systems from reusable modules. Use the framework directly for a custom service, or start with Application to reuse application-level capabilities. [Compare the two layers](/guide/application).

Networking is the technical foundation, not the application programming model. See the [technical architecture and networking ecosystem](/ecosystem/) for independent libraries, protocol details and integration boundaries.

::: info Capabilities, platforms and versions
Current sources use Kotlin 2.4.20; the framework remains on its 1.0 Beta development line. Libraries release independently and source versions do not confirm artifact availability. Read the [support matrix](/ecosystem/support) and [integration/version guide](/ecosystem/versions) for implemented capabilities, recorded validation and limitations.
:::
