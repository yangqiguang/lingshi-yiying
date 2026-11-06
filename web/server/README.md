# 灵视医影 · 后端服务（Flask + SQLite）

> **文档说明**：本文为项目开发期编写的接口与部署文档，部分内容对应历史交付版本
> （APK 下载、云部署脚本、审计脚本路径、早期模型名称等）。本开源仓库以根目录
> `README.md` 与 `docs/` 为准；仓库不含 APK、虚拟环境与调试脚本。

本目录是 **灵视医影** 网页项目的后端，配合上一级 `WebProject/` 静态页面使用。
启动后同一个端口既托管前端页面，又提供 `/api/*` 接口，手机扫码即可下载 APK。

---

## 一、启动方式

**推荐**：双击上一级的 `启动服务.bat`（`WebProject/启动服务.bat`）。它自己会搞定环境，分四步：

1. 扫描本机所有可能的 Python：`runtime\python` → `server\.venv` → 系统 `python` → `py -3.13…3.8` → 常见安装目录 / Anaconda；
2. 找到装好依赖的直接用；找到 Python 但没依赖，就建 `server\.venv` 并 `pip install -r requirements.txt`；
3. **一个 Python 都没有**（全新云服务器常见）时，自动下载官方便携版
   `python-3.10.11-embed` 解压到 `WebProject\runtime\python`，给它装好 pip 再装依赖，
   下载源依次尝试华为云 / 阿里云 / npmmirror / python.org；
4. 启动服务（有 `waitress` 就用 waitress 8 线程，没有才退回 Flask 自带的开发服务器）。

> 服务器完全连不上外网时，把任意一个 Python 3.10+ 的 `python.exe` 完整路径写进
> `server\python_path.txt`（一行，不要加引号），脚本会直接用它。
>
> 依赖装不上时脚本会自动降级：只缺 `onnxruntime` 也能起站，登录/档案/报告/审核都正常，
> 只有影像 AI 分析会提示「模型未就绪」。

手动启动也可以，但**必须用装好依赖的解释器**：

```powershell
cd WebProject/server
.venv\Scripts\python.exe app.py     # 首次需先：py -3.12 -m venv .venv
                                    #            .venv\Scripts\python.exe -m pip install -r requirements.txt
```

> 直接 `python app.py` 若报 `ModuleNotFoundError: No module named 'werkzeug'`（或 flask/onnxruntime），
> 说明当前 PATH 里的 Python 没装依赖 —— 用上面的 `.venv\Scripts\python.exe`，或直接双击 `启动服务.bat`。

端口可以用环境变量改（云服务器端口被占用时）：

```powershell
set LSY_PORT=8080
.venv\Scripts\python.exe app.py
```

看到以下输出即启动成功：

```
========================================================
  灵视医影后端已启动
  站点地址 : http://127.0.0.1:5000/
  登录页   : http://127.0.0.1:5000/login.html
  演示账号 : 13800000001~04（医师/技师/康复师/管理员）+ 13700000001（患者），密码均 123456
========================================================
```

浏览器打开 **http://127.0.0.1:5000/** 即为官网首页；打开 **/login.html** 进入工作台登录。

> 首次启动会自动在本目录生成 `lingshi.db`（SQLite 数据库），并写入 4 个员工演示账号、
> 1 个患者演示账号 + 12 条已审核演示病例（前 4 条属于患者 13700000001）。
> 删掉 `lingshi.db` 即可恢复初始状态。

---

## 二、演示账号

登录账号即手机号，密码均为 `123456`：

| 手机号        | 姓名   | 角色       | 默认进入 | 能做什么 |
|---------------|--------|------------|----------|----------|
| 13800000001   | 杨同学 | 执业医师   | 待审核   | 看待审核队列、调 AI 出病情/建议初稿、确认归档或驳回 |
| 13800000002   | 沈同学 | 影像技师   | 影像分析 | 上传影像、跑模型、撰写检查报告、提交审核 |
| 13800000003   | 张同学 | 康复治疗师 | 病例档案 | 在已审核档案上深化康复建议、录入周期随访 |
| 13800000004   | 刘同学 | 机构管理员 | 总览     | 全部权限 + 账号审批与系统维护 |
| 13700000001   | 宋同学 | 患者       | 我的档案 | 只读查看本人的治疗建议与历史随访 |
| 13000000000   | 体验用户 | 执业医师  | 总览     | 登录页"一键体验"用，只读演示 |

