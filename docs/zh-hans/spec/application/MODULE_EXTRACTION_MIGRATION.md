# 通用模块抽离后的下游同步指引

> 适用范围：从内嵌模块迁移到 canonical 独立模块仓的发行版。
> 各产品的具体迁移清单、历史差异和验收结果维护在产品仓库中。

## 归属原则

通用模块由自己的 canonical 仓库维护，发行版只负责装配。
通用修复回流到模块仓；产品差异通过产品模块和标准扩展点实现。
不能因为某个产品仍保留内嵌副本，就将其目录布局或私有迁移定义为上游标准。

## 迁移步骤

1. 锁定发行版、旧内嵌模块及目标 canonical 模块版本，比较源码、公开接口和迁移文件。
   将通用差异与产品差异分别归入正确仓库，保留未提交工作，不直接删除未审查的目录。
2. 在发行版的 `settings.gradle.kts` 中登记源码子项目。下面路径仅为示例，实际以发行版检出清单为准：

   ```kotlin
   include(":module-system")
   project(":module-system").projectDir = file("../neton-application-module-system")
   include(":module-infra")
   project(":module-infra").projectDir = file("../neton-application-module-infra")
   ```

3. 保持已有 projectPath，核对应用依赖、KSP 模块注册、依赖替换和干净环境检出清单。
   不依赖本地 Maven 发布或应用与模块间循环 `includeBuild`。
4. 审查迁移归属：保留已应用迁移的标识、版本和 checksum。仅移动源码目录不应重写历史；
   如目标版本确有差异，必须给出显式迁移方案，不能笼统承诺“数据库无感”。
5. 在一次性数据库和已有 schema 的隔离副本上执行迁移 status/verify，再编译、链接发行版并验收启动、
   认证及被迁移模块的关键路径。具体产品用例和操作命令放在产品仓库。
6. 只有差异已妥善保存、迁移和行为验收通过后，才删除旧内嵌副本；不要连同产品自有 SQL 一并删除。

## 前端模块

同样遵循“通用模块独立维护、发行版负责装配”的边界。
以当前模块 manifest、包依赖和 registry 为准，不根据历史目录描述复制一份通用模块到产品内。
