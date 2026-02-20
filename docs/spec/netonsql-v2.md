# NetonSQL v2 Spec（Phase 2~4 统一模型）

> **状态**：冻结草案 v2  
> **范围**：强类型列引用 + Typed Projection + JOIN AST  
> **策略**：一体设计、分步实现（Phase 2 → 3 → 4 逐步交付）  
> **前提**：Phase 1（MyBatis-Plus 平替底座）已冻结并交付

---

## 〇、设计原则（冻结）

| # | 原则 | 说明 |
|---|------|------|
| 1 | **Schema 源 = @Table data class + KSP** | 不引入 DB codegen，不引入 .sq 文件；Kotlin data class 即真相源 |
| 2 | **对外列引用只允许 `Entity::prop`** | 用户永远写 `SystemUser::username`，不写 `SystemUserColumns.username`；Columns 为 internal 实现 |
| 3 | **JOIN 不做 ORM 关系映射** | 只做 Typed SQL Builder，不引入 `@HasMany` / `@BelongsTo` |
| 4 | **Projection 强类型化** | 从 `Row` 升级为 `Record` / typed DTO |
| 5 | **Phase 1 完全兼容** | `Table<T, ID>` + `query { where { } }` + KProperty1 运算符全部保留 |
| 6 | **raw SQL 是逃生口，不是主路径** | 80% 查询走 DSL，20% 特殊查询走 `DbContext` |
| 7 | **分页永远两条 SQL** | `count + select limit/offset`，JOIN 场景同样适用 |
| 8 | **SQL 字符串只由 SqlBuilder + Dialect 产生** | 任何结构化类型（Column/TableRef）不提供拼 SQL 的方法 |
| 9 | **alias 自动生成** | 用户不写 `"u"` / `"ur"` 等字符串别名，框架内部按 JOIN 顺序分配 `t1` / `t2` / `t3` |
| 10 | **列名映射 KSP 化** | `Entity::prop → column_name` 的映射由 KSP 编译期生成，禁止 runtime regex 猜测 |
| 11 | **AST 禁止业务直接构造** | `ColumnPredicate` / `JoinCondition` / `ColumnOrdering` 只能通过 DSL 运算符创建，禁止业务代码手动 new（类型安全由运算符层保证） |
| 12 | **不支持属性名混淆** | v2 假设 Kotlin 属性名在运行时可用（`KProperty1.name`），不支持混淆/重写属性名的构建链 |
| 13 | **SELECT 投影列必须自动加别名** | `ProjectionExpr.Col` 输出 `{alias}."{column}" AS {alias}_{column}`（如 `t1."id" AS t1_id`），确保 `Row.get(ref, prop)` / `intoOrNull()` 的列名匹配 |
| 14 | **COUNT + GROUP BY 使用子查询** | 无 `groupBy` → `SELECT COUNT(*)`；有 `groupBy` → `SELECT COUNT(*) FROM (原始 SELECT 去 LIMIT) tmp`，避免返回分组条数而非总行数 |
| 15 | **TableDefRegistry 必须 O(1) 查找** | `Map<KClass<*>, TableDef<*>>`，`DatabaseComponent.init()` 一次性注册，禁止 resolve 时反射扫描 |
| 16 | **SelectAst 保持 public（只读）** | `SelectAst` 是 `public data class`，`SqlBuilder` 是 `internal`；未来可做 `QueryInterceptor.beforeExecute(ast)` / query cache / 多租户 rewrite |
| 17 | **Row.get 禁止 fallback 裸列名** | `Row.get(ref, prop)` 只能读 `{alias}_{column}`（如 `t1_id`），**不得 fallback 读裸列名**（如 `id`）。避免多表同名列隐式歧义。JOIN 投影列必须 `AS {alias}_{column}`（原则 13） |

---

## 一、Phase 2：强类型列（Column） — internal 实现

> **核心冻结约束**：对外 API 只允许 `KProperty1<T, V>`（即 `SystemUser::username`）。
> `Column<T, V>` / `TableDef<T>` 是 internal 实现载体，用户不直接接触。

### 1.1 Column（internal）

```kotlin
package neton.database.dsl

/**
 * 强类型列引用（internal）。
 * T = 所属实体类型，V = 列值类型。
 * KSP 生成，用户不直接使用。
 *
 * 注意：Column 不提供任何 SQL 字符串拼接方法。
 * SQL 输出完全由 SqlBuilder + Dialect 负责。
 */
internal class Column<T : Any, V>(
    val tableDef: TableDef<T>,
    val columnName: String,        // SQL 列名（snake_case），KSP 编译期确定
    val propertyName: String       // Kotlin 属性名（camelCase）
)
```

### 1.2 TableDef（internal）

```kotlin
package neton.database.dsl

/**
 * 表定义（internal）：持有表名和 KProperty → Column 的映射。
 * KSP 为每个 @Table 实体生成一个 internal object 实现。
 *
 * 与 Phase 1 的 Table<T, ID>（CRUD 接口）是不同的概念：
 * - TableDef：表的「元数据 + 列映射」，DSL 内部使用
 * - Table<T, ID>：表的「CRUD 操作」，用户直接使用
 */
internal interface TableDef<T : Any> {
    val tableName: String
    val columns: List<Column<T, *>>

    /** KProperty name → Column 的查找。KSP 生成的实现用 Map 做 O(1) 查找。 */
    fun <V> resolve(prop: KProperty1<T, V>): Column<T, V>
}
```

### 1.3 KSP 生成物（internal）

对每个 `@Table` 实体，KSP 额外生成一个 internal `<EntityName>TableDef` object：

```kotlin
// AUTO-GENERATED — model/SystemUserTableDef.kt (internal)
package model

import kotlin.reflect.KProperty1
import neton.database.dsl.Column
import neton.database.dsl.TableDef

internal object SystemUserTableDef : TableDef<SystemUser> {
    override val tableName = "system_users"

    val id = Column<SystemUser, Long?>(this, "id", "id")
    val username = Column<SystemUser, String>(this, "username", "username")
    val passwordHash = Column<SystemUser, String>(this, "password_hash", "passwordHash")
    val nickname = Column<SystemUser, String>(this, "nickname", "nickname")
    val status = Column<SystemUser, Int>(this, "status", "status")
    val deleted = Column<SystemUser, Int>(this, "deleted", "deleted")
    val createdAt = Column<SystemUser, Long>(this, "created_at", "createdAt")
    val updatedAt = Column<SystemUser, Long>(this, "updated_at", "updatedAt")

    override val columns = listOf(id, username, passwordHash, nickname, status, deleted, createdAt, updatedAt)

    // KSP 生成的精确映射，不依赖 runtime regex
    private val propMap: Map<String, Column<SystemUser, *>> = mapOf(
        "id" to id, "username" to username, "passwordHash" to passwordHash,
        "nickname" to nickname, "status" to status, "deleted" to deleted,
        "createdAt" to createdAt, "updatedAt" to updatedAt
    )

    @Suppress("UNCHECKED_CAST")
    override fun <V> resolve(prop: KProperty1<SystemUser, V>): Column<SystemUser, V> =
        (propMap[prop.name] as? Column<SystemUser, V>)
            ?: throw IllegalArgumentException("Unknown property: ${prop.name}")
}
```

**关键**：
- `propMap` 由 KSP 编译期生成，O(1) 查找，不做 runtime camelToSnake regex
- 整个 object 是 `internal`，用户代码不 import、不引用

### 1.4 TableRef：JOIN 时的表引用（auto alias）

```kotlin
package neton.database.dsl

/**
 * 查询中的表引用：持有 TableDef + 自动分配的 alias。
 * 用户通过 from(Table) / join(Table) 获得 TableRef，
 * 然后通过 tableRef[Entity::prop] 获得带表归属的 ColRef。
 *
 * alias 由 SelectBuilder 自动分配（t1, t2, t3...），用户不手写。
 */
class TableRef<T : Any> internal constructor(
    internal val def: TableDef<T>,
    internal val alias: String        // 自动分配：t1, t2, t3...
) {
    /** 列引用：tableRef[SystemUser::username] → ColRef<T, V> */
    operator fun <V> get(prop: KProperty1<T, V>): ColRef<T, V> =
        ColRef(this, def.resolve(prop))
}
```

### 1.5 ColRef：带表归属的列引用（用户通过 `tableRef[prop]` 获得）

```kotlin
package neton.database.dsl

/**
 * 查询中的列引用：TableRef + Column。
 * 自带表归属（通过 alias），跨表不冲突。
 *
 * 注意：ColRef 不提供任何 SQL 字符串方法。
 * SQL 输出完全由 SqlBuilder 负责。
 */
class ColRef<T : Any, V> internal constructor(
    internal val tableRef: TableRef<T>,
    internal val column: Column<T, V>
) {
    internal val alias: String get() = tableRef.alias
    internal val columnName: String get() = column.columnName
}
```

### 1.6 ColRef 运算符（对外 API — 用户通过 `tableRef[prop] eq value` 使用）

```kotlin
package neton.database.dsl

// ===== 值比较（强类型：V 必须匹配）=====
infix fun <T : Any, V> ColRef<T, V>.eq(value: V): ColumnPredicate =
    ColumnPredicate.Eq(this.alias, this.columnName, value)

infix fun <T : Any, V> ColRef<T, V>.ne(value: V): ColumnPredicate =
    ColumnPredicate.Ne(this.alias, this.columnName, value)

infix fun <T : Any, V : Comparable<V>> ColRef<T, V>.gt(value: V): ColumnPredicate =
    ColumnPredicate.Gt(this.alias, this.columnName, value)

infix fun <T : Any, V : Comparable<V>> ColRef<T, V>.ge(value: V): ColumnPredicate =
    ColumnPredicate.Ge(this.alias, this.columnName, value)

infix fun <T : Any, V : Comparable<V>> ColRef<T, V>.lt(value: V): ColumnPredicate =
    ColumnPredicate.Lt(this.alias, this.columnName, value)

infix fun <T : Any, V : Comparable<V>> ColRef<T, V>.le(value: V): ColumnPredicate =
    ColumnPredicate.Le(this.alias, this.columnName, value)

infix fun <T : Any> ColRef<T, String>.like(pattern: String): ColumnPredicate =
    ColumnPredicate.Like(this.alias, this.columnName, pattern)

infix fun <T : Any, V> ColRef<T, V>.`in`(values: Collection<V>): ColumnPredicate =
    ColumnPredicate.In(this.alias, this.columnName, values.toList())

fun <T : Any, V> ColRef<T, V>.isNull(): ColumnPredicate =
    ColumnPredicate.IsNull(this.alias, this.columnName)

fun <T : Any, V> ColRef<T, V>.isNotNull(): ColumnPredicate =
    ColumnPredicate.IsNotNull(this.alias, this.columnName)

infix fun <T : Any, V : Comparable<V>> ColRef<T, V>.between(range: Pair<V, V>): ColumnPredicate =
    ColumnPredicate.Between(this.alias, this.columnName, range.first, range.second)

// ===== 排序 =====
fun <T : Any, V> ColRef<T, V>.asc(): ColumnOrdering =
    ColumnOrdering(this.alias, this.columnName, Dir.ASC)

fun <T : Any, V> ColRef<T, V>.desc(): ColumnOrdering =
    ColumnOrdering(this.alias, this.columnName, Dir.DESC)

// ===== 跨表 JOIN 条件（左列 = 右列，类型 V 必须一致）=====
infix fun <T : Any, R : Any, V> ColRef<T, V>.eq(other: ColRef<R, V>): JoinCondition =
    JoinCondition(
        leftAlias = this.alias, leftColumn = this.columnName,
        rightAlias = other.alias, rightColumn = other.columnName
    )
```

