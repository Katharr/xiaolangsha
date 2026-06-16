# 小狼杀免费美术资源导入说明

## 当前路线

AI 生图路线暂时停用。本项目当前采用“免费素材筛选 + 本地整理 + 固定命名导入”的方式，为前端原型提供一套可直接引用的暗黑手绘风格素材。

最终导入目录：

```text
assets/generated-art/
```

该目录已经按前端约定拆分为：

```text
assets/generated-art/
  backgrounds/
  characters/
  roles/
  ui/
  icons/
  effects/
  props/
  manifest.json
  ATTRIBUTION.md
  asset_contact_sheet.png
```

`manifest.json` 是前端可读取的资产清单；`ATTRIBUTION.md` 记录来源与授权判断；`asset_contact_sheet.png` 是快速预览图。

## 视觉方向

目标风格仍围绕暗黑手绘 roguelike 卡牌战斗 UI：

- 暗黑奇幻村庄
- 手绘粗线条
- 卡牌战斗界面感
- 木质、皮革、蜡封、烛火、月光
- 角色和身份牌有戏剧感，但局中头像不泄露身份
- UI 不像后台管理系统

## 已筛选素材来源

### 1. Hounskull - Fantasy Illustration Pack 01

来源：

```text
https://hounskul.itch.io/fantasy-illustration-pack-01
```

用途：

- 角色基础图
- 身份牌图案
- 图标
- 蜡封、眼睛、月亮、蜡烛等手绘符号

授权判断：

- 页面写明 `Licensed under CC-BY`
- 可用于项目，但需要在项目中保留署名

### 2. Skolaztika - Fantasy Renpy GUI template 2

来源：

```text
https://skolaztika.itch.io/fantasy-renpy-gui-template-2
```

用途：

- 深色幻想 UI 面板质感
- 文本框、弹窗、对话气泡、菜单背景

授权判断：

- 作者在页面评论中说明可用于商业项目
- 署名不是强制要求，但建议保留
- 作者允许编辑素材

### 3. Hugues Laborde - Environment Pack 01

来源：

```text
https://hugues-laborde.itch.io/environment-pack-01
```

用途：

- 月亮
- 火焰
- 雾气
- 树、建筑等环境物件

授权判断：

- 页面说明可用于任意项目，包含商业项目

### 4. Kenney - Fantasy UI Borders

来源：

```text
https://kenney-assets.itch.io/fantasy-ui-borders
```

用途：

- 备用 UI 边框资源
- 干净许可证兜底

授权判断：

- 包内 License 为 CC0
- 可个人、教育、商业使用
- 不强制署名

### 5. Penzilla - Giant Basic GUI Bundle

来源：

```text
https://penzilla.itch.io/basic-gui-bundle
```

用途：

- 备用按钮、面板、图标底座

授权判断：

- 页面说明 royalty free 和 commercial use
- 当前最终包主要使用自制按钮与 Skolaztika/Hounskull 资源，Penzilla 仅作为备用来源记录

## 已排除来源

### dodoillustra - Free Hand-drawn Monster Pack

来源：

```text
https://dodoillustra.itch.io/free-rpg-hand-drawn-monster-pack
```

排除原因：

- 页面允许个人和商业使用
- 但明确写明不能再分发素材包
- 因此不放入 `assets/generated-art/`

### PaperHatLizard - Cryo's Mini GUI

来源：

```text
https://paperhatlizard.itch.io/cryos-mini-gui
```

排除原因：

- 授权为 Creative Commons Attribution v4.0 International
- 可作为备选，但视觉偏像素风，和当前暗黑手绘卡牌方向不够贴
- 当前未放入最终导入包

## 固定命名清单

以下文件名已生成，可直接在前端中引用。

### 背景

```text
assets/generated-art/backgrounds/bg_night_village_square.png
assets/generated-art/backgrounds/bg_day_village_square.png
assets/generated-art/backgrounds/bg_vote_village_altar.png
assets/generated-art/backgrounds/bg_review_truth_room.png
```

说明：

- 当前为本地合成背景
- 使用 Hugues 环境物件、Skolaztika 氛围背景、Hounskull 手绘符号和程序绘制形状组合
- 适合前端原型使用
- 后续如有更高质量完整场景图，可保持同名替换

### 角色

