# 开发与隔离验证

先执行 `npm ci`、`npm run build`。渲染需要的浏览器由安装器准备；验证时使用隔离配置目录：

```powershell
npm run setup -- --host both --home .tmp/cutbridge/test-home --apply
npm run check
npm test
npm run verify:mcp
npm run verify:review
npm run verify:relay
npm run verify:open-links
npm run verify:render
```

`--home` 仅改变本次安装目标，不触碰真实用户配置。无需登录外部模型即可执行这些协议、浏览器和渲染测试；测试脚本不是模型输出，也不是用户对作品的实际验收。

## 测试分工

| 入口 | 验证内容 |
| --- | --- |
| `npm test` | 99 项规则、格式、保护、会话、反馈范围、并发状态、安装目录与失败保护、安全迁移、访问凭据与启动参数回归 |
| `verify:mcp` | 19 个真实 stdio 工具握手、创建读取、待确认提案及 HTTP 认证 |
| `verify:review` | 6 组浏览器定位、微调、反馈、页面隔离和后台退出恢复 |
| `verify:render` | 真实 MP4 导出和媒体元数据验证 |
| `verify:installation` | 两宿主隔离配置、新建与旧工程、两工作台反馈原图、导出及重开 |
| `verify:relay` | 请求级身份、显式接管、旧租约拒绝、通知失败保留、Claude 通道消息以及单条气泡／批量确认；协议接收不替代真实模型测试 |
| `verify:open-links` | 两个独立浏览器打开、重复与并发访问、Cookie 隔离、短暂断网／502／超时恢复、发起 MCP 退出后持续使用及后台重启失效 |
| `verify:host-lifecycle` | Windows Job 整组回收后后台 PID、原 Cookie、双页面、播放、未发送草稿仍有效；需要 Windows 和 Python，不运行真实用户宿主 |

安装专项必须指向另一个已经执行依赖安装和生产构建的源码目录，不能把当前仓库自己当独立安装证据：

```powershell
$env:CUTBRIDGE_TEST_INSTALLATION = "<另一份已安装源码的绝对路径>"
npm run verify:installation
```

测试使用 4320–4327 端口和 `.tmp/cutbridge/` 下独立数据。同端口脚本顺序执行；服务代码变化后重启测试进程。实际模型宿主、系统登录和空闲唤醒需要另外实测，不因 MCP 客户端成功而推断通过。

## 平台接口

- `scripts/test-platform.ts`：浏览器、媒体二进制和空设备定位。Windows 自动查找 Edge；可用 `CUTBRIDGE_BROWSER` 指定其他兼容浏览器，或安装 Playwright Chromium。
- `src/server/launch-service.ts` 与 `scripts/service.mjs`：Windows 使用隐藏 WMI 后台进程，避免宿主 Job 回收同时终止工作台；其他系统使用 detached。启动失败直接报告，不改变系统策略。
- `src/server/service-lock.ts`：Windows 命名管道、Linux abstract socket、macOS Unix socket 的服务互斥。
- `src/server/session.ts`：宿主通知适配及错误恢复。
- `src/server/project-file.ts`：相对路径、文件格式、指纹和原子写入。
- `scripts/patch-renderer.mjs`：Remotion 4.0.539 固定补丁，覆盖 ESM 与 CommonJS。

macOS/Linux 安装预览可直接运行，试验写入需 `--experimental-platform`。本仓库不自动安装系统包；macOS 与原生 Linux 桌面仍需实机验证。

## 故障检查

安装下载失败时不应出现宿主配置部分写入。缺失渲染浏览器应立即返回恢复提示，不在领取反馈时启动长下载。旧工程格式、缺失素材、过期版本、重复请求、失效反馈和负责人替换均需覆盖。

查看日志时注意其中可能含本地路径和工程内容。不要将 `.tmp/`、`data/`、完整宿主输出或访问凭据上传到公开 issue；只提供脱敏后的错误、操作步骤和版本信息。

## 依赖安全回归

```powershell
npm ls zod --all
npm audit --registry=https://registry.npmjs.org
```

0.2.1 固定 Zod 4.6.7，使用 override 保证 Remotion 的嵌套依赖也采用修复版。完整依赖审计须包括开发依赖；不能通过忽略公告或只审计生产依赖获得通过结果。

`tests/schema-security.test.ts` 验证超限数组在遍历错误元素前拒绝，不累积每个元素的错误；新工程仍填充默认值，已有镜头和字幕的局部 patch 不补入默认位置、音量或样式。有效边界、未知字段和错误值继续受到校验。MCP、浏览器、安装及媒体验证仍是依赖升级后的必要回归，不以审计为零代替功能验证。
