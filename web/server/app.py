# -*- coding: utf-8 -*-
"""
灵视医影 · 统一后端服务（Flask + SQLite）—— 网页与 App 共用，端口 5000
=====================================
启动方式：
    cd server
    python app.py
然后接口根地址  http://127.0.0.1:5000/api/ ，站点地址 http://127.0.0.1:5000/

说明：
- 本服务是「唯一后端」：同时提供 /api/*、/uploads/* 接口与网页静态站点。
  网页前端（WebProject/ 根目录）与移动端 App（web-view 套壳）都连这一个进程、
  这一个 lingshi.db，数据天然同步，不再分 5000/5001 两个后端。
- 已内置 CORS（供 App 走 file:// 跨域调用）与 /api/ai/detect（App 影像识别）。
- 数据库文件为同目录下 lingshi.db，首次启动自动建表并写入演示账号与病例。
- 仅用于竞赛演示，密码用 SHA-256 哈希存储，不应对公网开放。
"""

import os
import re
import sys
import json
import sqlite3
import threading
from werkzeug.security import generate_password_hash, check_password_hash
import secrets
import datetime
from pathlib import Path

from flask import (
    Flask, request, jsonify, send_from_directory,
    g, abort, Response
)
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

# 小内存机器（2G 云服务器）友好：必须在 numpy / onnxruntime 导入前限制线程数，
# 否则 BLAS 一上来就按 CPU 核数起线程池，光线程栈就能吃掉几百 MB 提交内存。
for _k in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_k, "1")

# 便携版 Python（官方 embeddable 包）用 ._pth 固定 sys.path，
# 不会像正常安装那样把「脚本所在目录」加进去；这里补一次，
# 保证下面的 from detector import ... 在便携运行时也能找到同目录模块。
_THIS_DIR = str(Path(__file__).resolve().parent)
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

# 本地 ONNX 骨折检测模型（best.onnx · YOLO26n · 2 类）
# 模型不可用时只在 /api/analyze 处报 503，不影响登录、档案等其它功能
from detector import (
    DetectorError, detector_status, get_detector, CLASS_LABELS_ZH, CONF_THRESHOLD,
)

# ----------------------------------------------------------------------
# 路径与常量
# ----------------------------------------------------------------------
# 打包成 exe 后，以 exe 所在目录为基准；直接 python app.py 时以脚本所在目录为基准
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys.executable).resolve().parent
else:
    BASE_DIR = Path(__file__).resolve().parent          # server/
WEB_DIR  = BASE_DIR.parent                          # WebProject/
DB_PATH  = BASE_DIR / "lingshi.db"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

SECRET_KEY_PATH = BASE_DIR / ".secret_key"
TOKEN_MAX_AGE = 7 * 24 * 3600   # 7 天

ROLE_VIEWS = {
    "影像技师":   ["dashboard", "analysis", "archive", "case-detail", "ai-assist"],
    "执业医师":   ["dashboard", "review", "archive", "case-detail", "ai-assist"],
    "康复治疗师": ["dashboard", "archive", "rehab", "case-detail", "ai-assist"],
    "患者":       ["archive", "case-detail"],
    "机构管理员": ["dashboard", "analysis", "review", "archive",
                  "case-detail", "rehab", "analytics", "stats", "ai-assist", "return"],
}

# 病例状态机：报告撰写中 → 待审核 → 已审核 / 已驳回
ST_DRAFT   = "报告撰写中"
ST_PENDING = "待审核"
ST_DONE    = "已审核"
ST_REJECT  = "已驳回"
OLD_STATUS_MAP = {"待复核": ST_PENDING, "已修改待确认": ST_PENDING, "已确认": ST_DONE}

# 演示账号（首次启动写入；密码均为 123456，登录账号即手机号）
SEED_USERS = [
    ("13800000001", "123456", "杨同学", "执业医师"),
    ("13800000002", "123456", "沈同学", "影像技师"),
    ("13800000003", "123456", "张同学", "康复治疗师"),
    ("13800000004", "123456", "刘同学", "机构管理员"),
    ("13700000001", "123456", "宋同学", "患者"),
]

# 体验账号（每次启动确保存在，供评委/演示直接登录，无需审批）
DEMO_USER = ("13000000000", "123456", "体验用户", "执业医师")
DEMO_PATIENT = ("13700000001", "123456", "宋同学", "患者")

# ============ 阿里云百炼（DashScope）API 配置 ============
# 控制台：https://bailian.console.aliyun.com/ -> API-KEY 管理
# 密钥不再写死在源码里：优先读环境变量 DASHSCOPE_API_KEY，其次读 server/.dashscope_key（不随项目分发）
# 两处都没有时，AI 助手改为基于"当前病例真实数据"的规则回答，不影响其他功能
def _load_ai_key() -> str:
    key = (os.environ.get("DASHSCOPE_API_KEY") or "").strip()
    if key:
        return key
    try:
        f = BASE_DIR / ".dashscope_key"
        if f.exists():
            return f.read_text(encoding="utf-8").strip().splitlines()[0].strip()
    except Exception:
        pass
    return ""


AI_API_KEY = _load_ai_key()
# 百炼 OpenAI 兼容模式地址（同地址同时支持 Qwen 与 DeepSeek 系列）
AI_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
# 当前模型：DeepSeek V4.1 Flash（百炼平台，2026-10 实测可用，响应约 2-3 秒）
# 备选：qwen-plus（均衡）/ qwen-turbo（最便宜）/ qwen-max（最强）
# 注意：deepseek-v3 / deepseek-r1 系列已于 2026-10-10 在百炼下线，不要再填
AI_MODEL   = "deepseek-v4.1-flash-1017"
AI_SYSTEM_PROMPT = (
    "你是「灵视医影」平台的 AI 影像助手，服务于运动骨折诊疗与康复场景。"
    "回答要求：\n"
    "1. 基于运动医学常识给出参考建议，涉及影像解读、康复训练、恢复时间、病例摘要；\n"
    "2. 必须明确说明 AI 结果仅作辅助参考，不能替代执业医师诊断；\n"
    "3. 涉及用药、确诊、能否上场等问题，一律建议咨询执业医师或康复治疗师；\n"
    "4. 用中文回答，简洁专业，分点说明，不要编造具体药品剂量。"
)

# 演示病例（与前端 workbench.js 中 EXPORT_RECORDS 对齐）
SEED_CASES = [
    ("LSY-20260917-011", "腕部（桡骨远端）", "篮球", "X光", 0.83, "保护期",     7,  "否"),
    ("LSY-20260917-010", "踝部（外踝）",     "足球", "X光", 0.79, "活动恢复期", 9,  "否"),
    ("LSY-20260917-009", "腕部（未见异常）", "羽毛球", "X光", 0.90, "已排除",     0,  "不适用"),
    ("LSY-20260916-007", "踝部（内踝）",     "跑步", "X光", 0.81, "力量回归期", 10, "否"),
    ("LSY-20260916-005", "腕部（舟骨）",     "骑行", "X光", 0.76, "保护期",     12, "否"),
    ("LSY-20260910-008", "腕部（桡骨远端）", "篮球", "X光", 0.85, "活动恢复期", 7,  "否"),
    ("LSY-20260905-006", "踝部（外踝）",     "跑步", "X光", 0.88, "力量回归期", 9,  "否"),
    ("LSY-20260828-003", "锁骨（中段）",     "足球", "X光", 0.86, "已回归",     8,  "是"),
    ("LSY-20260820-014", "胫腓骨（下段）",   "足球", "X光", 0.80, "力量回归期", 12, "否"),
    ("LSY-20260812-021", "腕部（桡骨远端）", "羽毛球", "X光", 0.87, "已回归",   7,  "是"),
    ("LSY-20260803-009", "踝部（外踝）",     "篮球", "X光", 0.82, "已回归",     9,  "是"),
    ("LSY-20260726-017", "锁骨（远端）",     "骑行", "X光", 0.84, "已回归",     8,  "是"),
]

# 演示用"待审核"病例：技师已写完报告提交，医师登录后队列里就有活可干
SEED_PENDING = [
    ("LSY-20261103-031", "腕部 · 左侧", "篮球", "X光", 0.74, "保护期",     2, "否", "王同学", "13700000021"),
    ("LSY-20261103-032", "踝部 · 右侧", "足球", "X光", 0.68, "活动恢复期", 3, "否", "赵同学", "13700000022"),
]

# 各统计看板的数据（全部由数据库实时聚合，此处不再保留任何静态/演示数据集）

# ----------------------------------------------------------------------
# Flask 应用
# ----------------------------------------------------------------------
app = Flask(__name__, static_folder=None)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB 上传限制

# 统一 JSON 错误出口：/api/* 的错误返回 JSON，不返回 HTML
@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "接口不存在"}), 404
    return e

@app.errorhandler(405)
def method_not_allowed(e):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "方法不允许"}), 405
    return e

@app.errorhandler(413)
def too_large(e):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "文件太大，最大 16MB"}), 413
    return e

@app.errorhandler(500)
def internal_error(e):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "服务器内部错误"}), 500
    return e


# ----------------------------------------------------------------------
# CORS：App 走 file:// 本地页面（web-view 套壳），Origin 为 null，
# 需对 /api/* 统一回 Access-Control-Allow-Origin: * 才能跨域调用。
# 用 after_request 手写，不依赖 flask-cors，避免多装一个包。
# ----------------------------------------------------------------------
@app.after_request
def _add_cors(resp):
    if request.path.startswith("/api/") or request.path.startswith("/uploads/"):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Token"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        resp.headers["Access-Control-Max-Age"] = "86400"
    return resp


# ----------------------------------------------------------------------
# 数据版本：网页端任何写操作都会让版本号 +1，App 端轮询 /api/sync/version
# 感知到变化后自动重新拉数据，实现「网页改了，App 端自动同步刷新」。
# 用进程内计数器而非扫库，2G 小机器上 Zero 查询开销；waitress 多线程靠锁保护。
# 登录/登出/AI 对话等不改变业务档案的请求不计入，避免无谓刷新。
# ----------------------------------------------------------------------
_DATA_VERSION = 0
_DATA_VERSION_LOCK = threading.Lock()
_VERSION_SKIP = (
    "/api/auth/login", "/api/auth/logout", "/api/auth/me",
    "/api/ai/chat", "/api/ai/detect", "/api/sync/version",
)


@app.after_request
def _bump_data_version(resp):
    global _DATA_VERSION
    try:
        if (request.method in ("POST", "PUT", "PATCH", "DELETE")
                and request.path.startswith("/api/")
                and not any(request.path.startswith(s) for s in _VERSION_SKIP)
                and 200 <= resp.status_code < 300):
            with _DATA_VERSION_LOCK:
                _DATA_VERSION += 1
    except Exception:
        pass
    return resp


@app.get("/api/sync/version")
def api_sync_version():
    """App 轮询用：返回当前业务数据版本。变化时 App 应重新拉取并刷新界面。"""
    with _DATA_VERSION_LOCK:
        v = _DATA_VERSION
    return jsonify({"ok": True, "version": v})


@app.route("/api/<path:_p>", methods=["OPTIONS"])
@app.route("/uploads/<path:_p>", methods=["OPTIONS"])
def _cors_preflight(_p):
    return ("", 204)


@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    # 图片鉴权：允许从 header 或 query token 读取（<img> 标签带不了 header）
    token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    if not token:
        token = request.args.get("token", "")
    if not token:
        return jsonify({"ok": False, "error": "未登录"}), 401
    try:
        data = _ts.loads(token, salt="lingshi-token", max_age=7 * 86400)
    except Exception:
        return jsonify({"ok": False, "error": "token 无效"}), 401
    return send_from_directory(str(UPLOAD_DIR), filename)


def _load_secret_key() -> str:
    if SECRET_KEY_PATH.exists():
        return SECRET_KEY_PATH.read_text(encoding="utf-8").strip()
    key = secrets.token_hex(32)
    SECRET_KEY_PATH.write_text(key, encoding="utf-8")
    return key


app.secret_key = _load_secret_key()
_ts = URLSafeTimedSerializer(app.secret_key, salt="lingshi-token")


