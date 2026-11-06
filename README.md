# 灵视医影 · 多模态医学影像智能解析与辅助决策系统

面向运动骨折影像的辅助分析与康复随访原型：网页工作台 + 移动端 App 共用一套 Flask 后端与 SQLite 数据库，前端为原生 HTML/CSS/JS，App 为 uni-app 页面，检测模型以 ONNX Runtime 在本地推理。

> **发布前还需完成两件事**
> 1. 确认参赛材料中关于仓库状态的旧表述已同步改为本仓库地址；
> 2. 首次提交用 GitHub 提供的 noreply 邮箱，避免把本机姓名与邮箱写进公开历史。
>
> 仓库地址与 App 端本地调试地址已配置完毕（见第六节）。

**公开仓库地址**：`https://github.com/yangqiguang/lingshi-yiying`

---

## 一、它能做什么

- **五角色责任闭环**：影像技师上传影像并撰写检查报告 → 执业医师审核确认或驳回 → 康复治疗师深化建议并录入随访 → 机构管理员维护账号与档案 → 患者只读查看本人档案。
- **四态状态机**：报告撰写中 / 待审核 / 已审核 / 已驳回，服务端对每个动作做角色与状态双重校验，越权请求一律拒绝。
- **真实本地推理**：后端加载 `best.onnx` 输出可疑区域与置信度，模型只给位置不写结论；模型缺失时明确提示「检测模型未就绪」，不会返回假结果。
- **双端同步**：网页与 App 共用同一进程与数据库，写操作递增数据版本，App 轮询 `/api/sync/version` 自动刷新。
- 其余包括 AI 报告初稿与问答、康复回归阶梯、统计看板（全部为数据库真实计数）、科研数据导出。

## 二、开源范围与许可证（重要）

