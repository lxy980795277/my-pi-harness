# GitHub授权的IPv4映射地址误判

## Spec

### Roadmap Alignment

本轮属于M4插件OAuth与受限网络可靠性修复，沿用[roadmap](../../00_OVERVIEW/roadmap.md)既有能力，不进入M5。真实账号、Office视觉和Windows验收仍保留原状态。

### Intent

修复GitHub插件授权交换阶段的PRIVATE_NETWORK误报。本机实测github.com同时返回合法IPv4及其IPv4-mapped IPv6形式，当前全量DNS校验把等价映射地址一律当作禁用地址，导致发送请求前失败。Skill后续web_fetch使用的同类判定一并保持一致。

### Constraints

- 仅按嵌入的IPv4进行等价公网判定，不放行私网、回环、元数据、保留地址或一般IPv6过渡网段。
- 保留全部A/AAAA结果检查和socket地址固定；不通过忽略被拒绝记录、关闭TLS、DNS覆盖、环境代理或GitHub域名白名单绕过校验。
- 不读取或输出用户Token、Secret或授权码；实网验证仅访问无认证的公开端点，不代用户发起或完成OAuth授权。
- 不修改用户DNS、代理、凭据、已有会话或数据库；提交仅按用户明确指令执行，不推送。

### Acceptance Criteria

- AC1：点分十进制及十六进制形式的公网IPv4-mapped IPv6与原IPv4获得相同判定，原生公网IPv6行为不变。
- AC2：两种写法的私网、回环、元数据、保留IPv4映射仍拒绝；包含任一非法DNS结果时，请求在创建socket前失败。
- AC3：合成GitHub授权码交换/账号读取通过真实OAuth适配器及受控网络请求，混合A/AAAA映射不再触发PRIVATE_NETWORK；原地址固定、取消与错误安全行为保持。
- AC4：受影响源码测试、类型、静态检查通过；文档准确说明判定语义和真实账号未自动验证的范围。

## UseCase

- UC1：DNS返回公网A记录和等价映射AAAA，GitHub插件交换凭据及读取账号按既有流程继续，不要求修改Client或回调配置。
- UC2：DNS混合公网与映射私网/回环记录，保持拒绝且不发送凭据；文字形式或IP地址大小写变化不能绕过拦截。
- UC3：Skill后续访问公开网页时采用同一映射规则，宿主私有网关仍仅通过已注册的准确地址授权。

## Tasks

- [x] 实测DNS并定位与错误映射的源码链。
- [x] 补充能复现误判的公网映射与恶意映射回归。
- [x] 修复授权和Web网络判定，保留全量检查及socket固定。
- [x] 执行定向验证及无认证公网探测，更新技术文档和验证证据。

## Issues

本机github.com的A记录为100.12.0.13，AAAA为::ffff:100.12.0.13；api.github.com也返回同类映射。当前IPv6规则只允许2000::/3中的非禁用网段，未识别::ffff:0:0/96承载的IPv4，导致合法IPv4通过而其等价AAAA失败。错误在交换凭据的socket创建前产生，不是GitHub返回的OAuth客户端错误。

修复将重复IP段表集中到execution/web的纯isPublicAddress，映射地址借Node BlockList按内嵌IPv4检查，integrations与Web各保留自己的错误类型。回归先复现截图错误，再验证公网映射及私网拒绝；完整结果与真实授权边界见[验证](verify.md)。