# ----------------------------------------------------------------------
# 数据库
# ----------------------------------------------------------------------
def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def hash_password(pw: str) -> str:
    return generate_password_hash(pw)


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name          TEXT NOT NULL,
            role          TEXT NOT NULL,
            phone         TEXT DEFAULT '',
            org           TEXT DEFAULT '',
            status        TEXT NOT NULL DEFAULT 'active',
            created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pending_applications (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            phone         TEXT NOT NULL,
            org           TEXT NOT NULL,
            role          TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'pending',   -- pending / approved / rejected
            created_at    TEXT NOT NULL,
            reviewed_at    TEXT
        );

        CREATE TABLE IF NOT EXISTS cases (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            case_no    TEXT UNIQUE NOT NULL,
            part       TEXT NOT NULL,
            sport      TEXT NOT NULL,
            modality   TEXT NOT NULL,
            confidence REAL NOT NULL,
            stage      TEXT NOT NULL,
            weeks      INTEGER NOT NULL,
            returned   TEXT NOT NULL,
            status     TEXT NOT NULL DEFAULT '报告撰写中',
            image_path TEXT DEFAULT '',
            injury_date TEXT DEFAULT '',
            patient_name  TEXT DEFAULT '',
            patient_phone TEXT DEFAULT '',
            tech_report   TEXT DEFAULT '',
            tech_name     TEXT DEFAULT '',
            tech_submitted_at TEXT DEFAULT '',
            doctor_report TEXT DEFAULT '',
            doctor_advice TEXT DEFAULT '',
            doctor_name   TEXT DEFAULT '',
            reviewed_at   TEXT DEFAULT '',
            rehab_advice  TEXT DEFAULT '',
            rehab_name    TEXT DEFAULT '',
            rehab_updated_at TEXT DEFAULT '',
            chief_complaint TEXT DEFAULT '',
            reject_reason TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );

        -- 随访 / 康复评估记录（康复治疗师按周期录入）
        CREATE TABLE IF NOT EXISTS followups (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            case_no     TEXT NOT NULL,
            record_date TEXT NOT NULL,
            pain_score  INTEGER DEFAULT 0,     -- 0-10
            rom         INTEGER DEFAULT 0,     -- 关节活动度 %
            swelling    TEXT DEFAULT '',       -- 无 / 轻 / 中 / 重
            training    TEXT DEFAULT '',       -- 训练执行情况
            note        TEXT DEFAULT '',
            author      TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_followups_case ON followups(case_no);

        -- AI 生成 / 人工确认的文本留痕（医生结论、康复建议）
        CREATE TABLE IF NOT EXISTS ai_suggestions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            case_no    TEXT NOT NULL,
            kind       TEXT NOT NULL,          -- doctor / rehab
            content    TEXT NOT NULL,
            author     TEXT DEFAULT '',
            source     TEXT DEFAULT 'ai',      -- ai / human
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_sugg_case ON ai_suggestions(case_no);

        CREATE TABLE IF NOT EXISTS reviews (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            case_no    TEXT NOT NULL,
            action     TEXT NOT NULL,   -- confirm / edit / reject
            reviewer   TEXT NOT NULL,
            note       TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_chat_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            username   TEXT,
            role       TEXT NOT NULL,   -- user / bot
            content    TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        -- 模型检测结果：一条病例可有多处 bbox；normal 不出框但保留置信度
        CREATE TABLE IF NOT EXISTS findings (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            case_no    TEXT NOT NULL,
            class_id   INTEGER NOT NULL,          -- 0 fracture / 1 normal
            label      TEXT NOT NULL,             -- 中文标签
            raw_label  TEXT NOT NULL DEFAULT '',  -- 模型原始类别名
            confidence REAL NOT NULL,
            bbox       TEXT DEFAULT '',           -- JSON [x1,y1,x2,y2]，归一化 0~1
            source     TEXT NOT NULL DEFAULT 'model',
            model_name TEXT DEFAULT '',
            model_ver  TEXT DEFAULT '',
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_findings_case ON findings(case_no);
        """
    )

    # 种子用户
    cur.execute("SELECT COUNT(*) FROM users")
    if cur.fetchone()[0] == 0:
        now = datetime.datetime.now().isoformat(timespec="seconds")
        for uname, pw, real, role in SEED_USERS:
            cur.execute(
                "INSERT INTO users(username,password_hash,name,role,phone,status,created_at) VALUES(?,?,?,?,?,?,?)",
                (uname, hash_password(pw), real, role, uname, "active", now),
            )

    # 确保体验账号存在（每次启动检查，不存在则插入）
    for uname, pw, real, role in (DEMO_USER, DEMO_PATIENT):
        cur.execute("SELECT id FROM users WHERE username=?", (uname,))
        if not cur.fetchone():
            now = datetime.datetime.now().isoformat(timespec="seconds")
            cur.execute(
                "INSERT INTO users(username,password_hash,name,role,phone,status,created_at) VALUES(?,?,?,?,?,?,?)",
                (uname, hash_password(pw), real, role, uname, "active", now),
            )

    # 种子病例（演示用：全部按"已审核"归档，前 4 条属于患者演示账号 13700000001）
    cur.execute("SELECT COUNT(*) FROM cases")
    if cur.fetchone()[0] == 0:
        now = datetime.datetime.now().isoformat(timespec="seconds")
        for idx, row in enumerate(SEED_CASES):
            is_demo_patient = idx < 4
            pname = "宋同学" if is_demo_patient else f"患者{idx + 1}"
            pphone = "13700000001" if is_demo_patient else f"1370000{idx + 1:04d}"
            stage = row[5]
            advice = (
                "当前处于" + stage + "：继续支具保护，避免患处负重与对抗性动作；"
                "按康复计划进行无痛范围内的关节活动与渐进力量训练；4 周后复查评估。"
                if stage != "已排除"
                else "未见明确骨折，可逐步恢复日常活动；如疼痛持续，2 周后复查。"
            )
            rehab = (
                "第 1-2 周：患处支具保护，手指/踝泵等远端关节活动，抬高消肿；\n"
                "第 3-4 周：复查后逐步增加关节主动活动度，无痛范围内负重；\n"
                "第 5-6 周：弹力带渐进力量与本体感觉训练，逐步恢复日常与专项动作。"
                if stage != "已排除"
                else "未见明确骨折：可逐步恢复日常活动，注意热身与负荷递增；如疼痛反复，2 周后复查。"
            )
            cur.execute(
                """INSERT INTO cases(case_no,part,sport,modality,confidence,stage,weeks,returned,
                                     status,created_at,patient_name,patient_phone,
                                     tech_report,tech_name,tech_submitted_at,
                                     doctor_report,doctor_advice,doctor_name,reviewed_at,
                                     rehab_advice,rehab_name,rehab_updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (*row, ST_DONE, now, pname, pphone,
                 f"模型提示：{row[1]}，置信度 {round(row[4] * 100)}%。已核对体位与曝光，图像质量满足判读。",
                 "沈同学", now,
                 f"{row[1]}（{row[3]}）：模型提示疑似骨折，结合影像与病史，判读为{stage}阶段表现。",
                 advice, "杨同学", now,
                 rehab, "张同学", now),
            )
            if idx == 0:
                for k, (day, pain, rom, swell, train, note) in enumerate((
                    ("2026-09-24", 6, 35, "轻度", "手指屈伸 + 肩肘活动", "支具制动期，疼痛可控"),
                    ("2026-10-08", 4, 55, "轻微", "腕关节主动活动度 + 握力球", "复查后开始活动度训练"),
                    ("2026-10-22", 2, 72, "无", "弹力带渐进力量", "准备进入力量回归期"),
                )):
                    cur.execute(
                        """INSERT INTO followups(case_no,record_date,pain_score,rom,swelling,training,
                                                 note,author,created_at)
                           VALUES(?,?,?,?,?,?,?,?,?)""",
                        (row[0], day, pain, rom, swell, train, note, "张同学", now),
                    )

        # 两条"待审核"病例，让医师一登录就有队列可审
        for case_no, part, sport, modality, conf, stage, weeks, returned, pname, pphone in SEED_PENDING:
            cur.execute(
                """INSERT INTO cases(case_no,part,sport,modality,confidence,stage,weeks,returned,
                                     status,created_at,patient_name,patient_phone,
                                     tech_report,tech_name,tech_submitted_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (case_no, part, sport, modality, conf, stage, weeks, returned,
                 ST_PENDING, now, pname, pphone,
                 f"{part}正位片：可见骨皮质连续性中断，断端对位对线尚可，周围软组织稍肿胀；"
                 f"模型提示可疑区域，置信度 {round(conf * 100)}%，建议结合临床与查体。",
                 "沈同学", now),
            )
            cur.execute(
                "INSERT INTO reviews(case_no,action,reviewer,note,created_at) VALUES(?,?,?,?,?)",
                (case_no, "submit", "沈同学", "技师提交报告，等待医师审核", now),
            )

    # 兼容旧表：加新字段
    for col in (
        "image_path TEXT DEFAULT ''",
        "injury_date TEXT DEFAULT ''",
        "finding_label TEXT DEFAULT ''",
        "model_name TEXT DEFAULT ''",
        "model_ver TEXT DEFAULT ''",
        "detect_ms INTEGER DEFAULT 0",
        "image_w INTEGER DEFAULT 0",
        "image_h INTEGER DEFAULT 0",
        "ai_report TEXT DEFAULT ''",
        "patient_name TEXT DEFAULT ''",
        "patient_phone TEXT DEFAULT ''",
        "tech_report TEXT DEFAULT ''",
        "tech_name TEXT DEFAULT ''",
        "tech_submitted_at TEXT DEFAULT ''",
        "doctor_report TEXT DEFAULT ''",
        "doctor_advice TEXT DEFAULT ''",
        "doctor_name TEXT DEFAULT ''",
        "reviewed_at TEXT DEFAULT ''",
        "rehab_advice TEXT DEFAULT ''",
        "rehab_name TEXT DEFAULT ''",
        "rehab_updated_at TEXT DEFAULT ''",
        "chief_complaint TEXT DEFAULT ''",
        "reject_reason TEXT DEFAULT ''",
    ):
        try:
            cur.execute(f"ALTER TABLE cases ADD COLUMN {col}")
        except Exception:
            pass

    # 旧状态迁移：待复核/已修改待确认 → 待审核，已确认 → 已审核
    for old, new in OLD_STATUS_MAP.items():
        cur.execute("UPDATE cases SET status=? WHERE status=?", (new, old))

    # 旧病例补一个检测标签（只补空的，不覆盖真实结果）
    cur.execute(
        """UPDATE cases SET finding_label =
             CASE WHEN stage='已排除' THEN '未见明确骨折' ELSE '疑似骨折' END
           WHERE IFNULL(finding_label,'')=''"""
    )

    # 演示兼容：早期入库的病例没有患者信息，患者账号登录后会看到空档案。
    # 若该患者名下一条都没有，则把最近 4 条已审核病例补给他（只补空字段，不动真实数据）。
    cur.execute("SELECT COUNT(*) FROM cases WHERE patient_phone=?", (DEMO_PATIENT[0],))
    if cur.fetchone()[0] == 0:
        rows = cur.execute(
            """SELECT case_no, stage FROM cases
               WHERE status=? AND IFNULL(patient_phone,'')=''
               ORDER BY created_at DESC, id DESC LIMIT 4""",
            (ST_DONE,),
        ).fetchall()
        for case_no, stage in rows:
            cur.execute(
                """UPDATE cases SET patient_name=?, patient_phone=?,
                          doctor_report=CASE WHEN IFNULL(doctor_report,'')=''
                                             THEN '结合影像与病史，本例处于' || COALESCE(NULLIF(stage,''),'康复') || '阶段。'
                                             ELSE doctor_report END,
                          doctor_advice=CASE WHEN IFNULL(doctor_advice,'')=''
                                             THEN '遵医嘱制动与逐步负重，4 周后复查评估愈合情况；康复期按计划进行关节活动与力量训练。'
                                             ELSE doctor_advice END,
                          doctor_name=CASE WHEN IFNULL(doctor_name,'')='' THEN '杨同学' ELSE doctor_name END,
                          reviewed_at=CASE WHEN IFNULL(reviewed_at,'')='' THEN datetime('now','localtime') ELSE reviewed_at END
                   WHERE case_no=?""",
                ("宋同学", DEMO_PATIENT[0], case_no),
            )

    conn.commit()
    conn.close()


# ----------------------------------------------------------------------
# 鉴权辅助
# ----------------------------------------------------------------------
# token 黑名单（内存，重启后清空）
TOKEN_BLACKLIST = set()

def make_token(user_id: int, username: str) -> str:
    return _ts.dumps({"uid": user_id, "u": username})


def parse_token(token: str):
    try:
        data = _ts.loads(token, max_age=TOKEN_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    return data


def current_user():
    """从 Authorization: Bearer / X-Token / ?token= 解析当前用户，未登录返回 None。"""
    token = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
    if not token:
        token = request.headers.get("X-Token")
    if not token:
        token = request.args.get("token")
    if not token:
        return None
    # 检查是否在黑名单里
    if token in TOKEN_BLACKLIST:
        return None
    data = parse_token(token)
    if not data:
        return None
    row = get_db().execute(
        "SELECT * FROM users WHERE id=? AND status='active'", (data["uid"],)
    ).fetchone()
    return row


def login_required(view):
    def wrapper(*args, **kwargs):
        user = current_user()
        if user is None:
            return jsonify({"ok": False, "error": "未登录或登录已过期"}), 401
        g.user = user
        return view(*args, **kwargs)
    wrapper.__name__ = view.__name__
    return wrapper


def admin_required(view):
    def wrapper(*args, **kwargs):
        user = current_user()
        if user is None:
            return jsonify({"ok": False, "error": "未登录或登录已过期"}), 401
        if user["role"] != "机构管理员":
            return jsonify({"ok": False, "error": "仅机构管理员可操作"}), 403
        g.user = user
        return view(*args, **kwargs)
    wrapper.__name__ = view.__name__
    return wrapper


# ----------------------------------------------------------------------
# 认证 API
# ----------------------------------------------------------------------
@app.post("/api/auth/login")
def api_login():
    body = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    role_in  = (body.get("role") or "").strip()

    if not username or not password:
        return jsonify({"ok": False, "error": "请输入账号和密码"}), 400

    row = get_db().execute(
        "SELECT * FROM users WHERE username=? AND status='active'", (username,)
    ).fetchone()

    if row is None:
        return jsonify({"ok": False, "error": "账号或密码错误"}), 401

    # 兼容两种哈希：新的 werkzeug 和旧的 sha256 固定盐
    pwd_ok = check_password_hash(row["password_hash"], password)
    if not pwd_ok:
        import hashlib
        legacy_hash = hashlib.sha256(("lingshi::" + password).encode("utf-8")).hexdigest()
        if row["password_hash"] == legacy_hash:
            pwd_ok = True
    if not pwd_ok:
        return jsonify({"ok": False, "error": "账号或密码错误"}), 401

    # 若前端选了角色，与库中角色做一致性校验（兼容演示）
    if role_in and role_in != row["role"]:
        return jsonify({
            "ok": False,
            "error": f"该账号为【{row['role']}】，与所选角色不一致"
        }), 403

    token = make_token(row["id"], row["username"])
    return jsonify({
        "ok": True,
        "token": token,
        "user": {
            "username": row["username"],
            "name": row["name"],
            "role": row["role"],
            "views": ROLE_VIEWS.get(row["role"], []),
        },
    })


@app.post("/api/auth/register")
def api_register():
    body = request.get_json(silent=True) or {}
    name     = (body.get("name")     or "").strip()
    phone    = (body.get("phone")    or "").strip()
    org      = (body.get("org")      or "").strip()
    role     = (body.get("role")     or "").strip()
    password = body.get("password") or ""

    if not all([name, phone, org, role, password]):
        return jsonify({"ok": False, "error": "请完整填写注册信息"}), 400
    if len(password) < 8:
        return jsonify({"ok": False, "error": "密码至少 8 位"}), 400
    if role not in ROLE_VIEWS:
        return jsonify({"ok": False, "error": "角色选择不正确"}), 400
    if not re.fullmatch(r"1[3-9]\d{9}", phone):
        return jsonify({"ok": False, "error": "手机号格式不正确"}), 400

    db = get_db()
    # 手机号唯一：已开通账号则拒绝
    if db.execute("SELECT id FROM users WHERE phone=?", (phone,)).fetchone():
        return jsonify({"ok": False, "error": "该手机号已注册过账号，请直接登录"}), 409
    # 同手机号已提交过待审核申请则拒绝重复提交
    dup = db.execute(
        "SELECT id FROM pending_applications WHERE phone=? AND status='pending'", (phone,)
    ).fetchone()
    if dup:
        return jsonify({"ok": False, "error": "该手机号已提交过申请，等待管理员审核"}), 409

    now = datetime.datetime.now().isoformat(timespec="seconds")
    db.execute(
        """INSERT INTO pending_applications(name,phone,org,role,password_hash,status,created_at)
           VALUES(?,?,?,?,?,?,?)""",
        (name, phone, org, role, hash_password(password), "pending", now),
    )
    db.commit()
    return jsonify({"ok": True, "message": "注册申请已提交，等待机构管理员审核开通"})


@app.post("/api/auth/logout")
def api_logout():
    # 取出当前 token 加入黑名单，使其立即失效
    token = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
    if not token:
        token = request.headers.get("X-Token")
    if token:
        TOKEN_BLACKLIST.add(token)
    return jsonify({"ok": True})


@app.get("/api/auth/me")
@login_required
def api_me():
    u = g.user
    return jsonify({
        "ok": True,
        "user": {
            "username": u["username"],
            "name": u["name"],
            "role": u["role"],
            "org": u["org"],
            "phone": u["phone"],
            "views": ROLE_VIEWS.get(u["role"], []),
        },
    })


# ----------------------------------------------------------------------
# 病例 / 复核 / AI 分析
# ----------------------------------------------------------------------
@app.get("/api/cases")
@login_required
def api_list_cases():
    kw = (request.args.get("keyword") or "").strip()
    db = get_db()
    role = g.user["role"]
    sql = "SELECT * FROM cases"
    args = []
    where = []

    # 患者只能看自己的档案（按手机号匹配）
    if role == "患者":
        where.append("patient_phone=?")
        args.append(_uf(g.user, "phone") or _uf(g.user, "username"))

    if kw:
        like = f"%{kw}%"
        where.append("(case_no LIKE ? OR part LIKE ? OR sport LIKE ? OR patient_name LIKE ?)")
        args.extend([like, like, like, like])

    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC, id DESC"

    rows = db.execute(sql, args).fetchall()
    return jsonify({"ok": True, "count": len(rows), "cases": [dict(r) for r in rows]})


@app.post("/api/cases")
@login_required
def api_create_case():
    """医护端主动建档：手动录入一条病例，可选随附影像做模型初判。

    - 有影像：跑 ONNX 模型，结果写入 finding_label / findings；模型不可用时降级为「待模型判读」
    - 无影像：直接建档，等影像技师补影像与检查报告
    新病例统一从「报告撰写中」开始，落在影像技师的待办队列里。
    """
    import base64 as _b64
    import json as _json

    if _uf(g.user, "role") not in ("执业医师", "影像技师", "康复治疗师", "机构管理员"):
        return jsonify({"ok": False, "error": "当前角色没有建档权限"}), 403

    body = request.get_json(silent=True) or {}
    patient_name = (body.get("patient_name") or "").strip()
    if not patient_name:
        return jsonify({"ok": False, "error": "请填写患者姓名"}), 400
    if len(patient_name) > 20:
        return jsonify({"ok": False, "error": "患者姓名不超过 20 个字"}), 400

    part = (body.get("part") or "").strip()[:40]
    if not part:
        return jsonify({"ok": False, "error": "请选择或填写检查部位"}), 400

    modality = (body.get("modality") or "").strip()
    if modality not in ("X光", "CT", "MRI", "超声"):
        modality = "X光"

    sport = (body.get("sport") or "").strip()[:20] or "未填写"
    injury_date = (body.get("injury_date") or "").strip()
    if injury_date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", injury_date):
        return jsonify({"ok": False, "error": "受伤日期格式应为 YYYY-MM-DD"}), 400

    chief = (body.get("chief_complaint") or "").strip()[:300]
    patient_phone = (body.get("patient_phone") or "").strip()
    if patient_phone and not re.fullmatch(r"1\d{10}", patient_phone):
        return jsonify({"ok": False, "error": "患者手机号应为 11 位数字"}), 400

    # 可选影像：base64 → 模型初判（模型失败不影响建档）
    raw = None
    b64 = (body.get("image_b64") or "").strip()
    if b64:
        if b64.startswith("data:"):
            b64 = b64.split(",", 1)[-1]
        try:
            raw = _b64.b64decode(b64)
        except Exception:
            return jsonify({"ok": False, "error": "影像数据格式不正确"}), 400
        if not raw:
            raw = None
        elif len(raw) > 12 * 1024 * 1024:
            return jsonify({"ok": False, "error": "影像文件过大，请压缩到 10MB 以内"}), 400

    det = None
    warn = ""
    if raw:
        try:
            det = get_detector().detect(raw)
        except DetectorError as exc:
            warn = f"影像已保存，但模型暂不可用（{exc}），已标记为待模型判读"
        except Exception as exc:
            warn = f"影像已保存，但模型推理异常（{exc}），已标记为待模型判读"

    db = get_db()
    now = datetime.datetime.now().isoformat(timespec="seconds")
    today = datetime.datetime.now().strftime("%Y%m%d")

    save_name = ""
    if raw:
        ext = ".png" if raw[:8] == b"\x89PNG\r\n\x1a\n" else ".jpg"
        save_name = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(4) + ext
        try:
            (UPLOAD_DIR / save_name).write_bytes(raw)
        except Exception:
            save_name = ""

    confidence = round(float(det.confidence), 4) if det else 0.0
    if det:
        finding_label = det.finding_label
        stage = "保护期" if det.has_fracture else "不适用"
    else:
        finding_label = "待模型判读" if save_name else "待上传影像"
        stage = "保护期"

    case_no = _next_case_no(db, today)
    try:
        inserted = False
        for _ in range(6):
            try:
                db.execute(
                    """INSERT INTO cases(case_no,part,sport,modality,confidence,stage,weeks,returned,
                                        status,image_path,injury_date,created_at,chief_complaint,
                                        finding_label,model_name,model_ver,detect_ms,image_w,image_h,
                                        patient_name,patient_phone,tech_report,tech_name)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (case_no, part, sport, modality, confidence, stage, 0, "否",
                     ST_DRAFT, save_name, injury_date, now, chief,
                     finding_label,
                     det.model_name if det else "", det.model_version if det else "",
                     det.elapsed_ms if det else 0,
                     det.image_width if det else 0, det.image_height if det else 0,
                     patient_name, patient_phone, "", ""),
                )
                inserted = True
                break
            except sqlite3.IntegrityError:
                seq = int(case_no.rsplit("-", 1)[1]) + 1
                case_no = f"LSY-{today}-{seq:03d}"
        if not inserted:
            raise RuntimeError("病例号生成冲突，请重试")

        if det:
            for fd in det.findings:
                db.execute(
                    """INSERT INTO findings(case_no,class_id,label,raw_label,confidence,bbox,
                                            source,model_name,model_ver,created_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?)""",
                    (case_no, fd.class_id, fd.label, fd.raw_label, fd.confidence,
                     _json.dumps(fd.bbox) if fd.bbox else "",
                     fd.source, det.model_name, det.model_version, now),
                )
        db.execute(
            "INSERT INTO reviews(case_no,action,reviewer,note,created_at) VALUES(?,?,?,?,?)",
            (case_no, "create", _uf(g.user, "name"),
             "医护端主动建档" + ("，随附影像并完成模型初判" if det else ""), now),
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        if save_name:
            try:
                (UPLOAD_DIR / save_name).unlink(missing_ok=True)
            except Exception:
                pass
        return jsonify({"ok": False, "error": f"建档失败：{exc}"}), 500

    row = db.execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone()
    return jsonify({
        "ok": True,
        "case_no": case_no,
        "status": ST_DRAFT,
        "finding_label": finding_label,
        "confidence": confidence,
        "ai_used": bool(det),
        "has_image": bool(save_name),
        "image_url": f"/uploads/{save_name}" if save_name else "",
        "warning": warn,
        "case": dict(row) if row else {},
    })


@app.get("/api/cases/<case_no>")
@login_required
def api_get_case(case_no):
    row = get_db().execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "病例不存在"}), 404
    reviews = get_db().execute(
        "SELECT * FROM reviews WHERE case_no=? ORDER BY created_at DESC", (case_no,)
    ).fetchall()
    return jsonify({"ok": True, "case": dict(row), "reviews": [dict(r) for r in reviews]})


def _uf(user, key, default=""):
    """读取当前用户字段（g.user 是 sqlite3.Row，不能用 .get）。"""
    try:
        v = user[key]
    except Exception:
        return default
    return default if v is None else v


def _is_admin(user) -> bool:
    return _uf(user, "role") == "机构管理员"


def _can_view_case(user, case: dict) -> bool:
    role = _uf(user, "role")
    if role in ("执业医师", "康复治疗师", "影像技师", "机构管理员"):
        return True
    if role == "患者":
        me = _uf(user, "phone") or _uf(user, "username")
        return (case.get("patient_phone") or "") == me
    return False


@app.get("/api/cases/<case_no>/full")
@login_required
def api_get_case_full(case_no):
    """聚合接口：病例 + 检测框 + 技师报告 + 医师结论 + 康复建议 + 随访记录。"""
    import json as _json

    db = get_db()
    row = db.execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "病例不存在"}), 404
    case = dict(row)
    if not _can_view_case(g.user, case):
        return jsonify({"ok": False, "error": "无权查看该病例"}), 403

    reviews = db.execute(
        "SELECT * FROM reviews WHERE case_no=? ORDER BY created_at DESC", (case_no,)
    ).fetchall()
    findings = db.execute(
        "SELECT * FROM findings WHERE case_no=? ORDER BY id", (case_no,)
    ).fetchall()
    followups = db.execute(
        "SELECT * FROM followups WHERE case_no=? ORDER BY record_date, id", (case_no,)
    ).fetchall()
    suggestions = db.execute(
        "SELECT * FROM ai_suggestions WHERE case_no=? ORDER BY id", (case_no,)
    ).fetchall()

    flist = []
    for f in findings:
        item = dict(f)
        try:
            item["bbox"] = _json.loads(item["bbox"]) if item.get("bbox") else None
        except Exception:
            item["bbox"] = None
        flist.append(item)

    report = None
    if case.get("status") == ST_DONE:
        label = case.get("finding_label", "未检出")
        conf = case.get("confidence") or 0
        report = {
            "title": f"{case['part']} 审核报告",
            "summary": case.get("doctor_report")
                       or f"{case['part']}（{case['modality']}）模型检测：{label}，置信度 {round(conf * 100)}%。",
            "conclusion": case.get("doctor_advice") or "",
            "model": case.get("model_name") or "",
            "doctor": case.get("doctor_name") or "",
            "reviewed_at": case.get("reviewed_at") or "",
            "status": ST_DONE,
        }

    return jsonify({
        "ok": True,
        "case": case,
        "findings": flist,
        "reviews": [dict(r) for r in reviews],
        "followups": [dict(r) for r in followups],
        "suggestions": [dict(r) for r in suggestions],
        "report": report,
    })