登录时所选角色必须与账号真实角色一致，否则会被拒绝（防止越权）。新注册用户审批通过后，直接用注册时填的手机号 + 自己设的密码登录。

---

## 二·五、五角色工作流与状态机

```
影像技师上传影像
      │  模型只给"可疑位置 + 置信度"，不写结论
      ▼
  报告撰写中  ──技师写检查报告──▶  待审核
      ▲                              │
      │                              ├─ 执业医师（可调 AI 生成病情/建议初稿）
   已驳回 ◀──医师驳回（附原因）──────┤
                                     └─ 医师确认 ──▶ 已审核
                                                       │
                                     康复治疗师深化建议 + 周期随访
                                                       ▼
                                            病例与康复档案（患者只读）
```

| 动作 | 允许的角色 | 状态变化 |
|------|-----------|----------|
| 上传/分析影像 | 影像技师、机构管理员 | → 报告撰写中 |
| 写/改检查报告、提交 | 影像技师、机构管理员 | 报告撰写中 / 已驳回 → 待审核 |
| 审核（确认/驳回） | 执业医师、机构管理员 | 待审核 → 已审核 / 已驳回 |
| 撤回重审 | 仅机构管理员 | 已审核 → 待审核 |
| 康复建议、随访录入 | 康复治疗师、机构管理员 | 需先"已审核" |
| 查看 | 全部角色（患者仅本人） | — |

服务端对每个动作都做角色 + 状态双重校验，前端按钮显隐只是提示，越权请求一律 403。

---

## 三、目录结构

```
WebProject/
├── index.html / login.html / dashboard.html / ...   # 前端页面（已接入后端）
├── css/  js/  assets/  downloads/                  # 前端静态资源
│   └── js/
│       ├── auth.js        # 【新增】前端鉴权：token 存取、未登录踢回登录页
│       └── workbench.js    # 原有工作台逻辑
└── server/
    ├── app.py             # Flask 后端主程序（本文件同级）
    ├── lingshi.db         # SQLite 数据库（首次启动自动生成）
    ├── uploads/           # AI 分析上传的影像存放目录
    ├── .secret_key        # token 签名密钥（首次启动自动生成）
    └── README.md
```

---

## 四、API 一览

除 `/api/app/version` 外，所有接口都需要在请求头带 `Authorization: Bearer <token>`（登录接口本身除外）。

### 1. 认证
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login`    | 登录，body: `{username, password, role?}`，返回 token + 用户信息 |
| POST | `/api/auth/register` | 注册申请，body: `{name, phone, org, role, password}`，写入待审核表 |
| POST | `/api/auth/logout`   | 退出登录（无状态 token，前端清掉即可） |
| GET  | `/api/auth/me`       | 获取当前登录用户信息 |

### 2. 病例与角色工作流
| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/cases?keyword=`            | 病例列表；患者只能看到 `patient_phone` 等于本人手机号的病例 |
| GET  | `/api/cases/<case_no>`           | 病例详情 + 操作记录 |
| GET  | `/api/cases/<case_no>/full`      | 病例 + 检测框 + 操作记录 + 随访 + AI 记录 + 签发报告（越权 403） |
| POST | `/api/analyze`                   | 上传影像（multipart file + `patient_name`/`patient_phone`/`part`/`sport`），**真实 ONNX 推理**，状态置为"报告撰写中" |
| POST | `/api/cases/<no>/tech-report`    | 技师报告 `{content, submit}`；`submit=true` → 待审核 |
| POST | `/api/cases/<no>/ai-review`      | 医师调 AI 生成 `{condition, advice}` 初稿（无 Key 时用本地模板，`ai_used=false`） |
| POST | `/api/cases/<no>/review`         | `{action: confirm\|reject\|annotate\|reopen, condition, advice, note, annotations}` |
| POST | `/api/cases/<no>/ai-rehab`       | 康复师调 AI 生成 `{advice, progress}` 初稿 |
| POST | `/api/cases/<no>/rehab-advice`   | 康复建议 `{content}`，仅已审核病例可写 |
| GET  | `/api/cases/<no>/followups`      | 随访记录列表 |
| POST | `/api/cases/<no>/followups`      | 新增随访 `{record_date, pain_score(0-10), rom(0-100), swelling, training, note}` |
| GET  | `/api/cases/<no>/recovery`       | 运动回归阶梯：由随访记录计算恢复度（疼痛/活动度/肿胀三项扣分），返回 `series`/`ladder`/`score`；无随访时 `source="empty"` |
| GET  | `/api/model/status`              | 检测模型健康检查（是否就绪、类别、阈值、版本） |
| GET  | `/api/summary`                   | 总览 KPI（待审核、待撰写、今日分析、在管康复、复诊提醒，均为真实计数） |

