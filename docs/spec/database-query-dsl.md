# Neton Database Query DSL v2 设计规范

> neton-database 的「灵魂层」设计：极轻量 + 强类型 + 零心智负担的 Query DSL。

---

## 一、当前已做对的三件事

- **SQLx 只做 driver / pool**
- **KSP 生成 glue code**
- **API 以 Entity 为中心**（而不是 Store / Repo / Impl）

接下来不是再加抽象层，而是：**设计一套“极轻量 + 强类型 + 零心智负担”的 Query DSL**。

---

## 二、设计目标（不是谁，而是谁）

**目标不是：**

- ❌ jOOQ（太重、DSL 过度工程化）
- ❌ MyBatis Plus（Wrapper 太 Java 味）
- ❌ 方法名爆炸

**而是：**

⭐ **Laravel 手感 + Kotlin DSL + 编译期安全**

---

## 三、设计目标（必须满足）

### 1️⃣ 极简人体工程学

```kotlin
User.where { User::status eq 1 }.list()
```

而不是：

```kotlin
QueryBuilder<User>().where(...)
```

### 2️⃣ 强类型（无字符串字段名）

- `User::age gt 18` ✅
- `"age > 18"` ❌

### 3️⃣ 不暴露 SQLx

用户永远不知道底层是 sqlx4k / jdbc / sqlite / pg。

### 4️⃣ 零对象创建负担

Query 是轻量 struct（builder），不是 ORM Session。

### 5️⃣ 90% CRUD 场景一行解决

---

## 四、最终 API 预览（完整使用形态）

### 查询

**基础：**

```kotlin
User.get(id)           // 主键查询（短、直觉、Map.get 心智）
User.where { all() }.list()
User.count()
```

**where：**

```kotlin
User.where { User::status eq 1 }.list()
```

**多条件：**

```kotlin
User.where {
    (User::status eq 1) and
    (User::age gt 18)
}.list()
```

**like：**

```kotlin
User.where {
    User::name like "%jack%"
}.list()
```

**orderBy：**

```kotlin
User.where { User::status eq 1 }
    .orderBy(User::age.desc())
    .list()
```

**分页：**

```kotlin
User.where { User::status eq 1 }
    .page(1, 20)
    .listPage()
// 返回：PageResult<User>（data, page, size, total, totalPages）
```

**Flow（流式查询）：**

```kotlin
User.where { User::status eq 1 }
    .flow()
    .collect { println(it) }
```

**只查一条：**

- `.first()`
- `.one()`
- `.oneOrNull()`

**exists：**

```kotlin
User.where { User::email eq email }.exists()
```

### 更新

```kotlin
User.where { User::status eq 0 }
    .update {
        set(User::status, 1)
    }
```

### 删除（按 id / 实例）

```kotlin
User.destroy(id)       // 按主键删除一条
user.delete()          // 实例删除
User.where { User::status eq 0 }.delete()  // 条件删除
```

### ActiveRecord（定型 API）

```kotlin
User.get(id)                           // 主键查询
User.destroy(id)                       // 按 id 删除
User.update(id) { name = x; email = y }  // mutate 风格：lambda 内直接赋值，copy 由 KSP 内部生成
User.where { ... }.list() / .flow()
user.save()
user.delete()
```

**按 id 更新（mutate 风格）**：KSP 为每个实体生成 `XxxUpdateScope`（仅非 id 的 var 属性），`User.update(id) { block: UserUpdateScope.() -> Unit }` 内部实现为：取当前实体 → 构造 Scope(initial) → 执行 block → `current.copy(name = scope.name, ...)` → 保存并返回。业务层无需手写 `copy(...)`。

---

## 五、核心 DSL 设计（类型结构）

### 1️⃣ Query 接口

```kotlin
interface Query<T : Any> {
    fun where(block: PredicateScope<T>.() -> Predicate): Query<T>
    fun orderBy(vararg orders: Order<T>): Query<T>
    fun limit(n: Int): Query<T>
    fun offset(n: Int): Query<T>
    fun page(page: Int, size: Int): Query<T>
    suspend fun list(): List<T>
    suspend fun first(): T?
    suspend fun one(): T
    suspend fun oneOrNull(): T?
    suspend fun count(): Long
    suspend fun exists(): Boolean
    fun flow(): Flow<T>
    suspend fun delete(): Long
    suspend fun update(block: UpdateScope<T>.() -> Unit): Long
}
```

### 2️⃣ 条件 DSL

**Predicate：**