@app.post("/api/cases/<case_no>/review")
@login_required
def api_review(case_no):
    """执业医师审核：确认归档 / 驳回 / 人工标注。"""
    body = request.get_json(silent=True) or {}
    action = body.get("action")
    note = (body.get("note") or "").strip()
    if action not in ("confirm", "annotate", "edit", "reject", "reopen"):
        return jsonify({"ok": False, "error": "action 必须是 confirm/annotate/reject/reopen"}), 400
    if action == "edit":
        action = "annotate"

    user_role = _uf(g.user, "role")
    if action == "reopen" and not _is_admin(g.user):
        return jsonify({"ok": False, "error": "仅机构管理员可撤回已审核病例"}), 403
    if action != "reopen" and user_role not in ("执业医师", "机构管理员"):
        return jsonify({"ok": False, "error": f"角色 {user_role} 无审核权限"}), 403

    db = get_db()
    row = db.execute("SELECT id, status FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "病例不存在"}), 404
    current_status = row[1]

    if action in ("confirm", "reject") and current_status != ST_PENDING:
        return jsonify({
            "ok": False,
            "error": f"病例当前状态为「{current_status}」，只有「{ST_PENDING}」的病例可以审核",
        }), 409
    if action == "annotate" and current_status in (ST_DONE,):
        return jsonify({"ok": False, "error": "已审核病例如需修改标注，请先由机构管理员撤回"}), 409

    now = datetime.datetime.now().isoformat(timespec="seconds")

    # 人工标注：医生在影像上拖出的框，作为 findings 落库（source='doctor'）
    added = 0
    if action == "annotate":
        for item in (body.get("annotations") or [])[:20]:
            bb = item.get("bbox") if isinstance(item, dict) else None
            if not (isinstance(bb, (list, tuple)) and len(bb) == 4):
                continue
            try:
                x1, y1, x2, y2 = [min(max(float(v), 0.0), 1.0) for v in bb]
            except (TypeError, ValueError):
                continue
            if x2 - x1 < 0.005 or y2 - y1 < 0.005:
                continue
            db.execute(
                """INSERT INTO findings(case_no,class_id,label,raw_label,confidence,bbox,source,
                                        model_name,model_ver,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (case_no, 0, "人工标注", "manual", 1.0,
                 json.dumps([round(x1, 5), round(y1, 5), round(x2, 5), round(y2, 5)]),
                 "doctor", "", "", now),
            )
            added += 1

    if action == "confirm":
        condition = (body.get("condition") or "").strip()
        advice = (body.get("advice") or "").strip()
        if not condition or not advice:
            return jsonify({"ok": False, "error": "审核通过前请先填写「病情情况」和「治疗建议」"}), 400
        db.execute(
            """UPDATE cases SET status=?, doctor_report=?, doctor_advice=?, doctor_name=?,
                                reviewed_at=?, reject_reason=''
               WHERE case_no=?""",
            (ST_DONE, condition, advice, _uf(g.user, "name"), now, case_no),
        )
        db.execute(
            "INSERT INTO ai_suggestions(case_no,kind,content,author,source,created_at) VALUES(?,?,?,?,?,?)",
            (case_no, "doctor", condition + "\n\n【治疗建议】\n" + advice,
             _uf(g.user, "name"), "human", now),
        )
    elif action == "reject":
        reason = note or (body.get("reason") or "").strip()
        if not reason:
            return jsonify({"ok": False, "error": "请填写驳回原因，方便影像技师修改"}), 400
        db.execute("UPDATE cases SET status=?, reject_reason=? WHERE case_no=?", (ST_REJECT, reason, case_no))
    elif action == "reopen":
        db.execute("UPDATE cases SET status=? WHERE case_no=?", (ST_PENDING, case_no))

    db.execute(
        "INSERT INTO reviews(case_no,action,reviewer,note,created_at) VALUES(?,?,?,?,?)",
        (case_no, action, _uf(g.user, "name"), note, now),
    )
    db.commit()

    new_status = current_status
    if action == "confirm":
        new_status = ST_DONE
    elif action == "reject":
        new_status = ST_REJECT
    elif action == "reopen":
        new_status = ST_PENDING
    return jsonify({"ok": True, "status": new_status, "annotations_saved": added})


@app.post("/api/cases/<case_no>/tech-report")
@login_required
def api_tech_report(case_no):
    """影像技师写 / 改报告；submit=true 时进入执业医师待审核队列。"""
    if _uf(g.user, "role") not in ("影像技师", "机构管理员"):
        return jsonify({"ok": False, "error": "只有影像技师（或机构管理员）可以撰写检查报告"}), 403

    body = request.get_json(silent=True) or {}
    content = (body.get("content") or "").strip()
    submit = bool(body.get("submit"))

    db = get_db()
    row = db.execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "病例不存在"}), 404
    case = dict(row)
    if case["status"] not in (ST_DRAFT, ST_REJECT):
        return jsonify({"ok": False, "error": f"当前状态「{case['status']}」不可再修改检查报告"}), 409
    if submit and not content:
        return jsonify({"ok": False, "error": "提交审核前请先填写检查报告"}), 400

    now = datetime.datetime.now().isoformat(timespec="seconds")
    status = ST_PENDING if submit else case["status"]
    db.execute(
        """UPDATE cases SET tech_report=?, tech_name=?, status=?,
                            tech_submitted_at=?, reject_reason=?
           WHERE case_no=?""",
        (content, _uf(g.user, "name"), status,
         now if submit else (case.get("tech_submitted_at") or ""),
         "" if submit else (case.get("reject_reason") or ""), case_no),
    )
    if submit:
        db.execute(
            "INSERT INTO reviews(case_no,action,reviewer,note,created_at) VALUES(?,?,?,?,?)",
            (case_no, "submit", _uf(g.user, "name"), "影像技师提交审核", now),
        )
    db.commit()
    return jsonify({"ok": True, "status": status, "submitted": submit})


@app.post("/api/cases/<case_no>/ai-review")
@login_required
def api_ai_review(case_no):
    """执业医师用：让大模型基于「影像技师报告 + 模型检测」生成病情情况与治疗建议（不落库）。"""
    if _uf(g.user, "role") not in ("执业医师", "机构管理员", "影像技师"):
        return jsonify({"ok": False, "error": "只有医护角色可以调用该分析"}), 403

    db = get_db()
    row = db.execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "病例不存在"}), 404
    case = dict(row)
    findings = db.execute(
        "SELECT label, confidence, bbox FROM findings WHERE case_no=? ORDER BY confidence DESC",
        (case_no,),
    ).fetchall()

    prompt = (
        "你是「灵视医影」的影像分析助手。下面是影像技师提交的检查信息，请输出一段 JSON（不要其它文字）：\n"
        '{"condition": "病情情况（1-3 句，含部位、模型提示、置信度，不编造分型）", '
        '"advice": "治疗建议（3-4 条，含制动/复查/转诊方向，不写具体药品剂量）"}\n\n'
        f"病例：{case['part']}，影像类型 {case['modality']}，运动项目 {case.get('sport') or '未填'}，"
        f"受伤日期 {case.get('injury_date') or '未填'}。\n"
        f"模型检测：{case.get('finding_label') or '未检出'}，置信度 {round((case.get('confidence') or 0) * 100)}%，"
        f"检出框 {len(findings)} 个。\n"
        f"影像技师报告：\n{case.get('tech_report') or '（未填写）'}\n"
    )
    text = _call_ai(prompt) or ""
    parsed = _parse_json_block(text)
    if not parsed:
        parsed = _local_doctor_review(case, findings)
    return jsonify({"ok": True, "suggestion": parsed, "raw": text[:500], "ai_used": bool(text)})


@app.post("/api/cases/<case_no>/rehab-advice")
@login_required
def api_rehab_advice(case_no):
    """康复治疗师：保存深化后的康复建议（写入档案）。"""
    if _uf(g.user, "role") not in ("康复治疗师", "机构管理员"):
        return jsonify({"ok": False, "error": "只有康复治疗师可以提交康复建议"}), 403

    body = request.get_json(silent=True) or {}
    content = (body.get("content") or "").strip()
    if not content:
        return jsonify({"ok": False, "error": "康复建议不能为空"}), 400

    db = get_db()
    case = db.execute("SELECT status FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not case:
        return jsonify({"ok": False, "error": "病例不存在"}), 404
    if case["status"] != ST_DONE:
        return jsonify({"ok": False, "error": "该病例尚未通过医师审核，暂不能写入康复建议"}), 409

    now = datetime.datetime.now().isoformat(timespec="seconds")
    db.execute(
        "UPDATE cases SET rehab_advice=?, rehab_name=?, rehab_updated_at=? WHERE case_no=?",
        (content, _uf(g.user, "name"), now, case_no),
    )
    db.execute(
        "INSERT INTO ai_suggestions(case_no,kind,content,author,source,created_at) VALUES(?,?,?,?,?,?)",
        (case_no, "rehab", content, _uf(g.user, "name"), "human", now),
    )
    db.commit()
    return jsonify({"ok": True, "updated_at": now})


@app.post("/api/cases/<case_no>/ai-rehab")
@login_required
def api_ai_rehab(case_no):
    """康复治疗师用：根据医师治疗建议 + 随访记录生成康复方案（不落库）。"""
    if _uf(g.user, "role") not in ("康复治疗师", "机构管理员"):
        return jsonify({"ok": False, "error": "只有康复治疗师可以调用该分析"}), 403

    db = get_db()
    row = db.execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "病例不存在"}), 404
    case = dict(row)
    followups = db.execute(
        "SELECT record_date, pain_score, rom, swelling, training, note FROM followups "
        "WHERE case_no=? ORDER BY record_date DESC LIMIT 10",
        (case_no,),
    ).fetchall()
    fu_text = "\n".join(
        f"- {f['record_date']}：疼痛 {f['pain_score']}/10，活动度 {f['rom']}%，肿胀 {f['swelling'] or '未记'}，"
        f"训练 {f['training'] or '未记'}，备注 {f['note'] or '无'}"
        for f in followups
    ) or "（暂无随访记录）"

    prompt = (
        "你是「灵视医影」的康复治疗师助手。请基于医师结论与随访记录，输出一段 JSON（不要其它文字）：\n"
        '{"advice": "分阶段康复建议（按周写，3-5 条，含可做/禁做动作与复评节点）", '
        '"progress": "恢复情况判断（1-2 句，基于随访数据）"}\n\n'
        f"病例：{case['part']}，运动项目 {case.get('sport') or '未填'}，当前阶段 {case.get('stage') or '未填'}。\n"
        f"医师病情情况：{case.get('doctor_report') or '（无）'}\n"
        f"医师治疗建议：{case.get('doctor_advice') or '（无）'}\n"
        f"已有康复建议：{case.get('rehab_advice') or '（无）'}\n"
        f"随访记录：\n{fu_text}\n"
    )
    text = _call_ai(prompt) or ""
    parsed = _parse_json_block(text)
    if not parsed:
        parsed = _local_rehab_advice(case, followups)
    return jsonify({"ok": True, "suggestion": parsed, "raw": text[:500], "ai_used": bool(text)})


@app.get("/api/cases/<case_no>/followups")
@login_required
def api_list_followups(case_no):
    db = get_db()
    row = db.execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "病例不存在"}), 404
    if not _can_view_case(g.user, dict(row)):
        return jsonify({"ok": False, "error": "无权查看该病例"}), 403
    rows = db.execute(
        "SELECT * FROM followups WHERE case_no=? ORDER BY record_date, id", (case_no,)
    ).fetchall()
    return jsonify({"ok": True, "followups": [dict(r) for r in rows]})


@app.post("/api/cases/<case_no>/followups")
@login_required
def api_add_followup(case_no):
    """康复治疗师按周期录入随访：疼痛、活动度、肿胀、训练执行情况。"""
    if _uf(g.user, "role") not in ("康复治疗师", "机构管理员"):
        return jsonify({"ok": False, "error": "只有康复治疗师可以录入随访记录"}), 403

    body = request.get_json(silent=True) or {}
    db = get_db()
    case = db.execute("SELECT status FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not case:
        return jsonify({"ok": False, "error": "病例不存在"}), 404
    if case["status"] != ST_DONE:
        return jsonify({"ok": False, "error": "该病例尚未通过医师审核"}), 409

    record_date = (body.get("record_date") or datetime.date.today().isoformat()).strip()
    try:
        pain = int(body.get("pain_score") or 0)
        rom = int(body.get("rom") or 0)
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "疼痛评分与活动度必须是数字"}), 400
    pain = min(max(pain, 0), 10)
    rom = min(max(rom, 0), 100)

    now = datetime.datetime.now().isoformat(timespec="seconds")
    db.execute(
        """INSERT INTO followups(case_no,record_date,pain_score,rom,swelling,training,note,author,created_at)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (case_no, record_date, pain, rom, (body.get("swelling") or "").strip(),
         (body.get("training") or "").strip(), (body.get("note") or "").strip(),
         _uf(g.user, "name"), now),
    )
    db.commit()
    return jsonify({"ok": True})


def _parse_json_block(text: str):
    """从大模型回答里抠出第一个 JSON 对象，只保留我们认识的字段。"""
    if not text:
        return None
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    out = {}
    for k in ("condition", "advice", "progress"):
        v = data.get(k)
        if isinstance(v, str) and v.strip():
            out[k] = v.strip()
    return out or None


def _local_doctor_review(case: dict, findings) -> dict:
    """大模型不可用时的本地兜底：仍然是"基于检测结果"的文本，不是伪造结论。"""
    label = case.get("finding_label") or "未检出"
    pct = round((case.get("confidence") or 0) * 100)
    boxes = len(findings or [])
    condition = (
        f"{case.get('part')}（{case.get('modality')}）模型提示：{label}，置信度 {pct}%"
        + (f"，检出 {boxes} 处可疑区域" if boxes else "，未给出可疑区域框")
        + "。技师报告："
        + ((case.get("tech_report") or "未填写").splitlines()[0][:60])
    )
    if label == "未见明确骨折":
        advice = "1. 模型未提示骨折，结合查体确认压痛与肿胀情况；\n2. 症状持续者 2 周后复查或进一步影像检查；\n3. 逐步恢复日常活动，避免早期对抗性训练。"
    else:
        advice = "1. 患处制动保护，避免负重与旋转发力；\n2. 2 周后复查 X 线评估位置与愈合；\n3. 疼痛肿胀明显或移位可疑时转诊骨科；\n4. 复查后由康复治疗师制定分阶段训练计划。"
    return {"condition": condition, "advice": advice}


def _local_rehab_advice(case: dict, followups) -> dict:
    last = followups[0] if followups else None
    if last:
        progress = (
            f"最近一次随访（{last['record_date']}）：疼痛 {last['pain_score']}/10，"
            f"活动度 {last['rom']}%，肿胀 {last['swelling'] or '未记录'}。"
        )
    else:
        progress = "暂无随访记录，建议先完成首次评估再制定进阶训练。"
    advice = (
        "第 1-2 周：无痛范围内手指屈伸、肩肘活动，患处制动；\n"
        "第 3-4 周：复查后加入腕/踝主动活动度与握力训练，冰敷控制肿胀；\n"
        "第 5-6 周：弹力带渐进力量，加入平衡与本体感觉训练；\n"
        "复评节点：每 2 周一次，疼痛 >3/10 或肿胀加重时退回上一阶段。"
    )
    return {"advice": advice, "progress": progress}


# 病例号规范：LSY-YYYYMMDD-001
CASE_NO_RE = re.compile(r"^LSY-\d{8}-\d{3}$")


def _next_case_no(db, today: str) -> str:
    """当天最大序号 +1（按真实病例号解析，避免被脏数据带偏）。"""
    rows = db.execute(
        "SELECT case_no FROM cases WHERE case_no LIKE ?", (f"LSY-{today}-%",)
    ).fetchall()
    seqs = []
    for r in rows:
        m = re.fullmatch(r"LSY-\d{8}-(\d{3})", r[0])
        if m:
            seqs.append(int(m.group(1)))
    return f"LSY-{today}-{(max(seqs) if seqs else 0) + 1:03d}"


def _local_report(det, part: str, modality: str, sport: str) -> str:
    """模型结果的本地报告模板：即使大模型不可用也不会是空内容。"""
    pct = round(det.confidence * 100)
    lines = [
        "【影像所见】",
        f"· 检查部位：{part}（{modality}）" + (f"，受伤运动：{sport}" if sport else ""),
        f"· 模型检测：{det.finding_label}，最高置信度 {pct}%（{det.model_name}）",
    ]
    if det.findings:
        for i, fd in enumerate(det.findings, 1):
            if fd.bbox:
                x1, y1, x2, y2 = fd.bbox
                lines.append(
                    f"· 可疑区域 {i}：{fd.label}，置信度 {round(fd.confidence * 100)}%，"
                    f"位置（归一化）x {x1:.2f}–{x2:.2f} / y {y1:.2f}–{y2:.2f}"
                )
            else:
                lines.append(f"· 整体判读：{fd.label}，置信度 {round(fd.confidence * 100)}%")
    else:
        lines.append("· 未检出高于阈值的可疑区域，建议人工阅片确认")

    lines.append("")
    lines.append("【参考意见】")
    if det.has_fracture:
        lines += [
            "· 建议结合压痛点、肿胀、关节活动度等体征综合判断；",
            "· 必要时加拍侧位 / 斜位或行 CT 进一步评估；",
            "· 急性期以制动、消肿、保护为主，按医嘱复查。",
        ]
    else:
        lines += [
            "· 模型未提示骨折，但仍需结合临床查体；",
            "· 若局部压痛明显或症状持续，建议复查或进一步影像检查。",
        ]
    lines += [
        "",
        "【说明】本段由检测结果自动生成，仅作辅助参考，最终诊断以执业医师阅片为准。",
    ]
    return "\n".join(lines)


def _ai_report(det, part: str, modality: str, sport: str) -> str:
    """优先用大模型润色；不可用时退回本地模板。"""
    import json as _json

    if not AI_API_KEY:
        return _local_report(det, part, modality, sport)
    payload = {
        "case": {"part": part, "modality": modality, "sport": sport},
        "model": det.model_name,
        "has_fracture": det.has_fracture,
        "findings": [f.as_dict() for f in det.findings],
        "primary": det.primary.as_dict() if det.primary else None,
    }
    prompt = (
        "你是「灵视医影」平台的影像报告生成助手。下面是一个骨折检测模型对一张运动损伤影像的输出。"
        "请基于这些结构化结果写一份简洁、专业的中文影像分析报告，要求：\n"
        "1. 只复述给出的部位、检测标签、置信度，不要编造未提供的骨结构、软组织或分型信息；\n"
        "2. 说明这些发现的临床意义与下一步建议（制动 / 复查 / 转诊方向）；\n"
        "3. 必须包含一句：AI 检测结果仅作辅助参考，最终诊断以执业医师阅片为准；\n"
        "4. 分 3-4 点，不要写具体药品剂量。\n\n"
        f"检测结果：\n{_json.dumps(payload, ensure_ascii=False)}"
    )
    text = _call_ai(prompt)
    return text or _local_report(det, part, modality, sport)


@app.post("/api/analyze")
@login_required
def api_analyze():
    """影像分析：真实 ONNX 模型推理。

    流程：上传文件 → 模型检测（bbox + 置信度）→ 落库（cases + findings）→ 生成报告。
    注意：前端传来的 detection 字段一律忽略，检测结论只能来自模型。
    """
    import json as _json

    if _uf(g.user, "role") not in ("影像技师", "机构管理员"):
        return jsonify({"ok": False, "error": "只有影像技师（或机构管理员）可以上传并分析影像"}), 403

    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"ok": False, "error": "请先选择影像文件"}), 400

    ext = os.path.splitext(f.filename)[1].lower()
    if ext == ".dcm":
        return jsonify({
            "ok": False,
            "error": "暂不支持直接解析 DICOM（.dcm），请先导出为 JPG / PNG 再上传",
        }), 400
    if ext not in (".png", ".jpg", ".jpeg"):
        return jsonify({"ok": False, "error": f"不支持的文件类型 {ext}，只支持 JPG / PNG"}), 400

    raw = f.read()
    if not raw:
        return jsonify({"ok": False, "error": "文件内容为空"}), 400

    # 1) 模型推理（失败不写库、不落盘，避免产生半条病例）
    try:
        det = get_detector().detect(raw)
    except DetectorError as exc:
        return jsonify({"ok": False, "error": str(exc), "code": "MODEL_UNAVAILABLE"}), 503

    # 2) 表单字段（部位由使用者标注，模型不提供部位）
    db = get_db()
    form_case_no = request.form.get("case_no", "").strip()
    part = request.form.get("part", "").strip() or "未标注部位"
    modality = request.form.get("modality", "").strip() or "X光"
    sport = request.form.get("sport", "").strip()
    injury_date = request.form.get("injury_date", "").strip()
    patient_name = request.form.get("patient_name", "").strip()
    patient_phone = request.form.get("patient_phone", "").strip()
    now = datetime.datetime.now().isoformat(timespec="seconds")
    today = datetime.datetime.now().strftime("%Y%m%d")

    if form_case_no:
        if not CASE_NO_RE.fullmatch(form_case_no):
            return jsonify({
                "ok": False,
                "error": "病例号格式应为 LSY-YYYYMMDD-001，或留空自动生成",
            }), 400
        if db.execute("SELECT 1 FROM cases WHERE case_no=?", (form_case_no,)).fetchone():
            return jsonify({"ok": False, "error": f"病例号 {form_case_no} 已存在"}), 409
        case_no = form_case_no
    else:
        case_no = _next_case_no(db, today)

    # 3) 保存影像（校验通过后再落盘）
    save_name = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(4) + ext
    save_path = UPLOAD_DIR / save_name
    save_path.write_bytes(raw)

    # 4) 落库：病例 + 检测框；任何失败都回滚并删掉刚写的影像，不留半条数据
    stage = "保护期" if det.has_fracture else "不适用"
    try:
        inserted = False
        for _ in range(5):
            try:
                db.execute(
                    """INSERT INTO cases(case_no,part,sport,modality,confidence,stage,weeks,returned,
                                        status,image_path,injury_date,created_at,
                                        finding_label,model_name,model_ver,detect_ms,image_w,image_h,
                                        patient_name,patient_phone,tech_report,tech_name)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (case_no, part, sport or "未填写", modality, det.confidence, stage, 0, "否",
                     ST_DRAFT, save_name, injury_date, now,
                     det.finding_label, det.model_name, det.model_version, det.elapsed_ms,
                     det.image_width, det.image_height,
                     patient_name, patient_phone, "", _uf(g.user, "name")),
                )
                inserted = True
                break
            except sqlite3.IntegrityError:
                if form_case_no:
                    raise
                seq = int(case_no.rsplit("-", 1)[1]) + 1
                case_no = f"LSY-{today}-{seq:03d}"
        if not inserted:
            raise RuntimeError("病例号生成冲突，请重试")

        for fd in det.findings:
            db.execute(
                """INSERT INTO findings(case_no,class_id,label,raw_label,confidence,bbox,
                                        source,model_name,model_ver,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (case_no, fd.class_id, fd.label, fd.raw_label, fd.confidence,
                 _json.dumps(fd.bbox) if fd.bbox else "",
                 fd.source, det.model_name, det.model_version, now),
            )
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback()
        save_path.unlink(missing_ok=True)
        return jsonify({"ok": False, "error": "病例号已存在，请留空自动生成"}), 409
    except Exception as exc:
        db.rollback()
        save_path.unlink(missing_ok=True)
        return jsonify({"ok": False, "error": f"病例写入失败：{exc}"}), 500

    # 5) 报告（生成后回写病例，刷新页面不会丢）
    report = _ai_report(det, part, modality, sport)
    try:
        db.execute("UPDATE cases SET ai_report=? WHERE case_no=?", (report, case_no))
        db.commit()
    except Exception:
        db.rollback()

    result = {
        "case_no": case_no,
        # 兼容旧字段
        "finding": det.finding_label,
        "confidence": det.confidence,
        "location": f"{part} · {det.finding_label}",
        "suggestion": "建议由执业医师结合体征复核后确认。",
        "ai_report": report,
        "uploaded_file": f.filename,
        "image_url": f"/uploads/{save_name}",
        "part": part,
        "stage": stage,
        "status": ST_DRAFT,
        "patient_name": patient_name,
        "patient_phone": patient_phone,
        "tech_name": _uf(g.user, "name"),
        # 新增字段
        "has_fracture": det.has_fracture,
        "finding_label": det.finding_label,
        "findings": [fd.as_dict() for fd in det.findings],
        "image": {"width": det.image_width, "height": det.image_height},
        "model": {
            "name": det.model_name,
            "version": det.model_version,
            "elapsed_ms": det.elapsed_ms,
            "conf_threshold": det.conf_threshold,
        },
        "warning": det.warning,
    }
    return jsonify({"ok": True, "result": result})


@app.get("/api/model/status")
def api_model_status():
    """模型健康检查：前端启动时可显示"模型已就绪 / 未就绪"。"""
    st = detector_status()
    st.pop("model_path", None)  # 不暴露服务器绝对路径
    return jsonify({"ok": st.get("available", False), "model": st})


@app.post("/api/ai/detect")
def api_ai_detect():
    """移动端影像查看器「AI 识别」：只推理不落库。

    与 /api/analyze 复用同一套 ONNX 模型，但只返回检测框 + 置信度，
    不建病例、不写数据库（移动端演示场景：对已加载的预置 X 光片即时识别）。
    输入：{image_b64, conf?}；输出：{detections:[{label,raw_label,conf,bbox}]}。
    """
    import base64

    body = request.get_json(silent=True) or {}
    b64 = (body.get("image_b64") or "").strip()
    conf_th = float(body.get("conf") or CONF_THRESHOLD)
    if not b64:
        return jsonify({"ok": False, "error": "缺少影像数据 image_b64"}), 400

    try:
        raw = base64.b64decode(b64)
    except Exception:
        return jsonify({"ok": False, "error": "影像数据不是合法的 base64"}), 400
    if not raw:
        return jsonify({"ok": False, "error": "影像数据为空"}), 400

    try:
        det = get_detector().detect(raw)
    except DetectorError as exc:
        return jsonify({"ok": False, "error": str(exc), "mode": "no-model"}), 503

    # 移动端只要主结论 + 归一化框；未检出骨折也返回（label 为未见明确骨折）
    detections = []
    for f in det.findings:
        detections.append({
            "label": f.raw_label,                 # fracture / normal，前端据此画框
            "label_zh": f.label,                  # 疑似骨折 / 未见明确骨折
            "conf": round(float(f.confidence), 4),
            "bbox": f.bbox,                       # 归一化 [x1,y1,x2,y2]，normal 为 null
        })
    return jsonify({
        "ok": True,
        "mode": "model",
        "detections": detections,
        "primary": detections[0] if detections else None,
        "image": {"width": det.image_width, "height": det.image_height},
        "model": {"name": det.model_name, "version": det.model_version, "elapsed_ms": det.elapsed_ms},
    })


@app.get("/api/summary")
@login_required
def api_summary():
    """总览页 KPI：全部来自数据库真实计数，不再用页面里写死的数字。"""
    db = get_db()
    today = datetime.date.today().isoformat()
    one = lambda sql, args=(): db.execute(sql, args).fetchone()[0]

    analyzed_today = one("SELECT COUNT(*) FROM cases WHERE substr(created_at,1,10)=?", (today,))
    pending = one("SELECT COUNT(*) FROM cases WHERE status=?", (ST_PENDING,))
    draft = one("SELECT COUNT(*) FROM cases WHERE status IN (?,?)", (ST_DRAFT, ST_REJECT))
    total = one("SELECT COUNT(*) FROM cases")
    confirmed = one("SELECT COUNT(*) FROM cases WHERE status=?", (ST_DONE,))
    fractures = one("SELECT COUNT(*) FROM cases WHERE IFNULL(finding_label,'')='疑似骨折'")
    in_rehab = one("SELECT COUNT(*) FROM cases WHERE status=? AND IFNULL(rehab_advice,'')<>''",
                   (ST_DONE,))
    followups_due = one(
        """SELECT COUNT(*) FROM cases
           WHERE status=? AND IFNULL(injury_date,'')<>'' AND IFNULL(stage,'') NOT IN ('','不适用')
             AND date(injury_date, '+14 days') <= date('now')""",
        (ST_DONE,),
    )
    followups_soon = one(
        """SELECT COUNT(*) FROM cases
           WHERE status=? AND IFNULL(injury_date,'')<>'' AND IFNULL(stage,'') NOT IN ('','不适用')
             AND date(injury_date, '+14 days') > date('now')
             AND date(injury_date, '+14 days') <= date('now', '+7 days')""",
        (ST_DONE,),
    )
    parts = db.execute(
        "SELECT part, COUNT(*) FROM cases WHERE substr(created_at,1,10)=? GROUP BY part ORDER BY 2 DESC",
        (today,),
    ).fetchall()
    return jsonify({
        "ok": True,
        "summary": {
            "analyzed_today": analyzed_today,
            "pending": pending,
            "draft": draft,
            "total": total,
            "confirmed": confirmed,
            "fractures": fractures,
            "in_rehab": in_rehab,
            "followups_due": followups_due,
            "followups_soon": followups_soon,
            "today_parts": [{"part": p, "count": n} for p, n in parts],
        },
    })


# ----------------------------------------------------------------------
# 统计看板
# ----------------------------------------------------------------------
@app.get("/api/stats/<topic>")
@login_required
def api_stats(topic):
    db = get_db()
    # 按部位分组统计
    if topic == "body":
        rows = db.execute(
            "SELECT part, COUNT(*) as cnt FROM cases GROUP BY part ORDER BY cnt DESC"
        ).fetchall()
        data = [{"name": r[0], "value": r[1]} for r in rows]
        return jsonify({"ok": True, "topic": topic, "data": data})

    # 最近5天每天的病例数
    if topic == "weekly":
        rows = db.execute(
            """SELECT DATE(created_at) as d, COUNT(*) as cnt
               FROM cases
               WHERE created_at >= DATE('now', '-4 days')
               GROUP BY DATE(created_at)
               ORDER BY d"""
        ).fetchall()
        # 补全缺失的日期
        from datetime import timedelta
        xAxis = []
        series = []
        today = datetime.date.today()
        data_map = {r[0]: r[1] for r in rows}
        weekday_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
        for i in range(4, -1, -1):
            d = today - timedelta(days=i)
            date_str = d.isoformat()
            xAxis.append(weekday_names[d.weekday()] + ("（今天）" if i == 0 else ""))
            series.append(data_map.get(date_str, 0))
        return jsonify({"ok": True, "topic": topic, "data": {"xAxis": xAxis, "series": series}})

    # 最近6个月每月的病例数
    if topic == "monthly":
        rows = db.execute(
            """SELECT strftime('%Y-%m', created_at) as m, COUNT(*) as cnt
               FROM cases
               WHERE created_at >= DATE('now', '-6 months')
               GROUP BY m ORDER BY m"""
        ).fetchall()
        xAxis = [r[0] for r in rows]
        series = [r[1] for r in rows]
        return jsonify({"ok": True, "topic": topic, "data": {"xAxis": xAxis, "series": series}})

    # 随访记录趋势（按记录日期）
    if topic == "followups":
        rows = db.execute(
            "SELECT record_date, COUNT(*) FROM followups GROUP BY record_date ORDER BY record_date DESC LIMIT 14"
        ).fetchall()
        rows = list(reversed(rows))
        return jsonify({"ok": True, "topic": topic,
                        "data": {"xAxis": [r[0][5:] for r in rows], "series": [r[1] for r in rows]}})

    # 康复阶段分布（真实计数）
    if topic == "stage":
        rows = db.execute(
            "SELECT IFNULL(NULLIF(stage,''),'未填写') AS s, COUNT(*) FROM cases GROUP BY s ORDER BY 2 DESC"
        ).fetchall()
        return jsonify({"ok": True, "topic": topic,
                        "data": {"xAxis": [r[0] for r in rows], "series": [r[1] for r in rows]}})

    # 损伤部位 × 运动项目 交叉计数（热力图）
    if topic == "cross":
        rows = db.execute(
            "SELECT part, IFNULL(NULLIF(sport,''),'未填写') AS sp, COUNT(*) FROM cases GROUP BY part, sp"
        ).fetchall()
        parts = sorted({r[0] for r in rows})
        sports = sorted({r[1] for r in rows})
        data = [[sports.index(r[1]), parts.index(r[0]), r[2]] for r in rows]
        return jsonify({"ok": True, "topic": topic,
                        "data": {"parts": parts, "sports": sports, "cells": data}})

    # 未定义的统计项一律报错，不再用静态假数据兜底
    return jsonify({"ok": False, "error": "未知统计项"}), 404


# ----------------------------------------------------------------------
# AI 助手
# ----------------------------------------------------------------------
def _case_context(case, findings=None, followups=None) -> str:
    """把当前病例的真实字段拼成给大模型的上下文，避免模型凭空猜测。"""
    if not case:
        return "当前没有选中病例。"
    lines = ["【当前病例真实数据】"]
    lines.append(f"病例号：{case.get('case_no') or '—'}")
    lines.append(f"患者：{case.get('patient_name') or '未登记'}")
    lines.append(f"部位：{case.get('part') or '—'}；影像类型：{case.get('modality') or '—'}；运动项目：{case.get('sport') or '—'}")
    lines.append(f"受伤日期：{case.get('injury_date') or '—'}；康复阶段：{case.get('stage') or '—'}；病程：{case.get('weeks') or 0} 周")
    lines.append(f"模型结论：{case.get('finding_label') or '—'}（置信度 {round(float(case.get('confidence') or 0), 2)}，模型 {case.get('model_name') or '—'} {case.get('model_ver') or ''}）")
    if findings:
        boxes = [f"{f.get('label')} {round(float(f.get('confidence') or 0) * 100)}%"
                 for f in findings if (f.get("label") or "") != "未见明确骨折"]
        lines.append("检出区域：" + ("；".join(boxes[:5]) if boxes else "无高于阈值的可疑区域"))
    if case.get("tech_report"):
        lines.append(f"技师检查报告：{case['tech_report']}")
    if case.get("doctor_report") or case.get("doctor_advice"):
        lines.append(f"医师病情情况：{case.get('doctor_report') or '—'}")
        lines.append(f"医师治疗建议：{case.get('doctor_advice') or '—'}")
    if case.get("rehab_advice"):
        lines.append(f"康复治疗师方案：{case['rehab_advice']}")
    if followups:
        last = followups[0]
        lines.append(
            "最近随访：{d}·疼痛 {p}/10·活动度 {r}%·肿胀 {s}·训练 {t}".format(
                d=last.get("record_date") or "—", p=last.get("pain_score") or 0,
                r=last.get("rom") or 0, s=last.get("swelling") or "—",
                t=last.get("training") or "—"))
    return "\n".join(lines)


def _local_case_answer(case, q: str) -> str:
    """没有可用大模型时的兜底回答：只用当前病例的真实字段，不编造任何具体数值。"""
    if not case:
        return ("还没有选中病例。请先在左侧「病例与康复档案」或「待审核队列」里打开一个病例，"
                "我就能结合该病例的真实检查结果、医师结论与随访记录回答。")

    part = case.get("part") or "该部位"
    label = case.get("finding_label") or "模型未给出明确结论"
    conf = round(float(case.get("confidence") or 0) * 100)
    stage = case.get("stage") or "未填写"
    advice = (case.get("doctor_advice") or "").strip()
    rehab = (case.get("rehab_advice") or "").strip()

    if re.search(r"康复|训练|动作|方案|锻炼|怎么练", q):
        body = rehab or "康复治疗师尚未写入康复方案。"
        return ("**当前病例的康复信息**（病例号 {}）\n".format(case.get("case_no")) +
                "- 部位：{}；阶段：{}\n".format(part, stage) +
                "- 已写入的康复方案：{}\n".format(body) +
                "- 医师治疗建议：{}\n".format(advice or "尚未填写") +
                "\n提示：以上均取自本病例档案的真实记录，未做额外推断；具体动作与强度请以康复治疗师确认的版本为准。")

    if re.search(r"多久|恢复|回归|时间|什么时候|打球|上场", q):
        return ("**当前病例的恢复进度**（病例号 {}）\n".format(case.get("case_no")) +
                "- 部位：{}；影像结论：{}（模型置信度 {}%）\n".format(part, label, conf) +
                "- 康复阶段：{}；病程：{} 周\n".format(stage, case.get("weeks") or 0) +
                "- 是否已回归训练：{}\n".format(case.get("returned") or "否") +
                "\n提示：系统只能给出本病例已记录的阶段与病程，不能推算具体复出日期；"
                "能否回归须由执业医师 / 康复治疗师结合复查影像与功能评估判定。")

    if re.search(r"摘要|总结|概况|报告", q):
        return ("**病例摘要**（{}）\n".format(case.get("case_no")) +
                "- 患者：{}；部位：{}；运动项目：{}\n".format(
                    case.get("patient_name") or "未登记", part, case.get("sport") or "—") +
                "- 模型结论：{}（置信度 {}%）\n".format(label, conf) +
                "- 医师诊断：{}\n".format(case.get("doctor_report") or "尚未审核") +
                "- 医师建议：{}\n".format(advice or "尚未填写") +
                "- 康复方案：{}\n".format(rehab or "尚未写入"))

    # 默认：影像解读
    return ("**当前病例的影像判读**（{}）\n".format(case.get("case_no")) +
            "- 检查：{} · {}\n".format(part, case.get("modality") or "—") +
            "- 模型结论：{}（置信度 {}%）\n".format(label, conf) +
            "- 技师报告：{}\n".format(case.get("tech_report") or "尚未提交") +
            "- 医师结论：{}\n".format(case.get("doctor_report") or "尚未审核") +
            "\n提示：以上为模型辅助判读与本病例已记录内容的整理，不能作为确诊依据；"
            "骨折分型与是否移位需执业医师结合原始影像确认。")


def _call_ai(user_msg: str, case_ctx: str = "") -> str:
    """调用大模型 API（百炼 DashScope），失败返回空字符串。"""
    import json as _json
    import urllib.request
    import datetime as _dt
    today = _dt.datetime.now().strftime("%Y年%m月%d日")
    weekday = "一二三四五六日"[_dt.datetime.now().weekday()]
    sys_prompt = (
        f"{AI_SYSTEM_PROMPT}\n当前日期：{today}（星期{weekday}）。用户问日期/时间相关问题时以此为准。\n"
        f"{case_ctx}\n"
        "重要：回答必须基于上面给出的病例真实数据；数据中没有的检查值、日期、剂量一律不要编造，"
        "不确定时直接说明“档案中未记录”。"
    )
    payload = _json.dumps({
        "model": AI_MODEL,
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_msg},
        ],
        "stream": False,
        "temperature": 0.3,
    }).encode("utf-8")
    req = urllib.request.Request(
        AI_API_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {AI_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        try:
            with open(BASE_DIR / "ai_debug.log", "a", encoding="utf-8") as f:
                import traceback
                f.write(f"[AI ERROR] {e}\n{traceback.format_exc()}\n")
        except Exception:
            pass
        print(f"[AI] 调用失败: {e}")
        return ""


@app.post("/api/ai/chat")
@login_required
def api_ai_chat():
    body = request.get_json(silent=True) or {}
    msg = (body.get("message") or "").strip()
    if not msg:
        return jsonify({"ok": False, "error": "消息不能为空"}), 400
    case_no = (body.get("case_no") or "").strip()

    db = get_db()
    case, findings, followups = None, [], []
    if case_no:
        row = db.execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "病例不存在"}), 404
        case = dict(row)
        # 患者只能就已绑定的本人病例提问
        if not _can_view_case(g.user, case):
            return jsonify({"ok": False, "error": "无权查看该病例"}), 403
        findings = [dict(r) for r in db.execute(
            "SELECT * FROM findings WHERE case_no=? ORDER BY id", (case_no,)).fetchall()]
        followups = [dict(r) for r in db.execute(
            "SELECT * FROM followups WHERE case_no=? ORDER BY record_date DESC", (case_no,)).fetchall()]

    ctx = _case_context(case, findings, followups) if case else "当前没有选中病例。"
    source = "local"
    reply = ""
    if AI_API_KEY:
        reply = _call_ai(msg, ctx)
        if reply:
            source = "model"
    if not reply:
        reply = _local_case_answer(case, msg)   # 只用病例真实字段，不编造

    now = datetime.datetime.now().isoformat(timespec="seconds")
    db.execute("INSERT INTO ai_chat_log(username,role,content,created_at) VALUES(?,?,?,?)",
               (g.user["username"], "user", msg, now))
    db.execute("INSERT INTO ai_chat_log(username,role,content,created_at) VALUES(?,?,?,?)",
               (g.user["username"], "bot", reply, now))
    db.commit()
    return jsonify({"ok": True, "reply": reply, "source": source, "case_no": case_no})


