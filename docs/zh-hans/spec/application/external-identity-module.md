# module-external-identity 外部站点身份

> 标识：NETON-APP-EXTERNAL-IDENTITY
> 日期：2026-10-22 · 状态：Draft r2（r2：外部站点目录 §2.1、批量读取、评论接口带出来源站点 §5）
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

- `ExternalSiteIdentityReader.getMany(ids)`：展示方按一页评论引用的身份一次批量取（≤ 500）。
- `ExternalIdentityLogic` 同时实现两个端口；本模块 bootstrap `bindIfAbsent` 两者。

### 2.1 外部站点目录

```kotlin
interface ExternalSiteDirectory { suspend fun sites(siteIds: Collection<String>): Map<String, ExternalSite> }
data class ExternalSite(siteId, names: Map<语言标签, 展示名>, homeUrl?) { fun displayName(locale): String? }
```

- 站点标识 → 各语言展示名（`{"zh-CN":"IT之家","en-US":"IT Home"}`）与站点主页，表 `external_sites`（V002）。
  展示方（评论区「来自 Hacker News」）据此标出导入评论的来源站点；**没登记的站点不在结果里**——展示方只显示昵称，
  不把 `hackernews` 这种内部代码露给读者。
- 名称在后端存全部语言、由客户端按自己的语言取（后端不按请求协商语言；门户每个部署一种语言，App 多语言）：
  完全匹配 → 同一主语言 → 任意一个。
- 由产品迁移登记自己的采集源（itwind-backend V008：ithome、sspai、mydrivers、hackernews），后台接口可增改。
- 实现 `ExternalSiteLogic`，bootstrap `bindIfAbsent(ExternalSiteDirectory)`。
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

`/admin/external-identity/site/{page,save,delete/{siteId}}`：外部站点目录，权限点 `external-identity:site:query`（页面）、
`external-identity:site:update`（按钮：保存、删除），菜单「外部身份 / 外部站点」（V002）。保存按站点标识幂等、展示名整体替换。
后台前端页面尚未建（与「站点用户」页同一状态：菜单与接口在，页面待 front 模块）。

## 5. 与 collect / comment 的接入

- **评论**（comment-module §6）：`ImportedComment` 增加 `siteId / siteUserId / siteUsername / siteUserUrl`（可空，向后兼容）。
  导入评论时若四要素齐全且 `ExternalSiteIdentityWriter` 已绑定，comment 先 upsert 身份得到 id，写进 `comment_comments.external_identity_id`
  （弱引用，不加外键）。
  **展示（r2）**：评论接口的作者 `author.site = { id, names, userUrl }`（一页评论的身份与站点各批量取一次）；客户端显示
  「昵称 · 来自 {names[语言]}」，昵称以 `rel="nofollow ugc"` 链到 `userUrl`（只下发 http(s) 地址）。站点没登记时 `names` 为空，只显示昵称。
- **文章**（collect-module §8 `content.draft`）：采集记录的 `article` 类型新增 `authorId / authorUrl` 字段；`content.draft` 投递端口在交付时，
  若记录带 `authorId`，用源 `code` 作 site_id upsert 作者身份（失败不影响投递）。
- collect 记录类型：`comment` 新增 `siteUserId / siteUserUrl`，`article` 新增 `authorId / authorUrl`，由各源的抽取规则填充
  （IT之家评论 `Ui` → siteUserId、`UserIndexUrl` → siteUserUrl；少数派作者 `slug` → authorId）。

## 6. 错误码

机器码（UPPER_SNAKE_CASE）：`EXTERNAL_IDENTITY_NOT_FOUND`（后台取不到）；写入参数非法以 `require` 抛 `SITE_ID_REQUIRED` / `SITE_USER_ID_REQUIRED`；
站点目录：`EXTERNAL_SITE_ID_INVALID`、`EXTERNAL_SITE_NAMES_INVALID`、`EXTERNAL_SITE_URL_INVALID`（字段错误带路径）、`EXTERNAL_SITE_NOT_FOUND`。

## 7. 延后

认领流程（绑定平台账号、认领申请 / 审核、认领后内容归属迁移）、按身份聚合的贡献视图、跨站点同一人的合并。
