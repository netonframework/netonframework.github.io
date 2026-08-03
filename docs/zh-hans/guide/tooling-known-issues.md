# 工具链已知问题

## KSP 的 AWT 关闭噪音

在 macOS 上，Kotlin/Native 的 KSP 任务结束后，偶尔会打印一段来自 IntelliJ `FileDocumentManager`
的 `AWT-EventQueue-0` `NullPointerException`。这是工具链关闭阶段的噪音——此时 Gradle 仍然报
`BUILD SUCCESSFUL`，它也不是 Neton 生成的应用代码抛出来的。

处理原则：

- **以 Gradle 的退出码和任务结果为准**。KSP 任务真的失败时，绝不能忽略。
- 不要为这段 AWT 堆栈在应用里加重试、加 `clean`、或吞异常。
- Kotlin、KSP、Gradle 的版本要一起钉住；升级时重新确认该问题是否仍在。
- 可稳定复现的非零退出必须单独立项跟踪，并阻断发布验证。

Neton 1.0 基于 Kotlin `2.4.0` 构建，KSP 插件钉在 `2.3.10`（见 `gradle/libs.versions.toml`）。
