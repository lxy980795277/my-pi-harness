# Web与桌面共用数据目录

## Spec

### Roadmap Alignment

属于M0启动及M1本地存储配置修复。用户确认修复Web与桌面切换时历史不互通；保留既有M6与自动客户端初始化行为，不扩展M7范围。

### Intent

让daemon配置成为数据目录解析的唯一所有者，独立Web与Electron开发/发布启动都使用同一默认profile并支持同一显式覆盖。保留已有桌面历史，避免启动空profile造成数据丢失的错觉。

### Constraints

- macOS默认固定为`~/Library/Application Support/@my-pi-harness/desktop/profiles/default`，沿用已有桌面数据命名空间，不再依赖Electron应用名或userData；Windows继续使用LocalAppData下`My Pi Harness/profiles/default`。
- `MY_PI_HARNESS_PROFILE_DIRECTORY`显式覆盖默认，两入口均由daemon校验。进程环境优先于Node env-file；开发child加载根.env，发布child只加载随包公开OAuth配置。
- Electron userData只隔离Cookie与缓存；业务profile和会话日志根独立配置。桌面smoke必须显式传入临时profile，不能依赖`--user-data-dir`隔离数据库。
- 不移动数据库、JSONL、附件或凭据，不清空真实数据、不自动合并两个profile，不改变既有路径派生的JSONL和系统凭据命名空间。
- 保留profile排他锁；同一profile只允许一个daemon持有，两个前端同时使用时连接同一daemon，不新增多写入者或实例自动接管机制。

### Acceptance Criteria

1. 独立daemon与桌面child无显式覆盖时使用相同数据目录，已有macOS桌面路径保持。
2. 桌面child尊重进程及env-file中的profile配置，错误路径交daemon拒绝，Electron userData不改变选库。
3. 顺序从两种入口读取同一临时profile，可恢复同一会话与配置；并发另开同profile被锁拒绝。
4. 桌面smoke显式隔离profile和日志，现行文档同步，相关类型、源码、构建及定向回归通过。
5. 真实旧会话文件和数据库保持原处；不停止用户正在运行的实例，不使用真实profile做写入测试。

## UseCase

| 用例               | 操作                                      | 预期结果                                  |
| ------------------ | ----------------------------------------- | ----------------------------------------- |
| UC1 默认切换       | 退出所属入口后用另一个入口启动            | 默认profile相同，历史与配置保留           |
| UC2 显式覆盖       | 两入口使用同一PROFILE环境配置或开发根.env | daemon解析同一绝对路径，进程环境优先      |
| UC3 两页面同时使用 | 桌面daemon运行时用浏览器访问其Web地址     | 使用同一服务和数据，客户端Cookie仍独立    |
| UC4 重复持有       | 另开daemon请求已被持有的profile           | 明确拒绝，不绕过锁或创建空库              |
| UC5 隔离验证       | 桌面smoke指定临时profile、日志与userData  | 业务数据和Electron Cookie均不触碰真实目录 |

## Tasks

- [x] 收敛daemon默认profile，删除desktop重复选择逻辑及废弃类型/文件名。
- [x] 补齐真实child配置优先级和顺序共享/锁保护回归，修复smoke隔离。
- [x] 更新架构、规范和使用说明。
- [x] 执行定向检查、构建和临时profile验证，记录真实数据保留与未验范围。

## Issues

独立daemon原默认`My Pi Harness/profiles/default`，Electron开发入口实际使用`@my-pi-harness/desktop/profiles/default`；JSONL和系统凭据均按规范profile路径派生标识，前者为空而后者保存4条历史，导致切换启动方式时历史不互通。修复统一默认与覆盖所有权，不通过迁移或客户端同步绕过配置问题。