# ----------------------------------------------------------------------
# 科研数据导出
# ----------------------------------------------------------------------
@app.get("/api/export")
@login_required
def api_export():
    fmt = request.args.get("format", "json")
    rows = get_db().execute(
        "SELECT case_no,part,sport,modality,confidence,stage,weeks,returned FROM cases ORDER BY id"
    ).fetchall()

    if fmt == "csv":
        head = ["病例号", "损伤部位", "运动项目", "影像类型", "AI置信度", "康复阶段", "康复周期(周)", "是否回归"]
        lines = [",".join(head)]
        for r in rows:
            lines.append(",".join([
                r["case_no"], r["part"], r["sport"], r["modality"],
                f'{r["confidence"]:.2f}', r["stage"], str(r["weeks"]), r["returned"],
            ]))
        body = "\ufeff" + "\r\n".join(lines)
        return Response(body, mimetype="text/csv; charset=utf-8",
                        headers={"Content-Disposition": "attachment; filename=linschi_export.csv"})

    payload = {
        "source": "灵视医影·数据分析看板",
        "exportedAt": datetime.date.today().isoformat(),
        "count": len(rows),
        "records": [dict(r) for r in rows],
    }
    return jsonify({"ok": True, **payload})


# ----------------------------------------------------------------------
# 管理员：注册审核
# ----------------------------------------------------------------------
@app.get("/api/admin/pending")
@admin_required
def api_admin_pending():
    rows = get_db().execute(
        "SELECT id,name,phone,org,role,created_at,status FROM pending_applications ORDER BY created_at DESC"
    ).fetchall()
    return jsonify({"ok": True, "applications": [dict(r) for r in rows]})


