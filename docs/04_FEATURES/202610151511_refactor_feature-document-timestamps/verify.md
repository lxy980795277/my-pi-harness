# 功能文档分钟目录迁移验证

日期：2026-10-15，北京时间。范围为文档目录、引用、规则与针对性测试；未提交或推送。

## 结果

| AC/UC         | 结果 | 证据                                                                                                         |
| ------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| AC-01 / UC-01 | Pass | 8个历史目录迁移；移动前后逐文件比对，16份Spec/verify仅发生路径引用替换，原正文与验证证据保留                 |
| AC-02 / UC-01 | Pass | 全仓更新16份含旧路径的文本文件；旧目录引用搜索无残留，Markdown链接检查通过                                   |
| AC-03 / UC-02 | Pass | 功能入口、AGENTS、工作流与路线图统一北京时间分钟格式；明确历史分钟仅排序估计，后续小修沿用原目录             |
| AC-04 / UC-03 | Pass | 23项真实文档检查测试通过，覆盖合法日期/分钟、三类目录、旧格式、非法日历/时间、slug、缺Spec、旧链接和末尾换行 |

## 实际检查

- `pnpm exec vitest run tests/unit/docs.test.js`：23 passed。
- `pnpm exec eslint scripts/check-docs.mjs tests/unit/docs.test.js`：Pass。
- `node scripts/check-docs.mjs`：Pass，检查目录命名、Spec文件、链接及末尾换行。
- 相关Markdown、脚本与测试已由Prettier格式化；历史16份Spec/verify格式化结果均unchanged。

运行环境为本机Node 24.20.0与pnpm工作区。未修改产品业务代码，不用本次结果声明浏览器、模型、桌面产物或平台行为已重新验证。历史补齐的分钟没有真实开始时间证据，只用于目录排序。

## 连续时间戳修正

按用户补充，最终目录格式为 `YYYYMMDDHHmm_category_name/`，日期与小时分钟之间不加分隔符。包括新增M2收尾Spec在内的10个当前目录已迁移；19份既有文档逐文件比对，仅替换路径与格式引用，21份含引用文本同步。上文8目录、16文档和23项检查记录保留初次历史迁移的证据。

- `pnpm exec vitest run tests/unit/docs.test.js`：24 passed，新增日期与时间分隔符的实际拒绝用例。
- `pnpm exec eslint scripts/check-docs.mjs tests/unit/docs.test.js`：Pass。
- `node scripts/check-docs.mjs`：Pass，63份Markdown检查通过。
- AGENTS、工作流、路线图、功能入口与命名检查统一为12位连续时间戳；已有Spec/verify内容保留，不另建修正功能目录。
