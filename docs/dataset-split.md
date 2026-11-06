# Clean Bone Fracture · 数据集说明与划分清单

对应《第三方资源说明》第五节第 4 项。

## 一、来源与许可

| 项目 | 内容 |
| --- | --- |
| 名称 | Clean Bone Fracture（bone-fracture-detection-dataset） |
| 页面 | https://www.kaggle.com/datasets/dmtrrmnv/clean-bone-fracture |
| 发布者 | dmxtrx（Kaggle 账号 dmtrrmnv） |
| 版本 / 更新 | Version 5，2025-11-25 |
| 数据量 | 约 207 MB |
| **许可** | **MIT**（Kaggle 官方数据集接口 `licenseName: MIT`） |
| 内容说明 | 多个开源骨折影像数据集清洗合并：去重、统一标签、人工校验标注框；YOLO txt 格式 |

> 该数据集为二次加工数据集，MIT 为发布者对本数据集声明的许可；
> 上游各原始数据集的许可情况以原始来源为准，本作品仅用于竞赛科研训练与演示。

## 二、本地目录与划分清单（实测）

数据集目录：本地 `<dataset-root>/data`（未随仓库分发）

| 划分 | 影像数 | 标注数（.txt） | 路径 |
| --- | --- | --- | --- |
| train | **1,851** | 1,851 | `data/train/images`、`data/train/labels` |
| valid | **377** | 377 | `data/valid/images`、`data/valid/labels` |
| test | **134** | 134 | `data/test/images`、`data/test/labels` |
| 合计 | 2,362 | 2,362 | — |

影像与标注一一对应。`data/data.yaml` 内容：

```yaml
train: train/images
val: valid/images
test: test/images
nc: 2
names:
  0: fracture
  1: normal
```

两类标签与 `server/detector.py` 中 `CLASS_NAMES = {0: "fracture", 1: "normal"}` 一致。

## 三、训练配置（本地训练产物可核验）

目录：本地 `<dataset-root>/runs/fracture_yolo26/args.yaml`

| 参数 | 值 |
| --- | --- |
| 模型 | `yolo26n.pt` |
| 任务 | detect |
| 数据配置 | `data/data.yaml` |
| epochs | 100 |
| imgsz | 640 |
| batch | 16 |
| seed | 42 |
| 设备 | GPU（device: 0） |

## 四、评测记录（results.csv，第 100 轮）

| 指标 | 数值 |
| --- | --- |
| precision(B) | 0.82515 |
| recall(B) | 0.77325 |
| mAP50(B) | 0.8288 |
| mAP50-95(B) | 0.57641 |

> 说明：网页端早期版本曾在数据看板与首页展示静态的模型召回率数值，因缺少与之
> 对应的完整评测记录，开源版本中已移除这些展示值；引用本模型指标请一律以
> `docs/training/results.csv` 为准（第 100 轮 recall 0.77325）。377 张验证集
> 数量与本清单一致。

## 五、去标识化

数据集为公开 X 光影像检测数据集，发布方已完成清洗与统一标注；
本作品仅使用影像与边界框标注，不含姓名、病历号等可识别个人身份信息。
