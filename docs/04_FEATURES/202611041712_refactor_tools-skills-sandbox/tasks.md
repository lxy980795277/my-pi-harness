# 实施任务与验收顺序

状态：实现及本机工程验收完成；未安装的办公转换依赖、真实模型及正式桌面/Windows验收单列保留，见[验证记录](verify.md)。功能范围见[Spec](spec.md)，架构决定见[设计](design.md)。实现按依赖顺序推进，只有对应检查真实通过才能勾选；不为每阶段单独提交或升版。

## P0 设计落盘

- [x] 核对现有工具、Skill、插件、Office及sandbox调用关系，结合独立审查确定长期职责。
- [x] 明确tools/src/tools命名、独立sandbox、办公Skill化、删除execution及未来领域贡献方式。
- [x] review包边界、命令拥有者、通用产物不可变快照与功能迁移清单（AC-01/02/04/06/08/09）。

## P1 宿主访问与进程底座（AC-04/05/07/10）

- [x] 建立sandbox实际package、exports/编译面及单向依赖；将文件守卫、网络原语、平台隔离、环境和进程监管迁入各自模块。
- [x] 统一受限字节进程和明确启动Spec，保留MCP背压/写前取消、进程组与管道收束；移除底层MCP及Office错误语义。
- [x] 实现OS只读/工作区写/宿主执行的明确能力，保持当前默认选择；隔离不可用不回退，full-access不关闭专用网络/文件守卫。
- [x] 增加所属进程watchdog与daemon异常退出回收，明确平台支持及脱组后代边界。
- [x] 验证并发工作区、profile/敏感目录/链接、不同环境、启动失败、排队取消、leader退出、TERM升级、管道不关闭和重复close。

## P2 注册与领域接入（AC-01/02/03/10）

- [x] 建立tools及完整ToolRegistration/Registry，分离可序列化描述与内存executor；来源不能成为第二套dispatch键。
- [x] 迁移内置工具schema、参数相关策略、可用条件和执行工厂；保留TypeBox及原始JSON拒绝语义。
- [x] 为Work、子任务、目录搜索、Skill激活及MCP定义窄端口，由宿主/运行时绑定；不引入万能Host或具名execute总线。
- [x] ToolRuntime保留审批/记账/Pi桥接；删去family switch与多套按工具名维护的可用/只读/默认集合。
- [x] 保留run.accepted/tools_loaded提交屏障、每Run能力集合和授权代次复核；主子executor重新绑定。
- [x] 测试未来领域样例贡献、冲突、动态工具撤销、只读工作区与会话控制、未知外部结果及未进入execute的失败。

## P3 Skill与插件资源（AC-03/07/11）

- [x] 把目录/解析/资源版本/安装能力迁入tools/skills，把插件manifest/资源组合迁入tools/plugins和resources/plugins。
- [x] 继续由daemon管理安装开关/配置，integrations保留OAuth/MCP协议；无tools与integrations实现循环。
- [x] 建立精确资源物化及独立租约，load_skill返回可执行只读目录；共享格式资源依赖使用manifest/hash冻结。
- [x] 测试未激活、hash变化、停用/重装/撤销、受限/角色只读模式的资源写入与profile访问、full-access的明确保证范围、子任务隔离及进程仍持有资源时清理。

## P4 通用命令、读取与产物（AC-05/06/09/11）

- [x] 实现run_command/wait_command/stop_command，命令生存期与工具等待分开；输出游标、状态和部分失败结果明确。
- [x] 宿主装配Session/任务命令服务，核对访问归属、并发/保留上限；取消/子任务结束/Session关闭/daemon退出正确收束，重启不执行旧命令。
- [x] 将通用文档提取与页图/图片读取接入read_document/view_pdf_page/view_image，保留附件能力与视觉模型限制。
- [x] 实现publish_artifact、不可变blob及同批产物事实、授权下载和主子通用产物展示；不信任stdout或MCP自报路径。
- [x] 测试后台长命令及wait/stop、超时/取消部分输出、跨任务访问、产物伪造/越界/源变更/未完成生产命令、提交失败/崩溃、blob损坏、配额/下载租约/回收与下载字节一致。

