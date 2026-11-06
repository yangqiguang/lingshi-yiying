# 第三方组件版权声明（NOTICE）

本文件列出《第三方资源说明》资源清单中各组件对应的许可证与版权归属。
许可证全文见同目录 `AGPL-3.0.txt` / `MIT.txt` / `BSD-3-Clause.txt` /
`Apache-2.0.txt` / `ZPL-2.1.txt` / `MIT-CMU.txt`。
各组件的版权声明以其官方发布仓库为准，本作品未删除或修改任何原始版权信息。

| 组件 / 资源 | 许可证 | 版权归属 | 全文文件 |
| --- | --- | --- | --- |
| Ultralytics YOLO26n（检测框架与训练／导出工具） | AGPL-3.0 | Ultralytics 及贡献者 | `AGPL-3.0.txt` |
| YOLO26n 预训练权重 `yolo26n.pt` | AGPL-3.0 | Ultralytics 及贡献者 | `AGPL-3.0.txt` |
| Clean Bone Fracture 数据集 | MIT | 数据集发布者 dmxtrx（Kaggle: dmtrrmnv）及上游数据来源各自权利人 | `MIT.txt` |
| ONNX Runtime | MIT | Microsoft Corporation 及贡献者 | `MIT.txt` |
| Vue 3（uni-app 打包产物内运行时） | MIT | Evan You 及 Vue.js 贡献者 | `MIT.txt` |
| qrcode-generator | MIT | Kazuhiko Arase | `MIT.txt` |
| core-js | MIT | Denis Pushkarev 及贡献者 | `MIT.txt` |
| PyTorch（仅训练环境） | BSD-3-Clause | Meta Platforms, Inc. 及贡献者 | `BSD-3-Clause.txt` |
| NumPy | BSD-3-Clause | NumPy Developers | `BSD-3-Clause.txt` |
| Flask | BSD-3-Clause | Pallets 及贡献者 | `BSD-3-Clause.txt` |
| Werkzeug / itsdangerous / Jinja2 | BSD-3-Clause | Pallets 及贡献者 | `BSD-3-Clause.txt` |
| Quill | BSD-3-Clause | Quill 贡献者 | `BSD-3-Clause.txt` |
| uni-app | Apache-2.0 | DCloud 及贡献者 | `Apache-2.0.txt` |
| Apache ECharts | Apache-2.0 | Apache Software Foundation / ECharts 贡献者 | `Apache-2.0.txt` |
| SQLite（Python 内置 sqlite3） | Public Domain（公有领域） | SQLite 作者声明为公有领域，无附加限制 | — |
| waitress | ZPL-2.1 | Zope Foundation 及贡献者 | `ZPL-2.1.txt` |
| Pillow | MIT-CMU（HPND） | Secret Labs AB / Fredrik Lundh / Pillow 贡献者 | `MIT-CMU.txt` |
| 系统中文字体 | 随终端系统内置授权 | 字体文件不随仓库分发，仅终端本地渲染 | — |

## 说明

1. `MIT.txt` 取自 ONNX Runtime 官方发布包内的 LICENSE 原文，`BSD-3-Clause.txt`
   取自 Pallets（itsdangerous）官方发布包内的 LICENSE 原文；两者的条款文本为
   对应许可证的标准全文，各组件自身的版权行见上表与各自官方仓库。
2. `Apache-2.0.txt` 取自 https://www.apache.org/licenses/LICENSE-2.0.txt ，
   `AGPL-3.0.txt` 取自 https://www.gnu.org/licenses/agpl-3.0.txt 。
3. `ZPL-2.1.txt` 取自 waitress 官方发布包 `waitress-3.0.2.dist-info/LICENSE.txt`，
   `MIT-CMU.txt` 取自 Pillow 官方发布包 `pillow-13.0.0.dist-info/licenses/LICENSE`；
   MIT-CMU 即通常所称的 HPND（Historical Permission Notice and Disclaimer）。
4. AGPL-3.0 组件的对应源码（推理调用代码、网页端／移动端／后端业务代码）
   均在本公开仓库中提供；训练参数与评测记录见 `../docs/training/`。
