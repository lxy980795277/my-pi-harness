# 安全与权限

daemon仅回环监听，不因方便开发而默认绑定外部网卡。所有可改变本地状态的API在对应功能落地时建立来源与授权检查；桌面桥白名单与HTTP工具审批分别执行，不互相替代。

具体工具、连接信任与审批模式在所属功能Spec和协议中定义，不将尚未实施的安全能力写成已经存在。

## 信任与授权

HTTP、IPC、配置、文件、持久化记录和模型输出均为外部输入，在所属入口校验大小、schema、版本和关联；同进程已声明类型的值不增加猜测性兜底。模型与外部文档指令不能覆盖应用策略。

回环监听不能自动阻止恶意网页或本机进程访问。有状态API开放前建立Host、来源、认证和授权规则；CORS不是认证，没有Origin也不等于可信，不将Token放URL或SSE查询字符串。

审批针对具体解释后的动作，记录目标、范围、有效期、关联toolCall和撤销语义；一次许可不自动授权后续全部路径。读取、写入、删除与执行权限分别定义，审批通过和执行成功使用不同状态。

## Electron隔离

窗口设置、导航与重定向限制、默认拒绝权限和IPC来源校验由 [桌面约束](desktop.md) 统一规定，不能只校验URL而忽略窗口与frame。[Electron安全指南](https://www.electronjs.org/docs/latest/tutorial/security/)

发布CSP限制frame、object、base及脚本、样式、连接为同源；开发Refresh/HMR的nonce和WebSocket例外不带入发布。不以通配来源或unsafe-eval解决连接问题。Renderer sandbox不隔离daemon工具，Node Permission Model也不构成执行恶意代码的安全sandbox；OS执行隔离需独立实现。[Electron sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox/)、[Node权限模型](https://nodejs.org/download/release/v24.20.0/docs/api/permissions.html)

## 路径与副作用

文件创建检查已存在父目录，读取和修改检查真实目标与Workspace范围；不能用字符串startsWith代替路径包含判断，也不能认为一次realpath消除所有竞态。执行前再核对目标，受保护凭据目录与安装资源不是普通可写文件。

Shell明确程序、参数、cwd、环境白名单、AbortSignal、总超时和输出上限；未知文本不能拼成宿主命令，必要shell语法由对应工具明确承担。

工具取消、超时和输出超限都回收所属进程树；POSIX与Windows分别实现，不按名称杀其他进程。隔离初始化失败明确报错，不能静默退回宿主执行；必要的无隔离模式必须有独立政策和授权记录。

断线或超时不证明副作用未执行。保存已完成部分、结果未知和恢复证据，不自动重试未知结果，不把审批、执行、持久化和撤销合并成同一个成功状态。

## 网络、插件与OAuth

抓取限制协议、响应体、解压、重定向次数与总时间，每次DNS和重定向检查实际目标。默认限制localhost、私网、链路本地和云元数据地址；配置本机网关时只开放所需地址与能力，不开放全部私网。

安装插件或连接MCP不自动授予任意本机权限。所属模块校验安装来源、资源位置、启动程序、运行策略和输出；第三方结果进入上下文时保留来源，不执行附带指令或代码。

OAuth所属Spec定义state、PKCE、回调允许项、超时和重放拒绝；回环回调完成后关闭。Token留在服务侧，授权状态DTO不含凭据，不用通用shell.openExternal替代OAuth流程。

## 凭据与诊断

API Key、OAuth Token和环境密钥留在服务侧，不进入Renderer状态、公开DTO、URL、普通日志或trace导出。凭据持久化使用系统凭据能力或受控加密存储，确认平台支持；业务SQLite与ASAR不充当安全密钥库。日志脱敏覆盖headers、query、参数、响应和异常cause，不能只掩盖名为token的字段。

诊断导出使用脱敏摘要与明确用户选择；测试用假凭据证明不泄露。不读取、上传或复制当前任务无关的秘密文件。安全拒绝验证覆盖非法输入、其他窗口/子frame/外站、越界、未授权动作、取消和超时，规则文本及全mock测试不能替代实际拒绝证据。
