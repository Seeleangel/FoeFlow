# 风格学习系统

## 功能概述

风格学习系统允许用户从现有的 6 篇公众号文章排版中提取风格，并在生成新文章时应用这些学到的风格。

## 提取的风格

系统预设了 6 种从现有文章提取的风格：

| 风格名称 | 来源文章 | 配色方案 | 适用场景 |
|----------|----------|----------|----------|
| **专业严谨** | 315.txt | 红色 `#d83c18` + 金色 `#eeb069` | 维权指南、专业说明 |
| **节日喜庆** | 新年红包.txt | 中国红 `#e22007` + 金黄 `#ffc026` | 新年、节日庆典 |
| **温暖治愈** | 拥抱日.txt | 暖黄 `#f5d6a8` + 棕色 `#837261` | 情感类、温暖主题 |
| **传统节日** | 腊八节.txt | 深红 `#700202` + 深蓝 `#023270` | 传统节日、文化主题 |
| **活力庆典** | 新年师生同乐会.txt | 橙色 `#f96900` + 琥珀 `#ffb347` | 活动通知、庆典 |
| **时尚潮流** | 穿搭.txt | 渐变红 `#f22a0e` → `#be0000` | 时尚、穿搭、现代主题 |

## 风格构成

每种风格包含以下元素：

1. **颜色方案** - 主色、辅色、强调色
2. **装饰模式** - 从原文提取的装饰元素模式（SVG、边框、渐变等）
3. **装饰指令** - 具体的装饰应用规则：
   - `title-badge` - 标题徽章
   - `gradient-bg` - 渐变背景
   - `border-accent` - 装饰边框
   - `section-divider` - 分隔线
   - `centered-quote` - 居中金句
   - `emoji-prefix` - Emoji 前缀
   - `info-box` - 信息卡片

## 使用方法

### 在文章生成器中使用

1. 打开「文章生成器」页面
2. 生成或共创一篇新文章
3. 在生成结果区域，点击「**选择风格**」按钮
4. 从下拉列表中选择一种学到的风格
5. 点击「**智能美化**」按钮，AI 将应用所选风格的装饰

### 风格应用逻辑

- 系统会根据用户选择的风格，调整 AI 生成的装饰指令
- 自动应用风格的配色方案（主色、辅色）
- 保持风格的装饰密度和节奏感

## 技术实现

### 文件结构

```
src/
├── lib/
│   ├── styleExtractor.ts      # 风格提取和应用核心逻辑
│   ├── decorationAnalyzer.ts  # AI 装饰分析
│   └── decorationRenderer.ts  # 装饰渲染
├── components/
│   ├── StyleSelector.tsx      # 风格选择器组件
│   └── DecorationControls.tsx # 装饰控制按钮
├── pages/
│   └── Generator.tsx          # 集成风格选择
└── types/
    └── decoration.ts          # 类型定义（LearnedStyle 接口）
```

### 核心 API

```typescript
// 获取所有学到的风格
import { getLearnedStyles } from '@/lib/styleExtractor';
const styles = getLearnedStyles();

// 根据名称获取特定风格
import { getLearnedStyleByName } from '@/lib/styleExtractor';
const style = getLearnedStyleByName('节日喜庆');

// 应用风格到装饰指令
import { applyLearnedStyle } from '@/lib/styleExtractor';
const styledDecorations = applyLearnedStyle(originalDecorations, style);
```

### 风格数据结构

```typescript
interface LearnedStyle {
  name: string;              // 风格名称
  description: string;       // 风格描述
  articleType: ArticleType;  // 文章类型
  style: ArticleStyle;       // 风格（正式/活泼/温暖等）
  decorationDensity: DecorationDensity;  // 装饰密度
  colors: {
    primary: string;    // 主色
    secondary: string;  // 辅色
    accent?: string;    // 强调色
  };
  patterns: string[];  // 提取的装饰模式
  decorations: Array<{   // 装饰指令模板
    type: string;
    target: string;
    position: 'wrap' | 'before' | 'after';
    props?: Record<string, unknown>;
    reason: string;
  }>;
  sourceArticle: string;  // 来源文章
}
```

## 扩展新风格

可以通过两种方式添加新风格：

### 1. 添加到预设数组

在 `styleExtractor.ts` 的 `PRE_DEFINED_STYLES` 数组中添加新的风格定义。

### 2. 从 HTML 动态学习

```typescript
import { analyzeAndLearnStyle } from '@/lib/styleExtractor';

const html = `...文章 HTML...`;
const style = analyzeAndLearnStyle(html, '文章标题');
```

## 下一步计划

- [ ] 支持用户自定义上传 HTML 文件学习风格
- [ ] 风格编辑器，允许用户调整颜色、装饰密度
- [ ] 风格预览功能，实时查看风格效果
- [ ] 导出/分享学到的风格
- [ ] 从秀米链接直接学习排版风格
