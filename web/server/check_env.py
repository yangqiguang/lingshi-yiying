# -*- coding: utf-8 -*-
"""
环境自检（被 启动服务.bat /install 与 安装Python.bat 调用）
====================================================================
只做只读检查，不启动服务、不写数据库，用来确认这台机器到底能不能跑起来：
    python check_env.py
"""

import os
import platform
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

PKGS = ["flask", "werkzeug", "itsdangerous", "numpy", "Pillow", "onnxruntime", "waitress"]


def _align_stdout_with_console():
    """输出被重定向时，按控制台代码页写，避免和 bat 的 GBK 文本混在一起变乱码。"""
    try:
        if sys.stdout.isatty():
            return
        import ctypes
        cp = ctypes.windll.kernel32.GetConsoleOutputCP()
        if cp:
            sys.stdout.reconfigure(encoding=f"cp{cp}", errors="replace")
    except Exception:
        try:
            sys.stdout.reconfigure(errors="replace")
        except Exception:
            pass


def main() -> int:
    _align_stdout_with_console()
    print(f"  Python   : {platform.python_version()}  ({sys.executable})")
    print(f"  系统     : {platform.system()} {platform.release()} / {platform.machine()}")

    try:
        import importlib.metadata as md
        parts, missing = [], []
        for name in PKGS:
            try:
                parts.append(f"{name} {md.version(name)}")
            except Exception:
                missing.append(name)
        print("  依赖     : " + " · ".join(parts))
        if missing:
            print("  缺少依赖 : " + "、".join(missing) + "  ← 影像分析会不可用")
    except Exception as exc:  # 极少见
        print(f"  依赖     : 读取失败 —— {exc}")

    try:
        import onnxruntime  # noqa: F401
        print(f"  onnxruntime : 可导入（{onnxruntime.__version__}）")
    except Exception as exc:
        print(f"  onnxruntime : 导入失败 —— {exc}")
        print("                多半缺 VC++ 运行库（msvcp140.dll）。装一次即可：")
        print("                https://aka.ms/vs/17/release/vc_redist.x64.exe")

    try:
        from detector import detector_status
        st = detector_status()
        if st.get("available"):
            print(f"  检测模型 : {st['model_name']} · {st['model_size_mb']} MB · "
                  f"阈值 {st['conf_threshold']} · 版本 {st.get('model_version')}")
        else:
            print(f"  检测模型 : 未就绪 —— {st.get('error')}")
    except Exception as exc:
        print(f"  检测模型 : 检查失败 —— {exc}")

    db = HERE / "lingshi.db"
    if db.exists():
        print(f"  数据库   : 已有 lingshi.db（{db.stat().st_size // 1024} KB）")
    else:
        print("  数据库   : 还没有，首次启动会自动创建并写入演示数据")

    uploads = HERE / "uploads"
    print(f"  影像目录 : {'已有' if uploads.exists() else '首次启动自动创建'}")

    ok = True
    try:
        import flask, numpy, PIL, onnxruntime, waitress  # noqa: F401
    except Exception as exc:
        print(f"\n  [不通过] 核心依赖导不进来：{exc}")
        ok = False

    print("  " + ("-" * 56))
    if ok:
        print("  [通过] 环境可用")
        return 0
    print("  [不通过] 请把上面的报错发出来")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # 兜底，别让安装窗口一闪而过
        print(f"[错误] 自检异常：{exc}")
        sys.exit(1)