```kotlin
interface Predicate
```

**PredicateScope：**

```kotlin
interface PredicateScope<T>
```

仅作为 DSL 容器。

### 3️⃣ 字段操作符（核心）

KSP 生成字段映射。

**KProperty → Column：**

```kotlin
class Column<T, V>(
    val property: KProperty1<T, V>,
    val name: String
)
```

**运算符：**

```kotlin
infix fun <T, V> KProperty1<T, V>.eq(value: V): Predicate
infix fun <T, V : Comparable<V>> KProperty1<T, V>.gt(value: V): Predicate
infix fun <T, V : Comparable<V>> KProperty1<T, V>.lt(value: V): Predicate
infix fun <T> KProperty1<T, String>.like(value: String): Predicate
```

**AND / OR：**

```kotlin
infix fun Predicate.and(other: Predicate): Predicate
infix fun Predicate.or(other: Predicate): Predicate
```

### 4️⃣ 排序

```kotlin
class Order<T>(
    val property: KProperty1<T, *>,
    val asc: Boolean
)

fun <T> KProperty1<T, *>.asc(): Order<T>
fun <T> KProperty1<T, *>.desc(): Order<T>
```

### 5️⃣ Update DSL

```kotlin
interface UpdateScope<T> {
    fun <V> set(prop: KProperty1<T, V>, value: V)
}
```

---

## 六、KSP 生成结构（关键）

每个 Entity 生成 **UserExtensions.kt**（含 **UserUpdateScope** + 表级 Companion 扩展 + 实例级扩展）：

```kotlin
// 按 id 更新：mutate 风格，copy 在内部生成
class UserUpdateScope(initial: User) {
    var name: String
    var email: String
    var status: Int
    var age: Int
    init { name = initial.name; email = initial.email; ... }
}

// ---------- 表级（User.xxx）----------
suspend fun User.Companion.get(id: Any): User? = UserStore.findById(id)
suspend fun User.Companion.destroy(id: Any): Boolean = UserStore.deleteById(id)
suspend fun User.Companion.update(id: Any, block: UserUpdateScope.() -> Unit): User? {
    val current = UserStore.findById(id) ?: return null
    val scope = UserUpdateScope(current)
    scope.block()
    val updated = current.copy(name = scope.name, email = scope.email, status = scope.status, age = scope.age)
    UserStore.update(updated)
    return updated
}
fun User.Companion.where(block: PredicateScope<User>.() -> Predicate): Query<User> = UserStore.where(block)
suspend fun User.Companion.findAll(): List<User> = UserStore.findAll()
suspend fun User.Companion.count(): Long = UserStore.count()

// ---------- 实例级（user.xxx）----------
suspend fun User.save(): User = UserStore.save(this)
suspend fun User.delete(): Boolean = UserStore.delete(this)
```

**用户永远看不到 Store / Repository / Impl / SQLx。** 业务层写法：`User.update(id) { name = user.name; email = user.email }`。

---

## 七、内部实现层级（架构原则）

| 层级 | 内容 |
|------|------|
| **上层（用户 API）** | `User.where { }` |
| **中层（Query DSL）** | `Query&lt;T&gt;`、`Predicate`、`Order`、`UpdateScope` |
| **底层（驱动）** | `SqlxQueryExecutor`、`SqlxStore`、`SqlxPool` |

**只有底层依赖 SQLx。**

⭐ **Query 层 = 纯抽象**  
未来若要换 jdbc / native sqlite / postgres driver，可零改动。

---

## 八、与目标对比

| 目标 | 是否满足 |
|------|----------|
| Laravel 手感 | ✅ |
| Kotlin 风格 | ✅ |
| 强类型 | ✅ |
| 无字符串 SQL | ✅ |
| 无 Impl 类 | ✅ |
| 不暴露 sqlx | ✅ |
| Flow 支持 | ✅ |
| 低心智负担 | ✅ |
| 可长期冻结 | ✅ |

---

## 九、结论与建议

**建议：将本套 API 定为 neton-database v2 正式 Query 规范。**

然后：

- KSP 生成 Companion 扩展（get / destroy / update / where / save / delete）
- Query 作为唯一 DSL
- Store 退到 internal，不暴露
- 禁止 Repository / Impl，API 以 Entity 为中心

**已落地：**  
query 包（Query.kt、Predicate、Order、PageResult）、Store.update/updateById、KSP 生成 XxxUpdateScope + get/destroy/update（update 为 mutate 风格，内部 copy）。
