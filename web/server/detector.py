# -*- coding: utf-8 -*-
"""
灵视医影 · 骨折检测模型接入层（ONNX Runtime）
================================================
模型：best.onnx（YOLO26n · detect · imgsz=640 · 2 类）
类别：0 fracture（骨折） / 1 normal（未见骨折）

设计原则：
1. 模型是"检测器"，只负责输出 bbox + 置信度，不负责下诊断；
2. 任何结论都必须带 source（model / demo / none）与模型版本，前端必须展示来源；
3. 模型缺失时明确报错，绝不静默返回假结论。

坐标约定：findings[].bbox = [x1, y1, x2, y2]，均已归一化到原图 0~1。
"""

from __future__ import annotations

import ast
import io
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image, ImageOps

# ----------------------------------------------------------------------
# 可调参数（全部可用环境变量覆盖）
# ----------------------------------------------------------------------
MODEL_PATH = Path(
    os.environ.get(
        "DETECT_MODEL",
        str(Path(__file__).resolve().parent / "models" / "best.onnx"),
    )
)
IMG_SIZE = int(os.environ.get("DETECT_IMG_SIZE", "640"))
CONF_THRESHOLD = float(os.environ.get("DETECT_CONF", "0.15"))
IOU_THRESHOLD = float(os.environ.get("DETECT_IOU", "0.45"))
MAX_BOXES = int(os.environ.get("DETECT_MAX_BOXES", "5"))
MAX_SIDE = int(os.environ.get("DETECT_MAX_SIDE", "2000"))  # 超大图先缩放，控制耗时

FRACTURE_CLASS = 0
CLASS_NAMES = {0: "fracture", 1: "normal"}
CLASS_LABELS_ZH = {0: "疑似骨折", 1: "未见明确骨折"}

MODEL_NAME = "yolo26n-fracture"


class DetectorError(RuntimeError):
    """模型不可用 / 推理失败，调用方应转成 503 并给出明确提示。"""


# ----------------------------------------------------------------------
# 数据结构
# ----------------------------------------------------------------------
@dataclass
class Finding:
    class_id: int
    label: str                 # 中文标签：疑似骨折 / 未见明确骨折
    raw_label: str             # 模型原始类别：fracture / normal
    confidence: float
    bbox: Optional[list] = None  # [x1,y1,x2,y2] 归一化；normal 不给框
    source: str = "model"

    def as_dict(self) -> dict:
        return {
            "class_id": self.class_id,
            "label": self.label,
            "raw_label": self.raw_label,
            "confidence": round(float(self.confidence), 4),
            "bbox": [round(float(v), 5) for v in self.bbox] if self.bbox else None,
            "source": self.source,
        }


@dataclass
class DetectionResult:
    findings: list = field(default_factory=list)
    has_fracture: bool = False
    primary: Optional[Finding] = None
    image_width: int = 0
    image_height: int = 0
    elapsed_ms: int = 0
    model_name: str = MODEL_NAME
    model_version: str = ""
    conf_threshold: float = CONF_THRESHOLD
    warning: str = ""

    @property
    def confidence(self) -> float:
        return round(float(self.primary.confidence), 4) if self.primary else 0.0

    @property
    def finding_label(self) -> str:
        return self.primary.label if self.primary else "未检出"

    def as_dict(self) -> dict:
        return {
            "findings": [f.as_dict() for f in self.findings],
            "has_fracture": self.has_fracture,
            "primary": self.primary.as_dict() if self.primary else None,
            "image": {"width": self.image_width, "height": self.image_height},
            "elapsed_ms": self.elapsed_ms,
            "model": {
                "name": self.model_name,
                "version": self.model_version,
                "img_size": IMG_SIZE,
                "conf_threshold": self.conf_threshold,
                "classes": CLASS_NAMES,
            },
            "warning": self.warning,
        }


# ----------------------------------------------------------------------
# 预处理 / 后处理
# ----------------------------------------------------------------------
def _letterbox(img: Image.Image, size: int):
    """等比缩放 + 灰边填充（114），返回 canvas、缩放比、左上偏移。"""
    w, h = img.size
    r = min(size / w, size / h)
    nw, nh = max(1, round(w * r)), max(1, round(h * r))
    resized = img.resize((nw, nh), Image.BILINEAR)
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    dx, dy = (size - nw) // 2, (size - nh) // 2
    canvas.paste(resized, (dx, dy))
    return canvas, r, dx, dy


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thres: float) -> list:
    """单类别贪心 NMS。boxes 为 xyxy。"""
    order = scores.argsort()[::-1]
    keep = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2])
        yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        area_r = (boxes[rest, 2] - boxes[rest, 0]) * (boxes[rest, 3] - boxes[rest, 1])
        union = np.clip(area_i + area_r - inter, 1e-9, None)
        order = rest[(inter / union) <= iou_thres]
    return keep


