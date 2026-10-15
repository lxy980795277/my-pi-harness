# Electron与PC约束

本页规定桌面实现与发布必须满足的要求；当前已实现范围以 [架构](../01_ARCHITECTURE/overview.md) 和所属功能验证为准。后续要求不表示能力已经实现。Web Renderer复用浏览器页面，桌面专有能力通过有限协议接入。

main/preload与构建工具使用strict TypeScript和NodeNext；包内ESM导入保留编译后的`.js`，不将Web的无后缀或UI风格规则强施宿主代码。通用类型、外部解析、错误、日志与持久化见 [后端规范](backend.md)，Renderer见 [前端规范](frontend.md)。

## 进程职责

| 进程            | 职责                                                   | 禁止承担                                    |
| --------------- | ------------------------------------------------------ | ------------------------------------------- |
| main            | 窗口、菜单、系统对话框、受控资源路径、daemon监督和退出 | Agent Loop、长计算、数据库和工具执行        |
| preload         | 固定桌面方法映射为IPC，校验跨进程响应                  | 通用IPC代理、业务状态、文件系统和Shell入口  |
| Renderer        | 共享React页面、HTTP/SSE、桌面能力的状态呈现            | Node、Electron内部API、凭据或可执行文件选择 |
| 独立Node daemon | 应用服务、Agent、工具策略、存储与后台任务              | Electron窗口与Renderer对象                  |

