# Sandbox

`sandbox`拥有通用宿主文件守卫、公网地址判定和受监管字节进程，不依赖工具目录、集成协议、Pi、数据库或应用DTO。文件与地址守卫是宿主API校验；只有进程的macOS Seatbelt策略提供OS隔离。

## 文件与地址

`resolveWorkspaceRoot`注册真实工作区根；`canonicalWorkspace`复核保存的路径。`workspacePath`拒绝越界、链接、敏感名称及跨平台歧义文件名。`openRegular`持有单链接常规文件的inode；`readStableFile`有界读取并检查描述符元数据、最终路径身份及观察到的替换。父目录的并发重命名仍需要OS目录能力，不能以这些检查声称消除了所有文件竞态。

文件守卫与Seatbelt从同一敏感名称声明生成规则，大小写均受保护。文件API拒绝`.git`路径；进程允许读取`.git`，并拒绝写入。`isPublicAddress`将IPv4-mapped IPv6交给相同的IPv4规则；DNS全结果校验、socket固定、重定向和凭据目标由调用方的传输拥有。

## 进程

先调用`resolveProcess(input)`，再调用`startProcess(launch, observer, signal)`。解析阶段冻结程序、绝对文件参数、工作区及精确只读资源目录的观察身份，启动前复验；程序别名保留用于虚拟环境定位，同时核对真实目标。可执行文件和依赖在系统执行时仍可能变化，身份检查不等于冻结整个运行时。

`scope`映射既有受限或完全访问选择；`access`可进一步明确为`read-only`、`workspace-write`或`full-access`。受限策略默认断网，拒绝profile和敏感路径，只读资源按精确目录读取并禁止写入。只读角色必须显式收窄为`read-only`。完全访问直接使用宿主用户权限；环境仍显式构造，但不宣称能阻止获准Shell访问宿主路径或改写资源。额外解释器库和Skill资源均通过`readOnlyDirectories`由宿主明确提供，不隐式开放程序所在的父目录。

`ManagedProcess`提供stdout/stderr观察、`write`、`exit`、`closed`及幂等`close`，不暴露`ChildProcess`。写入队列在排队后和派发前复核取消；调用方的`beforeWrite`负责已可能写入的业务屏障。输出累计量、速率、队列及可选总生存期独立受限。自然退出和非零退出由`exit`返回，资源故障通过observer报告；`closed`只在进程组、管道和私有临时目录收束后完成。需要短命令收集时可用`collectProcess`，需要后台运行时由调用方保留进程拥有者及资源租约。

独立watchdog在启动目标前持有daemon控制管道；daemon崩溃或被SIGKILL后，管道EOF触发所属目标组的TERM、KILL升级、真实退出与管道回收。watchdog位于目标组之外，升级后仍能观察目标退出。daemon也保留所属组PID用于watchdog失效后的回收。主动脱组的后代不在现有保证内；无法收束的管道或进程明确报告清理失败。临时目录只归底层进程，业务产物目录由上层拥有。

当前仅实现并验证macOS，Linux和Windows在解析阶段明确拒绝，隔离不可用不会自动退回宿主执行。`test`覆盖真实临时目录、受控网络、字节背压、进程组与daemon异常退出；不读取真实profile、凭据或`.env`。