@app.post("/api/admin/pending/<int:app_id>/approve")
@admin_required
def api_admin_approve(app_id):
    db = get_db()
    row = db.execute("SELECT * FROM pending_applications WHERE id=?", (app_id,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "申请不存在"}), 404
    if row["status"] != "pending":
        return jsonify({"ok": False, "error": "该申请已处理"}), 400

    now = datetime.datetime.now().isoformat(timespec="seconds")
    # 手机号即登录账号；再次校验手机号未被占用
    if db.execute("SELECT id FROM users WHERE phone=?", (row["phone"],)).fetchone():
        return jsonify({"ok": False, "error": "该手机号已开通账号，请勿重复通过"}), 409

    username = row["phone"]
    db.execute(
        """INSERT INTO users(username,password_hash,name,role,phone,org,status,created_at)
           VALUES(?,?,?,?,?,?,?,?)""",
        (username, row["password_hash"], row["name"], row["role"], row["phone"], row["org"], "active", now),
    )
    db.execute("UPDATE pending_applications SET status='approved',reviewed_at=? WHERE id=?", (now, app_id))
    db.commit()
    return jsonify({"ok": True, "username": username,
                    "message": f"已开通账号：{username}（即手机号，密码为申请人设置的密码）"})


@app.post("/api/admin/pending/<int:app_id>/reject")
@admin_required
def api_admin_reject(app_id):
    db = get_db()
    row = db.execute("SELECT id FROM pending_applications WHERE id=? AND status='pending'", (app_id,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "申请不存在或已处理"}), 404
    now = datetime.datetime.now().isoformat(timespec="seconds")
    db.execute("UPDATE pending_applications SET status='rejected',reviewed_at=? WHERE id=?", (now, app_id))
    db.commit()
    return jsonify({"ok": True})