### 1.7 ColumnPredicate（v2 谓词 AST — 纯结构化数据，不含 Column 对象引用）

```kotlin
package neton.database.dsl

/**
 * v2 谓词 AST。
 * 存储 (tableAlias, columnName, value) 三元组，不持有 Column 对象引用。
 * SQL 生成完全由 SqlBuilder + Dialect 负责。
 *
 * 类型安全由运算符层保证（ColRef<T,V>.eq(V)），
 * AST 层存储 Any? 是因为 sealed interface 的 data class 无法持有泛型。
 */
sealed interface ColumnPredicate {
    data class Eq(val tableAlias: String, val column: String, val value: Any?) : ColumnPredicate
    data class Ne(val tableAlias: String, val column: String, val value: Any?) : ColumnPredicate
    data class Gt(val tableAlias: String, val column: String, val value: Any?) : ColumnPredicate
    data class Ge(val tableAlias: String, val column: String, val value: Any?) : ColumnPredicate
    data class Lt(val tableAlias: String, val column: String, val value: Any?) : ColumnPredicate
    data class Le(val tableAlias: String, val column: String, val value: Any?) : ColumnPredicate
    data class Like(val tableAlias: String, val column: String, val value: String) : ColumnPredicate
    data class In(val tableAlias: String, val column: String, val values: List<Any?>) : ColumnPredicate
    data class IsNull(val tableAlias: String, val column: String) : ColumnPredicate
    data class IsNotNull(val tableAlias: String, val column: String) : ColumnPredicate
    data class Between(val tableAlias: String, val column: String, val low: Any?, val high: Any?) : ColumnPredicate
    data class And(val children: List<ColumnPredicate>) : ColumnPredicate
    data class Or(val children: List<ColumnPredicate>) : ColumnPredicate
    data object True : ColumnPredicate
}

infix fun ColumnPredicate.and(other: ColumnPredicate): ColumnPredicate =
    ColumnPredicate.And(listOf(this, other))

infix fun ColumnPredicate.or(other: ColumnPredicate): ColumnPredicate =
    ColumnPredicate.Or(listOf(this, other))
```

### 1.8 ColumnOrdering

```kotlin
package neton.database.dsl

data class ColumnOrdering(val tableAlias: String, val column: String, val dir: Dir)
```

### 1.9 JoinCondition

```kotlin
package neton.database.dsl

/** JOIN ON 条件：左表.列 = 右表.列（纯结构化数据）*/
data class JoinCondition(
    val leftAlias: String,
    val leftColumn: String,
    val rightAlias: String,
    val rightColumn: String
)
```

### 1.10 条件筛选辅助函数

```kotlin
package neton.database.dsl

inline fun <V : Any> whenPresent(value: V?, block: (V) -> ColumnPredicate): ColumnPredicate =
    if (value != null) block(value) else ColumnPredicate.True

inline fun whenNotBlank(value: String?, block: (String) -> ColumnPredicate): ColumnPredicate =
    if (!value.isNullOrBlank()) block(value) else ColumnPredicate.True

inline fun <V> whenNotEmpty(value: Collection<V>?, block: (Collection<V>) -> ColumnPredicate): ColumnPredicate =
    if (!value.isNullOrEmpty()) block(value) else ColumnPredicate.True

fun allOf(vararg predicates: ColumnPredicate): ColumnPredicate {
    val filtered = predicates.filter { it !is ColumnPredicate.True }
    return when (filtered.size) {
        0 -> ColumnPredicate.True
        1 -> filtered.first()
        else -> ColumnPredicate.And(filtered)
    }
}

fun anyOf(vararg predicates: ColumnPredicate): ColumnPredicate {
    val filtered = predicates.filter { it !is ColumnPredicate.True }
    return when (filtered.size) {
        0 -> ColumnPredicate.True
        1 -> filtered.first()
        else -> ColumnPredicate.Or(filtered)
    }
}
```

### 1.11 TableDefRegistry（internal，O(1) 查找 — 原则 15）

```kotlin
package neton.database.dsl

import kotlin.reflect.KClass
import kotlin.reflect.KProperty1

/**
 * TableDef 注册表（internal）。
 * 存储 KClass → TableDef 和 Table → TableDef 的映射。
 * 在 DatabaseComponent.init() 一次性注册（KSP 生成注册代码），
 * 运行时只读查找，O(1)。禁止 resolve 时反射扫描。
 */
internal object TableDefRegistry {
    private val byClass = mutableMapOf<KClass<*>, TableDef<*>>()
    private val byTable = mutableMapOf<Any, TableDef<*>>()   // Table<T, ID> → TableDef<T>

    /** DatabaseComponent.init() 内调用，KSP 生成 */
    fun <T : Any> register(klass: KClass<T>, table: Any, def: TableDef<T>) {
        byClass[klass] = def
        byTable[table] = def
    }

    /** 通过 Table 实例查找（SelectBuilder.from / joinStep 内部使用） */
    @Suppress("UNCHECKED_CAST")
    fun <T : Any> get(table: Any): TableDef<T> =
        byTable[table] as? TableDef<T>
            ?: throw IllegalStateException("No TableDef registered for $table. Ensure @Table is annotated and DatabaseComponent is initialized.")

    /** 通过 KClass + KProperty1 解析列（intoOrNull 内部使用） */
    @Suppress("UNCHECKED_CAST")
    fun <T : Any, V> resolve(klass: KClass<T>, prop: KProperty1<T, V>): Column<T, V> {
        val def = byClass[klass] as? TableDef<T>
            ?: throw IllegalStateException("No TableDef for ${klass.simpleName}")
        return def.resolve(prop)
    }

    // ⚠️ find(prop) 已废除（原则 15 加固）
    // 遍历 byClass.values 再找 propertyName 存在 O(n) 与同名字段误匹配风险。
    // 正式路径必须走 resolve(entityClass, prop)：单表 query 已知 Table 的实体类型/def，
    // 直接 resolve，不需要 find。find 仅保留用于调试（标 @Deprecated）。
    @Deprecated("Use resolve(klass, prop) instead. find() is O(n) and may mismatch same-name properties across entities.")
    @Suppress("UNCHECKED_CAST")
    fun <T : Any> find(prop: KProperty1<T, *>): TableDef<T>? {
        return byClass.values.firstOrNull { def ->
            def.columns.any { it.propertyName == prop.name }
        } as? TableDef<T>
    }
}
```

### 1.12 单表场景：Table.query 中使用 KProperty1（Phase 1 兼容 + Phase 2 增强）

Phase 1 的 `KProperty1` 运算符保留不变。Phase 2 在 `Table.query` 内部也做 KSP resolve：

```kotlin
// Phase 1 保留，不标 deprecated（因为单表场景 KProperty1 就是主路径）
SystemUserTable.query {
    where {
        and(
            whenNotBlank(username) { SystemUser::username like "%$it%" },
            whenPresent(status) { SystemUser::status eq it }
        )
    }
}.page(1, 20)
```

**Phase 2 内部增强**：`KProperty1.toColumnRef()` 内部改为查找 KSP 生成的 `TableDef.resolve()`，
不再 runtime regex camelToSnake。对用户代码透明，无需改动。

```kotlin
// 内部实现变化（对用户不可见）
internal fun <T : Any> KProperty1<T, *>.toColumnRef(): ColumnRef {
    // Phase 1: name.replace(Regex("([a-z])([A-Z])"), "$1_$2").lowercase()
    // Phase 2: 通过 TableDefRegistry.resolve 走 KSP 生成的精确映射
    // 注意：不使用 find()（已废除），单表 query 已知实体类型，直接 resolve
    return try {
        val col = TableDefRegistry.resolve(this.receiverType(), this)
        ColumnRef(col.columnName)
    } catch (_: IllegalStateException) {
        // Phase 1 兼容 fallback（仅在 TableDef 未注册时）
        ColumnRef(fallbackCamelToSnake(name))
    }
}
```

### 1.13 与 Phase 1 的兼容策略（冻结）

| 场景 | 用户写法 | Phase 2 内部行为 |
|------|---------|----------------|
| 单表 query where | `SystemUser::username like "%x%"` | KProperty1 → TableDef.resolve() → ColumnRef（KSP 映射） |
| 单表 orderBy | `SystemUser::createdAt.desc()` | 同上 |
| JOIN where | `U[SystemUser::username] like "%x%"` | ColRef → ColumnPredicate（带 alias） |
| JOIN on | `U[SystemUser::id] eq UR[UserRole::userId]` | ColRef eq ColRef → JoinCondition |

**规则**：
- 单表场景：`KProperty1` 运算符是主路径，不 deprecate
- JOIN 场景：必须通过 `TableRef[Entity::prop]` 获得 `ColRef`，因为需要表归属
- `<Entity>Columns` / `<Entity>TableDef` 始终 internal，不出现在用户代码中

---

## 二、Phase 3：Typed Projection

### 2.1 Record 类型族

