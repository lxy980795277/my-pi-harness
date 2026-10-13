# TypeScript约束

- 使用ESM、strict，并启用noUncheckedIndexedAccess与exactOptionalPropertyTypes。
- 包间用包名导入，包内相对导入使用`.js`；不得深层跨app导入私有实现。
- 公共DTO/schema由protocol导出；服务内部对象、配置和凭据类型留在所属进程。
- 不使用无依据的any、双重断言或非空断言掩盖不确定类型；外部输入先视为unknown再校验。
- HTTP、IPC、配置、模型工具JSON、持久化记录和子进程消息执行运行时校验；同进程静态类型已要求的值不添加猜测性兜底。
- 使用可辨识联合表示状态，避免多个布尔值组合隐含生命周期。
- 错误码属于实际领域或协议所有者；API映射安全消息，不把所有业务错误缩减为不可区分字符串，也不提前建立泛化全局错误枚举。
- 导出函数、类和协议记录调用者需要的非显然行为、失败与所有权；命名清晰，通用转换优先复用可靠依赖。
- 异步资源应支持取消、超时与清理；不忽略Promise或保留无说明空catch。

源码与构建产物的解析规则见 [架构](../01_ARCHITECTURE/overview.md)，不通过指向旧dist的alias让源码检查偶然通过。

## 类型与命名

类型用PascalCase，值与函数用camelCase，固定协议常量用UPPER_SNAKE_CASE。路径与业务模块采用kebab-case；沿用框架所需的配置文件名。一个类型由真实所有者定义，只有实际跨端共享的内容进入protocol，不建万能types包。

优先interface描述可扩展对象，type描述联合和组合；协议ID的语义在所属类型明确。简单闭合字符串集合用字面量联合或as const映射，不机械将所有字符串和数值改为enum。DTO类型从schema派生，避免手写接口与schema漂移。

外部JSON使用unknown并经过schema或类型守卫收窄。any仅用于依赖确实无法表达且局部可解释的接口，不扩散到业务返回值；as unknown as T、ts-ignore或非空断言不能替代缺失校验。合法边界需要typeof/instanceof，不能照搬全面禁止这些检查的规则。

```ts
type RunState =
  | { status: 'running'; runId: string }
  | { status: 'failed'; runId: string; code: 'MODEL_UNAVAILABLE' };

function describeRun(state: RunState): string {
  switch (state.status) {
    case 'running':
      return state.runId;
    case 'failed':
      return state.code;
  }
}
```

此例说明可辨识联合；真实运行ID和错误由所属领域定义。闭合状态新增成员时更新全部处理分支；协议扩展事件明确未知类型政策，不用default静默吞掉新值。

## 错误与异步

catch参数保持unknown，窄try只包可能抛错的操作。处理已知可忽略错误时说明具体错误与原因，其他错误继续传播；禁止空catch、每层统一返回undefined或把所有Error改成同一字符串。

Promise要await、返回，或以void明确后台任务并附错误处理；void不能消除失败责任。超时、AbortSignal和dispose由资源拥有者贯通，下层保留具体失败原因。配置默认值在显式解析阶段产生，不对类型已经保证的服务字段增加防御性空值替换。

## 模块与可维护性

import type只导入类型；Node能力使用node:前缀并留在宿主模块。protocol不能包含Node/Electron、环境读取、数据库对象或Pi实例。一个package只声明自己直接使用的依赖，不依靠根包或传递依赖偶然解析。

文件大小和拆分判断见 [禁止事项](forbidden.md)。拆分围绕职责与依赖，不用重复转发文件或超深目录规避阈值。注释记录调用者需要的失败、时间、所有权和非显然限制；不写开发过程、逐行翻译或已经失效的实现说明。
