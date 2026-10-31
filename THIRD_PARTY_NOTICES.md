# 第三方说明

## 字体

界面使用 Source Han Sans CN 可变 WOFF2，保持原字体文件与 SIL Open Font License 1.1。许可原文位于 [src/web/fonts/LICENSE.txt](src/web/fonts/LICENSE.txt) ，来源说明位于 [src/web/fonts/README.md](src/web/fonts/README.md) 。

## 运行依赖

Node 依赖通过 npm 安装，准确版本由 package-lock.json 固定。React、Vite、TypeScript、MCP SDK、Remotion、Zod、Lucide、Playwright、fast-check 等组件沿用各自许可；本源码分发不包含 node_modules 或渲染浏览器二进制。

Remotion 的许可原文与适用条款以其官方仓库和所安装包为准：[Remotion License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) 。固定版本补丁由 scripts/patch-renderer.mjs 在安装后应用，源代码和修改位置在仓库中可检查。

## 图片

- assets/wechat-hmpunk.jpg：作者按其授权提供的微信公众号二维码，来源为作者的 [html-exhibition 项目](https://github.com/YeeKuson/html-exhibition/blob/master/assets/wechat-hmpunk.jpg) ，保持原图。
- assets/workbench.png：本项目测试工程的界面截图，不含用户真实视频工程。

本仓库未附加项目级开源许可证；本说明不替代各第三方组件的许可文件。