```kotlin
package neton.database.dsl

interface Record1<A> { val v1: A }
interface Record2<A, B> { val v1: A; val v2: B }
interface Record3<A, B, C> { val v1: A; val v2: B; val v3: C }
interface Record4<A, B, C, D> { val v1: A; val v2: B; val v3: C; val v4: D }
interface Record5<A, B, C, D, E> { val v1: A; val v2: B; val v3: C; val v4: D; val v5: E }
interface Record6<A, B, C, D, E, F> { val v1: A; val v2: B; val v3: C; val v4: D; val v5: E; val v6: F }
interface Record7<A, B, C, D, E, F, G> { val v1: A; val v2: B; val v3: C; val v4: D; val v5: E; val v6: F; val v7: G }
interface Record8<A, B, C, D, E, F, G, H> { val v1: A; val v2: B; val v3: C; val v4: D; val v5: E; val v6: F; val v7: G; val v8: H }

data class Rec1<A>(override val v1: A) : Record1<A>
data class Rec2<A, B>(override val v1: A, override val v2: B) : Record2<A, B>
data class Rec3<A, B, C>(override val v1: A, override val v2: B, override val v3: C) : Record3<A, B, C>
data class Rec4<A, B, C, D>(override val v1: A, override val v2: B, override val v3: C, override val v4: D) : Record4<A, B, C, D>
data class Rec5<A, B, C, D, E>(override val v1: A, override val v2: B, override val v3: C, override val v4: D, override val v5: E) : Record5<A, B, C, D, E>
data class Rec6<A, B, C, D, E, F>(override val v1: A, override val v2: B, override val v3: C, override val v4: D, override val v5: E, override val v6: F) : Record6<A, B, C, D, E, F>
data class Rec7<A, B, C, D, E, F, G>(override val v1: A, override val v2: B, override val v3: C, override val v4: D, override val v5: E, override val v6: F, override val v7: G) : Record7<A, B, C, D, E, F, G>
data class Rec8<A, B, C, D, E, F, G, H>(override val v1: A, override val v2: B, override val v3: C, override val v4: D, override val v5: E, override val v6: F, override val v7: G, override val v8: H) : Record8<A, B, C, D, E, F, G, H>
```

超过 8 列的投影使用自定义 DTO（v2.1 可加 `selectInto<UserLite>(...)` KSP 生成）。

### 2.2 EntityMapper（Neton Row → Entity，独立于 sqlx4k RowMapper）

```kotlin
package neton.database.api

/**
 * Neton 自有的 Row → Entity 映射器。
 * 基于 neton.database.api.Row 接口，与 sqlx4k RowMapper 独立。
 * KSP 为每个 @Table 实体生成。
 */
fun interface EntityMapper<T : Any> {
    fun map(row: Row): T
}
```

KSP 生成示例：

```kotlin
// AUTO-GENERATED — model/SystemUserEntityMapper.kt (internal)
package model

import neton.database.api.EntityMapper
import neton.database.api.Row

internal object SystemUserEntityMapper : EntityMapper<SystemUser> {
    override fun map(row: Row): SystemUser = SystemUser(
        id = row.longOrNull("id"),
        username = row.string("username"),
        passwordHash = row.string("password_hash"),
        nickname = row.string("nickname"),
        status = row.int("status"),
        deleted = row.int("deleted"),
        createdAt = row.long("created_at"),
        updatedAt = row.long("updated_at")
    )
}
```

### 2.3 EntityMapperRegistry（统一注册，收口到 Component 初始化）

```kotlin
package neton.database.api

import kotlin.reflect.KClass

/**
 * EntityMapper 注册表。
 * 注册只发生在 DatabaseComponent.init() 内（统一入口），不允许散落注册。
 */
object EntityMapperRegistry {
    private val mappers = mutableMapOf<KClass<*>, EntityMapper<*>>()

    fun <T : Any> register(klass: KClass<T>, mapper: EntityMapper<T>) {
        mappers[klass] = mapper
    }

    @Suppress("UNCHECKED_CAST")
    fun <T : Any> get(klass: KClass<T>): EntityMapper<T> =
        mappers[klass] as? EntityMapper<T>
            ?: throw IllegalStateException("No EntityMapper for ${klass.simpleName}. Ensure @Table is annotated and DatabaseComponent is initialized.")
}
```

KSP 生成注册代码，在 `DatabaseComponent.init()` 内统一调用（不生成散落的顶层注册函数）。

### 2.4 PrefixedRow（JOIN 结果映射）

```kotlin
package neton.database.api

/**
 * Row 包装器：自动剥离列名前缀。
 * SQL: SELECT r.id AS role_id, r.name AS role_name
 * 用法: row.into<Role>("role_")  → PrefixedRow("role_id") → delegate 找 "role_id"
 */
class PrefixedRow(private val delegate: Row, private val prefix: String) : Row {
    override fun long(name: String): Long = delegate.long(prefix + name)
    override fun longOrNull(name: String): Long? = delegate.longOrNull(prefix + name)
    override fun string(name: String): String = delegate.string(prefix + name)
    override fun stringOrNull(name: String): String? = delegate.stringOrNull(prefix + name)
    override fun int(name: String): Int = delegate.int(prefix + name)
    override fun intOrNull(name: String): Int? = delegate.intOrNull(prefix + name)
    override fun double(name: String): Double = delegate.double(prefix + name)
    override fun doubleOrNull(name: String): Double? = delegate.doubleOrNull(prefix + name)
    override fun boolean(name: String): Boolean = delegate.boolean(prefix + name)
    override fun booleanOrNull(name: String): Boolean? = delegate.booleanOrNull(prefix + name)
}
```

### 2.5 Row.into() 扩展

```kotlin
package neton.database.api

inline fun <reified T : Any> Row.into(): T =
    EntityMapperRegistry.get(T::class).map(this)

inline fun <reified T : Any> Row.into(prefix: String): T =
    EntityMapperRegistry.get(T::class).map(PrefixedRow(this, prefix))
```

### 2.6 Row.intoOrNull()（不用 try/catch，用存在性检测 + 显式 pk）

```kotlin
package neton.database.api

/**
 * LEFT JOIN 友好的映射：如果关联表主键列为 null，认为 LEFT JOIN 未命中，返回 null。
 * 不使用 try/catch（避免吞掉真实 bug）。
 *
 * pk 参数为关联表的主键属性（KProperty1），框架通过 TableDef.resolve() 得到真实列名。
 * 这样不硬编码 "id"，适配任何主键名。
 *
 * 用法：
 *   row.intoOrNull<Role>("role_", Role::id)
 *   row.intoOrNull<Category>("cat_", Category::code)   // 主键不是 id 也 OK
 */
inline fun <reified T : Any, ID> Row.intoOrNull(prefix: String, pk: KProperty1<T, ID>): T? {
    val pkColumn = TableDefRegistry.resolve(T::class, pk).columnName
    // 检测主键列：prefix + pkColumn 为 null 则认为 LEFT JOIN 未命中
    if (stringOrNull(prefix + pkColumn) == null) return null
    return EntityMapperRegistry.get(T::class).map(PrefixedRow(this, prefix))
}
```

> **冻结规则**：`intoOrNull` 必须传入 `pk` 参数（KProperty1），不做默认值猜测。

### 2.7 Row.get(ref, prop)：JOIN 结果的强类型取值

```kotlin
package neton.database.api

/**
 * 从 JOIN 结果行中按 TableRef + KProperty1 强类型取值。
 * 内部根据 TableRef.alias + TableDef.resolve(prop).columnName 计算实际列名。
 *
 * 用于聚合 helper 的 key 等场景，避免写字符串列名：
 *   key = { row -> row.get(U, SystemUser::id) }   // 而不是 row.long("id")
 */
@Suppress("UNCHECKED_CAST")
fun <T : Any, V> Row.get(ref: TableRef<T>, prop: KProperty1<T, V>): V {
    val col = ref.def.resolve(prop)
    val qualifiedName = "${ref.alias}_${col.columnName}"  // SELECT 输出的列别名
    // 根据属性类型分发（实现层根据 Column 元数据判断类型）
    return readColumn(qualifiedName, col) as V
}

fun <T : Any, V> Row.getOrNull(ref: TableRef<T>, prop: KProperty1<T, V>): V? {
    val col = ref.def.resolve(prop)
    val qualifiedName = "${ref.alias}_${col.columnName}"
    return readColumnOrNull(qualifiedName, col) as? V
}
```

> **实现细节**：`readColumn` / `readColumnOrNull` 根据 Column 的类型元数据（Long/Int/String/...）
> 调用对应的 `Row.long()` / `Row.int()` / `Row.string()` 等方法。
> SELECT 投影时，框架自动给列加 `{alias}_{columnName}` 别名以避免冲突。

### 2.8 Typed select() API

```kotlin
// EntityQuery 新增 typed select（Phase 1 接口扩展）
interface EntityQuery<T : Any> {
    // Phase 1 保留
    suspend fun list(): List<T>
    suspend fun count(): Long
    suspend fun page(page: Int, size: Int): Page<T>
    fun select(vararg columnNames: String): ProjectionQuery

    // Phase 3 新增：使用 KProperty1（保持对外统一）
    fun <A> select(c1: KProperty1<T, A>): TypedProjection1<A>
    fun <A, B> select(c1: KProperty1<T, A>, c2: KProperty1<T, B>): TypedProjection2<A, B>
    fun <A, B, C> select(c1: KProperty1<T, A>, c2: KProperty1<T, B>, c3: KProperty1<T, C>): TypedProjection3<A, B, C>
    // ... 到 8 列
}

interface TypedProjection2<A, B> {
    suspend fun fetch(): List<Record2<A, B>>
    suspend fun fetchFirst(): Record2<A, B>?
    suspend fun count(): Long
    suspend fun page(page: Int, size: Int): Page<Record2<A, B>>
}
```

用法：

```kotlin
// 单表 typed projection — 用户只写 KProperty1
val records: List<Record2<Long?, String>> = SystemUserTable.query {
    where { SystemUser::status eq 1 }
}.select(SystemUser::id, SystemUser::username).fetch()

records.forEach { println("id=${it.v1}, name=${it.v2}") }
```

---

## 三、Phase 4：JOIN AST

### 3.1 JoinClause

```kotlin
package neton.database.dsl

data class JoinClause(
    val type: JoinType,               // INNER / LEFT / RIGHT / FULL
    val targetTableName: String,
    val targetAlias: String,
    val on: JoinCondition
)
```

