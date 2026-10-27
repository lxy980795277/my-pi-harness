# Skills

`SkillsService` 只读取注册的 profile、项目和已安装插件目录；停用的插件Skill保留目录元数据并标为不可用，不授予文件执行或工具审批权限。目录元数据经公开协议返回；激活时校验选择版本，将完整指令和有界资源复制为不可变版本，调用方把 `FrozenSkill` 写入 JSONL。

调用方使用 `freezeSelections` 接受新选择，使用 `validateBindings` 和同步 `assertBindingsCurrent` 检查原授权；`retainBindings` 返回幂等释放函数，活动租约阻止所属资源卸载。正文变更不改写已有快照，停用、卸载、重新启用及插件重装均使旧授权失效。

受保护 API 包括目录、详情、创建、固定 GitHub 提交安装、控制、卸载、显式资源读取和注册目录解析。创建和安装只启用完整的新目录；取消及关闭等待所属暂存清理。兼容发现的项目 Skill 和插件 Skill 不能从独立卸载接口删除；插件目录中新出现但没有精确组件引用的Skill保持停用，不能绕过插件开关进入Run。桌面目录入口只接收 Skill ID，由宿主解析真实注册路径。

作用域、限制与验收范围见 [M4设计](../../../../docs/04_FEATURES/202610201932_feature_m4-capabilities/skills-plugins.md)。
