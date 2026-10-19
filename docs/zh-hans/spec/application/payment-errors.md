# module-payment 错误码

## 规则

payment 模块所有业务错误的 `message` 都是模块自己的机器码（`^[A-Z][A-Z0-9_]{2,}$`），统一定义在
`neton-application-module-payment/src/commonMain/kotlin/logic/PaymentErrorCodes.kt`；不写中英文句子、不拼
`CODE: detail`、不做字符串插值（金额、单号等细节只进日志，不进 message）。数字 `code` 取 `NetonErrorCode` 的类别：
参数非法 INVALID_PARAMS（400）、不存在 RESOURCE_NOT_FOUND（404）、状态不允许 / 乐观锁冲突 / 余额不足 OPERATION_CONFLICT（409）、
资金授权失败 PERMISSION_DENIED（403）。跟某个请求字段有关的错误另带字段级错误
`errors = [{ path: <字段>, message: <CODE>, code: <CODE> }]`。模块内抛错统一走 `logic/WalletHttpErrors.kt` 的
`walletBadRequest / walletNotFound / walletConflict / walletForbidden / requireParam / requireState`，实参只能是本表常量。
前端（neton-application-front-payment）在 `src/locales/<lang>.ts` 里按 `error.<CODE>` 翻译，页面通过
`useDescribeError("payment")` / `errorNamespace: "payment"` 取词条。守卫测试
`src/macosArm64Test/kotlin/logic/ErrorMessageGuardTest.kt` 扫描 `src/commonMain`，句子会让构建失败。

新增码：先加到 `PaymentErrorCodes`，再补本表与前端 zh-CN / en-US 两份 `error.<CODE>`。

余额不足有两种数字类别，按入口区分且保持历史行为：`PayWalletLogic.updateBalance`（后台调账 / 手动划扣、业务扣款）
返回 INVALID_PARAMS；资金事务内部的 `applyBalanceUpdate`（红包、转账、提现等）与冻结规则返回 OPERATION_CONFLICT。
机器码相同，客户端按机器码判断即可。

渠道配置缺失、渠道下单无响应、加密主密钥未配置等属于部署 / 上游故障，仍是 500，不在本表。

## 错误码