### 2.1 患者 ↔ 病例绑定
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/patient/bind` | 患者自助绑定，body `{case_no}`。仅当病例 `patient_phone` 为空且 `patient_name` 与账号姓名一致时成功；已绑定到他人返回 409 |
| GET  | `/api/admin/unbound` | 管理员查看未绑定病例 + 患者账号列表 |
| POST | `/api/admin/bind`    | 管理员绑定，body `{case_no, phone}`，可绑任意未绑定病例并写入操作记录（`action=bind`） |

### 3. 统计看板
| 方法 | 路径 | 对应前端图表 |
|------|------|--------------|
| GET  | `/api/stats/weekly`    | 本周分析量柱状图 |
| GET  | `/api/stats/body`      | 损伤部位饼图 |
| GET  | `/api/stats/monthly`   | 月度分析量趋势 |
| GET  | `/api/stats/followups` | 随访记录趋势（按日期） |
| GET  | `/api/stats/stage`     | 康复阶段分布 |
| GET  | `/api/stats/cross`     | 部位 × 运动项目热力图 |

> 全部为数据库真实计数。旧的 `accuracy` / `rehab-duration` / `recovery` 三个演示 topic 已删除（前端也不再引用），请求会返回 `404 未知统计项`，避免看板出现来源不明的数字。

### 4. AI 助手
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/chat` | body: `{message, case_no?}`。带 `case_no` 时后端注入该病例真实字段（检查、模型结论与置信度、检出区域、技师报告、医师意见、康复方案、最近随访）作为上下文；返回 `{reply, source: "model"\|"local", case_no}`，前端据此标注来源 |

> `source="local"` 表示未配置大模型 Key，回复完全由当前病例字段拼装，不会编造检查值、日期或剂量。设置环境变量 `DASHSCOPE_API_KEY` 后自动切换为 `qwen-plus` 生成（`source="model"`）。

### 5. 科研导出
| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/export?format=csv`  | 导出 CSV |
| GET  | `/api/export?format=json` | 导出 JSON |

### 6. 管理员（仅机构管理员）
| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/admin/pending`                  | 待审核注册申请列表 |
| POST | `/api/admin/pending/<id>/approve`     | 通过，自动生成工号并开通账号 |
| POST | `/api/admin/pending/<id>/reject`      | 驳回 |
| GET  | `/api/admin/users`                    | 真实账号清单（含每人绑定病例数） |
| POST | `/api/admin/users`                    | 新增账号 `{name, phone, role, org, password}`；手机号即登录账号，立即可用 |
| PATCH| `/api/admin/users/<id>`               | 编辑账号 `{name?, phone?, role?, org?, status?, password?}`；密码留空不改；手机号变更会同步迁移该患者的病例绑定 |
| DELETE| `/api/admin/users/<id>`              | 删除账号；**病例不删只解绑**（变为未绑定，可重新绑定）；不能删自己、不能删最后一个管理员 |
| PATCH| `/api/admin/cases/<case_no>`          | 编辑档案 `{patient_name?, patient_phone?, part?, sport?, injury_date?}`；写入 `reviews(action=admin-edit)` 留痕 |
| DELETE| `/api/admin/cases/<case_no>`         | 删除档案：连带检测框 / 随访 / AI 留痕 / 操作记录与影像文件，不可恢复 |
| GET  | `/api/admin/unbound`                  | 未绑定病例 + 患者账号列表 |
| POST | `/api/admin/bind`                     | 绑定 `{case_no, phone}` |