## P5 四类办公Skill（AC-08/11/12）

- [x] 独立编写四个Skill的依赖检查、普通创作、复杂编辑、结构/视觉检查和交付流程。
- [x] 迁移本项目格式能力为可组合CLI/helper；清理office\_\*总runner和旧JSON请求格式，不复制参考实现。
- [x] 完成DOCX中文长表、修订/批注/字段/模板，PDF分页/页面操作/choice与checkbox外观等格式回归。
- [x] 完成XLSX公式/缓存/图表及模板PPTX结构回归；PDF页图已实际查看。
- [ ] LibreOffice实际重算和DOCX/XLSX/PPTX转换/逐页视觉验收：本机未安装转换器，保留M4质量缺口。
- [x] 缺依赖、缺字体、无视觉模型、格式不支持、恶意包和未完成视觉验证分别记录，不能把脚本成功当完整质量验收。

## P6 收口与发布路径（AC-04/11/13）

- [x] 一次性移除office\_\*、pdf_read_pages、shell旧声明/检索/展示/schema、Office配置特例及下载白名单。
- [x] 删除旧execution包及依赖、paths、编译面、exports、旧dist/资源和测试引用；不留下兼容转发。
- [x] 更新源码规则和依赖门禁，加入正反fixture；tools不得反向引用runtime/daemon/storage，允许必要protocol DTO；sandbox另不得引用tools/integrations/Pi或业务protocol。
- [x] 更新真实架构、用户指南、协议和技术文档；将本设计中已实现事实移入权威文档，不让设计与实现并列成为两个事实源。
- [x] 更新prepare-desktop/smoke和资源校验，构建后在独立目录实际加载新包、worker、Skill脚本、文档工具及产物下载。

## P7 综合验收（AC-01至13）

- [x] 执行相应源码、TypeScript、格式/静态/边界及真实临时JSONL/SQLite回归。
- [x] 主子Run分别完成Skill→命令→wait→文档/图像复验→产物注册→浏览器下载。
- [x] 完成真实受管命令、受控HTTP模型和浏览器闭环，实际查看PDF中文长表和下载卡片。
- [ ] 真实模型、正式macOS Electron安装包和Windows：本轮未执行，不据工程测试宣称通过。
- [x] 核对无旧工具/runner/依赖残留、无权限或加载时机回退、无恢复时重执行。
- [x] 验证完成后创建verify.md，逐项更新AC、roadmap和剩余缺口；提交仅在用户明确要求时进行。

## P8 单工具文件与完整目录整理（2026-11-05，AC-14）

- [x] 将27个工具按名称平铺为独立文件，参数、元数据、策略和执行入口放在同一工具文件。
- [x] 提取真实共享的文件访问与格式、文档输入、网络传输辅助实现；删除旧工具组目录及按名字派发的文件操作实现。
- [x] 解除领域端口对工具Schema模块的反向引用，原生目录由工具出口装配，移除无消费者或重复的定义清单与低层工具公开出口。
- [x] 更新全部消费者及测试，验证工具定义、可用条件、权限与主子执行语义；同步README、技术文档和验证记录。

## P9 配套源码组织对齐（2026-11-05启动，2026-11-06收口，AC-15）

- [x] 将正文Worker适配及错误归并到utils/document-text.ts，删除documents目录与旧叶入口。
- [x] 将注册类型、工厂和注册器归lib/tool-registry.ts，原生装配与检索分别归根workspace-tool-registry.ts及utils/tool-search.ts，删除registry目录。
- [x] 公共上下文归lib/tool-context.ts，工具专属输入和回调类型归所属工具文件，删除ports目录及重复辅助入口。
- [x] 同步所有消费者、exports、tsconfig/Vitest别名、部署验证与文档，清理旧dist，验证声明、权限、主子执行及文档解析行为。