| 机器码 | NetonErrorCode | 场景 | 字段 |
| --- | --- | --- | --- |
| `AMOUNT_INVALID` | INVALID_PARAMS | 金额 ≤ 0：冻结 / 解冻 / 冻结实扣、转账、提现、红包总额、后台手动充值 / 划扣；充值 payPrice > totalPrice；订单退款金额 ≤ 0 或超过订单金额；司法冻结目标金额 ≤ 0 | `amount` / `totalAmount` / `payPrice` / `refundAmount` / `targetAmount` |
| `REMARK_REQUIRED` | INVALID_PARAMS | 后台手动充值 / 手动划扣备注为空 | `remark` |
| `WALLET_NOT_FOUND` | RESOURCE_NOT_FOUND | 用户或钱包 id 没有钱包（划扣、转账、发红包、提现、冻结） | — |
| `WALLET_BALANCE_INSUFFICIENT` | INVALID_PARAMS（updateBalance）/ OPERATION_CONFLICT（资金事务、冻结实扣） | 扣款后余额会变负 | — |
| `WALLET_AVAILABLE_BALANCE_INSUFFICIENT` | INVALID_PARAMS（updateBalance）/ OPERATION_CONFLICT（资金事务、冻结、风控冻结） | 可用余额（余额 − 冻结）不足 | — |
| `WALLET_FROZEN_AMOUNT_INSUFFICIENT` | OPERATION_CONFLICT | 解冻 / 冻结实扣金额超过当前冻结金额 | — |
| `WALLET_FREEZE_STATUS_INVALID` | INVALID_PARAMS | 结束冻结时终态传了 ACTIVE（内部调用） | — |
| `WALLET_ALREADY_FROZEN` | OPERATION_CONFLICT | 下达司法冻结时钱包已有生效中的账户冻结 | — |
| `WALLET_FREEZE_WITHDRAW_HOLD` | OPERATION_CONFLICT | 在冻结管理里释放提现冻结（须由提现状态机处理） | — |
| `WALLET_RECHARGE_NOT_FOUND` | RESOURCE_NOT_FOUND | 充值单不存在；App 发起支付时充值单不属于当前用户（同码，不泄露存在性） | — |
| `WALLET_RECHARGE_ALREADY_PAID` | INVALID_PARAMS | App 对已支付的充值单发起支付 | — |
| `WALLET_RECHARGE_NOT_PAID` | OPERATION_CONFLICT | 后台对未支付的充值单发起退款 / 标记已退款 | — |
| `WALLET_RECHARGE_REFUND_IN_PROGRESS` | OPERATION_CONFLICT | 标记支付时充值单已进入退款流程 | — |
| `WALLET_RECHARGE_REFUND_ALREADY_REQUESTED` | OPERATION_CONFLICT | 重复发起充值退款 | — |
| `WALLET_RECHARGE_REFUND_NOT_REQUESTED` | OPERATION_CONFLICT | 未发起退款就标记已退款 | — |
| `WALLET_RECHARGE_CONCURRENT_MODIFIED` | OPERATION_CONFLICT | 标记支付 / 已退款时乐观锁失败，可重试 | — |
| `WALLET_RECHARGE_PACKAGE_NOT_FOUND` | RESOURCE_NOT_FOUND | 更新 / 删除充值套餐时 id 不存在 | — |
| `TRANSFER_TO_SELF` | INVALID_PARAMS | 转账给自己 | — |
| `PAY_TRANSFER_NOT_FOUND` | RESOURCE_NOT_FOUND | `/pay/transfer/sync` 转账单不存在 | — |
| `RED_PACKET_COUNT_INVALID` | INVALID_PARAMS | 红包份数不在 1..1000 | `totalCount` |
| `RED_PACKET_AMOUNT_BELOW_COUNT` | INVALID_PARAMS | 红包总额不足每份 1 分 | `totalAmount` |
| `RED_PACKET_TYPE_INVALID` | INVALID_PARAMS | 红包类型不是 0（普通）/ 1（拼手气） | `type` |
| `RED_PACKET_NOT_FOUND` | RESOURCE_NOT_FOUND | 红包不存在 | — |
| `RED_PACKET_EXPIRED` | OPERATION_CONFLICT | 领取时红包已过期（同时触发退款） | — |
| `RED_PACKET_NOT_CLAIMABLE` | OPERATION_CONFLICT | 红包不在可领状态 | — |
| `RED_PACKET_DRAINED` | OPERATION_CONFLICT | 红包已领完 | — |
| `RED_PACKET_ALREADY_CLAIMED` | OPERATION_CONFLICT | 同一用户重复领取 | — |
| `RED_PACKET_CLAIM_CONFLICT` | OPERATION_CONFLICT | 并发领取乐观锁重试耗尽，可重试 | — |
| `RED_PACKET_CLAIM_FORBIDDEN` | PERMISSION_DENIED | 资金授权失败（非会话成员领取等，#84） | — |
| `BANK_CARD_HOLDER_NAME_REQUIRED` | INVALID_PARAMS | 绑卡持卡人姓名为空 | `holderName` |
| `BANK_CARD_BANK_NAME_REQUIRED` | INVALID_PARAMS | 绑卡开户行为空 | `bankName` |
| `BANK_CARD_NUMBER_REQUIRED` | INVALID_PARAMS | 绑卡卡号为空 | `cardNo` |
| `BANK_CARD_NUMBER_INVALID` | INVALID_PARAMS | 卡号（去空格 / 连字符后）不是 8–19 位数字 | `cardNo` |
| `BANK_CARD_NOT_FOUND` | RESOURCE_NOT_FOUND | 银行卡不存在、已失效或不属于当前用户（提现选卡、后台查看卡号） | — |
| `BANK_CARD_HAS_PENDING_WITHDRAWALS` | INVALID_PARAMS | 解绑的卡还有未打款的提现单 | — |
| `WITHDRAW_ORDER_NOT_FOUND` | RESOURCE_NOT_FOUND | 提现单不存在；用户取消他人的提现单（同码） | — |
| `WITHDRAW_STATUS_NOT_ALLOWED` | OPERATION_CONFLICT | 提现状态机不允许当前操作（审核 / 驳回 / 取消 / 打款 / 失败 / 挂起 / 解除挂起） | — |
| `WITHDRAW_HOLD_RESUME_INVALID` | OPERATION_CONFLICT | 解除挂起时 hold_resume_to 不是在途状态 | — |
| `WITHDRAW_HOLD_REASON_REQUIRED` | INVALID_PARAMS | 挂起原因为空 | `reasonText` |
| `WITHDRAW_CONCURRENT_MODIFIED` | OPERATION_CONFLICT | 提现单状态流转乐观锁失败，可重试 | — |
| `PAY_CHANNEL_CODE_EXISTS` | RESOURCE_ALREADY_EXISTS | 新建支付渠道编码重复 | `code` |
| `PAY_CHANNEL_NOT_FOUND` | RESOURCE_NOT_FOUND | 更新 / 删除支付渠道时 id 不存在 | — |
| `PAY_CHANNEL_UNAVAILABLE` | INVALID_PARAMS | 下单 / 退款时支付通道不存在、停用或平台未注册 | — |
| `PAY_ORDER_NOT_FOUND` | RESOURCE_NOT_FOUND | 渠道回调或退款时订单不存在 | — |
| `PAY_ORDER_NOT_PAID` | INVALID_PARAMS | 订单未支付成功就退款 | — |
| `MOCK_PAY_DISABLED` | RESOURCE_NOT_FOUND | 模拟支付开关关闭时访问模拟收银台 / 模拟回调 | — |
| `PAY_ENDPOINT_FORBIDDEN` | SERVICE_UNAVAILABLE | 下单 / 查单 / 退款时渠道配置的平台网关地址（支付宝 `serverUrl`、四方 `apiUrl`）被运维出站策略 `[egress]` 拒绝（内网 / 回环 / 链路本地、非放行端口、解析不出）；未发出任何请求。原因与地址只进服务端日志 `pay.platform.endpoint_forbidden`。见 [出站策略](../egress.md) | — |
