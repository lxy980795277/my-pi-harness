# 产物宿主服务

`ArtifactService.publish`接收工作区相对路径和当前工具的会话、Run、Task、toolCallId归属，复核工作区身份并稳定读取常规文件；路径遍历、受保护路径、符号链接、硬链接、读取中变化、类型不符、取消和大小超限均拒绝。它通过storage写入不可变blob，只返回元数据，不自行记录成功事件。可选producerCommandId由装配的命令端口先核对同归属且已经成功结束，再调用本服务。

运行时将返回的Artifact写入成功工具记录，并在同一终态批次追加`artifact.published`和canonical结果。普通stdout、模型文本和MCP结果都不构成宿主注册。成功写入blob后批次未提交会留下无引用文件；明确失败时释放发布引用，提交结果未知时保留至重启。配额、hash、下载租约与回收由[storage](../../../../packages/storage/README.md)拥有。

会话产物路由通过`/api/sessions/:id/artifacts/:artifactId`下载，沿用应用登录验证并核对当前分支可见性；它只读注册时的受保护blob，不重新打开工作区源文件，也不接受任意下载路径。`close`拒绝新增发布、取消在途文件读取并等待它们结束。