# ----------------------------------------------------------------------
# 患者身份与病例绑定（避免"注册后看不到自己病例"的断链）
# ----------------------------------------------------------------------
@app.get("/api/admin/users")
@admin_required
def api_admin_users():
    """真实账号清单：用于机构管理员的权限表，替代前端写死的角色表。"""
    rows = get_db().execute(
        """SELECT u.id,u.name,u.role,u.phone,u.org,u.status,u.created_at,
                  (SELECT COUNT(*) FROM cases c WHERE c.patient_phone=u.phone) AS case_count
           FROM users u ORDER BY u.role, u.id"""
    ).fetchall()
    return jsonify({"ok": True, "users": [dict(r) for r in rows]})


@app.get("/api/admin/unbound")
@admin_required
def api_admin_unbound():
    """尚未绑定患者账号的病例（建档时没填手机号），供管理员手工绑定。"""
    db = get_db()
    rows = db.execute(
        """SELECT case_no,patient_name,part,sport,injury_date,status,created_at
           FROM cases WHERE IFNULL(patient_phone,'')='' ORDER BY created_at DESC"""
    ).fetchall()
    patients = db.execute(
        "SELECT phone,name FROM users WHERE role='患者' AND IFNULL(phone,'')<>'' ORDER BY name"
    ).fetchall()
    return jsonify({"ok": True, "cases": [dict(r) for r in rows],
                    "patients": [dict(r) for r in patients]})


