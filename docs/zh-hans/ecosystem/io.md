# I/O

异步 I/O 底座，不依赖 Neton 框架。用于自定义协议、长连接与网络服务。

## 已有能力

`IoStream`、`Buffer`、`Framed`、`connect`、`serveTcp`、`bindUdp` 与 `lookupHost`。原生驱动包括 kqueue、epoll、io_uring、IOCP；JVM 使用 NIO。

## 如何接入

坐标：`com.netonstream:io`。在 reactor 作用域内建立连接；按流的线程归属调用读写。将 TLS、HTTP 或自定义编解码器放在 I/O 之上，不把业务协议放入驱动。`io-testkit` 可验证自己的流包装。

版本与安装规则见[接入与版本](./versions.md)，不要把下面的源码版本直接当作已发布版本。

## 支持范围与限制

原生目标包含 Linux、Apple、Windows、Android；也声明 JVM 目标。当前 JVM 源码通过 `DatagramChannel` 实现 UDP，旧版 README 中“不支持 JVM UDP”的描述已过时。平台选项不是完全对等；连接、缓冲、超时上限需要由应用配置。

## 验证记录

JVM UDP 每次接收一个数据报，不提供 GSO/GRO、逐数据报 ECN、源地址选择或目的地址元数据；不能把 Native UDP 的所有优化能力视为 JVM 已实现。

仓库包含流一致性、取消、驱动生命周期和公平性测试。SPEC 保留不同驱动的历史运行记录；本页不将历史通过视为当前提交的重新验证。

以上是仓库记录的结果，本次文档整理没有重新执行协议测试或性能测试。平台声明与运行验证的区别见[支持矩阵](./support.md)。

## 源码依据

核对日期：2026-10-12；源码提交：`c17214131f18bd269d2172a9234396371f79757a`；构建声明版本：`0.4.0`（非 Central 发布确认）。

- [源码与用法](https://github.com/netonframework/io)
- [目标与依赖](https://github.com/netonframework/io/blob/main/neton-io/build.gradle.kts)
- [设计与验证记录](https://github.com/netonframework/io/blob/main/SPEC.md)

链接指向仓库 main，可能随开发更新；本页的结论以记录的核对提交为准。
