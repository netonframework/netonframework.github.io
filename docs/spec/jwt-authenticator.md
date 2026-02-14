# Neton JWT Authenticator 规范 v1

> **状态**：Implemented (Spec-Compliant) | Contract tests: 8/8  
> **定位**：Native-only，JwtAuthenticator 的最小实现范围。与 [Neton-Security-Spec-v1.1-API-Freeze](./security-v1.1-freeze.md) 的 Identity/UserId 完全对接。  
> **原则**：冻结后再实现，避免算法/时钟/解析细节分叉。

---

## 一、范围（v1 冻结）

| 项 | v1 冻结 | 说明 |
|----|---------|------|
| Header | `Authorization: Bearer &lt;token&gt;` | 大小写：Authorization 按 HTTP 规范，Bearer 大小写敏感 |
| 算法 | HS256 | 唯一支持，最小依赖 |
| Claim | sub / roles / perms | 与 Identity v1.1 一致 |
| 时间 | exp | v1 只校验 exp，不强制 nbf/iat |
| 错误 | AuthenticationException(code, path) | 401 映射 |

---

## 二、Header 解析

```
Authorization: Bearer <token>
```

| 规则 | 说明 |
|------|------|
| 无 Authorization | 返回 null，不抛异常（交给 Guard） |
| 非 Bearer 前缀 | 返回 null |
| Bearer 后无 token | `AuthenticationException(code="MissingToken", path="Authorization")` → 401 |
| 多余空格 | Bearer 与 token 之间单空格，trim 后解析 |

---

## 三、Claim 规则（与 Identity v1.1 一致）

| Claim | 类型 | 缺失时 | 错误时 |
|-------|------|--------|--------|
| sub | string | 见细则 1 | UserId.parse 抛 InvalidUserId |
| roles | string[] | emptySet() | 见细则 2 |
| perms | string[] | emptySet() | 见细则 2 |

**细则 1：sub 缺失或为空字符串一律视为 InvalidUserId**

`AuthenticationException(code="InvalidUserId", path="sub")`。不新增 MissingUserId。

**细则 2：roles/perms 异常元素处理**（v1 冻结）

| 情况 | 行为 |
|------|------|
| 非 list 类型（如 string/object） | 当作缺失 → emptySet |
| list 中非 string 元素 | 忽略该元素 |
| 绝不抛异常 | 保持轻量 |

---

## 四、时间校验（v1 最小）

| Claim | v1 行为 |
|-------|---------|
| exp | 必须校验，过期 → `AuthenticationException(code="TokenExpired", path="exp")` → 401 |
| nbf | 不校验 |
| iat | 不校验 |

**细则 3：exp 类型与单位**（v1 冻结）

- exp 使用 **秒级 epoch**（NumericDate，非毫秒）
- exp 缺失、类型错（非 number）→ 视为无法确认有效期，按过期处理：`AuthenticationException(code="TokenExpired", path="exp")`
- 不新增 code，实现简单，语义安全

**时钟**：使用系统时钟，无 clock skew 配置。v2 可加。

---

## 五、签名与算法

| 项 | v1 冻结 |
|----|---------|
| 算法 | HS256 |
| 密钥 | 配置传入（String 或 ByteArray），长度满足 HS256 要求 |
| 算法不匹配 | `AuthenticationException(code="InvalidAlgorithm", path="alg")` → 401 |
| 签名无效 | `AuthenticationException(code="InvalidSignature", path="")` → 401 |

**细则 4：alg 校验**（v1 冻结）

- header.alg 必须严格等于 `"HS256"`（大小写敏感）
- 缺失、其他值 → `InvalidAlgorithm(path="alg")`

**细则 5：token 格式 / decode / JSON 解析失败**（v1 冻结）

以下情况统一抛 `AuthenticationException(code="MissingToken", path="Authorization")`：

- token 不满足 header.payload.signature 三段
- base64url decode 失败
- header/payload 不是合法 JSON

不新增 code，本质为「无效 token」。

---

## 六、AuthenticationException 映射（v1 冻结）

| code | path | message |
|------|------|---------|
| MissingToken | Authorization | Missing or invalid Bearer token |
| InvalidUserId | sub | Invalid user id |
| TokenExpired | exp | Token has expired |
| InvalidAlgorithm | alg | Unsupported algorithm |
| InvalidSignature | (空) | Invalid signature |

---

## 七、v1 解析失败映射规则（冻结）

按失败发生顺序，实现不得偏离：

| 失败场景 | code | path |
|----------|------|------|
| 无 Authorization | 返回 null，不抛 |
| 非 Bearer 前缀 | 返回 null |
| Bearer 后无 token | MissingToken | Authorization |
| token 三段不合法 | MissingToken | Authorization |
| base64url decode 失败 | MissingToken | Authorization |
| header/payload JSON 解析失败 | MissingToken | Authorization |
| header.alg != "HS256"（大小写敏感） | InvalidAlgorithm | alg |
| sub 缺失或空字符串 | InvalidUserId | sub |
| sub 非法（UserId.parse 失败） | InvalidUserId | sub |
| exp 缺失/类型错/过期 | TokenExpired | exp |
| signature 校验失败 | InvalidSignature | (空) |

---

## 八、实现清单

| 项 | 说明 |
|----|------|
| 1 | 解析 Authorization header，提取 Bearer token |
| 2 | Base64Url 解码 payload，析出 sub/roles/perms |
| 3 | sub 缺失/空 → InvalidUserId；sub 非法 → UserId.parse 抛 InvalidUserId |
| 4 | roles/perms 缺失或非 list → emptySet；list 中非 string 忽略 |
| 5 | exp 缺失/类型错/过期 → TokenExpired；exp 单位秒 |
| 6 | alg != "HS256" → InvalidAlgorithm |
| 7 | HS256 验签 |
| 8 | 构造 IdentityUser(id, roles.toSet(), perms.toSet()) |
| 9 | 契约测试：各 code 对应 path/message 稳定 |

**实现建议**：不要手写 HMAC-SHA256，使用 Native 可用 crypto 库（如 cryptography-kotlin：CommonCrypto/OpenSSL）封装极薄的 HS256 verifier。

**细则 6：签名比较必须 constant-time**（v1 冻结）

不得用普通 `==` 比较签名（可泄漏时序）。实现须使用 constant-time compare：

```kotlin
fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean {
    if (a.size != b.size) return false
    var r = 0
    for (i in a.indices) r = r or (a[i].toInt() xor b[i].toInt())
    return r == 0
}
```

---

## 九、契约测试骨架

```kotlin
// 无 Authorization → null
// 非 Bearer → null
// Bearer 后空 → MissingToken, path=Authorization
// token 格式坏 / decode 失败 / JSON 失败 → MissingToken
// alg != HS256 → InvalidAlgorithm, path=alg
// sub 缺失/空/非法 → InvalidUserId, path=sub
// exp 缺失/类型错/过期 → TokenExpired, path=exp
// 签名错误 → InvalidSignature
// 正常 → IdentityUser
```

---

*文档版本：v1*  
*后续：SessionAuthenticator、BasicAuthenticator 可单独建 spec，path 分别用 sessionId、Authorization。*