### 3.2 SelectAst（v2 查询 AST）

```kotlin
package neton.database.dsl

/**
 * v2 查询 AST：支持多表 JOIN（public，原则 16）。
 * 所有字段都是纯结构化数据（字符串 + 枚举），不持有 Column/TableRef 对象引用。
 * SQL 生成完全由 SqlBuilder + Dialect 负责（SqlBuilder 为 internal）。
 *
 * public 暴露是为了未来扩展：
 * - QueryInterceptor.beforeExecute(ast)
 * - query cache（AST 可哈希）
 * - 多租户 rewrite（AST 可重写）
 * - 慢 SQL 分析
 */
data class SelectAst(
    val fromTable: String,
    val fromAlias: String,
    val joins: List<JoinClause> = emptyList(),
    val where: ColumnPredicate? = null,
    val orderBy: List<ColumnOrdering> = emptyList(),
    val projection: List<ProjectionExpr> = emptyList(),
    val groupBy: List<ProjectionExpr> = emptyList(),
    val having: ColumnPredicate? = null,
    val limit: Int? = null,
    val offset: Int? = null,
    val distinct: Boolean = false
)

/**
 * 投影表达式（预留 Phase 5 聚合扩展）。
 * Phase 4 只使用 Col；Phase 5 扩展 Agg。
 */
sealed interface ProjectionExpr {
    /** 普通列引用：alias + columnName */
    data class Col(val tableAlias: String, val columnName: String) : ProjectionExpr

    /**
     * 聚合/表达式（Phase 5 预留，Phase 4 不实现）：
     * 例如 count(*) as total, sum(amount) as total_amount
     */
    data class Agg(val expression: String, val outputAlias: String) : ProjectionExpr
}
```

### 3.3 SelectBuilder（流式构建器 — auto alias）

```kotlin
package neton.database.dsl

/**
 * 流式 SELECT 构建器。alias 自动分配（t1, t2, t3...），用户不手写。
 *
 * 用法：
 *   val (q, U) = from(SystemUserTable)                                         // t1
 *   val UR = q.leftJoin(UserRoleTable).on { U[SystemUser::id] eq it[UserRole::userId] }  // t2
 *   val R  = q.leftJoin(RoleTable).on { UR[UserRole::roleId] eq it[Role::id] }           // t3
 *
 *   q.where(U[SystemUser::status] eq 1)
 *    .select(U[SystemUser::id], U[SystemUser::username], R[Role::name])
 *    .fetch()
 */
class SelectBuilder internal constructor() {
    private var aliasCounter = 0
    private var fromRef: TableRefInfo? = null
    private val joins = mutableListOf<JoinClause>()
    private var where: ColumnPredicate? = null
    private val orderBy = mutableListOf<ColumnOrdering>()
    private val groupBy = mutableListOf<ProjectionExpr.Col>()
    private var having: ColumnPredicate? = null
    private var limit: Int? = null
    private var offset: Int? = null
    private var distinct: Boolean = false

    private data class TableRefInfo(val tableName: String, val alias: String)

    private fun nextAlias(): String = "t${++aliasCounter}"

    // ===== FROM =====
    internal fun <T : Any> from(table: Table<T, *>): TableRef<T> {
        val def = TableDefRegistry.get(table)
        val alias = nextAlias()
        fromRef = TableRefInfo(def.tableName, alias)
        return TableRef(def, alias)
    }

    // ===== JOIN =====
    fun <T : Any> leftJoin(table: Table<T, *>): JoinStep<T> = joinStep(JoinType.LEFT, table)
    fun <T : Any> innerJoin(table: Table<T, *>): JoinStep<T> = joinStep(JoinType.INNER, table)
    fun <T : Any> rightJoin(table: Table<T, *>): JoinStep<T> = joinStep(JoinType.RIGHT, table)

    private fun <T : Any> joinStep(type: JoinType, table: Table<T, *>): JoinStep<T> {
        val def = TableDefRegistry.get(table)
        val alias = nextAlias()
        return JoinStep(this, type, def.tableName, alias, TableRef(def, alias))
    }

    internal fun addJoin(clause: JoinClause) { joins.add(clause) }

    // ===== WHERE =====
    fun where(predicate: ColumnPredicate): SelectBuilder = apply { this.where = predicate }

    // ===== ORDER BY =====
    fun orderBy(vararg orderings: ColumnOrdering): SelectBuilder = apply {
        this.orderBy.addAll(orderings)
    }

    // ===== GROUP BY / HAVING =====
    fun groupBy(vararg cols: ColRef<*, *>): SelectBuilder = apply {
        this.groupBy.addAll(cols.map { ProjectionExpr.Col(it.alias, it.columnName) })
    }
    fun having(predicate: ColumnPredicate): SelectBuilder = apply { this.having = predicate }

    // ===== LIMIT / OFFSET =====
    fun limit(n: Int): SelectBuilder = apply { this.limit = n }
    fun offset(n: Int): SelectBuilder = apply { this.offset = n }
    fun distinct(): SelectBuilder = apply { this.distinct = true }

    // ===== SELECT（投影）=====
    fun select(vararg cols: ColRef<*, *>): ProjectedSelect =
        ProjectedSelect(buildAst(cols.map { ProjectionExpr.Col(it.alias, it.columnName) }))

    fun selectAll(): ProjectedSelect =
        ProjectedSelect(buildAst(emptyList()))

    // ===== BUILD AST =====
    private fun buildAst(projection: List<ProjectionExpr>): SelectAst {
        val f = fromRef ?: throw IllegalStateException("from() not called")
        return SelectAst(
            fromTable = f.tableName, fromAlias = f.alias,
            joins = joins.toList(), where = where,
            orderBy = orderBy.toList(), projection = projection,
            groupBy = groupBy.toList(), having = having,
            limit = limit, offset = offset, distinct = distinct
        )
    }
}

class JoinStep<T : Any> internal constructor(
    private val builder: SelectBuilder,
    private val type: JoinType,
    private val tableName: String,
    private val alias: String,
    private val ref: TableRef<T>
) {
    /**
     * on 接收一个 lambda，lambda 的参数 `it` 就是被 JOIN 表的 TableRef。
     * 用户通过 `it[Entity::prop]` 获得被 JOIN 表的列引用。
     * 返回 TableRef<T>（被 JOIN 表），用户赋值给变量后续使用。
     *
     * 示例：
     *   val UR = q.leftJoin(UserRoleTable).on { U[SystemUser::id] eq it[UserRole::userId] }
     *   val R  = q.leftJoin(RoleTable).on { UR[UserRole::roleId] eq it[Role::id] }
     */
    fun on(block: (TableRef<T>) -> JoinCondition): TableRef<T> {
        val condition = block(ref)
        builder.addJoin(JoinClause(type, tableName, alias, condition))
        return ref
    }
}

class ProjectedSelect internal constructor(private val ast: SelectAst) {
    suspend fun fetch(): List<Row> = SelectExecutor.execute(ast)
    suspend fun count(): Long = SelectExecutor.count(ast)
    suspend fun page(page: Int, size: Int): Page<Row> {
        val total = count()
        val items = SelectExecutor.execute(ast.copy(
            limit = size, offset = (page - 1) * size
        ))
        return Page(items, total, page, size)
    }
}

/** 顶层入口：返回 SelectBuilder + FROM 表的 TableRef */
fun <T : Any> from(table: Table<T, *>): Pair<SelectBuilder, TableRef<T>> {
    val builder = SelectBuilder()
    val ref = builder.from(table)
    return builder to ref
}
```

### 3.4 SqlBuilder 扩展（SelectAst → SQL）