main不执行同步网络、重型文件遍历或CPU密集任务；耗时工作交给实际拥有该职责的服务或worker，保留取消和进度。将同步调用包进async函数不能消除阻塞。[Electron性能建议](https://www.electronjs.org/docs/latest/tutorial/performance)

## 窗口与页面

- 产品窗口明确设置 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；保持webSecurity，不启用不安全内容、实验性Blink能力或远程Node集成。
- preload用contextBridge公开具体方法，不向Renderer提供ipcRenderer、Electron事件对象、require、process、任意channel或动态代码。订阅包装回调并返回取消订阅函数。[Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)、[IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- main从受控开发URL或随包daemon地址决定页面来源；解析URL并比较协议、hostname、port。禁止子串或startsWith代替完整origin检查。
- 限制页面导航、服务端重定向和新窗口。主动loadURL前也校验目标；will-navigate不覆盖main主动加载，重定向独立处理will-redirect。默认拒绝新窗口，不把未知目标交给shell.openExternal。[webContents导航事件](https://www.electronjs.org/docs/latest/api/web-contents)
- session同时设置权限检查与权限申请处理，默认拒绝。必要权限按当前窗口、frame、来源和种类建立最小白名单，不默认允许摄像头、麦克风、定位、通知和屏幕捕获。[session权限处理](https://www.electronjs.org/docs/latest/api/session)
- 不接入webview或可加载任意远程页面的通用窗口；后续必要时定义独立session、导航、权限与桥接规则，不复用产品特权preload。
- 发布页面由daemon以同源HTTP托管，属于本机回环通信；外部资源要求HTTPS，不降低远端证书检查。
- 发布CSP限制frame、object、base、脚本与连接来源；Radix动态style使用每次响应的nonce，不启用unsafe-eval/unsafe-inline。开发HMR例外不能带入生产；Renderer隔离不等于daemon工具的OS sandbox。

## IPC检查

main先核对sender是当前拥有的webContents、senderFrame是主frame且URL是预期origin，再校验参数并调用具体能力。另一窗口即使加载相同URL也不自动获得权限；子frame、已销毁窗口或非法URL直接拒绝。

跨进程请求和响应由protocol定义。只传可序列化的公开DTO，不传窗口、Error原型、句柄、服务对象或内部路径。错误使用安全响应，不带堆栈和凭据；无参数方法不能扩展成任意channel调用。

```ts
// 固定方法和channel由preload决定。
contextBridge.exposeInMainWorld('desktop', {
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
});
```

此片段只说明方法映射，真实实现还需要来源与响应校验。

## 启动与退出

- main持有启动取消信号和daemon句柄；下载、就绪等待或页面加载期间退出，取消剩余步骤。退出开始后不创建新窗口或遗留新服务。
- 开发等待真实HTTP就绪，发布等待经过schema校验的daemon.ready。等待有总时限、单次请求时限和取消；进程退出、spawn error或无效记录立即失败，不用固定sleep代替。
- daemon使用独立Node；发布按process.resourcesPath定位随包Node与JavaScript。生产忽略开发可执行文件、页面URL、tsx和源码覆盖项，不要求用户预装Node或pnpm。
- Electron启动入口清除ELECTRON_RUN_AS_NODE等改变启动模式的宿主覆盖项；不得用Electron的process.execPath冒充独立Node。开发和发布准备共用已校验的Node资源流程。
- stop幂等，重复请求共享关闭结果；先IPC正常关闭，再有界等待，超时按平台强制回收。确认真实exit/close，child.killed仅表示已发送信号。[Node子进程](https://nodejs.org/download/release/v24.20.0/docs/api/child_process.html)
- before-quit阻止重复退出绕过清理；启动失败回收已获得资源，窗口关闭清除引用。当前关闭最后窗口即退出，不隐式增加托盘或macOS驻留模式。
- daemon监测所有者IPC失联和父进程存活，不仅依靠before-quit；Windows注销和关机不保证发出该事件。[Electron应用生命周期](https://www.electronjs.org/docs/latest/api/app)
- 开发聚合脚本拥有自己启动的进程组或进程树，正常退出和单个子进程失败都回收其他服务；禁止按端口或进程名误杀独立服务。

当前开发聚合工具在POSIX使用自己创建的进程组并有界回收，在Windows等待taskkill结果及所属child退出。taskkill需要leader仍存在，leader提前退出后不能据此证明全部孤儿后代已回收；需要完整Windows任务进程树保证时采用Job Object或等价平台所有权，不能复用开发工具的限制来声称工具隔离已完成。

## 跨平台与资源

用node:path处理磁盘路径，用fileURLToPath转换模块URL，不把URL.pathname当Windows路径。spawn传程序和参数数组，验证空格、中文路径与盘符；不假设bash、chmod、POSIX信号或进程组在Windows存在。

Windows环境变量名不区分大小写，env不能同时保留Path和PATH。`.cmd`/`.bat`不是普通原生可执行文件，不能假设execFile直接支持；所需shell明确选择，不拼接未知参数。[Node Windows进程说明](https://nodejs.org/download/release/v24.20.0/docs/api/child_process.html)

原生模块按实际加载宿主构建：better-sqlite3在独立Node daemon中使用，面向随包Node版本和平台架构；main/preload中的原生模块才面向Electron ABI。禁止混用两套二进制。[Electron原生模块说明](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

安装资源只读；SQLite与缓存沿用明确用户profile，会话JSONL按[架构](../01_ARCHITECTURE/overview.md)使用仓库根隐藏目录，独立安装包要求显式指定日志根，不写app.asar或安装路径。下载缓存使用独立临时目录，校验和解压完成后原子发布manifest；命中仍检查实际资源，失败不留可命中的半成品。生产依赖的符号链接不得指向源码仓库或应用资源之外。

## 发布与验收

应用版本、打包范围与当前签名状态见 [发布规范](../06_RELEASES/overview.md)。正式发布验证安装路径启动、无源码依赖、资源完整、进程退出、升级迁移和卸载数据政策，macOS与Windows分别提供证据。

macOS签名与公证、Windows代码签名分别实施；随包Node/helper纳入签名检查，凭据不进仓库。ad-hoc开发签名不能宣称已正式公证。[Electron代码签名](https://www.electronjs.org/docs/latest/tutorial/code-signing)

发布加固评估关闭RunAsNode、NodeOptions和调试CLI fuses，并配合ASAR完整性与仅从ASAR加载，以实际Electron版本和打包smoke验证。独立Node另行审查，fuses不充当工具sandbox。[Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)、[ASAR Integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)

Computer Use排除在当前版本之外。截图和桌面捕获不能提供完整Accessibility树与定向输入；后续专项定义原生helper、系统授权和平台验收。