# ----------------------------------------------------------------------
# 机构管理员：账号管理（新增 / 编辑 / 停用 / 删除）
# ----------------------------------------------------------------------
PHONE_RE = re.compile(r"1[3-9]\d{9}")


def _active_admins(db, exclude_id=None):
    sql = "SELECT COUNT(*) AS n FROM users WHERE role='机构管理员' AND status='active'"
    args = ()
    if exclude_id is not None:
        sql += " AND id<>?"
        args = (exclude_id,)
    return db.execute(sql, args).fetchone()["n"]


def _user_row(db, uid):
    row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return dict(row) if row else None


def _public_user(u: dict) -> dict:
    return {k: u.get(k) for k in ("id", "name", "role", "phone", "org", "status", "created_at")}


@app.post("/api/admin/users")
@admin_required
def api_admin_user_create():
    """管理员直接开通账号：手机号即登录账号，开通后立即可用（无需再走注册审核）。"""
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    phone = (body.get("phone") or "").strip()
    role = (body.get("role") or "").strip()
    org = (body.get("org") or "").strip()
    password = body.get("password") or ""

    if not name:
        return jsonify({"ok": False, "error": "请填写姓名"}), 400
    if not PHONE_RE.fullmatch(phone):
        return jsonify({"ok": False, "error": "手机号格式不正确（11 位，1 开头）"}), 400
    if role not in ROLE_VIEWS:
        return jsonify({"ok": False, "error": "角色选择不正确"}), 400
    if len(password) < 6:
        return jsonify({"ok": False, "error": "初始密码至少 6 位"}), 400

    db = get_db()
    if db.execute("SELECT id FROM users WHERE phone=? OR username=?", (phone, phone)).fetchone():
        return jsonify({"ok": False, "error": "该手机号已开通账号"}), 409

    now = datetime.datetime.now().isoformat(timespec="seconds")
    try:
        cur = db.execute(
            """INSERT INTO users(username,password_hash,name,role,phone,org,status,created_at)
               VALUES(?,?,?,?,?,?,?,?)""",
            (phone, hash_password(password), name, role, phone, org, "active", now),
        )
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback()
        return jsonify({"ok": False, "error": "该手机号已开通账号"}), 409

    u = _user_row(db, cur.lastrowid)
    return jsonify({"ok": True, "user": _public_user(u),
                    "message": f"已开通账号 {phone}（{name} · {role}），初始密码为所填密码"})


@app.patch("/api/admin/users/<int:uid>")
@admin_required
def api_admin_user_update(uid):
    """编辑账号资料 / 角色 / 状态，或重置密码（密码留空表示不修改）。"""
    db = get_db()
    u = _user_row(db, uid)
    if not u:
        return jsonify({"ok": False, "error": "账号不存在"}), 404

    body = request.get_json(silent=True) or {}
    me_id = _uf(g.user, "id")
    new_name = (body.get("name") or "").strip() if "name" in body else u["name"]
    new_phone = (body.get("phone") or "").strip() if "phone" in body else (u.get("phone") or "")
    new_role = (body.get("role") or "").strip() if "role" in body else u["role"]
    new_org = (body.get("org") or "").strip() if "org" in body else (u.get("org") or "")
    new_status = (body.get("status") or "").strip() if "status" in body else u["status"]
    password = body.get("password") or ""

    if not new_name:
        return jsonify({"ok": False, "error": "姓名不能为空"}), 400
    if new_phone and not PHONE_RE.fullmatch(new_phone):
        return jsonify({"ok": False, "error": "手机号格式不正确（11 位，1 开头）"}), 400
    if new_role not in ROLE_VIEWS:
        return jsonify({"ok": False, "error": "角色选择不正确"}), 400
    if new_status not in ("active", "disabled"):
        return jsonify({"ok": False, "error": "状态只能是 active / disabled"}), 400
    if password and len(password) < 6:
        return jsonify({"ok": False, "error": "新密码至少 6 位"}), 400

    if uid == me_id:
        if new_role != u["role"]:
            return jsonify({"ok": False, "error": "不能修改自己的角色"}), 400
        if new_status != "active":
            return jsonify({"ok": False, "error": "不能停用当前登录的管理员账号"}), 400

    losing_admin = (
        u["role"] == "机构管理员" and u["status"] == "active"
        and (new_role != "机构管理员" or new_status != "active")
    )
    if losing_admin and _active_admins(db, exclude_id=uid) == 0:
        return jsonify({"ok": False, "error": "这是最后一个启用的管理员，不能改角色或停用"}), 400

    if new_phone != (u.get("phone") or ""):
        dup = db.execute("SELECT id FROM users WHERE (phone=? OR username=?) AND id<>?",
                         (new_phone, new_phone, uid)).fetchone() if new_phone else None
        if dup:
            return jsonify({"ok": False, "error": "该手机号已被其他账号使用"}), 409

    fields, args = [], []
    for col, val in (("name", new_name), ("role", new_role), ("org", new_org), ("status", new_status)):
        fields.append(f"{col}=?")
        args.append(val)
    if new_phone != (u.get("phone") or ""):
        fields += ["phone=?", "username=?"]
        args += [new_phone, new_phone]
    if password:
        fields.append("password_hash=?")
        args.append(hash_password(password))
    args.append(uid)
    db.execute("UPDATE users SET " + ",".join(fields) + " WHERE id=?", args)

    # 手机号变了：把已绑定病例一起迁移，避免患者档案凭空消失
    moved = 0
    old_phone = u.get("phone") or ""
    if new_phone and new_phone != old_phone:
        cur = db.execute("UPDATE cases SET patient_phone=? WHERE patient_phone=?", (new_phone, old_phone))
        moved = cur.rowcount or 0
    db.commit()

    return jsonify({"ok": True, "user": _public_user(_user_row(db, uid)), "cases_moved": moved,
                    "message": "账号已更新" + (f"，{moved} 条病例已跟随新手机号迁移" if moved else "")})


@app.delete("/api/admin/users/<int:uid>")
@admin_required
def api_admin_user_delete(uid):
    """删除账号：病例不删，只解绑（变为未绑定，可重新绑定），避免毁掉临床档案。"""
    db = get_db()
    u = _user_row(db, uid)
    if not u:
        return jsonify({"ok": False, "error": "账号不存在"}), 404
    if uid == _uf(g.user, "id"):
        return jsonify({"ok": False, "error": "不能删除当前登录的账号"}), 400
    if u["role"] == "机构管理员" and u["status"] == "active" and _active_admins(db, exclude_id=uid) == 0:
        return jsonify({"ok": False, "error": "这是最后一个启用的管理员，不能删除"}), 400

    phone = u.get("phone") or ""
    released = 0
    if phone:
        cur = db.execute("UPDATE cases SET patient_phone='' WHERE patient_phone=?", (phone,))
        released = cur.rowcount or 0
    db.execute("DELETE FROM users WHERE id=?", (uid,))
    db.commit()
    return jsonify({"ok": True, "released_cases": released,
                    "message": "账号已删除" + (f"，{released} 条病例已解绑（可在绑定面板重新绑定）" if released else "")})


