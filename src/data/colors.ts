/**
 * 统一色彩令牌 - 低饱和科技蓝体系
 * 替换原分散硬编码色值，确保 ConsumerDashboard / BarChart 配色完全一致
 */

// —— 背景 ——
export const BG_PRIMARY = "#0C1524";          // 主背景（比原 #0A0F1A 更带蓝调，避免纯黑感）
export const BG_SECONDARY = "#101C32";       // 底部渐变终点（与主色同蓝系，融合而非割裂）

// —— 主强调色 ——
// 柔化的 sky 蓝，替代原高饱和 #00E5FF
export const ACCENT = "#4FC3F7";
export const ACCENT_DIM = "#29B6F6";          // 深色背景下的辅助蓝
export const ACCENT_GLOW = "rgba(79,195,247,0.35)";

// —— 语义色 ——
export const POSITIVE = "#4FC3F7";            // 正增长：用主色（科技看板蓝=正向表现）
export const NEGATIVE = "#E57373";            // 负增长：冷调柔红，避免跳脱的珊瑚橙

// —— 文本 ——
export const TEXT_PRIMARY = "#F5F9FC";        // 略偏蓝的白，减少纯白+深蓝的生硬对比
export const TEXT_SECONDARY = "#7A8CA0";      // 次文本：偏蓝灰，保持蓝系统一
export const TEXT_MUTED = "#4B5D72";          // 弱化文本

// —— Opacity 令牌（3 级，收敛原 0.03/0.08/0.12/0.15/0.2/0.4 碎片）——
export const OP = {
  subtle:  0.04,   // 网格线、背景纹理
  medium:  0.12,   // 卡片底色、径向光晕、柔和边界
  strong:  0.25,   // 主卡片边框、强调标记
  bold:    0.4,    // 扫描线、tag 边框
};

// —— 便捷 rgba ——
export const accentAlpha = (o: number) => `rgba(79,195,247,${o})`;
export const bgAlpha     = (o: number) => `rgba(255,255,255,${o})`;
