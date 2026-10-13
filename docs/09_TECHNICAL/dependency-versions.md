# 依赖版本审计

审计日期：2026-10-13。本页记录本轮M0依赖选择及依据；实际版本由根 `package.json`、`.node-version`、`pnpm-workspace.yaml` 和lockfile拥有。后续更新这些文件时同步本页，不把本页作为另一份安装配置。

采用仍受支持、已有使用观察期且满足整套工具peer范围的版本线；不统一追随latest，也不因版本发布日期较早就认定过时。稳定tag、发布时间、支持政策和本仓库运行检查分别提供证据，任何一项都不能单独保证稳定。

## 证据范围

版本、npm tag、发布时间、engines与peer来自npm官方Registry，本轮摘录位于 `output/audit/dependencies.json` 与 `output/audit/candidates.json`。表内日期是所选版本的npm发布时间（UTC日期），不是GitHub发布日、安装日或功能线最初发布日期。ESLint与pnpm补充读取完整Registry元数据；Node日期来自官方发行索引。

下表列出全部37项catalog及两项根运行工具。链接指向原始包元数据，`time[版本]` 可复查发布时间，`versions[版本]` 可复查engines与peer；dist-tags会变化，因此本页结论限定审计日期。

## Node、包管理与桌面

| 依赖                                                            | 选择    | 发布日期   | 本轮处理与依据                                                                |
| --------------------------------------------------------------- | ------- | ---------- | ----------------------------------------------------------------------------- |
| [Node](https://nodejs.org/download/release/index.json)          | 24.20.0 | 2026-08-26 | 保留已确认Node24 LTS；独立daemon与随包Node一致，不改成Current主线             |
| [pnpm](https://registry.npmjs.org/pnpm)                         | 10.34.6 | 2026-09-28 | 10.33.2调整到官方latest-10；保留10主线与workspace/deploy流程，不追12或next-10 |
| [electron](https://registry.npmjs.org/electron)                 | 43.7.9  | 2026-10-07 | 44.7.0调整为受支持的中间主线43，保留该线最新minor/patch，不停留在旧minor      |
| [electron-builder](https://registry.npmjs.org/electron-builder) | 26.15.3 | 2026-06-09 | 保留已采用的稳定latest；不追27 alpha，也不仅因另一tag数值更高而切换           |
| [electron-vite](https://registry.npmjs.org/electron-vite)       | 5.0.0   | 2025-12-07 | 保留稳定5，其Vite peer支持5/6/7；不采用6 beta                                 |

Node24处于LTS，daemon独立运行时不跟随Electron内置Node版本。官方建议生产应用使用LTS主线；本轮保持24.20.0，后续按安全修复与平台验证升级该线补丁。[Node支持状态](https://nodejs.org/en/about/previous-releases)

审计时最新LTS为24.21.0（2026-09-08），包含新的minor能力以及OpenSSL、Undici和根证书更新；本轮保留已验证的24.20.0，不把它写成最新LTS。官方安全公告列表核对至审计日，后续安全发布优先于观察期。[24.21发行记录](https://nodejs.org/en/blog/release/v24.21.0)、[安全发布列表](https://nodejs.org/en/blog/vulnerability/)

审计时Electron稳定主线为44、43、42；官方支持最近三个稳定主线，并仅维护各线最新minor。选择43是在支持窗口内取得更长观察期的项目判断，不是Electron官方额外承诺的LTS；仍需跟进Chromium安全更新和未来EOL。[稳定发行列表](https://releases.electronjs.org/)、[Electron支持政策](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)

## 编译、构建与测试

| catalog依赖                                                               | 选择    | 发布日期   | 本轮处理与依据                                                           |
| ------------------------------------------------------------------------- | ------- | ---------- | ------------------------------------------------------------------------ |
| [typescript](https://registry.npmjs.org/typescript)                       | 6.0.3   | 2026-04-16 | 保留；处于typescript-eslint的TypeScript支持范围内                        |
| [vite](https://registry.npmjs.org/vite)                                   | 7.3.7   | 2026-10-06 | 保留7.3线补丁，满足electron-vite5；不单独升至8                           |
| [@vitejs/plugin-react](https://registry.npmjs.org/@vitejs%2fplugin-react) | 5.2.0   | 2026-03-12 | 保留支持Vite7的稳定5；6.1.2要求Vite8，不能独立升级                       |
| [vitest](https://registry.npmjs.org/vitest)                               | 4.1.11  | 2026-08-18 | 5.0.4调整为官方V4 tag；V4 peer包含Vite7和Node24                          |
| [@playwright/test](https://registry.npmjs.org/@playwright%2ftest)         | 1.63.0  | 2026-09-04 | 1.64.0调整为已有观察期的1.63，保持完整浏览器与Electron检查               |
| [@types/node](https://registry.npmjs.org/@types%2fnode)                   | 24.19.2 | 2026-10-09 | 保留Node24类型线，不因latest为26而换主线；类型补丁号不必与Node运行时相同 |
| [tsx](https://registry.npmjs.org/tsx)                                     | 4.23.15 | 2026-09-20 | 保留已采用4线开发启动补丁；生产daemon不依赖tsx                           |
| [turbo](https://registry.npmjs.org/turbo)                                 | 2.10.13 | 2026-09-14 | 2.11.7调整为已有观察期的2.10线，避免无需求切换新minor                    |

typescript-eslint支持TypeScript `>=4.8.4 <6.1.0` 与ESLint10；因此保留TS6.0.3。Vite7、plugin-react5和electron-vite5作为一组评估，不能逐包追latest打破peer交集。[typescript-eslint版本支持](https://typescript-eslint.io/users/dependency-versions/)、[electron-vite5元数据](https://registry.npmjs.org/electron-vite/5.0.0)、[plugin-react5元数据](https://registry.npmjs.org/@vitejs%2fplugin-react/5.2.0)

Vitest Registry明确保留V4 tag；选择该tag不是声称V5不可用，也不将tag存在解释为官方长期维护承诺。Playwright升级时安装与所选包匹配的浏览器，并重新执行真实页面和桌面产物检查。[Vitest tags与peer](https://registry.npmjs.org/vitest)、[Playwright浏览器版本](https://playwright.dev/docs/browsers)

根测试程序与daemon测试程序显式声明catalog中的Vite，为Vitest提供选定的Vite7 peer；eslint-config同样用devDependency提供选定的ESLint10.11，同时保留消费方peer范围。仅有catalog不能约束未显式提供的自动peer；提交前已核对lockfile与各消费者实际解析路径，移除自动解析的Vite8.3.4与ESLint10.12.0。

## 静态质量与提交工具

| catalog依赖                                                                           | 选择    | 发布日期   | 本轮处理与依据                                               |
| ------------------------------------------------------------------------------------- | ------- | ---------- | ------------------------------------------------------------ |
| [eslint](https://registry.npmjs.org/eslint)                                           | 10.11.0 | 2026-09-18 | 9.39.5调整到仍受维护的10线；选择已有观察期的10.11，不追10.12 |
| [@eslint/js](https://registry.npmjs.org/@eslint%2fjs)                                 | 10.0.1  | 2026-02-06 | 9.39.5同步到10配置线，peer要求ESLint10                       |
| [typescript-eslint](https://registry.npmjs.org/typescript-eslint)                     | 8.70.1  | 2026-09-21 | 8.71.2调整到观察版本，保留ESLint10/TS6.0兼容                 |
| [eslint-plugin-react-hooks](https://registry.npmjs.org/eslint-plugin-react-hooks)     | 7.1.1   | 2026-04-17 | 保留稳定7，peer明确包含ESLint10；不追canary                  |
| [oxlint](https://registry.npmjs.org/oxlint)                                           | 1.82.0  | 2026-09-07 | 新增观察版本，只补jsx-a11y规则；ESLint继续检查全部JS/TS      |
| [globals](https://registry.npmjs.org/globals)                                         | 17.13.0 | 2026-10-01 | 保留已选稳定环境定义，不改变browser/Node分区                 |
| [prettier](https://registry.npmjs.org/prettier)                                       | 3.8.5   | 2026-06-26 | 3.9.10调整为观察版本，避免刚发布patch改变格式基线            |
| [prettier-plugin-tailwindcss](https://registry.npmjs.org/prettier-plugin-tailwindcss) | 0.8.1   | 2026-07-15 | 保留稳定版本，peer支持Prettier3                              |
| [husky](https://registry.npmjs.org/husky)                                             | 9.1.7   | 2024-11-18 | 保留官方稳定latest；没有新stable不等于过时                   |
| [lint-staged](https://registry.npmjs.org/lint-staged)                                 | 17.5.1  | 2026-09-10 | 17.6.0调整为观察版本，Node24满足engines                      |

ESLint9已于2026-08-06结束官方维护，不能用“更成熟”作为继续停留的理由；10线仍在维护。eslint-plugin-jsx-a11y6.10.2的peer最高为ESLint9，本轮移除该插件，以Oxlint的jsx-a11y规则补足对应检查，未关闭strict peers或降回ESLint9。[ESLint支持状态](https://eslint.org/version-support/)、[jsx-a11y6元数据](https://registry.npmjs.org/eslint-plugin-jsx-a11y/6.10.2)、[Oxlint jsx-a11y规则](https://oxc.rs/docs/guide/usage/linter/rules.html)

Oxlint仅承担可访问性规则补充，不替代ESLint的类型、Hook或本仓库工程约束。工具版本较新不表示所有规范已自动检查；规则的实际作用以配置与非法fixture验证为准。

## Renderer与样式

| catalog依赖                                                                     | 选择    | 发布日期   | 本轮处理与依据                                             |
| ------------------------------------------------------------------------------- | ------- | ---------- | ---------------------------------------------------------- |
| [react](https://registry.npmjs.org/react)                                       | 19.3.0  | 2026-09-09 | 保留稳定19.3，不追canary/experimental                      |
| [react-dom](https://registry.npmjs.org/react-dom)                               | 19.3.0  | 2026-09-09 | 与React配对，满足同线peer                                  |
| [@types/react](https://registry.npmjs.org/@types%2freact)                       | 19.3.0  | 2026-09-09 | 保留React19类型线                                          |
| [@types/react-dom](https://registry.npmjs.org/@types%2freact-dom)               | 19.3.0  | 2026-09-09 | 与React类型配对，满足peer                                  |
| [@radix-ui/react-slot](https://registry.npmjs.org/@radix-ui%2freact-slot)       | 1.3.3   | 2026-07-24 | 1.5.0调整为观察版本，peer支持React19，不追10月新minor      |
| [@tanstack/react-query](https://registry.npmjs.org/@tanstack%2freact-query)     | 5.102.8 | 2026-08-27 | 5.104.2调整为观察版本，peer支持React18/19                  |
| [lucide-react](https://registry.npmjs.org/lucide-react)                         | 1.45.0  | 2026-09-11 | 1.56.0调整为观察版本，保留React19兼容，不为新增图标追minor |
| [tailwindcss](https://registry.npmjs.org/tailwindcss)                           | 4.3.3   | 2026-07-16 | 保留稳定4.3线                                              |
| [@tailwindcss/vite](https://registry.npmjs.org/@tailwindcss%2fvite)             | 4.3.3   | 2026-07-16 | 与Tailwind配对，peer支持Vite7                              |
| [tailwind-merge](https://registry.npmjs.org/tailwind-merge)                     | 3.7.0   | 2026-09-12 | 保留已选稳定版本                                           |
| [class-variance-authority](https://registry.npmjs.org/class-variance-authority) | 0.7.1   | 2024-11-26 | 保留稳定latest，无需改用canary                             |
| [clsx](https://registry.npmjs.org/clsx)                                         | 2.1.1   | 2024-04-23 | 保留稳定latest，小型工具发布少不自动构成淘汰理由           |

## 本机服务与协议

| catalog依赖                                                     | 选择   | 发布日期   | 本轮处理与依据                                                        |
| --------------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------- |
| [fastify](https://registry.npmjs.org/fastify)                   | 5.12.7 | 2026-10-13 | 保留已采用5.12功能线的最新补丁，不因当日发布退回5.12.4，也不追6 alpha |
| [@fastify/static](https://registry.npmjs.org/@fastify%2fstatic) | 10.1.6 | 2026-10-09 | 保留已采用10.1线补丁及Fastify5配套；不只按年龄退回10.1.3              |
| [pino](https://registry.npmjs.org/pino)                         | 10.3.1 | 2026-02-09 | 10.4.0调整为观察版本，维持已有结构化日志流程                          |
| [typebox](https://registry.npmjs.org/typebox)                   | 1.3.30 | 2026-09-09 | 1.3.37调整为观察补丁，保留TypeBox1协议API，不换旧作用域包             |

Fastify5.12和static10.1已有早期补丁观察记录，本轮保留所选线上修复而非机械回退整个功能线；5.12.7本身尚无长期观察期。仍需用真实health、SSE、静态资源和退出检查判断本仓库适配情况。[Fastify版本元数据](https://registry.npmjs.org/fastify)、[static版本元数据](https://registry.npmjs.org/@fastify%2fstatic)

## 验证归属与后续维护

CI的checkout、pnpm/action-setup与setup-node分别采用正式7.0.1、6.0.10和7.1.0，均用Node24 action runtime，支持当前Node/pnpm输入。workflow固定完整commit SHA并标注对应版本，更新时同时核对正式tag、源码manifest和使用说明；不以浮动major tag推断它已经指向最新minor。[checkout发行](https://github.com/actions/checkout/releases/tag/v7.0.1)、[pnpm发行](https://github.com/pnpm/action-setup/releases/tag/v6.0.10)、[setup-node发行](https://github.com/actions/setup-node/releases/tag/v7.1.0)

本页不记录检查通过结果。strict peer解析、静态规则、源码单测、构建、真实产物、桌面smoke及npm audit由本轮 [Spec](../04_FEATURES/20261013_refactor_m0-standards-audit/spec.md) 和验证记录承担；审计文件、安装成功或版本可解析不能代替运行验收。npm audit未执行前不得预写“无漏洞”，有报告时区分生产/开发、可达性和实际修复。

Pi、Zustand、SQLite及embedding等后续模块不在本轮catalog审计范围；选型确定不等于已安装或已实现。功能状态由里程碑与所属Spec管理。

维护采用本地人工审查：约每月及发布前核对支持/EOL、安全公告、npm tags、peer和lockfile；遇到已确认安全修复或支持线结束提前处理。Electron每次发布核对最近三条支持线，不让观察期策略拖到EOL。

同线patch先看变更与安全影响再更新，不固定等待天数阻止必要修复；新minor/major先确认需求、迁移与观察证据。按Node/Electron、Vite测试工具、ESLint工具、React样式等兼容组更新，保留可复查选择依据和对应检查。不引入更新机器人或额外服务，不自动提交升级。