```kotlin
// SqlBuilder 新增方法
class SqlBuilder(private val dialect: Dialect) {

    // Phase 1 保留
    fun <T : Any> buildSelect(ast: QueryAst<T>): BuiltSql { ... }
    fun <T : Any> buildCount(ast: QueryAst<T>): BuiltSql { ... }

    // Phase 4 新增
    fun buildSelect(ast: SelectAst): BuiltSql {
        reset()

        // FROM
        val fromSql = "${dialect.quoteIdent(ast.fromTable)} AS ${ast.fromAlias}"

        // JOIN
        val joinsSql = ast.joins.joinToString(" ") { join ->
            val keyword = when (join.type) {
                JoinType.INNER -> "INNER JOIN"
                JoinType.LEFT -> "LEFT JOIN"
                JoinType.RIGHT -> "RIGHT JOIN"
                JoinType.FULL -> "FULL JOIN"
            }
            val target = "${dialect.quoteIdent(join.targetTableName)} AS ${join.targetAlias}"
            val on = "${join.on.leftAlias}.${dialect.quoteIdent(join.on.leftColumn)} = " +
                     "${join.on.rightAlias}.${dialect.quoteIdent(join.on.rightColumn)}"
            "$keyword $target ON $on"
        }

        // SELECT — 所有列必须加 AS {alias}_{column} 别名（原则 13）
        val selectClause = if (ast.projection.isEmpty()) {
            "SELECT *"
        } else {
            "SELECT " + ast.projection.joinToString(", ") { expr ->
                when (expr) {
                    is ProjectionExpr.Col ->
                        "${expr.tableAlias}.${dialect.quoteIdent(expr.columnName)} AS ${expr.tableAlias}_${expr.columnName}"
                    is ProjectionExpr.Agg ->
                        "${expr.expression} AS ${dialect.quoteIdent(expr.outputAlias)}"
                }
            }
        }

        // WHERE
        val whereClause = ast.where?.let { "WHERE ${buildColumnPredicate(it)}" } ?: ""

        // GROUP BY
        val groupByClause = if (ast.groupBy.isEmpty()) "" else {
            "GROUP BY " + ast.groupBy.joinToString(", ") { expr ->
                when (expr) {
                    is ProjectionExpr.Col -> "${expr.tableAlias}.${dialect.quoteIdent(expr.columnName)}"
                    is ProjectionExpr.Agg -> expr.outputAlias  // Phase 5
                }
            }
        }

        // HAVING
        val havingClause = ast.having?.let { "HAVING ${buildColumnPredicate(it)}" } ?: ""

        // ORDER BY
        val orderClause = if (ast.orderBy.isEmpty()) "" else {
            "ORDER BY " + ast.orderBy.joinToString(", ") {
                "${it.tableAlias}.${dialect.quoteIdent(it.column)} ${it.dir.name}"
            }
        }

        // LIMIT/OFFSET
        val limitClause = buildLimitOffset(ast.limit, ast.offset)

        val distinct = if (ast.distinct) "DISTINCT " else ""
        val sql = listOf(
            selectClause.replaceFirst("SELECT ", "SELECT $distinct"),
            "FROM $fromSql", joinsSql,
            whereClause, groupByClause, havingClause, orderClause, limitClause
        ).filter { it.isNotBlank() }.joinToString(" ")

        return BuiltSql(sql, args.toList())
    }

    fun buildCount(ast: SelectAst): BuiltSql {
        reset()
        if (ast.groupBy.isEmpty()) {
            // 无 GROUP BY → 直接 COUNT(*)
            // 复用 FROM/JOIN/WHERE 生成逻辑，SELECT 替换为 COUNT(*)
            val fromJoinWhere = buildFromJoinWhere(ast)
            return BuiltSql("SELECT COUNT(*) $fromJoinWhere", args.toList())
        } else {
            // 有 GROUP BY → 子查询包裹（原则 14）
            // 否则 COUNT(*) 返回的是分组后的条数，不是总行数
            val innerSql = buildSelect(ast.copy(limit = null, offset = null)).sql
            return BuiltSql("SELECT COUNT(*) FROM ($innerSql) AS tmp", args.toList())
        }
    }

    private fun buildColumnPredicate(p: ColumnPredicate): String = when (p) {
        is ColumnPredicate.Eq -> {
            "${p.tableAlias}.${dialect.quoteIdent(p.column)} = ${addArg(p.value)}"
        }
        is ColumnPredicate.Ne -> {
            "${p.tableAlias}.${dialect.quoteIdent(p.column)} != ${addArg(p.value)}"
        }
        is ColumnPredicate.Like -> {
            dialect.likeExpression(
                "${p.tableAlias}.${dialect.quoteIdent(p.column)}",
                addArg(p.value)
            )
        }
        is ColumnPredicate.In -> {
            if (p.values.isEmpty()) "1 = 0"
            else "${p.tableAlias}.${dialect.quoteIdent(p.column)} IN (${p.values.map { addArg(it) }.joinToString(", ")})"
        }
        is ColumnPredicate.IsNull -> "${p.tableAlias}.${dialect.quoteIdent(p.column)} IS NULL"
        is ColumnPredicate.IsNotNull -> "${p.tableAlias}.${dialect.quoteIdent(p.column)} IS NOT NULL"
        is ColumnPredicate.Between -> {
            val lo = addArg(p.low); val hi = addArg(p.high)
            "${p.tableAlias}.${dialect.quoteIdent(p.column)} BETWEEN $lo AND $hi"
        }
        is ColumnPredicate.Gt -> "${p.tableAlias}.${dialect.quoteIdent(p.column)} > ${addArg(p.value)}"
        is ColumnPredicate.Ge -> "${p.tableAlias}.${dialect.quoteIdent(p.column)} >= ${addArg(p.value)}"
        is ColumnPredicate.Lt -> "${p.tableAlias}.${dialect.quoteIdent(p.column)} < ${addArg(p.value)}"
        is ColumnPredicate.Le -> "${p.tableAlias}.${dialect.quoteIdent(p.column)} <= ${addArg(p.value)}"
        is ColumnPredicate.And -> p.children.joinToString(" AND ") { "(${buildColumnPredicate(it)})" }
        is ColumnPredicate.Or -> p.children.joinToString(" OR ") { "(${buildColumnPredicate(it)})" }
        is ColumnPredicate.True -> "1 = 1"
    }
}
```

### 3.5 一对多聚合 Helper

```kotlin
package neton.database.api

/** 从多行结果中提取一对多关系（显式 key 去重）*/
inline fun <T, R, K> List<Row>.firstOneToMany(
    one: (Row) -> T,
    many: (Row) -> R?,
    manyKey: (R) -> K           // 显式 key 去重，不依赖 equals
): Pair<T, List<R>>? {
    if (isEmpty()) return null
    val entity = one(first())
    val related = mapNotNull(many).distinctBy(manyKey)
    return entity to related
}

/** 按 key 分组后提取一对多 */
inline fun <K, T, R, RK> List<Row>.groupOneToMany(
    key: (Row) -> K,
    one: (Row) -> T,
    many: (Row) -> R?,
    manyKey: (R) -> RK          // 显式 key 去重
): List<Pair<T, List<R>>> {
    return groupBy(key).map { (_, rows) ->
        val entity = one(rows.first())
        val related = rows.mapNotNull(many).distinctBy(manyKey)
        entity to related
    }
}
```

### 3.6 执行链冻结（C+ 统一执行门面）

本节冻结 NetonSQL v2 的执行链模型。
目标：在不破坏 Phase 1 API 的前提下，实现 Phase 1 / Phase 4 的统一执行入口，
为多租户、数据权限、慢 SQL 统计、监控埋点等能力预留稳定扩展点。

---

#### 3.6.1 DbContext —— 唯一执行门面（冻结）

**1️⃣ 定位**

DbContext 是 NetonSQL 的统一执行门面（execution gateway）。
- Phase 1（单表 CRUD / QueryAst）
- Phase 4（JOIN / SelectAst）

所有 SQL 执行必须通过 DbContext 进行。

**禁止**：
- SqlBuilder 直接触发数据库执行
- Table / Adapter 直接调用底层 driver
- 全局单例执行器（如 SelectExecutor）

SelectExecutor 在 v2 中彻底移除。
统一执行路径由 DbContext 承担。

---

**2️⃣ 冻结接口定义**

```kotlin
interface DbContext {

    /** 执行查询（Phase 1 + Phase 4 统一入口） */
    suspend fun query(built: BuiltSql): List<Row>

    /** 执行更新（INSERT / UPDATE / DELETE） */
    suspend fun execute(built: BuiltSql): Long

    /** 事务边界 */
    suspend fun <R> transaction(block: suspend DbContext.() -> R): R

    /** Interceptor 链（只读） */
    val interceptors: List<QueryInterceptor>

    /** Phase 4 JOIN 入口 */
    fun <T : Any> from(table: Table<T, *>): Pair<SelectBuilder, TableRef<T>>
}
```

---

**3️⃣ 冻结职责**

DbContext 必须承担以下职责：

| 职责 | 说明 |
|------|------|
| SQL 执行 | 统一调用底层 driver（如 sqlx4k） |
| 事务控制 | transaction 作为唯一事务边界 |
| 拦截链调度 | 在执行前后调用 QueryInterceptor |
| 错误传播 | 统一错误模型 |
| 未来扩展点 | 多租户、数据权限、慢 SQL、Metrics |

---

**4️⃣ 执行流程（冻结四步链路）**

任何查询执行必须遵循以下链路：

1. 构建 AST（QueryAst / SelectAst）
2. 进入 DbContext
3. 触发 Interceptor.beforeXxx(ast)（可改写 AST）
4. SqlBuilder.build(ast) → BuiltSql(sql, args)
5. 调用底层 driver 执行
6. 记录耗时
7. 触发 Interceptor.onExecute / onError
8. 返回 Row 或映射结果

---

**5️⃣ Phase 1 与 Phase 4 的统一要求（冻结）**

| 场景 | 必须行为 |
|------|----------|
| Table.query() | 内部执行必须调用 DbContext.query() |
| SqlxTableAdapter | 不得直接触发 driver |
| ProjectedSelect | 内部必须调用 DbContext.query() |
| TypedProjection | 内部必须调用 DbContext.query() |

**冻结原则**：执行统一，API 稳定。

外部 API（如 `SystemUserTable.query {}`）保持不变，
但内部必须走 DbContext 执行链。

---

#### 3.6.2 QueryInterceptor —— 冻结扩展点

**1️⃣ 定位**

QueryInterceptor 是 NetonSQL 的唯一 AST 改写与执行观测扩展点。

它用于：
- 多租户注入
- 数据权限注入
- 软删除自动注入
- SQL 执行日志
- 慢 SQL 统计
- Metrics 埋点

---

**2️⃣ 冻结接口定义**

```kotlin
interface QueryInterceptor {

    /** Phase 1 单表查询改写入口 */
    fun beforeQuery(ast: QueryAst<*>): QueryAst<*> = ast

    /** Phase 4 JOIN 查询改写入口 */
    fun beforeSelect(ast: SelectAst): SelectAst = ast

    /** 执行成功后观测（只读，不可修改结果） */
    fun onExecute(sql: String, args: List<Any?>, elapsedMs: Long) {}

    /** 执行异常观测 */
    fun onError(sql: String, args: List<Any?>, error: Throwable) {}
}
```

---

**3️⃣ 明确排除（冻结）**

以下能力 **不属于** v2 设计范围：
- ❌ 不允许 `afterFetch(List<T>)` 这种结果改写钩子
- ❌ 不允许在拦截器中修改返回数据
- ❌ 不允许在拦截器中执行额外 SQL

**设计原则**：
Interceptor 只负责 AST 改写和执行观测，不参与业务逻辑。

---

**4️⃣ 冻结拦截顺序**

执行顺序固定为：

```
beforeQuery / beforeSelect
→ SqlBuilder.build()
→ driver.execute()
→ onExecute / onError
```

拦截器按注册顺序执行。

---

#### 3.6.3 SelectExecutor 移除声明（冻结）

v2 中不再存在 SelectExecutor 全局对象。

**原因**：
1. ❌ 不符合 KMP Native 架构（无全局连接上下文）
2. ❌ 无法正确管理事务边界
3. ❌ 无法提供统一拦截链
4. ❌ 阻断未来多租户 / 观测扩展

所有执行必须经由 DbContext。

---

#### 3.6.4 架构稳定性声明

此执行模型保证：
- Phase 1 与 Phase 4 执行路径统一
- 事务边界统一
- 扩展点统一
- 未来能力（多租户 / 数据权限 / SQL cache）可在 AST 层扩展
- 不需要推翻现有 API

---

#### 3.6.5 C+ 冻结结论

| 项目 | 状态 |
|------|------|
| Table API | 保持稳定 |
| DbContext | 统一执行门面 |
| QueryInterceptor | 冻结扩展接口 |
| SelectExecutor | 删除 |
| 未来扩展 | 可持续 |

---

#### 3.6.6 实现细节（保留原 spec 内容）

##### DbContext 新增方法

