# 前端依赖说明（关于 package.json）

《第三方资源说明》第五节第 1 项要求「package.json（前端侧）逐项列明组件名称与版本」。
经核实，本作品**不存在 npm 依赖树，因此没有 package.json**，理由与替代清单如下。

## 为什么没有 package.json

- 网页端为原生 HTML / CSS / JavaScript 实现，未使用 Vue / React / 构建工具链；
- 移动端为 uni-app（HBuilderX）打包的 Android 应用，页面为手写 H5（`hybrid/html/`、
  `h5/`），仅由 web-view 承载，不经过 npm 安装；
- 因此不存在 `node_modules`、`package-lock.json` 或 npm 依赖树。
  资源清单表第 9 项「Vue 3」指 uni-app 打包产物内自带的 Vue3 运行时文件，
  并非本作品通过 npm 直接引入的依赖。

## 前端本地引入的第三方组件（等价于前端依赖清单）

| 组件 | 版本 | 许可证 | 引入方式 | 用途 |
| --- | --- | --- | --- | --- |
| Apache ECharts | 5.6.0 | Apache-2.0 | 本地 `js/lib/echarts.min.js`，未改动 | 数据看板与统计图表 |
| qrcode-generator | 1.4.4 | MIT | 本地 `js/lib/qrcode.min.js`（jsDelivr 压缩版） | 下载页 APK 二维码 |
| uni-app Vue3 运行时 | 随 HBuilderX 打包版本 | MIT | 打包产物自带 `uni-jsframework-vue3.js` | App 内页面渲染 |
| uni-app view 层 | 随 HBuilderX 打包版本 | Apache-2.0 | 打包产物自带 `uni-app-view.umd.js` | 原生渲染桥接 |
| core-js | 2.6.12 | MIT | 打包产物自带（uni-app 依赖） | ES 语法兼容垫片 |
| Quill | 1.3.7 | BSD-3-Clause | 打包产物自带 `__uniappquill.js`（本项目未调用） | 富文本编辑能力 |

以上组件均未修改源代码，版权声明见 `THIRD_PARTY_LICENSES/NOTICE.md`。
如需以 npm 形式表达，可据上表生成一份仅作声明用途的 package.json，
但本作品实际未使用 npm 安装，故不提供该文件以免与实际工程结构不符。
