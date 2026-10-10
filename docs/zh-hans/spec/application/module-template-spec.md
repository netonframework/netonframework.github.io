# Module Template Spec

> Status: active
> Scope: `neton-application` and all `neton-application-module-*` projects

## 1. Purpose

`neton-application-module-template` is only a minimal bootstrap project.

It must stay tiny and only prove:

- the module can compile
- the module has a stable initializer
- the module has one tiny controller example

Real resource design rules live in this document, not inside the template project.

## 2. Module forms

Neton supports two module forms:

### 2.1 Internal module

- lives inside `neton-application`
- example: `module-system`, `module-infra`
- suitable for core platform capabilities

### 2.2 External module

- lives as an independent repository
- example: `neton-application-module-member`, `neton-application-module-payment`, `neton-application-module-platform`
- suitable for business domains that may evolve independently

Both forms must follow the same engineering rules.

## 3. Recommended real-module structure

When a hello world template is turned into a real module, expand it into:

```text
src/commonMain/kotlin/
├── controller/
├── init/
├── logic/
├── model/
└── table/
```

Only add folders when the module actually needs them.

Optional folders:

- `constant/`
- `controller/app/`
- `controller/open/`
- `util/`

The minimal template should already mirror the real top-level layout:

- `controller/admin/...`
- `init/...`
- `commonTest/...`

## 4. Resource rules

- every main resource uses `id` as the primary key
- every write API uses DTOs
- every persistent yes/no field uses `0/1`
- single-resource lookup must use `/get/{id}`
- business-key lookup must use `/get-by-*`
- `save` must not mix create and update semantics

Allowed exceptions:

- singleton config resources may use `GET /get` and `PUT /update`
- current-user profile resources may use `GET /get`, `PUT /update`, and `PUT /update-password`
- these exceptions must be driven by singleton semantics or current identity context, not by loose query parameters

### 4.1 Controller naming

- controller class names should describe the resource only
- do not add `App`, `Admin`, or `Open` as class-name prefixes
- side semantics must come from:
  - package path
  - route prefix

Prefer (resource-only class name; side comes from package/route):

- `controller.admin.user.UserController`
- `controller.app.auth.AuthController`
- `controller.open.order.PlatformOrderController`

Avoid (side baked into the class name):

- `AppUserController`
- `AdminAuthController`
- `OpenOrderController`

### 4.2 Controller method naming

Prefer this standard method set:

- `page`
- `list`
- `simpleList`
- `get`
- `create`
- `update`
- `delete`
- `deleteList`

Additional conventions:

- singleton config resources use `get` and `update`
- business-key reads use `getBy*`
- status changes use `updateStatus`
- domain actions should use explicit verbs such as `assignRole`, `resetPassword`, `bindSocialUser`

Avoid:

- `save`
- `edit`
- `remove`
- `queryInfo`
- `detail` when it is only a standard id lookup

## 5. AI workflow

1. copy `neton-application-module-template`
2. rename module id, package, route prefix
3. replace placeholder initializer with real Neton module wiring
4. write the module `SPEC.md`
5. decide whether the module is internal or external
6. add only the folders and resources the module really needs
7. verify compile and tests

## 6. Copy Checklist

### 6.1 Rename checklist

After copying `neton-application-module-template`, replace at least:

- project directory name
- `rootProject.name`
- Gradle `group` and `version` if needed
- Kotlin package names
- initializer name
- controller path prefix
- module id

Recommended rename example:

- repo: `neton-application-module-order`
- module id: `order`
- route prefix: `/order`
- initializer: `OrderModuleInitializer`
- controller package: `controller.admin.order`

### 6.2 Internal module steps

Use this form when the module should live inside `neton-application`.

1. copy the template into `neton-application/module-xxx`
2. keep it in the main repository
3. update the root `settings.gradle.kts`
4. add the new module to the application entry if needed
5. add SQL migrations under the main `neton-application/sql/`

Internal module notes:

- internal modules should follow the same directory layout
- they should not create their own standalone repo metadata
- they can depend more directly on core project utilities

### 6.3 External module steps

Use this form when the module should evolve as an independent repository.

1. copy the template as a new sibling repository
2. rename `rootProject.name`
3. keep `includeBuild("../neton")`
4. keep stable dependencies such as `com.netonstream.app:module-system` in the standalone build
5. register the repository as a source subproject in the aggregate application's `settings.gradle.kts`

External module notes:

- external modules must be able to compile independently
- they should keep their own `README.md` and `SPEC.md`
- they should avoid accidental coupling to unrelated internal modules

### 6.4 Aggregate source registration

When an external module is introduced, add it to:

`neton-application/settings.gradle.kts`

Example shape:

```kotlin
include(":module-order")
project(":module-order").projectDir = file("../neton-application-module-order")
```

The aggregate root maps stable module coordinates to these projects with Gradle dependency substitution. Do not make an external module `includeBuild` the aggregate application: that creates a cyclic composite. The external repository's own `settings.gradle.kts` remains the standalone build entry.

## 7. Real Module Expansion Order

After the copy is complete, expand the module in this order:

1. `SPEC.md`
2. initializer and route prefix
3. `model/`
4. `table/`
5. `logic/`
6. `controller/`
7. tests
8. SQL
9. admin/client integration if the module really needs UI

Do not start by generating pages or SQL first if the resource boundary is still unclear.

## 8. Sample expansion guidance

Do not bake CRUD, config, log, SQL, or frontend pages into the template repository by default.

Instead:

- define them in the target module spec
- let AI or humans add them after the module boundary is clear

That keeps the template clean and avoids turning it back into a traditional code generator.

## 9. What AI Should Not Do

When expanding from the template, AI should not:

- invent extra layers before the business boundary is clear
- add mall-style demo pages or historical template baggage
- introduce `save` style ambiguous write APIs
- add persistent `Boolean` fields for yes/no data
- turn the template repository itself into a giant example project
