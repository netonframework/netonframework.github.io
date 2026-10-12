# 支持与验证矩阵

核对日期：2026-10-12。各库页面记录源码提交与证据入口。**声明构建目标、编译成功、测试运行、外部互通、生产验证是不同的状态。** 本轮检查源码与已有记录，没有重跑 CI、真机或压测。

## 源码声明的目标

| 库 | Linux / macOS Native | Windows Native | iOS | Android Native | JVM |
|---|---|---|---|---|---|
| io | 有 | 有 | 有 | 32/64 位 | 有 |
| http（含 HTTP/2） | 有 | 有 | 有 | 32/64 位 | 有 |
| websocket | 有 | 有 | 有 | 32/64 位 | 有 |
| tls / quic | 有 | 有 | 有 | 64 位 | 有，依赖 OpenSSL JNI |
| openssl | 按构建目标选择 | 按构建目标选择 | 按构建目标选择 | 64 位 | 开发中，需 JNI 本地库 |
| http3 | 有 | 有 | 有 | 64 位 | 未声明 |
| msgtrans 核心 | 有 | 未声明 | 有 | 显式开启，默认不发布 | 有 |

目标声明来自各库 Gradle 配置。Android JVM 与 Android Native 不是同一种产物；模拟器、设备、桌面 JVM 的运行结果不能互相替代。JVM 声明也不表示 JNI 已覆盖每种宿主。OpenSSL 的目标选择和工具链要求会限制上层可用范围。

## 已有验证记录及边界

| 库 | 仓库记录 | 不能据此推断 |
|---|---|---|
| io | 流一致性、驱动生命周期、公平性；SPEC 有 Linux/macOS/Windows/JVM 记录 | 当前提交在所有设备都通过 |
| http | h2spec 145/145、curl、走私向量、流式上传 | 完整 RFC 认证或所有适配器均支持 |
| websocket | Autobahn 双向记录，含压缩；仍有 NON-STRICT/INFORMATIONAL | 全项严格通过或无限并发 |
| quic | quinn 双向及 Interop Runner 多实现记录；保留间歇失败 | QUIC 所有特性/所有互通组合均通过 |
| http3 | h3spec 49/49，h3/h3-quinn、aioquic 指定场景 | 动态 QPACK、WebTransport、HTTP Datagrams 已支持 |
| tls / openssl | TLS 回归与平台构建/运行记录 | 每个平台证书存储和 JNI 部署均已验证 |
| msgtrans | Rust peer 互通脚本、会话契约测试 | 所有语言客户端、完整类型化 RPC 已完成 |

## 发布前的检查

1. 固定库版本、编译器与依赖图，确认目标产物实际可取得。
2. 在部署平台跑正确性、取消/关闭、资源上限和安全配置测试。
3. 需要互通时记录对端版本与用例，保留失败，不只报告通过项。
4. 性能单独验收：吞吐、尾延迟、错误、CPU、内存与慢客户端场景一起看。

详细历史审计留在 neton-docs 的内部 `docs/zh-hans/stack/`，不直接当作最新用户手册发布。

