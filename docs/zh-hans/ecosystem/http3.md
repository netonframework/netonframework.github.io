# HTTP/3

独立 HTTP/3 库，使用 http 的通用类型与 quic 的传输能力。

## 已有能力

客户端、服务端、请求流、trailers、GOAWAY、静态表与 literal QPACK，以及早期数据标记。

## 如何接入

坐标：`com.netonstream:http3`。QUIC 协商 ALPN `h3` 后，通过 `asH3()` 接入客户端或服务端连接；消费请求/响应体并结束或关闭请求流。应用框架接入是独立工作，不因库存在就自动启用 HTTP/3。

版本与安装规则见[接入与版本](./versions.md)，不要把下面的源码版本直接当作已发布版本。

## 支持范围与限制

当前只声明 Native，尚无 JVM 目标；依赖仍是 http/quic 0.2.0，不能直接套用它们最新源码的版本组合。不支持动态 QPACK、服务器推送、WebTransport 和 HTTP Datagrams；QUIC 数据报不等于 HTTP Datagrams。

## 验证记录

README 记录 h3spec 49/49，以及 h3/h3-quinn、aioquic 的指定场景互通；quiche/curl HTTP/3、真实 TLS 丢包乱序与性能对照仍列为待验证。

以上是仓库记录的结果，本次文档整理没有重新执行协议测试或性能测试。平台声明与运行验证的区别见[支持矩阵](./support.md)。

## 源码依据

核对日期：2026-10-12；源码提交：`9921dd64adbc69899a847ef3579e96c2f7a96aa7`；构建声明版本：`0.2.0`（非 Central 发布确认）。

- [源码与用法](https://github.com/netonframework/http3)
- [目标与依赖](https://github.com/netonframework/http3/blob/main/http3/build.gradle.kts)
- [设计与验证记录](https://github.com/netonframework/http3/blob/main/SPEC.md)

链接指向仓库 main，可能随开发更新；本页的结论以记录的核对提交为准。