> 建档入口：管理员在「病例与康复档案」点「＋ 新增档案」，上传影像后走与技师完全相同的真实 ONNX 推理链路，落库为「报告撰写中」，再由技师补写报告、医师审核。管理员不绕过审核流程。

### 7. 安装包与版本
| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/downloads/lingshi-yiying-app.apk` | 直接下载安装包（15.1 MB，随项目附带） |
| GET  | `/api/app/version` | 返回版本号、大小、更新日期；安装包缺失时 `downloadUrl` 为 `null`，页面据此隐藏下载按钮 |

---

## 五、让手机扫码下载 APK

服务监听 `0.0.0.0:5000`，同一局域网内手机可直接访问。

1. 电脑上启动 `python app.py`；
2. 看启动日志里的 `http://192.168.x.x:5000`；
3. 手机浏览器打开 `http://192.168.x.x:5000/download.html`，页面二维码会指向当前地址下的 `downloads/lingshi-yiying-app.apk`，扫码即可下载；
4. 不装 App 也可以直接用手机浏览器打开 `login.html` 使用同一套 Web 工作台。

---

## 六、前端改动说明（相对原静态页）

1. **新增 `js/auth.js`**：负责 token 存取、`dashboard.html` 进入时校验登录态（未登录踢回 `login.html`）、退出时清 token。
2. **`dashboard.html`**：在 `workbench.js` 之前加了一行 `<script src="js/auth.js"></script>`；侧栏、视图、按钮名称按新流程调整（待复核 → 待审核、康复方案 → 康复与随访）。
3. **`login.html`**：登录/注册改为调用 `/api/auth/*`；角色卡增至 5 个（含"患者"）。
4. **影像分析页（技师）**：真实上传 + 模型推理；模型只输出"可疑位置 + 置信度"，技师在其下方撰写**检查报告**并保存/提交，提交后进入医师待审核队列。
5. **待审核队列（医师）**：只列 `待审核` 病例，点开进详情；详情页可一键调 AI 生成"病情情况 + 治疗建议"初稿，逐字修改后确认归档，或填原因驳回给技师。
6. **病例详情**：按角色渲染三段——技师报告、医师审核、康复深化；每段只对相应角色开放编辑，其余只读。报告面板只在 `已审核` 后出现。
7. **康复与随访（康复治疗师）**：选病例 → 看医师结论 → AI 生成/手写康复建议 → 保存并追加到档案 → 录入周期随访（疼痛评分 / 关节活动度 / 肿胀 / 训练项），趋势文本实时更新。
8. **我的档案（患者）**：只显示本人且已归档的病例，详情全只读，无任何操作按钮。
9. **总览 KPI**：改为 `/api/summary` 的真实计数；待审核列表与 KPI 每 60 秒自动刷新。
10. **数据看板**：删除写死的 91.3% / 6.2 周 / 94% 等数字，改为数据库真实统计（累计病例、已归档、在管康复、随访趋势、阶段分布、部位×运动热力图）。

---

## 七、骨折检测模型（真实推理）

检测不再是"前端假数据 + 后端转发"，而是后端加载 ONNX 模型真跑推理。

### 1. 依赖与模型文件

```powershell
pip install onnxruntime          # 只有 app.py 需要，前端不受影响
```

模型放在 `server/models/best.onnx`（YOLO26n detect，约 9.4 MB，输入 `1×3×640×640`，
输出 `1×6×8400`：4 个 bbox + 2 个类别分数，类别为 `fracture` / `normal`）。
把训练得到的 `best.onnx` 直接替换同名文件即可换模型，无需改代码。

