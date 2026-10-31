# 开发与隔离验证

先执行 `npm ci`、`npm run build`。渲染需要的浏览器由安装器准备；验证时使用隔离配置目录：

```powershell
npm run setup -- --host both --home .tmp/cutbridge/test-home --apply
npm run check
npm test
npm run verify:mcp
npm run verify:review
npm run verify:render
```

`--home` 仅改变本次安装目标，不触碰真实用户配置。无需登录外部模型即可执行这些协议、浏览器和渲染测试；测试脚本不是模型输出，也不是用户对作品的实际验收。

## 测试分工

| 入口 | 验证内容 |
| --- | --- |
| `npm test` | 83 项规则、格式、保护、会话、反馈范围、并发状态与安装失败回归 |
| `verify:mcp` | 19 个真实 stdio 工具握手、创建读取、待确认提案及 HTTP 认证 |
| `verify:review` | 6 组浏览器定位、微调、反馈、页面隔离和后台退出恢复 |
| `verify:render` | 真实 MP4 导出和媒体元数据验证 |
| `verify:installation` | 两宿主隔离配置、新建与旧工程、两工作台反馈原图、导出及重开 |

安装专项必须指向另一个已经执行依赖安装和生产构建的源码目录，不能把当前仓库自己当独立安装证据：

```powershell
$env:CUTBRIDGE_TEST_INSTALLATION = "<另一份已安装源码的绝对路径>"
npm run verify:installation
```

测试使用 4320–4327 端口和 `.tmp/cutbridge/` 下独立数据。同端口脚本顺序执行；服务代码变化后重启测试进程。实际模型宿主、系统登录和空闲唤醒需要另外实测，不因 MCP 客户端成功而推断通过。

## 平台接口

- `scripts/test-platform.ts`：浏览器、媒体二进制和空设备定位。Windows 自动查找 Edge；可用 `CUTBRIDGE_BROWSER` 指定其他兼容浏览器，或安装 Playwright Chromium。
- `src/server/service-lock.ts`：Windows 命名管道、Linux abstract socket、macOS Unix socket 的服务互斥。
- `src/server/session.ts`：宿主通知适配及错误恢复。
- `src/server/project-file.ts`：相对路径、文件格式、指纹和原子写入。
- `scripts/patch-renderer.mjs`：Remotion 4.0.539 固定补丁，覆盖 ESM 与 CommonJS。

macOS/Linux 安装预览可直接运行，试验写入需 `--experimental-platform`。本仓库不自动安装系统包；macOS 与原生 Linux 桌面仍需实机验证。

## 故障检查

安装下载失败时不应出现宿主配置部分写入。缺失渲染浏览器应立即返回恢复提示，不在领取反馈时启动长下载。旧工程格式、缺失素材、过期版本、重复请求、失效反馈和负责人替换均需覆盖。

查看日志时注意其中可能含本地路径和工程内容。不要将 `.tmp/`、`data/`、完整宿主输出或访问凭据上传到公开 issue；只提供脱敏后的错误、操作步骤和版本信息。