# ----------------------------------------------------------------------
# 检测器
# ----------------------------------------------------------------------
class FractureDetector:
    """ONNX Runtime 推理封装（线程安全，session 只加载一次）。"""

    def __init__(self, model_path: Path = MODEL_PATH):
        self.model_path = Path(model_path)
        if not self.model_path.exists():
            raise DetectorError(
                f"检测模型不存在：{self.model_path}。"
                "请把 best.onnx 放到 server/models/ 下，或用环境变量 DETECT_MODEL 指定路径。"
            )
        try:
            import onnxruntime as ort  # 延迟导入：没装 onnxruntime 时不影响其它接口
        except ImportError as exc:
            # 注意：装了 onnxruntime 但缺 VC++ 运行库时，这里抛的也是 ImportError
            if "DLL load failed" in str(exc):
                raise DetectorError(
                    "onnxruntime 已安装，但缺少它依赖的 VC++ 运行库（msvcp140.dll）。"
                    "装上 vc_redist.x64.exe 即可，或把运行库 DLL 放进 Python 目录。"
                ) from exc
            raise DetectorError(
                "缺少 onnxruntime，请先执行：pip install onnxruntime"
            ) from exc

        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # ---- 小内存机器友好设置（2G 云服务器实测省 ~300MB 提交内存）----
        # 默认开满所有 CPU 核会起几十个线程，每个线程 8MB 栈，2G 机器直接被压死；
        # 需要更快时可用环境变量放开：set ORT_INTRA_THREADS=4
        try:
            so.intra_op_num_threads = max(1, int(os.environ.get("ORT_INTRA_THREADS", "1")))
            so.inter_op_num_threads = max(1, int(os.environ.get("ORT_INTER_THREADS", "1")))
        except ValueError:
            so.intra_op_num_threads = 1
            so.inter_op_num_threads = 1
        # CPU 内存池常驻不释放，默认关掉；把 ORT_MEM_ARENA 设成 1 可以换速度换内存
        so.enable_cpu_mem_arena = os.environ.get("ORT_MEM_ARENA", "0") == "1"
        so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self.session = ort.InferenceSession(
            str(self.model_path), sess_options=so, providers=["CPUExecutionProvider"]
        )
        self.input_name = self.session.get_inputs()[0].name
        meta = self.session.get_modelmeta().custom_metadata_map or {}
        self.model_version = (meta.get("date") or "")[:10] or self.model_path.stat().st_mtime.__str__()
        # 优先使用模型自带类别名，保证与权重一致
        self.names = dict(CLASS_NAMES)
        try:
            raw = meta.get("names") or ""
            if raw:
                parsed = ast.literal_eval(raw)
                if isinstance(parsed, dict):
                    self.names = {int(k): str(v) for k, v in parsed.items()}
        except Exception:
            pass
        self._lock = threading.Lock()

    # ---------- 对外接口 ----------
    def detect(self, image_bytes: bytes) -> DetectionResult:
        if not image_bytes:
            raise DetectorError("影像内容为空")
        t0 = time.perf_counter()
        try:
            img = Image.open(io.BytesIO(image_bytes))
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
        except Exception as exc:
            raise DetectorError("无法解析该文件为图片，请上传 JPG / PNG") from exc

        origin_w, origin_h = img.size
        if origin_w < 64 or origin_h < 64:
            raise DetectorError(f"图像尺寸过小（{origin_w}×{origin_h}），请上传清晰的 X 光片")

        warning = ""
        if max(origin_w, origin_h) > MAX_SIDE:
            scale = MAX_SIDE / max(origin_w, origin_h)
            img = img.resize((max(1, int(origin_w * scale)), max(1, int(origin_h * scale))),
                             Image.BILINEAR)
            warning = f"图像较大，已等比缩放至 {img.size[0]}×{img.size[1]} 后推理"

        canvas, ratio, dx, dy = _letterbox(img, IMG_SIZE)
        arr = np.asarray(canvas, dtype=np.float32) / 255.0          # HWC
        arr = np.transpose(arr, (2, 0, 1))[None, ...]              # 1,3,H,W
        arr = np.ascontiguousarray(arr)

        try:
            with self._lock:  # 单 session 并发保护，避免极端情况下的显存/线程争用
                outputs = self.session.run(None, {self.input_name: arr})
        except Exception as exc:
            raise DetectorError(f"模型推理失败：{exc}") from exc

        pred = np.asarray(outputs[0])
        if pred.ndim == 3:
            pred = pred[0]
        if pred.shape[0] < pred.shape[1]:                           # (4+nc, N) → (N, 4+nc)
            pred = pred.T

        boxes_xywh = pred[:, :4]
        class_scores = pred[:, 4:]
        class_ids = class_scores.argmax(axis=1)
        confidences = class_scores.max(axis=1)
        mask = confidences >= CONF_THRESHOLD

        findings: list = []
        # 归一化后的 xyxy
        boxes_xyxy = np.empty_like(boxes_xywh)
        cx, cy, bw, bh = (boxes_xywh[:, i] for i in range(4))
        boxes_xyxy[:, 0] = cx - bw / 2
        boxes_xyxy[:, 1] = cy - bh / 2
        boxes_xyxy[:, 2] = cx + bw / 2
        boxes_xyxy[:, 3] = cy + bh / 2

        for cid in np.unique(class_ids[mask]):
            idx = np.where(mask & (class_ids == cid))[0]
            if idx.size == 0:
                continue
            keep = _nms(boxes_xyxy[idx], confidences[idx], IOU_THRESHOLD)
            for k in keep:
                i = int(idx[k])
                x1 = (boxes_xyxy[i, 0] - dx) / ratio / origin_w
                y1 = (boxes_xyxy[i, 1] - dy) / ratio / origin_h
                x2 = (boxes_xyxy[i, 2] - dx) / ratio / origin_w
                y2 = (boxes_xyxy[i, 3] - dy) / ratio / origin_h
                x1, y1 = max(0.0, min(1.0, x1)), max(0.0, min(1.0, y1))
                x2, y2 = max(0.0, min(1.0, x2)), max(0.0, min(1.0, y2))
                if x2 - x1 < 0.01 or y2 - y1 < 0.01:
                    continue
                cid = int(cid)
                is_normal = cid == 1
                findings.append(
                    Finding(
                        class_id=cid,
                        label=CLASS_LABELS_ZH.get(cid, self.names.get(cid, "未知")),
                        raw_label=self.names.get(cid, str(cid)),
                        confidence=float(confidences[i]),
                        # 统一转成 Python float，避免 numpy.float32 无法 JSON 序列化
                        bbox=None if is_normal else [float(x1), float(y1), float(x2), float(y2)],
                    )
                )

        # 骨折优先；没有骨折才看 normal
        fractures = [f for f in findings if f.class_id == FRACTURE_CLASS]
        normals = [f for f in findings if f.class_id != FRACTURE_CLASS]
        findings = sorted(fractures, key=lambda f: f.confidence, reverse=True)[:MAX_BOXES]
        if not findings:
            findings = sorted(normals, key=lambda f: f.confidence, reverse=True)[:1]

        primary = findings[0] if findings else None
        elapsed = int((time.perf_counter() - t0) * 1000)
        return DetectionResult(
            findings=findings,
            has_fracture=bool(primary and primary.class_id == FRACTURE_CLASS),
            primary=primary,
            image_width=origin_w,
            image_height=origin_h,
            elapsed_ms=elapsed,
            model_name=MODEL_NAME,
            model_version=str(self.model_version),
            warning=warning,
        )