**本项目整体采用 [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）**。

原因：检测模型 `best.onnx` 由 Ultralytics YOLO 8.4.188 训练并导出，上游为 AGPL-3.0 与商业授权双轨制。既然随作品分发了模型，就需按 AGPL-3.0 提供**对应的完整源码**。因此：

- 本仓库公开了调用该模型的全部可运行源码：`web/`（网页端 + 统一后端）与 `app/`（uni-app 源码），不是只提供一个推理脚本；
- 各第三方组件按各自许可证使用，版权归原作者，全文与逐项版权声明见 `THIRD_PARTY_LICENSES/`；本作品未修改任何第三方组件源码；
- 若后续需要闭源商用，须取得 Ultralytics Enterprise 授权，或改用 Apache-2.0 许可的检测框架重新训练模型；
- **不随仓库分发的内容**：Clean Bone Fracture 数据集本体（207 MB，见第八节）、Android 安装包 APK、便携 Python 运行环境、SQLite 数据库、密钥文件，以及模型训练／ONNX 导出脚本（训练配置与逐轮结果见 `docs/training/`，可按该配置用 Ultralytics 官方训练接口复现）。
- 因不含 APK，`web/download.html` 的下载按钮与二维码为占位；把安装包放到 `web/downloads/lingshi-yiying-app.apk` 后即可正常下载。

## 三、仓库结构

```
lingshi-yiying/
├── LICENSE                        AGPL-3.0 全文
├── README.md                      本文件
├── .gitignore                     排除密钥、数据库、构建产物与参赛材料
├── .env.example                   环境变量模板（真实值不入库）
├── requirements.lock.txt          Python 侧精确依赖版本
├── THIRD_PARTY_LICENSES/          6 份许可证全文 + NOTICE.md + 对应说明
├── docs/
│   ├── dataset-split.md           数据集划分、训练参数与评测记录
│   ├── frontend-dependencies.md   为什么没有 package.json、本地组件清单
│   └── training/                  data.yaml / args.yaml / results.csv
├── web/                           网页端（保持原有相对路径，可直接运行）
│   ├── index.html / login.html / dashboard.html / ...
│   ├── css/  js/  assets/        静态资源（js/lib 为本地引入组件）
│   ├── 启动服务.bat / 安装Python.bat
│   └── server/
│       ├── app.py / detector.py / check_env.py
│       ├── README.md              后端接口与部署说明
│       ├── requirements.txt / requirements-core.txt
│       └── models/best.onnx       9.4 MB 检测权重
└── app/                           uni-app 源码
    ├── pages/  static/  App.vue  main.js  manifest.json  pages.json
    ├── h5/  hybrid/html/          双端页面与运行期配置
    └── HBuilderX打包说明.txt
```

## 四、快速开始

环境：Python 3.10+（Windows / Linux 均可），无需 GPU，模型随仓库提供、不需联网下载。

```bash
git clone https://github.com/yangqiguang/lingshi-yiying.git
cd lingshi-yiying
python -m venv .venv
.venv\Scripts\activate          # Windows；Linux/macOS 用 source .venv/bin/activate
pip install -r requirements.lock.txt
python web/server/app.py
```

看到「灵视医影后端已启动」后，浏览器打开 `http://127.0.0.1:5000/login.html`。

- 不想手动建环境：Windows 下双击 `web/启动服务.bat`，它会自动寻找或安装 Python 与依赖。
- 只想跑通业务流程、不做影像检测：`pip install -r web/server/requirements-core.txt`（不含 onnxruntime），此时 AI 分析会提示模型未就绪。
- 端口可用 `LSY_PORT` / `LSY_LEGACY_PORT` 调整；健康检查接口：`GET /api/model/status`、`GET /api/app/version`、`GET /api/sync/version`（均无需登录）。
- 首次启动自动在 `web/server/` 下生成 `lingshi.db` 与 `.secret_key`，删除数据库即可恢复初始演示数据。这两个文件都已被 `.gitignore` 排除。

## 五、演示账号

登录账号即手机号，密码统一为 `123456`，全部为构造的演示数据：

| 手机号 | 角色 | 默认进入 |
| --- | --- | --- |
| 13800000001 | 执业医师 | 待审核 |
| 13800000002 | 影像技师 | 影像分析 |
| 13800000003 | 康复治疗师 | 病例档案 |
| 13800000004 | 机构管理员 | 总览 |
| 13700000001 | 患者 | 我的档案 |
| 13000000000 | 体验用户（只读） | 总览 |

登录时所选角色须与账号真实角色一致，否则会被拒绝。完整接口与角色权限表见 `web/server/README.md`。

## 六、配置

把 `.env.example` 复制为 `.env` 后按需填写（`.env` 不入库）。关键项：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` | 空 | 大模型 Key。留空时 AI 助手降级为本地模板回答并标注来源，不会编造数据 |
| `LSY_PORT` / `LSY_LEGACY_PORT` | 5000 / 5001 | 主端口与旧 App 兼容端口 |
| `DETECT_MODEL` | `web/server/models/best.onnx` | 默认按脚本目录定位，一般无需设置 |
| `DETECT_CONF` / `DETECT_IOU` | 0.15 / 0.45 | 置信度与 NMS 阈值 |
| `DETECT_IMG_SIZE` / `DETECT_MAX_BOXES` | 640 / 20 | 推理边长与单图最多保留框数 |

App 端后端地址不读环境变量，两个配置文件默认指向 `http://127.0.0.1:5000`；部署时按需修改 `app/h5/config.js` 与 `app/hybrid/html/config.js`。密钥读取顺序为环境变量 → `web/server/.dashscope_key`，源码中不含任何硬编码 Key。

界面文案中出现的「DeepSeek」指经阿里云百炼平台调用的模型，并非 DeepSeek 官方 API；实际模型由部署侧配置决定。未配置 Key 时全部走本地模板，不产生任何外部调用。

## 七、模型

| 项目 | 内容 |
| --- | --- |
| 训练／导出框架 | Ultralytics YOLO 8.4.188（AGPL-3.0） |
| 结构与权重 | YOLO26n · detect · `models/best.onnx` · 9.4 MB |
| 输入 / 类别 | 1×3×640×640 / `fracture`、`normal` 两类 |
| 推理运行时 | ONNX Runtime 1.23.2（MIT），业务代码未引入 ultralytics Python 包 |
| 默认阈值 | conf 0.15、IoU 0.45 |

## 八、数据集

训练使用公开数据集 [Clean Bone Fracture](https://www.kaggle.com/datasets/dmtrrmnv/clean-bone-fracture)（Kaggle，`dmtrrmnv/clean-bone-fracture`，Kaggle API 标注 `licenseName: MIT`）。划分：train 1851 张 / valid 377 张 / test 134 张，均为图像 + YOLO txt 标注，`data.yaml` 为 2 类。

数据集本体**不随仓库分发**，请按上方链接自行下载；划分清单见 `docs/dataset-split.md`，训练参数、数据配置与逐轮评测记录见 `docs/training/`（`args.yaml`、`data.yaml`、`results.csv`）。网页端不展示模型准确率类指标，评测数据以 `docs/training/results.csv` 为准。

## 九、第三方组件

主要依赖：Flask / Werkzeug / itsdangerous / Jinja2（BSD-3-Clause）、NumPy（BSD-3-Clause）、Pillow（HPND）、ONNX Runtime / qrcode-generator（MIT）、waitress（ZPL-2.1）、Apache ECharts 5.6.0 / uni-app（Apache-2.0）、Ultralytics YOLO（AGPL-3.0）、阿里云百炼（商业服务，非开源组件）。

逐项版权声明见 `THIRD_PARTY_LICENSES/NOTICE.md`，6 份许可证全文与来源见同目录 `README.md`；前端为原生 HTML/CSS/JS，无 npm 依赖树、不提供 `package.json`，理由与本地组件清单见 `docs/frontend-dependencies.md`。

## 十、免责声明

本项目为教学与演示用途的原型系统，**未开展临床验证，不提供诊断准确率等医学指标**。模型输出仅为可疑区域位置与置信度，不构成诊断结论；所有演示账号、病例与影像均为构造数据或公开数据集样例。不得用于真实诊疗决策，亦不得替代执业医师判断。

## 十一、AI 工具使用披露

开发过程中使用生成式 AI 工具辅助代码编写、文档整理与界面文案。系统架构设计、五角色业务闭环、模型训练与验证、界面实现与全流程测试由团队完成并人工复核；AI 生成内容均经筛选与改写后纳入。本仓库不含任何参赛材料。

## 十二、参与贡献

欢迎通过 Issue 反馈问题、通过 Pull Request 提交改进。提交前请确认：不包含任何密钥、数据库、安装包或含身份信息的参赛材料；新增第三方资源需在 `THIRD_PARTY_LICENSES/NOTICE.md` 中补充声明。