### 2. 可调环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `DETECT_MODEL`     | `server/models/best.onnx` | 模型路径 |
| `DETECT_CONF`      | `0.15` | 置信度阈值，低于该分数的框丢弃 |
| `DETECT_IOU`       | `0.45` | NMS 的 IoU 阈值 |
| `DETECT_IMG_SIZE`  | `640`  | 推理输入边长 |
| `DETECT_MAX_BOXES` | `20`   | 单图最多保留框数 |
| `DASHSCOPE_API_KEY`| 空     | 有值则用 qwen-plus 生成报告/问答，否则用本地模板。读取顺序：环境变量 → `server/.dashscope_key` 文件；**源码中不再硬编码任何 Key** |

启动时可先访问 `/api/model/status` 确认 `available: true`；模型缺失会返回明确错误，
前端会显示"检测模型未就绪"，而不是给出假的检测结果。

### 3. 阈值与评测记录

置信度与 NMS 阈值由环境变量 `DETECT_CONF` / `DETECT_IOU` 控制，默认 0.15 / 0.45。
训练过程逐轮指标见 `docs/training/results.csv`（第 100 轮：precision 0.82515、
recall 0.77325、mAP50 0.8288、mAP50-95 0.57641）；训练参数见
`docs/training/args.yaml`，数据集划分见 `docs/dataset-split.md`。

早期文档曾列出按阈值调整的召回／精确率对照表及 test 集统计，因缺少与之对应的
完整评测记录，开源版本中已移除；引用本模型指标请一律以
`docs/training/results.csv` 为准，更换模型后需重新评测。

### 4. 结果如何进入数据库

- `cases`：一条病例一行。模型侧 `finding_label`、`confidence`、`model_name`、`model_ver`、`detect_ms`、
  `image_w/h`、`ai_report`；流程侧 `status`、`patient_name/patient_phone`、`tech_report/tech_name/tech_submitted_at`、
  `doctor_report/doctor_advice/doctor_name/reviewed_at`、`rehab_advice/rehab_name/rehab_updated_at`、`reject_reason`。
- `findings`：一处检测一行，含 `bbox`（归一化 `[x1,y1,x2,y2]` JSON）、`label`、`confidence`、
  `source`（`model` / `doctor`）；医师人工标注也写进这张表，`source='doctor'`。
- `followups`：康复随访一行一条（日期、疼痛 0-10、关节活动度 0-100、肿胀、训练项、备注、记录人）。
- `ai_suggestions`：AI 初稿与最终采纳文本各留一份，`kind` 区分 `review`（医师）/`rehab`（康复师），
  `source` 区分 `ai` / `local` / `doctor`，便于追溯"哪些内容是 AI 起草、谁改的"。
- 模型判为 `normal`（未见明确骨折）时**不画框**，`bbox` 为 `null`，只保留置信度。
- 前端只按 `/api/cases/<no>/full` 返回的 `findings` 画框，不再接受浏览器传来的任何检测结果。

### 5. 注意：`lingshi-server.exe` 已从交付目录移除

早期 PyInstaller 产物没有打包 onnxruntime 和模型文件，运行它不会具备真实推理能力，容易在评审时被误认为"功能不可用"。该文件已移出 `server/`（`网页\_开发归档\lingshi-server.exe`），演示与评审统一用 `python app.py`。如确需打包：

```powershell
pyinstaller -F app.py --add-data "models;models" --collect-all onnxruntime
```

或者演示阶段直接用 `python app.py`。

---

## 八、部署提示

- 竞赛演示阶段直接 `python app.py` 即可（有 waitress 会自动用 waitress，没有就用 Flask 内置服务器）。
- **Windows 云服务器**部署步骤：
  1. 把 `lsy-web.zip` 传到服务器解压（目录里能看到 `WebProject\启动服务.bat`）；
  2. 双击 `WebProject\启动服务.bat`。没装 Python 也没关系，脚本会自己下载便携版并装依赖（首次约 2-5 分钟）；
  3. 云控制台「安全组 / 防火墙」放行 **TCP 5000**（脚本在管理员身份下也会自动放行系统防火墙）；
  4. 浏览器访问 `http://服务器公网IP:5000/login.html`。
- 想开机自启 / 后台常驻，用「任务计划程序」新建任务，操作填 `启动服务.bat` 的完整路径，
  起始位置填 `WebProject` 目录，勾选"不管用户是否登录都运行"。