# ----------------------------------------------------------------------
# 单例
# ----------------------------------------------------------------------
_detector = None
_detector_error = None
_detector_lock = threading.Lock()


def get_detector():
    """返回检测器；不可用时抛 DetectorError（调用方转 503）。"""
    global _detector, _detector_error
    if _detector is not None:
        return _detector
    if _detector_error is not None:
        raise _detector_error
    with _detector_lock:
        if _detector is None and _detector_error is None:
            try:
                _detector = FractureDetector()
            except DetectorError as exc:
                _detector_error = exc
                raise
    return _detector


def detector_status() -> dict:
    """给 /api/model/status 用的健康检查，不抛异常。"""
    info = {
        "available": False,
        "model_path": str(MODEL_PATH),
        "model_exists": MODEL_PATH.exists(),
        "model_name": MODEL_NAME,
        "classes": CLASS_NAMES,
        "img_size": IMG_SIZE,
        "conf_threshold": CONF_THRESHOLD,
        "iou_threshold": IOU_THRESHOLD,
    }
    try:
        det = get_detector()
        info.update(
            available=True,
            model_version=str(det.model_version),
            model_size_mb=round(MODEL_PATH.stat().st_size / 1024 / 1024, 2),
        )
    except Exception as exc:
        info["error"] = str(exc)
    return info