# 登录本机工作台

## 项目应用配置

登录配置放在仓库根 `.env`，不写入 TypeScript。当前本机文件已保存用户提供的公开 Client ID；新克隆仓库从 [.env.example](../../.env.example) 创建 `.env` 后填入自己的配置。`.env` 不进入 Git；进程环境优先于文件，空值属于非法配置。配置改动后重启 daemon，桌面入口一并重启 Electron。

| 配置                                 | 用途                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `MY_PI_HARNESS_GITHUB_CLIENT_ID`     | Web 与 Electron 共用的 GitHub.com OAuth App Client ID                              |
| `MY_PI_HARNESS_GITHUB_CLIENT_SECRET` | Web 授权码交换所需，只由本机 daemon 使用                                           |
| `MY_PI_HARNESS_GITHUB_CALLBACK_URL`  | Web 可选显式回调地址；缺省采用登录入口的本机 origin 加 `/api/auth/callback/github` |

开发执行 `pnpm dev`、`pnpm dev:daemon` 或 `pnpm dev:desktop`，daemon 自动加载根 `.env`，无需手动 export。Vite 页面不加载该文件中的私密配置。

GitHub OAuth App 启用 Device Flow 后，Electron 只需要 Client ID。浏览器登录另需在 `.env` 填入 Client Secret，并将 GitHub 应用设置中的 Authorization callback URL 配为 `http://127.0.0.1:5174/api/auth/callback/github`。直接访问 daemon 托管页面时使用该页面 origin 对应的回调，并同步更新 GitHub 应用设置；显式回调不能含凭据、query 或 fragment，必须是本机回环地址，且 hostname 与登录页面相同（端口可不同）。不要把 Secret 发到聊天、提交 Git 或放进 `VITE_` 配置。

桌面打包从根 `.env` 或构建环境提取 Client ID，生成 `desktop-oauth.env` 随 daemon 分发；根 `.env`、Client Secret 与其他凭据不会装入应用。缺少有效 Client ID 时打包直接失败。替换 OAuth App 后重新打包。[GitHub 登录协议](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)

## 首次登录

Electron 自动建立本机信任；普通浏览器先填写 daemon 启动终端的一次性配对码。两种入口随后使用不同的 GitHub 流程：

- Electron：点击“使用 GitHub 登录”后自动打开系统浏览器，在 GitHub 输入应用显示的用户验证码并批准；若未打开，点击“打开 GitHub”重试。
- 浏览器：点击登录后按钮显示“正在前往 GitHub…”并禁用重复点击，当前页面跳转 GitHub 的账号选择页；选择账号并批准后回到本机页面，显示“正在登录…”直至进入工作台。缺少 Web 配置时先补齐 `.env`，不会改用设备码流程。

首次成功登录会把当前 profile 与该 GitHub 账号绑定，现有本机配置、工作区和会话归这个账号使用，工作区文件保持原位。后续用同一账号重登；同名或相同邮箱的另一账号不自动继承。当前没有换号、解除 profile 绑定或多人共享入口。

遇到拒绝、到期或取消，可以重新登录。在 GitHub 授权途中返回工作台后也可以重新发起，旧 Web 流程会被替换。授权已完成但页面未进入时可重试进入；客户端会先查询实际登录状态，避免盲目重复完成请求。临时流程不能跨 daemon 重启恢复；账号不匹配时请使用原账号。

## 恢复与退出

有效登录Cookie与数据库记录在刷新和daemon重启后恢复，不要求每次访问GitHub。本地登录最长30天；本机信任最长90天，到期按界面重新登录或配对。更换浏览器需重新配对并登录；桌面与独立daemon只有使用同一profile时才共享同一账号归属。

点击左下角用户信息卡片，在上方菜单选择“设置”打开设置弹窗；选择“退出登录”后再次确认，才会清除当前客户端登录、私有页面缓存与草稿，保留本机信任。取消或按Esc保留登录和草稿。其他已登录客户端不受影响。退出不删除会话、工作区或模型凭据，已接受的后台任务继续运行；重新登录后可以查看与操作。登录GitHub和授权模型Provider是两个独立步骤。

本地退出不会自动撤销GitHub侧OAuth App授权；如需撤销，在GitHub应用授权设置中操作。有效本地会话不会持续联网检查GitHub侧撤销，不能将离线恢复理解为实时上游验证。