- **Linux**（或想用 gunicorn）：
  ```bash
  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
  .venv/bin/gunicorn -w 2 -b 0.0.0.0:5000 --timeout 180 app:app
  ```
- **安全说明**：密码用 SHA-256 存储，token 7 天有效，仅适合演示；正式产品请替换为 bcrypt + HTTPS + 登录限流。

---

## 九、本轮质量审计与修复（2026-11）

### 1. 阻断：患者 ↔ 病例没有绑定通路

- 根因：`/api/cases` 只按 `patient_phone == 本人手机号` 过滤，技师建档时手机号可留空；全站没有绑定接口，也没有绑定入口 → 患者档案永远是空的（演示时"患者端什么都没有"）。
- 修复：新增 `/api/patient/bind`（自助，姓名一致 + 未绑定才成功）、`/api/admin/unbound`、`/api/admin/bind`（管理员代绑，写 `reviews.action=bind` 留痕）；患者档案页加「＋ 绑定我的病例」，管理员「数据与账号」页加未绑定面板。
- 验证：API 用例覆盖"冒领被拒 / 管理员绑定 / 绑定后可见 / 留痕 / 非管理员 403"；浏览器验证患者空档案 → 绑定入口 → 列表刷新。

### 2. 严重：AI 助手的回答与病例无关、且会编造数据

- 根因：`/api/ai/chat` 只发用户那句话，前端还内置了 `AI_REPLIES` 假答案（"左腕 X 线 / 置信度 0.83 / 2026-10-01 复查"）；面板标题写死病例号 `LSY-20260917-011`。换个病例问，答案仍是那一段。
- 修复：删除 `AI_REPLIES`；后端 `_case_context()` 注入该病例真实字段（检查、模型结论与置信度、检出区域、技师报告、医师意见、康复方案、最近随访），无 Key 时由 `_local_case_answer()` 只用这些字段拼答案并显式提示"档案中未记录"；返回 `source` 供前端标注；未选病例时给出选择引导。
- 验证：带不同 `case_no` 提问，回答中的病例号与结论随病例变化；`0.83` 不再出现；未选病例返回引导语。

### 3. 严重：AI 回复里的 `**加粗**` 原样显示

- 根因：气泡只把 `\n` 换成 `<br>`。
- 修复：新增 `mdToHtml()`（转义 → 标题 → 粗体/斜体/行内码 → 列表），气泡改用该渲染；写入输入框的建议改用 `plainText()` 去标记，避免把 `**` 带进可编辑文本。
- 验证：DOM 断言气泡含 `<b>` 且无字面 `**`。

### 4. 严重：运动回归页整页是假数据

- 根因：`view-return` 静态写死病例 `LSY-20260905-006（右踝）`、恢复度 `[42,58,72,78]`、"约 78%"、7 级阶梯与"下次复查 2026-10-06"，库里没有该病例，切换病例也不会变。
- 修复：新增 `/api/cases/<no>/recovery`，用随访的疼痛 / 活动度 / 肿胀三项扣分算恢复度，返回 `series`、`ladder`、`score`；前端改为"选病例 → 拉取 → 渲染阶梯与 ECharts 曲线（含 90% 达标线）"，无随访时明确显示"暂无随访记录"。
- 验证：接口返回的曲线点数与随访条数一致、分数落在 0–100、阶梯恰 7 级且有当前阶段；页面徽章/说明随真实随访变化，旧病例号不再出现。

### 5. 严重：大模型 Key 硬编码在源码里

- 根因：`AI_API_KEY = "sk-..."` 直接写在 `app.py`。
- 修复：改为 `_load_ai_key()` 读 `DASHSCOPE_API_KEY` 或 `server/.dashscope_key`，源码中 Key 出现次数为 0；未配置时自动降级为本地回答并在界面标注来源。

### 6. 一般：账号页与身份区是写死的

- 根因：「数据与账号」的角色表是 5 行静态 HTML（含"安全设置"文案），「＋ 新增账号」只弹 toast；侧栏与账户卡的头像/姓名/角色写死"沈同学 / 执业医师 / 执"。
- 修复：新增 `/api/admin/users` 返回真实账号（姓名、角色、手机号、机构、绑定病例数、状态、开通时间），前端渲染真实表格；「＋ 新增账号」打开注册页；身份区默认 `—`，登录后由用户信息填充。