```kotlin
interface DbContext {
    // Phase 1 保留（raw SQL 逃生口，不变）
    suspend fun fetchAll(sql: String, params: Map<String, Any?> = emptyMap()): List<Row>
    suspend fun fetchOne(sql: String, params: Map<String, Any?> = emptyMap()): Row?
    suspend fun execute(sql: String, params: Map<String, Any?> = emptyMap()): Long

    // Phase 4 新增：JOIN 查询入口（替代原顶层 from 函数，绑定执行上下文）
    fun <T : Any> from(table: Table<T, *>): Pair<SelectBuilder, TableRef<T>>
}

// module-internal：仅供 ProjectedSelect / TypedProjectedSelectN 调用，不对外暴露
internal suspend fun DbContext.selectRows(ast: SelectAst): List<Row>
internal suspend fun DbContext.countRows(ast: SelectAst): Long
```

> **迁移**：原顶层 `fun <T : Any> from(table: Table<T, *>)` 标 `@Deprecated`，迁移为 `db.from(table)`，迁移完成后删除。

##### SelectBuilder 改造（绑定 DbContext）

```kotlin
class SelectBuilder internal constructor(
    internal val db: DbContext    // ★ 改造：绑定执行上下文，由 DbContext.from() 注入
) {
    // ...（alias 分配、join/where/orderBy/groupBy/limit 等不变）...

    // Row 逃生口（适合 into / intoOrNull / groupOneToMany 自定义映射）
    fun selectRows(vararg cols: ColRef<*, *>): ProjectedSelect =
        ProjectedSelect(db, buildAst(cols.map { ProjectionExpr.Col(it.alias, it.columnName) }))

    fun selectAllRows(): ProjectedSelect = ProjectedSelect(db, buildAst(emptyList()))

    // Phase 4 typed projection（基于 ColRef，与 Phase 3 路径 A 风格对齐）
    fun <A> select(c1: ColRef<*, A>): TypedProjectedSelect1<A>
    fun <A, B> select(c1: ColRef<*, A>, c2: ColRef<*, B>): TypedProjectedSelect2<A, B>
    fun <A, B, C> select(
        c1: ColRef<*, A>, c2: ColRef<*, B>, c3: ColRef<*, C>
    ): TypedProjectedSelect3<A, B, C>
    // ... 到 8 列
}
```

##### ProjectedSelect（Row 逃生口，绑定 DbContext）

```kotlin
class ProjectedSelect internal constructor(
    private val db: DbContext,
    private val ast: SelectAst
) {
    /** Row 逃生口：适合 intoOrNull / into / groupOneToMany 手动映射 */
    suspend fun fetchRows(): List<Row> = db.selectRows(ast)
    suspend fun count(): Long = db.countRows(ast)
    suspend fun pageRows(page: Int, size: Int): Page<Row> {
        val total = count()
        val items = db.selectRows(ast.copy(limit = size, offset = (page - 1) * size))
        return Page(items, total, page, size)
    }
}
```

##### TypedProjectedSelect（Phase 4 JOIN 强类型投影，以 Rec2 为例，其余 N 形态一致）

```kotlin
class TypedProjectedSelect2<A, B> internal constructor(
    private val db: DbContext,
    private val ast: SelectAst,
    private val read1: (Row) -> A,   // 编译期由 ColRef 类型确定，不依赖运行时反射
    private val read2: (Row) -> B
) {
    suspend fun fetch(): List<Record2<A, B>> =
        db.selectRows(ast).map { Record2(read1(it), read2(it)) }
    suspend fun count(): Long = db.countRows(ast)
    suspend fun page(page: Int, size: Int): Page<Record2<A, B>> {
        val total = count()
        val items = db.selectRows(ast.copy(limit = size, offset = (page - 1) * size))
                      .map { Record2(read1(it), read2(it)) }
        return Page(items, total, page, size)
    }
}
```

`SelectBuilder.select()` 在构建期绑定读取器（以 2 列为例）：

```kotlin
fun <A, B> select(c1: ColRef<*, A>, c2: ColRef<*, B>): TypedProjectedSelect2<A, B> {
    val key1 = "${c1.alias}_${c1.columnName}"
    val key2 = "${c2.alias}_${c2.columnName}"
    return TypedProjectedSelect2(
        db  = db,
        ast = buildAst(listOf(
            ProjectionExpr.Col(c1.alias, c1.columnName),
            ProjectionExpr.Col(c2.alias, c2.columnName)
        )),
        read1 = { row -> row.readQualified(key1, c1.column) },
        read2 = { row -> row.readQualified(key2, c2.column) }
    )
}
```

`readQualified` 见附录 A §A.5。

##### 两条投影路径（冻结）

| 路径 | 场景 | DSL | 返回类型 |
|------|------|-----|----------|
| **路径 A**（Phase 3） | 单表 typed projection | `EntityQuery.select(T::a, T::b)` | `List<Record2<A, B>>` |
| **路径 B**（Phase 4） | JOIN typed projection | `q.select(U[SystemUser::id], R[Role::name])` | `List<Record2<A, B>>` |
| **逃生口** | JOIN + 自定义映射 | `q.selectRows(...).fetchRows()` | `List<Row>` |

**说明**：Phase 4 JOIN 投影不退化为 `Row`。路径 B 是正式路径；`fetchRows()` / `pageRows()` 是逃生口，适合 `groupOneToMany` 等手动映射场景。

---

**🔒 冻结声明**

NetonSQL v2 执行链模型自本版本起冻结。
- 不允许新增绕过 DbContext 的执行路径
- 不允许新增全局 SQL 执行单例
- 不允许在 DSL 之外拼接 SQL

所有扩展必须基于：
- SelectAst
- QueryAst
- DbContext
- QueryInterceptor

---

## 四、完整使用示例

### 4.1 单表查询（Phase 1 写法不变，Phase 2 内部增强）

```kotlin
// 用户写法完全不变 —— KProperty1 是单表主路径
val page = SystemUserTable.query {
    where {
        and(
            whenNotBlank(username) { SystemUser::username like "%$it%" },
            whenPresent(status) { SystemUser::status eq it }
        )
    }
    orderBy(SystemUser::createdAt.desc())
}.page(1, 20)
```

### 4.2 单表投影（Phase 3）

```kotlin
// 使用 KProperty1 做 typed select
val records: List<Record2<Long?, String>> = SystemUserTable.query {
    where { SystemUser::status eq 1 }
}.select(SystemUser::id, SystemUser::username).fetch()

records.forEach { println("id=${it.v1}, name=${it.v2}") }
```

### 4.3 JOIN 查询（Phase 4）

```kotlin
// ✅ from 通过 DbContext 调用（不再是顶层函数）
val db: DbContext = ctx.get(DbContext::class)
val (q, U) = db.from(SystemUserTable)                                            // t1
val UR = q.leftJoin(UserRoleTable).on { U[SystemUser::id] eq it[UserRole::userId] }  // t2
val R  = q.leftJoin(RoleTable).on { UR[UserRole::roleId] eq it[Role::id] }           // t3

val condition = allOf(
    U[SystemUser::status] eq 1,
    whenNotBlank(keyword) { U[SystemUser::username] like "%$it%" }
)

// --- 路径 B：JOIN typed projection（强类型，正式路径）---
val page: Page<Record4<Long?, String, Long?, String>> = q
    .where(condition)
    .select(U[SystemUser::id], U[SystemUser::username], R[Role::id], R[Role::name])
    .page(1, 20)

// --- 逃生口：Row + 一对多聚合（手动映射场景）---
val rows: Page<Row> = q
    .where(condition)
    .selectRows(U[SystemUser::id], U[SystemUser::username], R[Role::id], R[Role::name])
    .pageRows(1, 20)

rows.items.groupOneToMany(
    key     = { it.get(U, SystemUser::id) },
    one     = { it.into<SystemUser>() },
    many    = { it.intoOrNull<Role>("t3_", Role::id) },
    manyKey = { it.id }
)
```

> **生成的 SQL**（用户不关心）：
> ```sql
> SELECT t1."id" AS t1_id, t1."username" AS t1_username,
>        t3."id" AS t3_id, t3."name" AS t3_name
> FROM "system_users" AS t1
> LEFT JOIN "user_roles" AS t2 ON t1."id" = t2."user_id"
> LEFT JOIN "roles" AS t3 ON t2."role_id" = t3."id"
> WHERE t1."status" = $1 AND t1."username" LIKE $2
> LIMIT $3 OFFSET $4
> ```

### 4.4 raw SQL 逃生口（始终可用）

```kotlin
// Logic 层使用 DbContext 逃生口（80% 用 DSL，20% 特殊查询走 raw SQL）
class UserLogic(private val db: DbContext = dbContext()) : DbContext by db {
    suspend fun getWithRolesRaw(userId: Long): UserWithRoles? {
        val sql = """
            SELECT u.id, u.username, u.nickname,
                   r.id AS role_id, r.name AS role_name
            FROM system_users u
            LEFT JOIN user_roles ur ON ur.user_id = u.id
            LEFT JOIN roles r ON r.id = ur.role_id
            WHERE u.id = :uid
        """.trimIndent()
        val rows = fetchAll(sql, mapOf("uid" to userId))
        val (user, roles) = rows.firstOneToMany(
            one = { it.into<SystemUser>() },
            many = { it.intoOrNull<Role>("role_", Role::id) },
            manyKey = { it.id }
        ) ?: return null
        return UserWithRoles(user, roles)
    }
}
```

---

## 五、KSP 生成物总览

对每个 `@Table` 实体（以 `SystemUser` 为例），KSP 生成：

| 文件 | Phase | 可见性 | 内容 |
|------|-------|--------|------|
| `SystemUserMeta.kt` | 1 | internal | `EntityMeta<SystemUser>` — 表名、列名、类型 |
| `SystemUserRowMapper.kt` | 1 | internal | sqlx4k `RowMapper<SystemUser>` — ResultSet.Row → Entity |
| `SystemUserTable.kt` | 1 | **public** | `Table<SystemUser, Long> by SqlxTableAdapter` — CRUD 操作 |
| `SystemUserExtensions.kt` | 1 | public | `update(id){ }` + `save()` + `delete()` 扩展 |
| **`SystemUserTableDef.kt`** | **2** | **internal** | **`TableDef<SystemUser>` — KProperty → Column 精确映射** |
| **`SystemUserEntityMapper.kt`** | **3** | **internal** | **`EntityMapper<SystemUser>` — Neton Row → Entity** |

