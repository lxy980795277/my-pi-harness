# 本地检索与模型资源

`SearchService`拥有认证查询、索引命令和显式模型准备。人工搜索、模型历史检索与记忆召回统一调用其queryScoped，接受同一服务取消和关闭管理；MemoryRetrieval只消费搜索结果和相关性复核，不另建查询引擎。`SearchIndexer`按持久正文/hash与成员关系增量更新FTS、精确向量及代际；`PersistentSearchQuery`先过滤宿主scope，再独立产生词法和语义候选并融合。短词、来源窗口、降级及索引覆盖均有明确结果，不从live输出或私有请求日志提取正文。

`LocalSearchModelResource`是唯一宿主队列和Node Worker拥有者，提供embedding与reranker两个窄视图。两份模型分别记录状态、准备与取消，固定定义见`embedding-model.ts`和`reranker-model.ts`；复核模型不改变已有embedding索引签名。准备目标可以下载固定资源，普通推理只用绝对缓存路径和local-only加载。GET状态和普通查询不下载模型。

`tool-search-embedder.ts`单独适配M4工具目录协议，将document/query映射为共享embedding视图的passage/query及tool优先级；Worker拥有者不依赖工具接口。embedding用于持久检索和M4工具目录；reranker只核验自动回忆候选，不把embedding余弦当作采用概率。复核使用原始query/passage pair，不加E5前缀；实际超过512 tokens的pair明确返回null，其余合法项继续推理，不悄然丢尾。候选scope、当前body hash、纯领域选择及派发前复核由memory相关拥有者处理。

宿主持有待派工作，前台优先且有有界公平性，后台小批让出；复核每批最多四对。活动取消可以先拒绝调用者，但只有真实settled才释放执行容量。不可抢占的准备期间，前台推理明确BUSY并降级，不能排在下载后耗尽请求时限。关闭终止唯一Worker并等待退出；取消准备或Worker崩溃后，两模型驻留状态都重新从各自缓存判断。

模型状态与准备路由由本目录`routes.ts`声明，真实质量、离线和性能证据见[M6验证](../../../../docs/04_FEATURES/202610301722_feature_m6-memory-search/verify.md)。