### 7. 一般：能力页把大模型写成 DeepSeek，与实际不符

- 根因：`about.html` 与 `capabilities.html` 写着"YOLO + DeepSeek"，而后端实际调用阿里云百炼 `qwen-plus`（`/api/ai/*`）。
- 修复：文案统一为"阿里云百炼大模型"；`/api/app/version` 改为读安装包真实大小与修改时间（此前版本号、日期为硬编码常量）。

### 8. 建议：删除无来源的统计假数据

- 根因：`STATS_DATA` 还保留 `accuracy=91.3%`、`rehab-duration=6.2周`、`recovery=94%` 三个 topic，前端虽未引用，接口仍会返回这些数字。
- 修复：整段删除，未知 topic 返回 `404 未知统计项`；README 同步说明。

### 9. 建议：交付目录混入调试产物

`lingshi-server.exe`（缺 onnxruntime/model 的旧打包）、`ai_debug.log`、`lingshi.db.bak`、`__pycache__`、若干 `check_*.py` 已移入 `网页\_开发归档\`，`server/` 只保留运行必需文件。

---

## 十、机构管理员的账号与档案管理（2026-11 新增）

### 1. 账号：新增 / 编辑 / 删除

入口：「统计与设置 → 账号与权限（真实账号）」，表格新增「操作」列。

- **新增**：点「＋ 新增账号」展开表单（姓名 / 手机号 / 角色 / 机构 / 状态 / 初始密码），保存后立即生效，手机号即登录账号，无需再走注册审核。
- **编辑**：行内「编辑」展开同一表单，可改姓名、角色、机构、状态（启用 / 停用），密码留空表示不改；**改手机号会同步迁移该患者已绑定的病例**，不会让档案凭空消失。
- **删除**：行内「删除」需点两次（第一次变「确认删除？」，3 秒后自动取消）。删除账号**不删档案**，只把其病例解绑为"未绑定"，可在绑定面板重新绑定。

安全约束（后端强制，前端只是提示）：

1. 不能修改自己的角色、不能停用 / 删除自己；
2. 不能把最后一个启用的管理员改角色、停用或删除；
3. 手机号必须 11 位且全局唯一；密码至少 6 位；
4. 非机构管理员调用这些接口一律 403。

### 2. 档案：新增 / 编辑 / 删除

- **新增**：在「病例与康复档案」点「＋ 新增档案」，填患者姓名 / 手机号（选填，填了即自动绑定该患者账号）/ 部位 / 运动项目 / 受伤日期并上传影像。后端走与技师上传完全相同的真实 ONNX 推理与落库逻辑，状态为「报告撰写中」，不会跳过医师审核。
- **编辑**：打开病例详情，底部「档案管理（机构管理员）」可改患者姓名 / 手机号 / 部位 / 运动项目 / 受伤日期。留空手机号即解除绑定；填手机号时要求该号码必须是**患者账号**，否则拒绝并提示先去开通。每次修改写一条 `reviews(action=admin-edit)` 记录，注明"字段: 旧值 → 新值"。
- **删除**：同一面板的「删除档案」需点两次确认。删除会连带清掉该病例的检测框、随访、AI 留痕、操作记录与影像文件（`uploads/` 下的图片一并删除），不可恢复。

### 3. 权限边界

管理员能看到全部状态的病例（含"报告撰写中 / 待审核 / 已驳回"），技师仍只看到自己待撰写的与已审核的，医师只看到已审核，患者只看到本人已审核——这一点在浏览器里逐个角色验证过（见 `audit/cdp_role_regress.py`）。

### 附：本轮验证方式

- 接口级：`audit/audit_fix_test.py`（27 条断言，含越权/冒领/绑定留痕/接口下线）；
- 浏览器级：`audit/cdp_audit_ui.py`（21 条断言，覆盖 AI 气泡渲染、账号表、绑定面板、回归阶梯、患者档案）；
- 回归：`audit/flow_test.py` 12 步全流程（技师上传 → 提交 → 医师审核 → 康复 → 患者只读 → 撤回权限）通过。