---

## 六、文件结构

```
neton-database/src/commonMain/kotlin/neton/database/
├── annotations/
│   └── DatabaseAnnotations.kt           # 不变
├── api/
│   ├── Table.kt                          # 不变
│   ├── EntityMeta.kt                     # 不变
│   ├── EntityQuery.kt                    # Phase 1 保留 + Phase 3 新增 typed select
│   ├── DbContext.kt                      # ★ Phase 4 扩展：新增 from() / selectRows() / countRows()
│   ├── Row.kt                            # ★ 附录 A：Row 接口定义
│   ├── Page.kt                           # 不变
│   ├── AutoFill.kt                       # 不变
│   ├── SoftDeleteConfig.kt               # 不变
│   ├── EntityMapper.kt                   # ★ Phase 3：EntityMapper + Registry
│   └── PrefixedRow.kt                    # ★ Phase 3：前缀 Row 包装
├── dsl/
│   ├── Column.kt                         # ★ Phase 2：Column<T, V> + ColumnType (internal)
│   ├── TableDef.kt                       # ★ Phase 2：TableDef<T> (internal)
│   ├── TableRef.kt                       # ★ Phase 2：TableRef<T> + ColRef<T, V>
│   ├── ColRefOperators.kt                # ★ Phase 2：ColRef 运算符
│   ├── ColumnPredicate.kt                # ★ Phase 2：v2 谓词 AST
│   ├── ColumnOrdering.kt                 # ★ Phase 2：排序 + Dir 枚举
│   ├── ConditionHelpers.kt               # ★ Phase 2：whenPresent/allOf/anyOf
│   ├── SelectAst.kt                      # ★ Phase 4：多表查询 AST
│   ├── SelectBuilder.kt                  # ★ Phase 4：流式构建器（auto alias，绑定 DbContext）
│   ├── ProjectedSelect.kt                # ★ Phase 4：Row 逃生口执行对象
│   ├── TypedProjectedSelect.kt           # ★ Phase 4：TypedProjectedSelect1~8
│   ├── JoinTypes.kt                      # ★ Phase 4：JoinClause / JoinCondition / JoinType 枚举
│   ├── Record.kt                         # ★ Phase 3：Record1~8
│   ├── AggregateHelpers.kt               # ★ Phase 4：firstOneToMany/groupOneToMany
│   ├── TableDefRegistry.kt               # ★ Phase 2：Table → TableDef 查找
│   ├── ColumnRef.kt                      # Phase 1 保留
│   ├── Predicate.kt                      # Phase 1 保留
│   ├── PredicateScope.kt                 # Phase 1 保留
│   ├── QueryScope.kt                     # Phase 1 保留（内部 resolve 改为 KSP 映射）
│   ├── QueryAst.kt                       # Phase 1 保留
│   └── Ordering.kt                       # Phase 1 保留
├── sql/
│   ├── SqlBuilder.kt                     # Phase 1 保留 + Phase 4 扩展（buildSelect/buildCount SelectAst）
│   ├── Dialect.kt                        # 不变
│   └── BuiltSql.kt                       # 不变
└── adapter/sqlx/                          # 不变（DbContext 实现在此层，调用 SqlBuilder + sqlx4k）
```

---

## 七、实施计划

### Phase 2 交付物

| 任务 | 产出 |
|------|------|
| 定义 `Column<T, V>` (internal) | `dsl/Column.kt` |
| 定义 `TableDef<T>` (internal) | `dsl/TableDef.kt` |
| 定义 `TableRef<T>` + `ColRef<T, V>` | `dsl/TableRef.kt` |
| 定义 `ColumnPredicate` | `dsl/ColumnPredicate.kt` |
| 实现 ColRef 运算符 | `dsl/ColRefOperators.kt` |
| 实现 `ColumnOrdering` | `dsl/ColumnOrdering.kt` |
| 实现条件辅助函数 | `dsl/ConditionHelpers.kt` |
| 实现 `TableDefRegistry` | `dsl/TableDefRegistry.kt` |
| KSP 生成 `<Entity>TableDef` (internal) | `EntityTableProcessor` 扩展 |
| Phase 1 `toColumnRef()` 内部改为 KSP 映射 | `dsl/ColumnRef.kt` 修改 |
| contract tests | 列映射精确、运算符类型安全 |

**验收**：
- `SystemUser::username like "%x%"` 内部走 KSP 映射（不再 runtime regex）
- `TableRef[SystemUser::id] eq value` 编译通过

### Phase 3 交付物

| 任务 | 产出 |
|------|------|
| 定义 Record1~8 | `dsl/Record.kt` |
| 定义 `EntityMapper<T>` + Registry | `api/EntityMapper.kt` |
| 实现 `PrefixedRow` | `api/PrefixedRow.kt` |
| KSP 生成 `<Entity>EntityMapper` (internal) | `EntityTableProcessor` 扩展 |
| `Row.into<T>()` / `into<T>(prefix)` / `intoOrNull<T>(prefix)` | 扩展函数 |
| `EntityQuery` 新增 typed select（KProperty1） | `api/EntityQuery.kt` 修改 |
| contract tests | 映射正确、prefix 正确、intoOrNull null 检测 |

**验收**：
- `row.into<SystemUser>()` 正确映射
- `row.intoOrNull<Role>("role_", Role::id)` LEFT JOIN 未命中返回 null
- `select(SystemUser::id, SystemUser::username).fetch()` 返回 `List<Record2<Long?, String>>`

### Phase 4 交付物

| 任务 | 产出 |
|------|------|
| 定义 `SelectAst` / `JoinClause` / `JoinCondition` / `ProjectionExpr` | `dsl/SelectAst.kt`, `dsl/JoinTypes.kt` |
| 定义 `JoinType` / `Dir` 枚举 | `dsl/JoinTypes.kt`, `dsl/ColumnOrdering.kt` |
| 实现 `SelectBuilder`（auto alias t1/t2/t3，绑定 DbContext） | `dsl/SelectBuilder.kt` |
| `DbContext` 新增 `from()` / `selectRows()` / `countRows()` | `api/DbContext.kt` 修改 |
| 实现 `ProjectedSelect`（Row 逃生口，绑定 DbContext） | `dsl/ProjectedSelect.kt` |
| 实现 `TypedProjectedSelect1~8`（ColRef typed projection） | `dsl/TypedProjectedSelect.kt` |
| `SqlBuilder` 扩展 `buildSelect(SelectAst)` + `buildCount(SelectAst)` | `sql/SqlBuilder.kt` 修改 |
| 实现聚合 helper（显式 key 去重） | `dsl/AggregateHelpers.kt` |
| 顶层 `from()` 函数标 `@Deprecated`，引导迁移到 `db.from()` | `dsl/SelectBuilder.kt` |
| examples: User/Role/UserRole JOIN | 示例更新 |
| contract tests | JOIN SQL、alias、count 同源、typed projection、DbContext 绑定 |

**验收**：
- `db.from(SystemUserTable).leftJoin(RoleTable).on(...).where(...).select(...).fetch()` 生成正确 SQL
- `db.from()` 绑定 db，执行不经过任何全局静态对象
- `q.select(U[SystemUser::id], R[Role::name]).fetch()` 返回 `List<Record2<Long?, String>>`
- `page().total == count()`（同源验证）
- PG `$1/$2` / MySQL `?` 占位符正确

---

## 八、Contract Tests 清单

### Phase 2

| # | 测试 | 验证点 |
|---|------|--------|
| 1 | `SystemUser::passwordHash` → `"password_hash"` | KSP 映射精确，非 runtime regex |
| 2 | `ColRef<T, String>.like` 编译通过 | 类型约束 |
| 3 | `ColRef<T, Int>.like` 编译失败 | 非 String 列不可 like |
| 4 | `ColRef eq value` 类型 V 必须匹配 | 强类型 |
| 5 | `ColRef<T,V> eq ColRef<R,V>` JOIN 条件类型匹配 | 跨表类型安全 |
| 6 | allOf 过滤 True | `allOf(True, Eq(...))` = `Eq(...)` |
| 7 | whenPresent null → True | 条件忽略 |
| 8 | 两表同名列 `t1.id` vs `t3.id` 不冲突 | alias 区分 |

### Phase 3

| # | 测试 | 验证点 |
|---|------|--------|
| 1 | `select(SystemUser::id, SystemUser::username)` 返回 `Record2<Long?, String>` | 类型正确 |
| 2 | `Row.into<SystemUser>()` 全字段映射 | EntityMapper 正确 |
| 3 | `Row.into<Role>("role_")` 前缀映射 | PrefixedRow 正确 |
| 4 | `Row.intoOrNull<Role>("role_", Role::id)` role_id 为 null → 返回 null | 存在性检测（显式 pk） |
| 5 | `Row.intoOrNull<Role>("role_", Role::id)` role_id 非 null → 返回 Role | 正常映射 |
| 6 | Registry 未注册时抛明确异常 | 错误信息含类名 |

### Phase 4

| # | 测试 | 验证点 |
|---|------|--------|
| 1 | `db.from().leftJoin().on().where().selectRows()` → SQL | 正确 JOIN SQL，执行通过 DbContext |
| 2 | alias 稳定分配 t1/t2/t3 | 按 join 顺序 |
| 3 | `pageRows().total == count()` | JOIN + WHERE 同源 |
| 4 | JOIN + LIMIT/OFFSET | SQL 正确 |
| 5 | firstOneToMany + manyKey 去重 | 一对多正确 |
| 6 | groupOneToMany + manyKey 去重 | 多组正确 |
| 7 | PG 占位符 `$1/$2` | Dialect 正确 |
| 8 | MySQL 占位符 `?` | Dialect 正确 |
| 9 | ON 条件 `t1."id" = t2."user_id"` | Dialect quoteIdent |
| 10 | `JOIN + WHERE + IN` 占位符与 args 顺序一致 | 参数绑定正确 |
| 11 | INNER/LEFT/RIGHT JOIN 关键字 | SQL 正确 |
| 12 | SELECT 投影列自动加 AS：`t1."id" AS t1_id` | 原则 13，Row.get 列名匹配 |
| 13 | `Row.get(U, SystemUser::id)` 通过 `t1_id` 列名取值 | 强类型取值 + alias 列名 |
| 14 | COUNT + GROUP BY → `SELECT COUNT(*) FROM (...) AS _count_tmp` | 原则 14，子查询包裹 |
| 15 | COUNT 无 GROUP BY → `SELECT COUNT(*)` 直接 | 无子查询开销 |
| 16 | `Row.get(U, SystemUser::id)` 使用裸列名 `"id"` → 抛异常/编译失败 | 原则 17，禁止 fallback 裸列名 |
| 17 | `TableDefRegistry.find(prop)` 标 @Deprecated | 原则 15 加固，正式路径走 resolve(klass, prop) |
| 18 | `db.from(SystemUserTable)` 返回 `SelectBuilder` 持有 db 引用 | DbContext 绑定，不经全局静态对象 |
| 19 | `q.select(U[SystemUser::id], R[Role::name]).fetch()` 返回 `List<Record2<Long?, String>>` | 路径 B typed projection |
| 20 | `q.select(...).page(1, 20)` 返回 `Page<Record2<...>>` | 路径 B 分页 typed projection |
| 21 | `q.selectRows(...).fetchRows()` 返回 `List<Row>` | 逃生口路径正常 |
| 22 | `readQualified` 按 ColumnType dispatch，不走 JVM 反射 | KMP Native 安全 |

