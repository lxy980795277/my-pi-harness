# 附件

`AttachmentService`将用户上传或工作区引用冻结为Profile私有内容；文本限制256000字节，支持PNG/JPEG/GIF/WebP图片（签名与MIME匹配，2MiB）及PDF（8MiB），PDF复用有内存、时间和取消限制的解析worker，无OCR。文本与PDF保存提取内容，图片保存私有base64，公开元数据preview最多4000字符。上传不持久保存原始PDF，历史预览使用冻结的提取文本。

引用复用M2真实路径、敏感名称、链接与普通单链接文件检查，读取期间核对文件大小和修改时间，文本可选行范围；后续文件变化不改已发送内容。目录浏览只返回单目录内最多500项安全相对路径，最多检查5000项，目录末尾带`/`，链接与敏感项隐藏。应用数据目录不能作为引用来源。

路由必须装配在已有授权API范围内。`POST /api/attachments`接受base64且单请求body上限12MiB；`POST /api/attachments/reference`接受工作区相对路径；`GET /api/attachments/:attachmentId`只返回元数据，`/content`显式获取冻结文本或图片；`GET /api/workspaces/:workspaceId/files`返回`{paths}`。不存在的ID明确失败，内容不进入SSE或通用页面Store。附件不会上传到其他主机，只有用户将ID随输入发送后才由Runtime加入模型请求。

上传和引用请求断连会取消处理并等待资源回收；`close()`拒绝新任务、取消在途解析并等待worker退出，应用关闭需先等待此方法，再关闭底层Store。目录浏览是有界单目录遍历，不持有后台解析任务。
