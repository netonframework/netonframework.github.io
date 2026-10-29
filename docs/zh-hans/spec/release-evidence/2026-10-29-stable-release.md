# Neton 1.0.0 正式发布准备

状态：发布前门禁已全部通过；Central 已接受正式发布请求，正在同步。公开消费验收待完成。
维护者已授权正式发布及公开消费复验。以下首轮进度作为历史保留，以末节的新证据为准。

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

## 首轮升级验收进度

- 本地 `:neton-database:checkKotlinAbi` 通过（Kotlin 2.4.20）；这是补充检查，
  不替代干净候选 CI。制品校验工具的 7 项单元测试通过。
- 新提交的 PostgreSQL、Redis、Linux/Windows Core、Linux/Windows 参考应用迁移与
  两轮启停，以及 Linux x64/ARM64、Windows KSP 增量检查通过。
- 签名候选制品门禁通过，三平台公开应用消费及 macOS 基础检查仍在运行。
- 全量 ABI、macOS 参考应用、macOS KSP job 未执行代码即被 GitHub 取消。注释明确为
  hosted macOS ARM64 runner 容量不足。ARM64 后续执行 job 因依赖未满足被跳过。
  当前凭据重跑返回 `Resource not accessible by personal access token`，已请求维护者
  在本轮结束后执行 Re-run failed jobs。不得用本地数据库 ABI 检查替代这些缺失项。
- Maven Central 逐项 HEAD 检查确认全部 79 个预期的 `1.0.0` 坐标尚不存在（404），
  未发现已发布版本占用。此结果只代表检查时点，正式上传前仍应核对。
- 生产签名制品在干净提交的独立目录本地准备。首次构建退出 143，Gradle 日志显示客户端
  断开而取消，没有成功制品验收结论；保留原日志，第二次构建进行中。没有上传或发布。

因此首轮记录时为 **未放行**；旧候选全绿不能抵消升级后门禁取消/跳过。

## 最终候选放行与生产发布请求

[同一运行 attempt 2](https://github.com/netonframework/neton/actions/runs/40753256264/attempts/2)
在框架 `e7a78204854464326ca878414968a96f4bdb2575` 上完整 19 项门禁全部通过，包括此前
取消的 macOS 检查、ARM64 实际执行以及三平台公开候选消费，未跳过失败项。

干净独立目录的生产构建第二次成功（819 tasks executed）。正式 `1.0.0` 共 79 个坐标、
345 个正文文件，通过完整清单、POM/Gradle metadata、BOM、校验和及每份签名核验；
全部签名绑定上述生产密钥。上传包 SHA-256：
`d3c3c84a2a4bb6e0c8d49753d78c76a156ca42ddf6cc5a889bb3c510af3970b0`。

Central deployment ID：`7e302f24-1e16-476d-bd64-3e17afbd5475`。
先以 USER_MANAGED 上传，返回 `VALIDATED` 且 errors 为空，随后按授权请求正式发布。
当前 `PUBLISHING` 尚不等于公开仓库同步完成，不能提前宣布公开消费通过。
Central 提醒组织月度配额已达到限额，但处于截至 2026-11-02 的发布宽限期；
本次验证成功，不涉及付费升级或绕过配额。
