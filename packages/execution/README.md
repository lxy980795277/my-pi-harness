# Execution

`@my-pi-harness/execution` 实现 M2 的确定工具与本机执行，不创建 Pi Agent、保存会话、处理 HTTP 路由或拥有审批。daemon / agent-runtime 在执行前持久化 intent 并取得批准，再传入已注册的工作区真实路径、私有 profile 路径、只读策略与 AbortSignal。

## 接口与工具

`TOOL_DEFINITIONS` 使用 TypeBox 1.3，与 Pi 1.1 的 schema 类型一致。`describeTool` 只解释参数，不读文件；`executeTool` 校验完整参数并执行。`resolveWorkspaceRoot({rootPath, profileDirectory, signal?})` 供注册与执行共用，检查绝对路径、目录存在与可读、系统根/Home祖先、profile重叠与敏感目录。注册可以使用目录别名并保存返回的realpath；执行另外要求真实路径仍等于该保存身份，不能把后来替换的别名当原工作区。

文件变更、Shell 与所有 Web 请求要求批准；只读模式仍可批准网络 GET，但不允许 POST、文件变更或 Shell。执行结果的 image content 仅用于 Pi 私有上下文，公开事件投影只保留有界文本、summary 与 diff。

| 工具           | 行为                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `read_file`    | UTF-8 文本附 SHA-256 与行号；PNG/JPEG/GIF/WebP 返回 image content；PDF 在受限 worker 提取文本，无 OCR |
| `list_files`   | 有界工作区目录遍历，不跟随符号链接                                                                    |
| `search_files` | 有界 UTF-8 literal 搜索，不执行用户正则                                                               |
| `write_file`   | `expectedHash:null` 仅新建；替换必须匹配当前 SHA-256；同目录临时文件与原子替换                        |
| `edit_file`    | 匹配当前 SHA-256 后精确替换；默认只允许一个命中；返回统一 Diff                                        |
| `shell`        | macOS Seatbelt，无网络、独立 HOME/TMPDIR、环境白名单、限时和输出上限                                  |
| `web_fetch`    | 公网 HTTP(S) GET/POST；DNS 与实际 socket 绑定；逐跳检查；POST 重定向不自动重放                        |

路径必须相对工作区。拒绝 `..`、绝对路径、符号链接组件、私有 profile 的祖先/子目录，以及 `.env*`、`.ssh`、`.aws`、`.gnupg`、`.kube`、`.netrc`、`.npmrc`、`.git-credentials`、`.git`。读取和写入多硬链接文件也拒绝，避免通过第二个名称访问工作区外对象。父目录必须存在；读取可提供后续编辑所需的预像 hash。执行前重新核对工作区根仍等于注册的真实路径。

模型路径统一使用正斜杠，宿主生成的相对路径先转换到同一表示。为了跨平台保持同一目标，所有系统上的模型文件工具都拒绝冒号/ADS、Windows设备名及其扩展（包括COM¹/LPT³）、控制字符、`<>\"|?*` 与尾点/尾空格；目录遍历略过这些不能通过模型路径访问的名称。中文、普通空格和正常扩展可用。这些纯路径检查与macOS嵌套文件行为验证不等于Windows原生文件系统或Shell验收；Windows Shell仍明确不可用。

## 限制与隔离范围

文件工具使用组件 lstat/realpath、O_NOFOLLOW、打开后的 inode 检查、写前预像与父目录核对；Node 的文件 API 不提供完整 openat 目录句柄操作，这些检查不能消除恶意进程并发替换父目录的竞态。文件工具当前不提供抵抗同用户恶意文件系统并发修改的完整隔离保证。

Shell 的 Seatbelt 从 deny-default 开始，只开放工作区、独占临时目录与明确的系统/运行时工具链读取，允许写工作区和临时目录；profile 和敏感文件始终拒绝，网络不开放。系统元数据和根目录枚举是启动系统程序所需的只读例外。环境不继承模型凭据、SSH socket、代理、Node options 或用户 Shell 配置。Windows/Linux 未提供已验证的 OS 隔离时直接返回 `SANDBOX_UNAVAILABLE`，不退回宿主执行。

取消、超时、输出上限、执行失败和 leader 提前退出都先 TERM/KILL 自有 POSIX 进程组并确认没有存活成员，再有界等待输出管道关闭和清理临时目录。leader的exit开始回收，不代表输出已读完；仅在stdout/stderr及child close收束后生成成功结果，跨chunk的UTF-8分别解码。退出后的输出超限、读流错误和取消仍产生失败；无法确认回收或管道不关闭会明确报告清理失败，销毁本进程的读取管道，不返回部分成功。

测试覆盖继承该进程组的孙进程及忽略 TERM 的进程；主动 setsid/setpgid 脱离组的恶意后代不在该回收保证内，其 Seatbelt 限制仍继承。此实现不声称具备完整恶意进程容器所有权。

PDF worker 有 96 MiB V8 old-generation、10 秒与 20 页/100000 字符限制，退出/取消等待 worker 终止；只调用 `getDocument` / `getTextContent`，不装配 viewer 的 scripting 能力，也不加载外部资源。PDF.js 固定使用修复 [GHSA-hq66-cqwq-w95j](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j) 的版本；旧版的 `isEvalSupported:false` 不能代替升级。worker 是解析资源隔离，不是 OS 级恶意库代码沙箱。图片最多 2 MiB，仅确认格式签名，不承担完整图像解码或 OCR。

Web 工具只使用标准 80/443 端口，拒绝 URL 凭据、非公网地址、IPv4 映射/过渡 IPv6、HTTPS 降级和超过四次重定向。每次解析全部 A/AAAA 结果并检查，socket 使用已核对的地址；没有环境代理、cookies、认证头、重试或连接复用。总时间 15 秒、响应 500000 字节、模型输出 100000 字符。请求 identity 编码并拒绝压缩响应，防止隐藏的解压放大；二进制与非 UTF-8 响应明确失败。POST 结果不确定时由调用者展示执行事实，不自动重试。

## 验证

使用 `pnpm --filter @my-pi-harness/execution test`、`typecheck`、`lint` 运行本包检查。真实 macOS 测试覆盖网络/越界/敏感文件拒绝、取消、超时、输出上限、leader 提前退出与 TERM 升级；非macOS测试分支检查不支持时拒绝执行，Windows/Linux实机尚未验证。测试使用独占临时工作区和假数据，不访问真实用户凭据或真实供应商账户。
