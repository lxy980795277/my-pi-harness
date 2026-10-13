# 验证与测试

Vitest验证业务判断、协议、配置和生命周期；Playwright验证真实Web/桌面交互。测试描述可观察行为，包含实际风险对应的非法输入、失败和清理路径，不镜像实现细节。

## 检查选择

根据改动选择最小覆盖范围，静态检查、行为测试、产物启动和人工体验分别提供证据。`pnpm check`聚合format、lint、typecheck和Vitest，不包括Playwright、完整打包或目标机器安装。

| 命令                   | 证据范围                                             |
| ---------------------- | ---------------------------------------------------- |
| `pnpm format:check`    | 格式                                                 |
| `pnpm lint`            | ESLint、a11y、依赖边界、源码约定、文档与版本检查     |
| `pnpm lint:a11y`       | Renderer可访问性规则检查；由lint统一调用             |
| `pnpm typecheck`       | workspace源码类型                                    |
| `pnpm test`            | Vitest源码行为测试，不依赖dist                       |
| `pnpm test:artifact`   | 真实构建后的daemon CLI、IPC及退出；先执行build       |
| `pnpm test:e2e`        | 构建Web与daemon的Playwright场景；先执行build         |
| `pnpm build`           | 构建与应用版本生成                                   |
| `pnpm smoke:desktop`   | 桌面产物启动，前提以脚本声明为准                     |
| `pnpm package:desktop` | 构建、桌面资源准备与应用目录打包；产物范围见发布规范 |

表中命令描述M0检查入口，脚本存在和源码审查不表示检查已经通过，实际结果由功能verify记录。首次M0验收可运行工程范围检查；日常局部改动不机械运行全部套件。已有通过结果只在代码、环境或未解决问题变化后重复。CI的职责是keyless全量与macOS/Windows平台矩阵；真实Provider或外部服务检查需独立配置，不能默默变成普通单测的费用依赖。

## 可靠性

- 单测可用可控替身；HTTP、SSE和子进程生命周期至少有真实边界检查，不能把所有外部交互都mock后声称集成通过。
- 测试使用临时目录和动态端口，负责关闭连接、计时器和进程，不污染用户数据或依赖共享固定端口。
- 时序测试等待明确状态，不使用任意sleep代替就绪信号。
- 错误输入、禁止来源、非法依赖或缺失产物的检查需要证明实际拒绝，不能只检查规则文本存在。
- 不在测试输出中打印密钥、认证头或真实敏感文件。

人工体验、系统授权、签名安装或真实API结果在verify单独标注；没有执行的路径使用Not verified。当前检查入口以根package.json为可执行来源，命令改变时同步本页。

## 按风险分配用例

| 改动                 | 单元/集成重点                            | 需要的额外证据                    |
| -------------------- | ---------------------------------------- | --------------------------------- |
| 配置或公开schema     | 有效输入、非法范围、未知字段政策、默认值 | 对应真实HTTP/IPC解析              |
| 状态、策略、工具判断 | 主路径、拒绝、取消、结果未知             | 真实副作用边界、用户结果          |
| 连接和子进程         | 分片记录、启动失败、重复关闭、父进程失联 | 构建后的CLI与平台退出             |
| 页面与交互           | 复杂纯逻辑和Hook状态转换                 | Playwright操作、键盘与视觉观察    |
| 存储与迁移           | 事务失败、顺序、重复、旧版本、损坏       | 真实SQLite、备份与恢复            |
| 打包和资源           | 配置及资源规则                           | 应用目录从临时cwd启动、无源码链接 |

不为简单DTO、纯转发route或只重复实现的断言机械增加单测。修复bug时优先建立能复现行为的回归；重构复用已有行为验证。组件布局用真实页面检查，不能把静态字符串比较当用户交互验证。

现有用例位于各app的test目录和根tests/unit、tests/e2e，沿用 `.test.ts`/`.test.js`；新目录随实际拥有者建立，不为复制参考项目改成另一套文件布局。单测通过源码paths解析，产物检查明确先build，不能混用旧dist。

## Mock与边界

单测可替换模型、MCP和网络等不可控依赖；repository行为使用临时数据库，HTTP/SSE和进程生命周期保留真实本机边界。外部真实Provider检查独立运行并标明需要凭据，普通CI不依赖用户Key。

mock只声明消费者实际需要的方法，以函数参数或工厂注入，不构造完整框架实例。不使用 `as unknown as Service` 掩盖缺失方法，Vitest类型从vitest导入，不写Jest的Mock命名空间。

```ts
import { expect, it, vi, type Mock } from 'vitest';

it('停止后只关闭一次连接', async () => {
  const close: Mock<() => Promise<void>> = vi.fn(async () => undefined);
  const resource = createOwnedConnection({ close });
  await Promise.all([resource.stop(), resource.stop()]);
  expect(close).toHaveBeenCalledTimes(1);
});
```

此例说明测试重复关闭的行为，createOwnedConnection是示意，不是已有API；实际进程退出仍用真实子进程验证。测试名描述观察结果，不写「正确运行」。

## 并发与失败清理

每个用例独占临时目录、动态端口和测试身份；使用真实网络时不依赖开发端口。失败时同样在finally/afterEach关闭响应、child、server和文件句柄；不能只清空测试变量。

改动process.env、process资源属性、cwd或全局mock的测试避免同进程并发，保存并恢复原值；不同worker仍需独立磁盘资源。并发缓存测试用可控gate安排交错，不能碰真实共享缓存或下载大运行时。

等待明确事件或有界轮询，超时是失败；fetch超时不能作为端口已关闭的证据，child.killed不能证明退出。退出测试观察所属PID实际消失、控制关闭原因和端口拒绝，避免误测另一个实例。

## 覆盖率与检查证据

覆盖率帮助找未覆盖分支，不能代替行为验收。业务判断、权限拒绝、异常与清理分支是重点；纯UI布局不以单元覆盖率评价。不复制参考项目的旧百分比和coverage命令：本仓库当前未设置覆盖率门槛，新增门槛时必须同时定义排除项、实际命令与CI，并记录结果。

提交hook当前执行lint-staged、lint、typecheck和Vitest，hook不是Playwright或安装验收。日常自测按风险选择，已有证据可复用；不能因规范写了某条规则便声称该条已有自动gate。

verify按UseCase记录命令、环境、结果与缺口；自动检查、人工体验、真实Provider、目标平台安装和签名分别列出。失败先记录复现和修复再验证，不预填通过、不提前生成验证成功文件。
