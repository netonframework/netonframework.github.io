# 路线图

> 状态：草案 v0（2026-10-10）。按**退出条件**推进，不承诺工期，也不预设性能倍数。功能扩展（QUIC v2、WebTransport、ECH、多路径、
> 更多 JVM 目标等）按用户需求单独立项，不作为 1.0 的前提。

## 阶段

| 阶段 | 主要交付 | 退出条件 | 状态 |
|---|---|---|---|
| 1. 基线 | 工程标准；每个库的支持声明与证据索引；兼容策略；安全策略；可追溯的发布记录 | 每个发布产物能追溯到源码、依赖、工具链与测试结果；每个库有支持声明 | 进行中：标准、quic 的支持声明、发布记录已建 |
| 2. 正确性 | 高风险 RFC 条款清单；运行时契约测试；互通失败的复现与定因；资源上限测试 | 声明支持的范围内没有未解释的发布阻断缺陷 | 未开始 |
| 3. 稳定与性能 | 多核诊断；长时间运行；故障注入；真实业务基准 | 达到事先定义的吞吐、延迟、错误率与资源预算 | 未开始 |
| 4. 1.0 | API 与行为承诺；升级验证；下游试用 | 有真实、独立的使用者验证过升级与运维路径 | 未开始 |

## 阶段 1：基线

- [x] 工程标准草案（[standards](./standards.md)）
- [x] quic 的支持声明与证据索引（[quic](./libraries/quic.md)），作为其他库的模板
- [x] 发布记录（[releases](./releases.md)）
- [x] 其余库的支持声明：http3、http、websocket、tls、io、msgtrans（初稿，2026-10-10）
- [ ] 安全策略定稿（报告渠道与响应时限由维护者确定），各仓库添加 `SECURITY.md`
- [ ] 各库 CHANGELOG
- [ ] klib ABI 快照纳入 CI（先在一个库上验证 Kotlin Gradle 插件的 ABI 校验对 Native 与 cinterop 的效果）
- [ ] Kotlin 版本兼容矩阵：实测"生产者 / 使用者"版本组合，区分纯 Kotlin 与含 cinterop 的产物
- [ ] 发布由 CI 执行（目前由维护者本机构建、签名与上传）
- [ ] 同批发布时，发版提交上的 CI 能解析尚未上线的依赖（2026-10-08 的 websocket、quic、http3 发版提交因此没有运行测试，见 [releases](./releases.md)）

## 阶段 2：正确性（已知缺口）

**跨库**
- RFC 条款清单（先做高风险条款）：RFC 9112（HTTP/1.1）、RFC 9113（HTTP/2，h2spec 只针对 RFC 7540/7541）、RFC 9114 与 RFC 9204（HTTP/3、QPACK）、
  RFC 6455 与 RFC 7692（WebSocket）、RFC 9000 / 9001 / 9002（QUIC）。
- 组合测试：HTTP/3 → QUIC → UDP → 反应器；HTTPS / wss → tls → TCP（含 Windows IOCP）；取消、背压、关闭与错误传播。
- 覆盖率引导的模糊测试（当前为确定性种子），发现的输入沉淀为回归用例；cinterop 的 C 代码以 ASan / UBSan 运行。

**按库**（完整清单见各库支持声明的"缺口"一节；下表只列关键项）

| 库 | 关键缺口 |
|---|---|
| [quic](./libraries/quic.md) | Interop Runner `handshakeloss` / `handshakecorruption` 时过时不过，原因未明；runner 结果表需从最新 CI 刷新；与 quinn 的性能对照 |
| [http3](./libraries/http3.md) | h3spec 与互通只在发布前手工运行过、不在 CI；h3spec 的 `CRYPTO in 0-RTT` 未真正检验（需重跑）；0-RTT 无外部互通；Interop Runner `http3`、quiche、curl `--http3`；丢包 / 乱序下的 HTTP/3；无请求 / 头部超时；README 中 0-RTT 的说法前后矛盾 |
| [http](./libraries/http.md) | HTTP/1.1 无外部一致性证据（解析分歧与走私的差分测试）；RFC 9113 的变化；h2spec 与 curl 互通只在发布前手工运行、不在 CI，之后未重跑；HTTP/2 请求体总量无上限（HTTP/1 为 10 MiB），不对称未说明 |
| [websocket](./libraries/websocket.md) | 开启压缩的首轮 Autobahn（run 37706619816）在服务端方向中断、无报告，原因未明；无握手 / 空闲 / 关闭握手超时；Autobahn 镜像未固定版本、只在 Linux epoll 上运行；SPEC 与 README 的状态描述过时 |
| [tls](./libraries/tls.md) | IOCP 上取消写入计数的修正（dc1e86a）没有确定性的专门回归测试；取消写入后的关闭、多轮建连与失败后原生资源回到基线、握手超时均无测试；HTTPS / wss 未与独立实现互通 |
| [io](./libraries/io.md) | io-testkit 一致性套件的结果未上传、不可从 CI 复核；JVM 的 `NioReactor` 未跑一致性套件；`UdpTest` 对批量个数与 GSO 段数只打印不断言；SPEC §29.5 计划的 GSO 降级、GRO 拆分、`mayFragment` 测试未写 |
| [msgtrans](./libraries/msgtrans.md) | 默认负载上限 64 MiB 宽于 WIRE_FORMAT §9.3 的 QUIC 单帧 16 MB（规范要求接收方报错）——决定改默认值或声明偏离；版本 / 压缩 / 包类型非法值的拒绝无专门断言；与 TypeScript 客户端的互通；msgtrans-rust 的 `wire_format_fixtures` 在 Kotlin 中运行 |

## 阶段 3：稳定与性能（已知问题）

- **多核退化**：HttpArena（64 核 cpuset）上 NetonStream 的吞吐与 p99 明显落后于 hyper4k。已修正若干可疑点（cpuset 下的反应器数量、
  io_uring 的 accept、每请求的协程与共享计数），但 io SPEC §31.1 明确指出 Arena 的数字是症状，**不能证明根因**。下一步：在多核机器上
  复现，再以 perf、调度与锁统计、GC 日志与分配归因定位。需要一台多核 Linux 机器（共享生产主机不可用）。
- quic 与 quinn、http3 与 h3 的性能对照（尚未做）。
- 长时间运行：内存、句柄、定时器数量不增长；慢客户端与资源耗尽下的行为。
