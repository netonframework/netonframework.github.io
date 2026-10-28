# Neton 1.0.0 正式发布准备

状态：发布前验收中，尚未发布。维护者已授权在全部门禁通过后发布并完成公开消费复验。

## 版本及依赖

框架准备提交：`e7a78204854464326ca878414968a96f4bdb2575`，正式版本号 `1.0.0`。
Kotlin 编译器保持 `2.4.20`，KSP 保持 `2.3.12`，未升级编译器。

- sqlx4k：`1.16.0` → `1.17.0`。上游声明修复驱动解码、取消与连接清理等问题。
  上游使用 Kotlin 2.4.21，消费兼容性必须由本项目 2.4.20 的真实构建/运行确认。
  依赖图可能包含上游的 stdlib 版本，不等于修改本项目编译器插件版本。
- kotlinx-serialization：`1.11.0` → `1.12.0`；上游基于 Kotlin 2.4.10，包含解码异常
  包装及嵌套深度限制变化，仍需框架序列化与 HTTP 契约回归。
- 核查时其余直接运行库已为最新稳定版本：coroutines `1.11.0`、kotlinx-io `0.9.1`、
  datetime `0.8.0`、Konform `0.11.1`、rethis `0.4.4`。
- 自有已发布栈保持 io `0.4.1`、http/tls/websocket `0.3.0`、openssl `4.0.2-3`。
  不以未发布兄弟源码替代依赖，不在发布前擅自升级 Kotlin。

来源：[sqlx4k 1.17.0](https://github.com/smyrgeorge/sqlx4k/releases/tag/1.17.0)、
[serialization 1.12.0](https://github.com/Kotlin/kotlinx.serialization/releases/tag/v1.12.0)，
其他库对照官方 release 与 Maven Central metadata。版本盘点不是兼容性测试。

Neton 的 SQL 适配层使用 Statement、fetchAll、execute 和事务 API；未发现调用此次
改变返回值的 batchInsert/batchUpdate 或改变生命周期的数据库 listen。Neton 自有迁移
引擎没有因为上游迁移器修复而被替换。真实数据库类型、事务取消、迁移及连接归零仍需验收。

## 生产签名预检

当前 Gradle 配置的生产密钥主指纹为
`AA93E367430D0F9FC4CCB7AB4EC1381BAA4F649B`，公开身份
`zoujiaqing <zoujiaqing@gmail.com>`，非候选临时密钥，检查时未过期。
已从 Maven Central 下载 beta26 的 neton POM 与签名，GPG 验证有效且指纹一致。
私钥与令牌未写入本记录；该检查不替代正式 1.0.0 每个制品的签名核验。

## 当前门禁与发布纪律

[新框架 CI](https://github.com/netonframework/neton/actions/runs/40753256264) 正在验收。
此前 `934764f` 的绿色候选不替代升级后提交的结果。
中英文发布说明已经按独立 AI、自有 HTTP、平台/数据库实际范围重新对齐，仍标记待发布。

在新门禁全部通过、正式生产签名制品清单及 Central USER_MANAGED 验证通过前，不执行
不可逆发布。发布后才更新公开模板默认版本、创建正式发布标记，并执行不使用 Maven Local、
候选文件仓库或源码替换的公开 Central 消费验收。后续结果必须保留具体 SHA、制品摘要、
签名身份及真实启停结果；缺失项不得推断为通过。
