# module-external-identity 外部站点身份

> 标识：NETON-APP-EXTERNAL-IDENTITY
> 日期：2026-10-19 · 状态：Draft r1
> 仓库：`neton-application-module-external-identity`（服务端，可选套件模块）
> 把采集 / 导入进来的「某个外部站点上的某个用户」沉淀成一条**可被认领**的身份记录。本期只存事实 + 认领状态，不含认领流程。

## 1. 目标与边界

采集进来的内容里，评论作者、文章作者往往是外部站点（IT之家、少数派、快科技……）上的一个用户。这些用户没有本平台账号，
但同一个人可能在多条评论 / 多篇文章里反复出现，日后也可能来认领自己的贡献。external-identity 把「哪个站点的哪个用户」
收敛成**一条**身份记录（`external_site_users`，唯一键 `(site_id, site_user_id)`），供：

- 展示：导入评论仍按「来自 X 的网友 + 昵称」展示，但背后指向一条稳定身份；
- 后台：按站点 / 认领状态浏览外部用户；
- 未来认领：把身份绑定到平台账号（本期**不实现**，只预留 `claimed_user_id` / `claim_status` 与绑定点）。

可选模块：只依赖套件基础契约与 `system` / `infra` 基座，不依赖其他套件模块的实现；独立可构建，宿主按需装配。
消费方（collect、comment）一律 `ctx.getOrNull(...)` 取端口，本模块没装时优雅降级（照常展示外部作者名，不登记身份）。

## 2. 契约 `contract.externalidentity`

```kotlin
interface ExternalSiteIdentityWriter {
    // 按 (siteId, siteUserId) 幂等：已存在就更新展示字段（非空才覆盖）与 last_seen，返回同一条记录 id。
    suspend fun upsert(siteId: String, siteUserId: String,
                       siteUsername: String? = null, siteUserUrl: String? = null, avatarUrl: String? = null): Long
}
interface ExternalSiteIdentityReader {
    suspend fun get(id: Long): ExternalSiteIdentity?
    suspend fun find(siteId: String, siteUserId: String): ExternalSiteIdentity?
}
data class ExternalSiteIdentity(id, siteId, siteUserId, siteUsername?, siteUserUrl?, avatarUrl?,
                                claimedUserId?, claimStatus, firstSeenAt, lastSeenAt)
```

- `ExternalIdentityLogic` 同时实现两个端口；本模块 bootstrap `bindIfAbsent` 两者。
- `site_id` 约定**稳定取采集源 `code`**（`ithome` / `sspai` / `mydrivers`）。`site_user_id` 是站内用户的稳定标识
  （IT之家评论的 `Ui`、少数派作者的 `slug`）。

## 3. 存储

```
external_site_users(id, site_id, site_user_id, site_username?, site_user_url?, avatar_url?,
                    claimed_user_id?, claim_status('unclaimed'|'claimed'), first_seen_at, last_seen_at)
  UNIQUE (site_id, site_user_id)
```

upsert 以 `ON CONFLICT (site_id, site_user_id) DO UPDATE`：展示字段 `COALESCE(新值, 旧值)`（非空才覆盖），`last_seen_at` 刷新，
`first_seen_at` 不变。本期 `claim_status` 恒 `unclaimed`、`claimed_user_id` 恒 NULL —— 认领流程另立项。

## 4. 后台

`/admin/external-identity/user/{page,get}`，权限点 `external-identity:user:query`，菜单「外部身份 / 站点用户」。只读：按站点、认领状态、关键词（站内用户 ID / 昵称）分页。

## 5. 与 collect / comment 的接入

- **评论**（comment-module §6）：`ImportedComment` 增加 `siteId / siteUserId / siteUsername / siteUserUrl`（可空，向后兼容）。
  导入评论时若四要素齐全且 `ExternalSiteIdentityWriter` 已绑定，comment 先 upsert 身份得到 id，写进 `comment_comments.external_identity_id`
  （弱引用，不加外键）。未认领前展示不变。
- **文章**（collect-module §8 `content.draft`）：采集记录的 `article` 类型新增 `authorId / authorUrl` 字段；`content.draft` 投递端口在交付时，
  若记录带 `authorId`，用源 `code` 作 site_id upsert 作者身份（失败不影响投递）。
- collect 记录类型：`comment` 新增 `siteUserId / siteUserUrl`，`article` 新增 `authorId / authorUrl`，由各源的抽取规则填充
  （IT之家评论 `Ui` → siteUserId、`UserIndexUrl` → siteUserUrl；少数派作者 `slug` → authorId）。

## 6. 错误码

机器码（UPPER_SNAKE_CASE）：`EXTERNAL_IDENTITY_NOT_FOUND`（后台取不到）；写入参数非法以 `require` 抛 `SITE_ID_REQUIRED` / `SITE_USER_ID_REQUIRED`。

## 7. 延后

认领流程（绑定平台账号、认领申请 / 审核、认领后内容归属迁移）、按身份聚合的贡献视图、跨站点同一人的合并。
