---
name: Idea2Screenplay
description: 一句话逐层发展为可编辑中文短剧的安静编剧工作台
colors:
  ink: "#211F1C"
  ink-deep: "#0F0E0D"
  text-soft: "#6F6B64"
  canvas: "#F7F6F1"
  surface: "#FCFBF8"
  surface-muted: "#ECE9E1"
  border: "#D8D4CB"
  signal: "#B84A3A"
  signal-deep: "#91382D"
  success: "#477D5D"
  error: "#9D3429"
typography:
  display:
    fontFamily: "Playfair Display, Noto Serif SC, Songti SC, serif"
    fontSize: "76px"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Playfair Display, Noto Serif SC, Songti SC, serif"
    fontSize: "56px"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Inter, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.02em"
rounded:
  xs: "4px"
  sm: "8px"
  md: "14px"
  pill: "999px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "64px"
  4xl: "96px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "12px 18px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink-deep}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "12px 18px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "11px 17px"
    height: "44px"
  prompt-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "18px 20px"
    height: "64px"
  surface-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "24px"
  nav-active:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
---

# Design System: Idea2Screenplay

## Overview

**Creative North Star: "未装订的剧本"**

这套系统像一份刚从编剧手中拿到、仍可继续修改的剧本：暖白、安静、可信，保留纸张与铅字的文化联想，但不模拟陈旧材质。首页借鉴 Sitor 的编辑出版感，用充足留白把一句话创意放在视觉中心；用户进入工作台后，留白收紧，人物、节拍、场景和对白获得更高的信息密度。

界面必须“作品重于工具”。生成过程通过真实阶段、明确状态和可编辑产物建立可信度，不通过霓虹、机器人形象或虚假的思考动画表演 AI。操作控件使用熟悉的产品模式，电影语言只出现在场次编号、剧本排版和少量符号中。

桌面工作台以 1280px 内容宽度为上限，侧栏在 1050px 以下收窄，在 760px 以下折叠为抽屉。普通状态变化使用 150–220ms 的克制过渡；禁用装饰性入场编排，并完整尊重 `prefers-reduced-motion`。

**Key Characteristics:**

- 暖白画布与铅字墨形成主要视觉关系。
- 校订朱砂只标记关键动作、当前阶段和需要注意的状态。
- 首页疏朗，工作台紧凑；两者共享同一字体、颜色和组件词汇。
- 内容区以细线和色调分层，阴影只属于真正悬浮的纸张与浮层。
- 所有核心路径满足 WCAG 2.2 AA，并支持完整键盘操作。

## Colors

色彩来自未装订纸张、印刷铅字与编辑校订标记；整体近乎单色，稀少的朱砂因此具有明确意义。

### Primary