```text
assets/generated-art/characters/char_player_human.png
assets/generated-art/characters/char_ai_villager_blue.png
assets/generated-art/characters/char_ai_villager_green.png
assets/generated-art/characters/char_ai_villager_gray.png
assets/generated-art/characters/char_ai_villager_teal.png
assets/generated-art/characters/char_overlay_dead.png
```

说明：

- 角色由 Hounskull 手绘人物/符号改色整理
- 局中角色不表示真实身份
- 符合项目“局中不泄露隐藏身份”的要求

### 身份牌

```text
assets/generated-art/roles/role_card_back.png
assets/generated-art/roles/role_card_seer.png
assets/generated-art/roles/role_card_werewolf.png
assets/generated-art/roles/role_card_villager.png
```

说明：

- 仅用于开局自己身份展示、身份牌展示、终局复盘
- 不应在普通局中玩家头像上直接展示真实身份

### UI 面板

```text
assets/generated-art/ui/ui_hud_top_panel.png
assets/generated-art/ui/ui_action_dock.png
assets/generated-art/ui/ui_event_log_panel.png
assets/generated-art/ui/ui_role_hand_panel.png
assets/generated-art/ui/ui_truth_reveal_card.png
assets/generated-art/ui/ui_modal_panel.png
assets/generated-art/ui/ui_speech_bubble.png
```

说明：

- 面板留出了前端动态文字区域
- 不包含烘焙文字
- 可作为 `background-image`、九宫格切片素材或普通图片层使用

### 按钮

```text
assets/generated-art/ui/btn_primary.png
assets/generated-art/ui/btn_secondary.png
assets/generated-art/ui/btn_danger.png
assets/generated-art/ui/btn_square_icon.png
```

说明：

- 按钮只提供底图
- 按钮文字由前端渲染

### 图标

```text
assets/generated-art/icons/icon_vote.png
assets/generated-art/icons/icon_speech.png
assets/generated-art/icons/icon_night_action.png
assets/generated-art/icons/icon_seer_check.png
assets/generated-art/icons/icon_abstain.png
assets/generated-art/icons/icon_fast_forward.png
assets/generated-art/icons/icon_review.png
assets/generated-art/icons/icon_error.png
assets/generated-art/icons/icon_private_info.png
```

说明：

- 图标均为透明背景 PNG
- 适合前端按钮、状态标签、日志分类使用

### 特效

```text
assets/generated-art/effects/fx_current_actor_ring.png
assets/generated-art/effects/fx_legal_target_ring.png
assets/generated-art/effects/fx_vote_marker.png
assets/generated-art/effects/fx_loading_slots.png
assets/generated-art/effects/fx_private_info_glow.png
assets/generated-art/effects/fx_day_speech_spotlight.png
```

说明：

- 用于当前发言者、可选目标、投票标记、加载骨架、私密信息提示等状态

### 地图物件

```text
assets/generated-art/props/prop_bonfire.png
assets/generated-art/props/prop_village_house.png
assets/generated-art/props/prop_forest_trees.png
assets/generated-art/props/prop_moon_fog_overlay.png
assets/generated-art/props/tile_village_path.png
```

说明：

- 可用于主屏背景叠加
- 也可作为后续动态场景拆层素材

## 前端接入建议

建议前端通过 `manifest.json` 读取资产路径，或先直接按固定路径引用：

```ts
const art = {
  nightBackground: "/assets/generated-art/backgrounds/bg_night_village_square.png",
  dayBackground: "/assets/generated-art/backgrounds/bg_day_village_square.png",
  voteBackground: "/assets/generated-art/backgrounds/bg_vote_village_altar.png",
  reviewBackground: "/assets/generated-art/backgrounds/bg_review_truth_room.png",
  playerHuman: "/assets/generated-art/characters/char_player_human.png",
  primaryButton: "/assets/generated-art/ui/btn_primary.png",
  voteIcon: "/assets/generated-art/icons/icon_vote.png"
};
```

如果使用 Vite/React，后续也可以把这些路径迁移到 `src/assets`，但当前原型阶段保留在 `assets/generated-art/` 更方便快速替换。

## 注意事项

- Hounskull 为 CC-BY，正式发布时必须保留署名。
- 背景图当前是合成占位，不是完整商业级场景插画。
- 角色图数量和差异度足够原型使用，但后续如追求更高品质，可保持同名替换。
- 不要在局中用 `role_card_werewolf`、`role_card_seer` 直接标记 AI 玩家真实身份。
- 若项目最终需要闭源商用发行，建议在发行前再做一次人工授权复核。
