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
- [ ] 其余库的支持声明：http3、http、websocket、tls、io、msgtrans
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

**按库**

| 库 | 缺口 |
|---|---|
| quic | Interop Runner `handshakeloss` / `handshakecorruption` 时过时不过，原因未明；runner 结果表需从最新 CI 刷新；见 [quic §6](./libraries/quic.md#_6-缺口-进入路线图) |
| http3 | h3spec 的 `CRYPTO in 0-RTT` 当时未真正检验（quic 已支持 0-RTT，需重跑）；Interop Runner 的 http3 用例；与 quiche、curl `--http3` 互通；真实 TLS 下的丢包 / 乱序 |
| http | HTTP/1.1 缺少外部一致性证据：解析分歧与请求走私的差分测试；RFC 9113 相对 RFC 7540 的变化 |
| tls | 封装层的契约：WANT_READ / WANT_WRITE、取消、截断与关闭语义、内存生命周期、证书验证配置；BoGo / tlsfuzzer 主要检验 OpenSSL，优先级低于前者 |
| msgtrans | 发版提交 68921a3 的 CI 中，WebSocket 互通 "Kotlin client -> Rust server" 一次 Rust 服务端未按时退出（run 37961081168），其余运行通过，原因未明；与 TypeScript 客户端的互通；共享的线格式样例（msgtrans-rust `wire_format_fixtures`）在 Kotlin 中运行 |

## 阶段 3：稳定与性能（已知问题）

- **多核退化**：HttpArena（64 核 cpuset）上 NetonStream 的吞吐与 p99 明显落后于 hyper4k。已修正若干可疑点（cpuset 下的反应器数量、
  io_uring 的 accept、每请求的协程与共享计数），但 io SPEC §31.1 明确指出 Arena 的数字是症状，**不能证明根因**。下一步：在多核机器上
  复现，再以 perf、调度与锁统计、GC 日志与分配归因定位。需要一台多核 Linux 机器（共享生产主机不可用）。
- quic 与 quinn、http3 与 h3 的性能对照（尚未做）。
- 长时间运行：内存、句柄、定时器数量不增长；慢客户端与资源耗尽下的行为。