- **铅字墨（ink）** (#211F1C)：主要文字、导航激活态和主按钮。它承担品牌识别，不额外引入黑色变体。
- **深铅字（ink-deep）** (#0F0E0D)：仅用于主按钮悬停和需要增强对比的短暂交互状态。

### Secondary

- **校订朱砂（signal）** (#B84A3A)：只用于生成入口、当前流水线阶段、文本选择和重要焦点提示。
- **深校订朱砂（signal-deep）** (#91382D)：用于朱砂控件的按下态及高对比提示，不作为大面积背景。

### Neutral

- **未装订纸（canvas）** (#F7F6F1)：页面主画布和首页大面积留白。
- **新纸白（surface）** (#FCFBF8)：输入区、内容面板和剧本纸张。
- **折页灰（surface-muted）** (#ECE9E1)：侧栏、工具条、悬停和选中背景。
- **装订线（border）** (#D8D4CB)：分隔线、输入边界和静态容器边框。
- **批注灰（text-soft）** (#6F6B64)：辅助文字、元数据和未激活状态。
- **完成绿（success）** (#477D5D)：仅表达生成完成或保存成功。
- **错误红（error）** (#9D3429)：仅表达失败、危险和不可逆操作。

**The One Red Mark Rule.** 校订朱砂在任一屏幕上的可见面积不得超过 8%；如果同时有三个以上朱砂强调点，必须降低其中至少两个的权重。

**The Warm White Rule.** 禁止用纯白覆盖整个页面；未装订纸负责环境，新纸白只负责需要聚焦的内容表面。

**The Semantic State Rule.** 成功、错误和进行中状态必须同时拥有文字或图标，禁止只依赖颜色传达。

## Typography

**Display Font:** Playfair Display，中文回退为 Noto Serif SC / Songti SC

**Body Font:** Inter，中文回退为 Noto Sans SC / Microsoft YaHei

**UI Font:** Inter，中文配套为 Noto Sans SC；常规正文 400，导航与标签 500–600

**Technical Mono Font:** 系统等宽字体仅用于 Fountain 剧本正文、固定宽度数字和技术性片段，不再承担导航或按钮文字

**Character:** Playfair Display 与 Noto Serif SC 只承担主标题和作品内容，提供 Sitor 式的编辑出版气质；所有按钮、表单、导航、帮助文字和产品状态使用 Inter 与 Noto Sans SC。等宽字体只留给 Fountain 剧本和真正需要固定字符宽度的数据。

### Hierarchy

- **Display** (600, 52–76px, line-height 1.08): 仅用于首页核心命题；移动端降为 44–50px，最多两行。
- **Headline** (600, 40–56px, line-height 1.12): 用于项目名称、阶段标题和重要故事命题。
- **Title** (600, 20px, line-height 1.35): 用于面板、人物和场景标题。
- **Body** (400, 16px, line-height 1.7): 用于说明、梗概和编辑内容；叙述文本控制在 68–72 个拉丁字符的等效行宽内。
- **Label** (600, 12–13px, letter-spacing 0–0.04em): 用于场次、元数据和短操作标签；英文可以轻微增加字距，中文保持正常字距。

**The Two-Voice Rule.** 一个界面区域最多同时出现衬线与无衬线两种声音；等宽标签属于元数据，不得扩张为第三种正文风格。

**The Italic Accent Rule.** 斜体只属于首页或空状态中的短句，禁止用于按钮、输入内容、导航和长篇中文文本。

## Elevation

系统默认扁平，通过未装订纸、新纸白、折页灰和装订线建立结构。阴影不是装饰，只有剧本纸张、菜单、对话框和移动侧栏等确实离开画布的对象才能获得柔和、宽扩散的环境阴影；普通卡片在静止和悬停状态都不升起。

### Shadow Vocabulary

- **纸张悬浮（ambient-page）** (box-shadow: 0 18px 50px rgba(33, 31, 28, 0.10))：用于完整剧本页面和可拖离画布的稿纸，阴影宽、浅且无硬边。
- **临时浮层（ambient-overlay）** (box-shadow: 0 24px 80px rgba(15, 14, 13, 0.18))：用于对话框、菜单和移动抽屉，强度高于稿纸但仍保持低饱和中性。
- **焦点轮廓（focus-ring）** (box-shadow: 0 0 0 2px #F7F6F1, 0 0 0 4px #B84A3A)：使用双层轮廓确保在暖白和墨色表面都可见，不用阴影模拟键盘焦点。

**The Flat-by-Default Rule.** 如果一个容器不会遮挡或离开相邻内容，它就没有资格获得阴影。

**The No Hard Shadow Rule.** 禁止使用当前版本中 5px–16px 的硬偏移块状阴影；若阴影边缘一眼可见，说明强度过高。

## Components

### Buttons

- **Shape:** 工作台按钮使用克制圆角（sm）；胶囊形只允许用于首页导航 CTA 和紧凑筛选器。
- **Primary:** 铅字墨背景、新纸白文字，44px 高；同一视区只保留一个主按钮。
- **Hover / Focus:** 悬停切换为深铅字；键盘焦点使用 2px 校订朱砂外轮廓和 2px 间距。按下态不位移超过 1px。
- **Secondary / Ghost:** 新纸白或透明背景，使用装订线边框；悬停只改变为折页灰，不改变控件尺寸。
- **Disabled / Loading:** 禁用态保留文字可读性并降低整体对比；加载态保留按钮宽度，使用简短动词和静态进度图标。

### Cards / Containers

- **Corner Style:** 内容面板使用轻微圆角（sm），剧本纸张保持 0–4px 的近直角。
- **Background:** 新纸白用于需要阅读或编辑的内容，折页灰用于导航和工具区域。
- **Shadow Strategy:** 普通卡片始终无阴影，只有稿纸和临时浮层遵循 Elevation 规则。
- **Border:** 统一使用 1px 装订线，不通过彩色粗边区分类别。
- **Internal Padding:** 紧凑工作台使用 16–24px；首页叙事模块使用 32–64px。

### Inputs / Fields

- **Style:** 首页创意输入框使用新纸白、装订线和中等圆角（md），最小高度 64px；工作台字段使用 44px 控件或带底线的剧本编辑样式。
- **Focus:** 边框转为铅字墨，并出现 2px 校订朱砂外轮廓；禁止发光效果。
- **Error / Disabled:** 错误红与文字说明同时出现；禁用态不可仅靠降低透明度，仍需可读标签和不可用原因。
- **Help / Counter:** 字数、匿名保存期限和每日剩余额度使用批注灰，放在字段之后并与字段建立程序化关联。

### Navigation

桌面端采用暖白顶栏与窄侧栏，默认文字为批注灰，激活项使用折页灰背景和铅字墨文字。禁止依赖 3px 彩色竖条作为唯一选中信号。移动端侧栏变为带遮罩抽屉，打开后焦点锁定在导航内，Escape 可关闭并返回触发按钮。

### Generation Pipeline

六阶段流水线是产品的签名组件。每一步同时显示序号、名称与文字状态；当前阶段使用单个校订朱砂标记，已完成阶段使用完成绿和勾选图标，未开始阶段使用批注灰。阶段产物必须在继续前提供“编辑”“局部重生成”和“确认继续”三个明确动作。

### Screenplay Page

剧本页面使用新纸白和克制的纸张悬浮，正文遵循 Fountain 语义但不模拟打字机噪点。场景标题、动作和对白拥有稳定宽度与缩进；编辑保存状态必须在页面工具条中持续可见。移动端优先保持可读字号，通过缩进收缩适配，禁止整体缩放整张稿纸。

## Do's and Don'ts

### Do:

- **Do** 让首页的创意输入成为唯一主视觉，并在首屏直接提供完整示例入口。
- **Do** 使用 `canvas`、`surface` 和 `surface-muted` 建立层级，把 `signal` 控制在每屏 8% 以内。
- **Do** 在工作台中优先展示用户作品、真实生成阶段和可编辑产物。
- **Do** 为按钮、输入、导航和阶段控件实现默认、悬停、焦点、按下、禁用、加载与错误状态。
- **Do** 保持首页疏朗、工作台紧凑，并在 760px 与 1050px 处进行结构性响应式调整。
- **Do** 为进度、成功和错误状态同时提供文字、图标与颜色，并满足 WCAG 2.2 AA。

### Don't:

- **Don't** 使用“紫蓝渐变、霓虹发光、机器人插画等通用 AI 产品外观”。
- **Don't** 使用“厚重的全暗色界面、强烈仿旧纸张纹理或大面积暗红装饰”。
- **Don't** 把复杂创作流程退化成单一聊天窗口。
- **Don't** 使用“满屏同质卡片、无意义的大标题和装饰性动画”营造高级感。
- **Don't** 采用“廉价短视频模板、娱乐化贴纸或过度活跃的社交平台视觉语言”。
- **Don't** 在普通卡片上添加硬阴影、悬停位移或玻璃拟态；如果容器看起来像漂浮广告，它已经偏离系统。
- **Don't** 在按钮、导航、表单标签或长篇正文中使用装饰性斜体衬线字体。
- **Don't** 只用颜色、动画或透明度表达状态，也不得忽略键盘焦点和减少动态设置。