# ----------------------------------------------------------------------
# 机构管理员：档案管理（编辑基础信息 / 删除档案）
# ----------------------------------------------------------------------
@app.patch("/api/admin/cases/<case_no>")
@admin_required
def api_admin_case_update(case_no):
    db = get_db()
    row = db.execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "病例不存在"}), 404
    case = dict(row)
    body = request.get_json(silent=True) or {}

    new_name = (body.get("patient_name") or "").strip() if "patient_name" in body else (case.get("patient_name") or "")
    new_phone = (body.get("patient_phone") or "").strip() if "patient_phone" in body else (case.get("patient_phone") or "")
    new_part = (body.get("part") or "").strip() if "part" in body else case["part"]
    new_sport = (body.get("sport") or "").strip() if "sport" in body else (case.get("sport") or "")
    new_date = (body.get("injury_date") or "").strip() if "injury_date" in body else (case.get("injury_date") or "")

    if not new_part:
        return jsonify({"ok": False, "error": "部位不能为空"}), 400
    if new_phone and not PHONE_RE.fullmatch(new_phone):
        return jsonify({"ok": False, "error": "患者手机号格式不正确（11 位，1 开头）"}), 400
    if new_phone:
        owner = db.execute("SELECT role,name FROM users WHERE phone=?", (new_phone,)).fetchone()
        if not owner:
            return jsonify({"ok": False, "error": "该手机号没有账号，请先在「账号与权限」里开通患者账号"}), 400
        if owner["role"] != "患者":
            return jsonify({"ok": False, "error": f"该手机号对应的是{owner['role']}账号，不能作为患者绑定"}), 400
        if not new_name:
            new_name = owner["name"]

    changed = []
    for label, old, new in (("患者姓名", case.get("patient_name"), new_name),
                            ("患者手机号", case.get("patient_phone"), new_phone),
                            ("部位", case["part"], new_part),
                            ("运动项目", case.get("sport"), new_sport),
                            ("受伤日期", case.get("injury_date"), new_date)):
        if (old or "") != (new or ""):
            changed.append(f"{label}: {old or '空'} → {new or '空'}")

    db.execute(
        """UPDATE cases SET patient_name=?,patient_phone=?,part=?,sport=?,injury_date=? WHERE case_no=?""",
        (new_name, new_phone, new_part, new_sport or "未填写", new_date, case_no),
    )
    if changed:
        now = datetime.datetime.now().isoformat(timespec="seconds")
        db.execute("INSERT INTO reviews(case_no,action,reviewer,note,created_at) VALUES(?,?,?,?,?)",
                   (case_no, "admin-edit", _uf(g.user, "name"), "；".join(changed), now))
    db.commit()

    out = dict(db.execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone())
    return jsonify({"ok": True, "case": out, "changed": changed,
                    "message": "档案已更新" if changed else "内容没有变化"})


@app.delete("/api/admin/cases/<case_no>")
@admin_required
def api_admin_case_delete(case_no):
    """删除档案：连带检测框 / 随访 / AI 留痕 / 操作记录与影像文件，不可恢复。"""
    db = get_db()
    row = db.execute("SELECT case_no,image_path FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "病例不存在"}), 404

    image_path = (row["image_path"] or "").strip()
    db.execute("DELETE FROM findings WHERE case_no=?", (case_no,))
    db.execute("DELETE FROM followups WHERE case_no=?", (case_no,))
    db.execute("DELETE FROM ai_suggestions WHERE case_no=?", (case_no,))
    db.execute("DELETE FROM reviews WHERE case_no=?", (case_no,))
    db.execute("DELETE FROM cases WHERE case_no=?", (case_no,))
    db.commit()

    removed_file = False
    if image_path:
        target = (UPLOAD_DIR / os.path.basename(image_path))
        try:
            if target.exists():
                target.unlink()
                removed_file = True
        except OSError:
            pass
    return jsonify({"ok": True, "image_removed": removed_file,
                    "message": f"档案 {case_no} 已删除" + ("（含影像文件）" if removed_file else "")})


def _bind_case(db, case_no: str, phone: str, name_hint: str = ""):
    user = db.execute("SELECT * FROM users WHERE phone=?", (phone,)).fetchone()
    if not user:
        return None, "该手机号没有对应的患者账号"
    if user["role"] != "患者":
        return None, "该手机号绑定的不是患者账号"
    case = db.execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not case:
        return None, "病例不存在"
    if (case["patient_phone"] or "") and case["patient_phone"] != phone:
        return None, "该病例已绑定其他患者，不能重复绑定"
    now = datetime.datetime.now().isoformat(timespec="seconds")
    db.execute(
        "UPDATE cases SET patient_phone=?, patient_name=CASE WHEN IFNULL(patient_name,'')='' THEN ? ELSE patient_name END WHERE case_no=?",
        (phone, user["name"] or name_hint, case_no),
    )
    db.execute("INSERT INTO reviews(case_no,action,reviewer,note,created_at) VALUES(?,?,?,?,?)",
               (case_no, "bind", _uf(g.user, "name"),
                f"绑定患者账号 {phone}（{user['name']}）", now))
    db.commit()
    return {"case_no": case_no, "patient_phone": phone, "patient_name": user["name"],
            "status": case["status"]}, None


@app.post("/api/admin/bind")
@admin_required
def api_admin_bind():
    body = request.get_json(silent=True) or {}
    case_no = (body.get("case_no") or "").strip()
    phone = (body.get("phone") or "").strip()
    if not case_no or not phone:
        return jsonify({"ok": False, "error": "病例号与手机号都不能为空"}), 400
    data, err = _bind_case(get_db(), case_no, phone)
    if err:
        return jsonify({"ok": False, "error": err}), 400
    return jsonify({"ok": True, "binding": data})


@app.post("/api/patient/bind")
@login_required
def api_patient_bind():
    """患者自助绑定：仅限"未绑定"且档案姓名与本人一致的病例，防止冒领。"""
    if _uf(g.user, "role") != "患者":
        return jsonify({"ok": False, "error": "仅患者账号可自助绑定"}), 403
    body = request.get_json(silent=True) or {}
    case_no = (body.get("case_no") or "").strip()
    if not case_no:
        return jsonify({"ok": False, "error": "请输入病例号"}), 400
    db = get_db()
    case = db.execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not case:
        return jsonify({"ok": False, "error": "病例不存在，请核对病例号"}), 404
    if (case["patient_phone"] or ""):
        mine = _uf(g.user, "phone") or _uf(g.user, "username")
        if case["patient_phone"] == mine:
            return jsonify({"ok": True, "binding": {"case_no": case_no}, "already": True})
        return jsonify({"ok": False, "error": "该病例已被其他患者绑定，请联系机构管理员"}), 409
    if (case["patient_name"] or "").strip() != (_uf(g.user, "name") or "").strip():
        return jsonify({"ok": False, "error": "档案姓名与本人账号不一致，请携带证件联系机构管理员绑定"}), 403
    data, err = _bind_case(db, case_no, _uf(g.user, "phone") or _uf(g.user, "username"))
    if err:
        return jsonify({"ok": False, "error": err}), 400
    return jsonify({"ok": True, "binding": data})


@app.get("/api/cases/<case_no>/recovery")
@login_required
def api_case_recovery(case_no):
    """运动回归阶梯：完全按该病例的随访记录计算，无随访则不编造。"""
    db = get_db()
    row = db.execute("SELECT * FROM cases WHERE case_no=?", (case_no,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "病例不存在"}), 404
    case = dict(row)
    if not _can_view_case(g.user, case):
        return jsonify({"ok": False, "error": "无权查看该病例"}), 403

    fus = db.execute(
        "SELECT record_date,pain_score,rom,swelling FROM followups WHERE case_no=? ORDER BY record_date",
        (case_no,)).fetchall()
    swell_pen = {"无": 0, "轻": 4, "中": 8, "重": 12}
    series = []
    for f in fus:
        pain = float(f["pain_score"] or 0)
        rom = float(f["rom"] or 0)
        score = 100 - pain * 6 - (100 - rom) * 0.3 - swell_pen.get(f["swelling"] or "无", 0)
        score = max(0, min(100, round(score)))
        series.append({"date": f["record_date"], "score": score})

    now_score = series[-1]["score"] if series else 0
    steps = [("日常活动", 0), ("活动度训练", 40), ("基础力量", 55),
             ("跑跳", 70), ("变向", 80), ("对抗", 88), ("专项运动", 95)]
    ladder = []
    cur = 0
    for i, (name, need) in enumerate(steps):
        if now_score >= need:
            state = "done"
            cur = i
        elif i == cur + 1:
            state = "current"
        else:
            state = "todo"
        ladder.append({"name": name, "state": state, "need": need})

    return jsonify({"ok": True, "case_no": case_no, "part": case.get("part"),
                    "stage": case.get("stage"), "weeks": case.get("weeks") or 0,
                    "followups": len(series), "score": now_score, "target": 90,
                    "series": series, "ladder": ladder,
                    "source": "followups"})


# ----------------------------------------------------------------------
# App 版本信息（供未来移动端/扫码页使用）
# ----------------------------------------------------------------------
@app.get("/api/app/version")
def api_app_version():
    """版本信息取自实际安装包文件，文件缺失时不返回下载地址。"""
    apk_path = WEB_DIR / "downloads" / "lingshi-yiying-app.apk"
    has_apk = apk_path.exists()
    updated = (
        datetime.datetime.fromtimestamp(apk_path.stat().st_mtime).date().isoformat()
        if has_apk else datetime.date.today().isoformat()
    )
    return jsonify({
        "ok": True,
        "channel": "web+apk" if has_apk else "web",
        "version": "1.2.22" if has_apk else "1.0.0-web",
        "updatedAt": updated,
        "minAndroid": "8.0",
        "sizeMB": round(apk_path.stat().st_size / 1024 / 1024, 1) if has_apk else None,
        "downloadUrl": "/downloads/lingshi-yiying-app.apk" if has_apk else None,
        "note": "安装包可直接下载安装" if has_apk else "安装包未随仓库提供，请使用 Web 工作台",
    })


# ----------------------------------------------------------------------
# 静态站点托管：WebProject/ 根目录
# ----------------------------------------------------------------------
@app.get("/")
def index():
    return send_from_directory(WEB_DIR, "index.html")


@app.get("/<path:path>")
def serve_static(path):
    # 白名单：只允许前端资源目录
    allowed_prefixes = ("css/", "js/", "assets/", "downloads/")
    # 显式拒绝敏感路径和扩展名
    forbidden_ext = (".db", ".log", ".py", ".pyc", ".bak", ".secret_key", ".md", ".zip", ".exe")
    if path.startswith("server/") or path.startswith("."):
        abort(404)
    if path.endswith(forbidden_ext):
        abort(404)
    # 只允许白名单前缀的文件，或根目录的 html
    if not (path.startswith(allowed_prefixes) or path.endswith(".html") or path.endswith(".png") or path.endswith(".jpg")):
        abort(404)
    # 防止路径穿越
    target = (WEB_DIR / path).resolve()
    try:
        target.relative_to(WEB_DIR.resolve())
    except ValueError:
        abort(403)
    if target.is_dir():
        index_file = target / "index.html"
        if index_file.exists():
            return send_from_directory(WEB_DIR, str(Path(path) / "index.html"))
        abort(404)
    return send_from_directory(WEB_DIR, path)


# ----------------------------------------------------------------------
# 入口
# ----------------------------------------------------------------------
# 数据库初始化：模块加载即建表 + 写种子数据，兼容 gunicorn 多 worker 启动
# （幂等：CREATE IF NOT EXISTS + COUNT 判断；多 worker 并发时靠 SQLite 默认锁兜底）
try:
    init_db()
except Exception:
    pass

if __name__ == "__main__":
    init_db()
    HOST = os.environ.get("LSY_HOST", "0.0.0.0")     # 云服务器/局域网都靠 0.0.0.0
    PORT = int(os.environ.get("LSY_PORT", "5000"))
    # 兼容旧 App：旧 APK 里写死了 5001。设 LSY_LEGACY_PORT 为空可关闭旧端口监听。
    LEGACY_PORT = int(os.environ.get("LSY_LEGACY_PORT", "5001"))
    print("=" * 56)
    print(f"  灵视医影统一后端已启动（网页 + App 共用同一进程与数据库）")
    print(f"  站点地址 : http://127.0.0.1:{PORT}/")
    print(f"  接口前缀 : http://127.0.0.1:{PORT}/api/")
    print(f"  兼容端口 : http://127.0.0.1:{LEGACY_PORT}/  （旧 App 仍连 5001）")
    print(f"  数据库   : {DB_PATH}")
    st = detector_status()
    if st.get("available"):
        print(f"  检测模型 : {st['model_name']} · {st['model_version']} · "
              f"{st['model_size_mb']} MB · 阈值 {st['conf_threshold']}")
    else:
        print(f"  检测模型 : 未就绪 —— {st.get('error')}")
    print("  演示账号（密码均 123456）:")
    print("    13800000001 杨同学/执业医师    13800000002 沈同学/影像技师")
    print("    13800000003 张同学/康复治疗师  13800000004 刘同学/机构管理员")
    print("    13700000001 宋同学/患者（只读本人的档案）")
    print("  流程：技师上传+写报告 → 医师审核 → 康复师深化与随访 → 患者只读")
    print("=" * 56)
    # 优先 waitress：多线程、抗慢连接，云服务器上比 Flask 开发服务器稳得多
    THREADS = int(os.environ.get("LSY_THREADS", "4"))   # 2G 机器 4 线程够用，别开 8
    try:
        from waitress import serve
        import threading
        print(f"  运行模式 : waitress · {HOST} · {THREADS} 线程/端口")

        def _serve(port):
            serve(app, host=HOST, port=port, threads=THREADS, channel_timeout=180)

        # 主端口 5000 阻塞当前线程；旧端口 5001 起在后台线程，共用同一 Flask app + 同一库
        legacy_thread = None
        if LEGACY_PORT and LEGACY_PORT != PORT:
            legacy_thread = threading.Thread(target=_serve, args=(LEGACY_PORT,), daemon=True)
            legacy_thread.start()
            print(f"  旧 App 兼容监听 : {HOST}:{LEGACY_PORT} 已在后台启动")
        print("=" * 56)
        _serve(PORT)
    except ImportError:
        print("  运行模式 : Flask 开发服务器（未安装 waitress，演示够用）")
        print("=" * 56)
        # host=0.0.0.0 便于同局域网手机访问
        app.run(host=HOST, port=PORT, debug=False, threaded=True)
