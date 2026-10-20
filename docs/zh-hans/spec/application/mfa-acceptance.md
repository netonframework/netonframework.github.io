# MFA 数据库并发与浏览器验收

本验收只使用隔离的本地 PostgreSQL / Redis 与生产前端构建。测试账号、主密钥与 JWT 密钥是公开的测试夹具，禁止部署到实际业务环境。

## 1. 真实 PostgreSQL 并发

测试位于 `neton-application-module-system/src/commonTest/kotlin/security/MfaPostgresTest.kt`。它调用实际 `SqlxDatabase` 与 `MfaLogic`，从生成的生产迁移资源建表，避免手写另一套 schema。

先创建隔离实例和两个 UTF-8 数据库（PostgreSQL 工具需已加入 PATH）：

```sh
MFA_TEST_DIR=$(mktemp -d /tmp/neton-mfa-acceptance.XXXXXX)
initdb -D "$MFA_TEST_DIR/pg" --auth=trust --no-locale -E UTF8 -U mfa_test
pg_ctl -D "$MFA_TEST_DIR/pg" -l "$MFA_TEST_DIR/postgres.log" \
  -o "-h 127.0.0.1 -p 55439 -k $MFA_TEST_DIR" start
createdb -h 127.0.0.1 -p 55439 -U mfa_test mfa_integration
createdb -h 127.0.0.1 -p 55439 -U mfa_test mfa_browser
```

在系统模块仓库执行：

```sh
NETON_MFA_TEST_DATABASE_URI=postgresql://mfa_test:test@127.0.0.1:55439/mfa_integration \
  ./gradlew macosArm64Test --tests security.MfaPostgresTest --console=plain
```

测试只能接受 `127.0.0.1` 和数据库名 `mfa_integration`；会清空该库的 MFA 表。没有环境变量时普通测试任务不连接数据库；**不能仅凭普通测试的绿色结果宣称真实数据库已验收**，须确认报告中存在 `MFA_POSTGRES_PASS`。

断言范围：

- 同时取得 4 个不同的 `pg_backend_pid()`，证明使用真实独立连接。
- 两个服务实例、8 个并发消费者，对一个挑战恰好只有 1 个成功。
- 同时间步跨挑战重放失败。
- 并发错误校验累计到 5 次；服务向调用者抛错后计数仍已提交。
- 管理员重置撤销旧修订会话和待验证挑战，保留 required，重新进入绑定。

## 2. 浏览器完整流程

准备文件位于 `neton-application/tests/mfa/`，浏览器脚本与同源代理位于 `neton-application-front/scripts/`。

先在 application 仓库构建实际后端，并用夹具目录作为运行目录：

```sh
./gradlew :application:linkDebugExecutableMacosArm64 --console=plain
cd tests/mfa
../../application/build/bin/macosArm64/debugExecutable/application.kexe migrate up
psql -h 127.0.0.1 -p 55439 -U mfa_test -d mfa_browser -v ON_ERROR_STOP=1 -f seed.sql
NETON_MFA_MASTER_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
  ../../application/build/bin/macosArm64/debugExecutable/application.kexe
```

在独立终端启动隔离 Redis：

```sh
redis-server --bind 127.0.0.1 --port 56379 --save '' --appendonly no
```

后端启动需要 Redis，因此应先启动 Redis，再运行上面的后端常驻进程。夹具配置的客服服务地址只指向未使用的本地端口，不访问实际 IM 服务。

在 front 仓库分别构建并启动前端、代理：

```sh
pnpm build
pnpm --filter @neton/application-front-shell start --hostname 127.0.0.1 --port 33180
```

```sh
node scripts/mfa-acceptance-proxy.mjs
```

通过 Playwright CLI 后台无界面运行（不加 `--headed`）：

```sh
playwright-cli -s=mfa-acceptance open http://127.0.0.1:33181/login
playwright-cli -s=mfa-acceptance run-code --filename=scripts/mfa-browser-acceptance.js
playwright-cli -s=mfa-acceptance close
```

若使用 Codex Playwright skill，可将 `playwright-cli` 替换为 `bash ~/.codex/skills/playwright/scripts/playwright_cli.sh`。每轮复验前先重新执行 `seed.sql`；在这个隔离 Redis 实例上执行 `redis-cli -p 56379 FLUSHDB` 清空上一轮请求额度。不可在其他 Redis 上执行。

脚本创建相互独立的管理员/目标用户浏览器上下文，真实点击设置、验证码输入和重置确认按钮；不 mock 后端。它复制真实 fetch 响应用于断言，避免页面跳转后浏览器已释放响应体。验证码由独立的浏览器 WebCrypto HMAC-SHA1 算法生成，不调用后端 TOTP 帮助函数。

验收覆盖：

- 管理员通过用户页面开启 required，已有无 MFA 会话立即失效。
- 首次登录显示绑定页面和二维码；正式 Token / Cookie 均未签发；挑战不能访问业务 API 或刷新。
- 错误验证码在页面显示错误，保留 MFA 页面，不建立会话。
- 正确验证码完成绑定，签发 HttpOnly Cookie，受保护 API 可访问。
- 再次登录进入 MFA 验证页，不展示绑定密钥；已消费动态码不能重放，新的当前动态码可登录。
- 管理员通过确认框重置，页面显示未绑定但 required 保持开启。
- 重置前的 access Cookie 和 refresh token 均失效，用户刷新受保护页面返回登录页。
- 下次登录重新显示二维码，密钥与旧密钥不同，重新绑定后可进入后台。
- 运行中没有未处理的浏览器异常。

成功时脚本返回 `MFA_BROWSER_PASS` 和每项检查名称。脚本限于 `http://127.0.0.1:33181`，夹具 SQL 限于本地 `mfa_browser` 数据库。

## 3. 结束测试

关闭测试浏览器、同源代理、前端与后端；关闭隔离 Redis，最后停止临时 PostgreSQL：

```sh
redis-cli -p 56379 SHUTDOWN NOSAVE
pg_ctl -D "$MFA_TEST_DIR/pg" -m fast stop
```

测试证据反映本地实际版本和数据库状态，不替代线上部署的验收。

## 4. 2026-10-11 验收记录

环境：macOS ARM64 原生后端 debug executable；Next.js 16.2.10 生产构建；PostgreSQL 16.9；隔离 Redis 7.2.7；后台无界面 Chromium。应用实际执行了 21 条模块迁移，其中包括 system V003 MFA 迁移。未使用线上数据库或线上账号。

真实数据库测试报告：1 个场景，0 failures / 0 errors，包含以下成功标记：

```text
MFA_POSTGRES_PASS connections=4 concurrentConsumers=8 winners=1 committedFailures=5 resetRevokesSession=true
```

浏览器测试返回 `MFA_BROWSER_PASS`，以下六组断言全部通过：

```text
policy_change_revokes_old_session
forced_binding_qr_no_token_no_cookie_challenge_not_session
wrong_code_denied_binding_issues_httponly_session
bound_login_requires_mfa_replay_denied_current_code_success
admin_reset_preserves_requirement_revokes_access_refresh_browser_redirects
reset_requires_new_qr_and_rebinding_restores_session
```

最终数据库状态：测试用户 required=1、bound=true、revision=2，符合「开启强制策略 → 绑定 → 重置递增版本 → 重新绑定」的结果。浏览器页无未处理异常。

本次并发测试是同一测试进程中的两个 `MfaLogic` 实例共享真实连接池，确实验证了独立 PostgreSQL 会话和行锁；没有把它描述为两台部署服务器的跨主机验收。二维码页面和基于密钥的动态码绑定已验收，未使用实体手机相机进行扫码。
