# Admin operation audit

> Requires a System module with operation audit support and the route lifecycle APIs in the Neton Framework 1.2.0 candidate. In a source-based scaffold, use compatible local checkouts and apply the System PostgreSQL migration `V005__operation_audit.sql` before starting the updated module.

Neton Framework provides the request completion event. Neton Application's **System module** decides which admin operations to record and stores them for the existing operation log page. Ordinary CRUD does not require an audit annotation.

## Choose what to record

In `application.conf`:

```toml
[audit]
operations = "write"
```

| Value | Ordinary admin requests recorded |
| --- | --- |
| `off` | None |
| `delete` | Delete operations |
| `update` | Update operations |
| `write` | Creates, updates, deletes, and other write actions (default) |
| `all` | All matched admin routes, including reads |

Classification uses HTTP methods and the scaffold's standard CRUD route conventions. A recorded read is an API request, not proof of what someone saw on screen. Records use route templates and allowlisted metadata, not raw query values, credentials, or request and response bodies. Ordinary records use a bounded asynchronous queue and are not guaranteed durable.

## Reliable audit for high-risk changes

Declared high-risk routes are observed even when ordinary logging is off. The page distinguishes **HTTP** records (request outcomes) from **COMMIT** records (durable business facts). A server-generated invocation ID links them; do not count the two records as two successful actions.

System wires transactional audit for operations such as admin MFA reset and role assignment. For a new high-risk database action, register its method, **unmounted** route template and stable action key with `OperationAudit.register` during module assembly. Use `OperationAudit.commit` to append the business fact in the same transaction and on the same `DbContext` as the mutation. An audit write failure rolls back the change. For external commands, persist acceptance or dispatch separately from actual execution; an HTTP success cannot prove the remote action ran.

See [route lifecycle extensions](./route-lifecycle.md) for the framework API and the [audit specification](https://github.com/netonframework/netonframework.github.io/blob/main/docs/zh-hans/spec/application/operation-audit.md) for module integration and acceptance.
