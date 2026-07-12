# 风格宪法 · 已冻结（T-002）

> 定稿：主创于 2026-07-12 在 `prototype/style-lab.html` 拉参定稿，Architect 落成本文档。
> **本页是所有美术与 UI 的验收基准。** 修改需主创 + Architect 双方同意；agent 不得自行改动。
> MVP 只做森林世界，即本页「青雾」一套。

---

## 1 · 冻结参数（canonical CONFIG）

所有场景代码（Web 原型与小程序 canvas）从这份 CONFIG 起步，字段名保持一致：

```json
{
  "preset": "青雾",
  "fog": 56,
  "fogSpeed": 0.5,
  "fogLayers": 3,
  "hueShift": 0,
  "saturation": 1,
  "fly": 45,
  "flySize": 1,
  "flyGlow": 70,
  "flyRange": 1,
  "flySpeed": 1,
  "breathAmp": 60,
  "breathPeriod": 6,
  "parallaxLayers": 5,
  "parallaxIntensity": 65,
  "strokeWidth": 0,
  "portraitMode": true
}
```

要点直译：雾量 56%、雾 3 层、萤火密度 45%、辉光 70%、呼吸 6 秒、视差 5 层、**无描边**（纯剪影）、默认竖屏。

## 2 · 色板「青雾」（森林世界）

| 角色 | 变量 | Hex |
|---|---|---|
| 天空（顶→底） | `--color-sky-0/1/2` | `#0B2429` `#17454A` `#2C6B6B` |
| 剪影层（远→近） | `--color-layers-0…4` | `#7FB5AE` `#4E8D88` `#2F6B67` `#1C4A48` `#102F30` |
| 雾 | `--color-fog` | `#BFE3DB` |
| 萤火 | `--color-fly` | `#D8FFEF` |
| 中心辉光 | `--color-glow` | `#C8F0E4` |
| 高饱和的刺（点缀） | `--color-accent` | `#B04A5A` |
| 倾听者眼睛 | `--color-eye` | `#EAFFF6` |
| 地面/小径 | `--color-ground` | `#5E9B94` |

CSS 变量块（可直接粘进任何页面）：

```css
:root {
  --color-sky-0: #0B2429;  --color-sky-1: #17454A;  --color-sky-2: #2C6B6B;
  --color-glow: #C8F0E4;
  --color-layers-0: #7FB5AE; --color-layers-1: #4E8D88; --color-layers-2: #2F6B67;
  --color-layers-3: #1C4A48; --color-layers-4: #102F30;
  --color-fog: #BFE3DB;  --color-fly: #D8FFEF;  --color-accent: #B04A5A;
  --color-eye: #EAFFF6;  --color-ground: #5E9B94;
  --fog-opacity: 56%;  --fog-speed: 0.50;  --fog-layers: 3;
  --firefly-count: 45%; --firefly-size: 1.00; --firefly-glow: 70%;
  --firefly-range: 1.00; --firefly-speed: 1.00;
  --breath-amplitude: 60%; --breath-period: 6.0s;
  --parallax-layers: 5; --parallax-intensity: 65%;
  --stroke-width: 0;
}
```

## 3 · 线条 / 构图 / 动效（沿袭 AGENTS.md §3，此处为验收细则）

- **线条**：扁平剪影，`strokeWidth=0` 已定稿——**不描边**。
- **构图**：雾负责「看不清」，意象不必具象；点状光源数量以萤火密度 45% 为上限基准；中心辉光只有一处。
- **动效全部程序化**：视差（5 层，强度 65%）+ 雾漂移（3 层，速度 0.5）+ 萤火正弦漂移 + 6 秒全场呼吸缩放（幅度 60%）。运行时零生成成本。
- **`prefers-reduced-motion`**：位移/缩放类动画全部归零（雾漂移、萤火漂移、呼吸、摇摆、grain 滚动、光柱），只允许透明度级微脉动。
- **默认竖屏**（9:16，对齐小程序），可切全屏预览。

## 4 · 禁止项（硬性，与 AGENTS.md §4 同级）

- ❌ 清晰人脸——脸一律背影/剪影（恐怖谷 + 肖像风险）
- ❌ 纯黑（`#000000` 不得作为画面内颜色；最深只到 `#0B2429` / `#102F30` 一族）
- ❌ 血腥直出——一律剪影化 / 红雾
- 所有 AI 生成图先过白名单转译（人脸→剪影，血→红雾）再进图像模型

## 5 · 使用与验收规则

1. 新场景/新页面一律 import 本页 CONFIG 与色板起步，禁止另起炉灶调色。
2. Reviewer 验收美术相关任务时，逐条对照本页 §2–§4；色值偏差需能说明理由（如雾化混色）。
3. 「高饱和的刺」（`--color-accent`）每屏至多一处，小面积点缀。
4. 本页与 `verdant-mirage-product-design.html` 冲突时，**色板与参数以本页为准**（本页更新、由主创直接定稿）。