---

## 九、Phase 5（Future，不在本 spec 范围）

- 聚合函数（`count()`, `sum()`, `max()`, `min()`, `avg()`）
- `having` 支持聚合函数谓词
- 子查询（`subquery`）
- `UNION` / `INTERSECT`
- `selectInto<UserLite>(...)` KSP 生成 DTO projection
- Schema migration 工具
- `@Version` 乐观锁

---

## 附录 A：基础类型定义

> 补齐正文引用但未单独定义的基础类型，以及对 Phase 2 `Column` 的一处修订。

### A.1 Row 接口

```kotlin
package neton.database.api

/**
 * 单行查询结果。
 * 列名规则：按 SQL 输出列名原样匹配，大小写统一 lowercase（驱动层负责转换）。
 * JOIN 场景列名为 {alias}_{columnName}（原则 13），如 t1_id / t2_user_id。
 *
 * 存在性检测：通过 stringOrNull(name) == null 判断列是否为 null（intoOrNull 依赖此行为）。
 * 不引入 hasColumn() 方法，避免驱动层 API 依赖。
 */
interface Row {
    // 非 null 读取（列不存在或值为 null 时抛异常）
    fun long(name: String): Long
    fun int(name: String): Int
    fun string(name: String): String
    fun double(name: String): Double
    fun boolean(name: String): Boolean
    fun bytes(name: String): ByteArray

    // 可 null 读取（列不存在或值为 null 时返回 null）
    fun longOrNull(name: String): Long?
    fun intOrNull(name: String): Int?
    fun stringOrNull(name: String): String?
    fun doubleOrNull(name: String): Double?
    fun booleanOrNull(name: String): Boolean?
    fun bytesOrNull(name: String): ByteArray?
}
```

> **列名大小写冻结**：框架内部全部使用 lowercase 列名。驱动适配层（`adapter/sqlx/`）在构造 `Row` 时统一转 lowercase，上层代码不感知大小写差异。

### A.2 Dir 枚举

```kotlin
package neton.database.dsl

enum class Dir { ASC, DESC }
```

### A.3 JoinType 枚举

```kotlin
package neton.database.dsl

enum class JoinType { INNER, LEFT, RIGHT, FULL }
```

### A.4 Column 修订：新增 ColumnType（Phase 2 §1.1 补丁）

> **修订原因**：`TypedProjectedSelectN` 的 `read1 / read2` 需要在运行时按列类型从 `Row` 读取值；
> KMP Native 不可用 JVM 反射（`KClass.java`），必须由 KSP 编译期确定类型标记，O(1) dispatch。

```kotlin
package neton.database.dsl

/**
 * 列的基础类型标记（KSP 生成时确定，readQualified dispatch 用）。
 * 不在此枚举中的复杂类型（JSON、枚举映射等）通过 EntityMapper 手动处理。
 */
enum class ColumnType { LONG, INT, STRING, DOUBLE, BOOLEAN, BYTES }

/**
 * 强类型列引用（internal）—— Phase 2 §1.1 更新版本。
 * 新增 type: ColumnType 和 nullable: Boolean，供 readQualified dispatch 使用。
 */
internal class Column<T : Any, V>(
    val tableDef: TableDef<T>,
    val columnName: String,
    val propertyName: String,
    val type: ColumnType,      // ★ 新增：KSP 编译期确定
    val nullable: Boolean      // ★ 新增：对应 V 是否为可 null 类型
)
```

KSP 生成物对应更新（以 `SystemUserTableDef` 为例）：

```kotlin
val id           = Column<SystemUser, Long?>(this, "id",            "id",           ColumnType.LONG,   nullable = true)
val username     = Column<SystemUser, String>(this, "username",     "username",     ColumnType.STRING, nullable = false)
val passwordHash = Column<SystemUser, String>(this, "password_hash","passwordHash", ColumnType.STRING, nullable = false)
val status       = Column<SystemUser, Int>(this, "status",          "status",       ColumnType.INT,    nullable = false)
val createdAt    = Column<SystemUser, Long>(this, "created_at",     "createdAt",    ColumnType.LONG,   nullable = false)
// ...
```

### A.5 readQualified（internal 扩展）

```kotlin
package neton.database.api

import neton.database.dsl.Column
import neton.database.dsl.ColumnType

/**
 * 按列元数据从 Row 读取值，供 TypedProjectedSelectN 的 read 函数使用。
 * 运行时 dispatch 基于 ColumnType，不依赖 JVM 反射（KMP Native 安全）。
 *
 * qualifiedName = "{alias}_{columnName}"（原则 13 的别名规则）。
 */
@Suppress("UNCHECKED_CAST")
internal fun <V> Row.readQualified(qualifiedName: String, column: Column<*, V>): V =
    if (column.nullable) readQualifiedOrNull(qualifiedName, column) as V
    else when (column.type) {
        ColumnType.LONG    -> long(qualifiedName)
        ColumnType.INT     -> int(qualifiedName)
        ColumnType.STRING  -> string(qualifiedName)
        ColumnType.DOUBLE  -> double(qualifiedName)
        ColumnType.BOOLEAN -> boolean(qualifiedName)
        ColumnType.BYTES   -> bytes(qualifiedName)
    } as V

@Suppress("UNCHECKED_CAST")
internal fun <V> Row.readQualifiedOrNull(qualifiedName: String, column: Column<*, V>): V? =
    when (column.type) {
        ColumnType.LONG    -> longOrNull(qualifiedName)
        ColumnType.INT     -> intOrNull(qualifiedName)
        ColumnType.STRING  -> stringOrNull(qualifiedName)
        ColumnType.DOUBLE  -> doubleOrNull(qualifiedName)
        ColumnType.BOOLEAN -> booleanOrNull(qualifiedName)
        ColumnType.BYTES   -> bytesOrNull(qualifiedName)
    } as V?
```

### A.6 SqlBuilder 私有方法分解（替代未定义的 buildFromJoinWhere）

原 `buildCount(SelectAst)` 引用了未定义的私有方法 `buildFromJoinWhere(ast)`，现拆分为三个独立私有方法，`buildCount` 直接复用：

```kotlin
// SqlBuilder 内部（以下均为 private）

private fun buildFrom(ast: SelectAst): String =
    "${dialect.quoteIdent(ast.fromTable)} AS ${ast.fromAlias}"

private fun buildJoins(ast: SelectAst): String =
    ast.joins.joinToString(" ") { join ->
        val keyword = when (join.type) {
            JoinType.INNER -> "INNER JOIN"; JoinType.LEFT  -> "LEFT JOIN"
            JoinType.RIGHT -> "RIGHT JOIN"; JoinType.FULL  -> "FULL JOIN"
        }
        val on = "${join.on.leftAlias}.${dialect.quoteIdent(join.on.leftColumn)} = " +
                 "${join.on.rightAlias}.${dialect.quoteIdent(join.on.rightColumn)}"
        "$keyword ${dialect.quoteIdent(join.targetTableName)} AS ${join.targetAlias} ON $on"
    }

private fun buildWhere(predicate: ColumnPredicate?): String =
    predicate?.let { "WHERE ${buildColumnPredicate(it)}" } ?: ""

// buildCount 重写（清晰引用私有方法，不再有未定义引用）
fun buildCount(ast: SelectAst): BuiltSql {
    reset()
    return if (ast.groupBy.isEmpty()) {
        val parts = listOf(
            "SELECT COUNT(*)",
            "FROM ${buildFrom(ast)}",
            buildJoins(ast),
            buildWhere(ast.where)
        )
        BuiltSql(parts.filter { it.isNotBlank() }.joinToString(" "), args.toList())
    } else {
        // 有 GROUP BY → 子查询包裹（原则 14）
        val innerSql = buildSelect(ast.copy(limit = null, offset = null)).sql
        BuiltSql("SELECT COUNT(*) FROM ($innerSql) AS _count_tmp", args.toList())
    }
}
```

### A.7 KProperty1.receiverType() — 从 spec 移除

原 §1.12 中 `this.receiverType()` 是一条脆弱的反射路径，KMP Native 下不可用。

**冻结决策**：删除该扩展函数引用。单表场景的 `KProperty1 → Column` resolve 通过 **`QueryScope` 持有 `TableDef` 直接 resolve**，无需从 `KProperty1` 反向推断实体类型。

```kotlin
// ❌ 删除（KMP Native 不可用）
internal fun <T : Any> KProperty1<T, *>.toColumnRef(): ColumnRef {
    val col = TableDefRegistry.resolve(this.receiverType(), this)  // receiverType() 不可用
    ...
}

// ✅ 替代：QueryScope 持有 def，直接 resolve（O(1) KSP 映射）
internal class QueryScope<T : Any>(private val def: TableDef<T>) {
    internal fun <V> KProperty1<T, V>.toColumnRef(): ColumnRef {
        val col = def.resolve(this)   // TableDef 在进入 QueryScope 时已知，无需逆推
        return ColumnRef(col.columnName)
    }
}
```

`TableDef` 在 `Table.query { }` 进入 `QueryScope` 时由 `TableDefRegistry.get(this)` 取得，后续所有 `KProperty1` 操作均在 `QueryScope` 内完成，不需要 `receiverType()`。
