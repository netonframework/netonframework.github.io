# module-system / module-infra 抽离后的下游同步指引

> 状态：立即生效
> 背景：`module-system` 与 `module-infra` 已从 `neton-application` 内嵌目录抽离为独立
> canonical 仓 `neton-application-module-system` / `neton-application-module-infra`，
> 与 `module-member/payment/platform` 同形态。application 退化为纯装配工程。

## 为什么

内嵌导致 fork（privchat / yese）各自 fork 了一份 system/infra，在自己仓库里修 bug
（如 privchat 的 `V003__add_missing_system_user_profile_columns`、权限规范化、
precheck 释放连接），修复被锁死在 fork 里，上游与其它发行版看不到，同一 bug 被重复踩、
重复修。抽离后，核心模块的任何改动只能提交到模块自己的 canonical 仓，所有发行版天然共享。

## 下游 fork（privchat-application 等）迁移步骤

privchat 当前把 `module-system` / `module-infra` 作为**内嵌目录**（`include(":module-system")`
不带 projectDir）。迁移到与上游一致的装配形态：

1. **删除内嵌目录**：`git rm -r module-system module-infra sql`
   （迁移 SQL 由 `neton-application-module-infra/sql/` 持有，不再随 application 走）。

2. **settings.gradle.kts** 把两个 `include(":module-xxx")` 改成源码子项目引用：
   ```kotlin
   include(":module-system")
   project(":module-system").projectDir = file("../../Neton/neton-application-module-system")
   include(":module-infra")
   project(":module-infra").projectDir = file("../../Neton/neton-application-module-infra")
   ```
   （privchat 已用 `../../Neton/` 前缀引 canonical，其它模块行不变。）

3. **application/build.gradle.kts** 无需改动：仍是 `implementation(project(":module-system"))`，
   projectPath 不变。

4. **privchat 的产品差异要先回流**：抽离前 privchat 的 system/infra 携带了一批修复，
   其中**通用**部分已由上游 commit 合并（sex→gender、V004-V006、jobs 装配、
   FileUploadLogic 匿名读、JwtAuthenticator 去别名、MenuLogic 时间戳等）。迁移前请
   `diff` 确认 privchat 内嵌副本相对新 canonical 仓**没有剩余的产品私有改动**；若有，
   先提交到 canonical 模块仓（通用）或抽成 privchat 自有模块（产品专属），**不要**留在
   即将删除的内嵌目录里。

5. **数据库无感**：迁移 history 里 system/infra 的 moduleId 仍是 `infra`（V001…V006 版本号
   不变），checksum 不变，存量库 `migrate status` 无差异，无需重跑。

6. 验证：`./gradlew :application:compileKotlinMacosArm64 :application:linkDebugExecutableMacosArm64`
   → `application.kexe migrate status`（确认 infra V001-V006 identical）→ 启动登录冒烟。

## 前端同理（可选，后续）

`front-module-system` 仍内嵌在 `neton-application-front/packages/`，而 `front-member`
已是独立仓。同样的漂移风险存在，建议后续把 `front-module-system`（及 infra 对应）
抽为独立仓，`neton-application-front` 只做壳装配。
