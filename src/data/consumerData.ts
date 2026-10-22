/**
 * 2025年中国社会消费品零售总额数据
 * 数据来源：国家统计局 2025年国民经济和社会发展统计公报 + 12月社零报告
 * https://www.stats.gov.cn/
 */

export interface Category {
  name: string;
  retail: number;       // 零售额（亿元）
  growth: number;       // 同比增长率（%）
}

/** 核心指标 */
export const coreMetrics = {
  totalRetail: 501202,       // 社会消费品零售总额（亿元）
  totalGrowth: 3.7,          // 同比增长（%）
  urbanRetail: 432972,       // 城镇消费品零售额
  urbanGrowth: 3.6,
  ruralRetail: 68230,        // 乡村消费品零售额
  ruralGrowth: 4.1,
  goodsRetail: 443220,       // 商品零售额
  goodsGrowth: 3.8,
  cateringRetail: 57982,     // 餐饮收入
  cateringGrowth: 3.2,
  onlineRetail: 159722,      // 网上零售额
  onlineGrowth: 8.6,
  year: 2025,
};

/** Top 10 消费品类（按零售额降序，限额以上单位） */
export const topCategories: Category[] = [
  { name: "汽车类",          retail: 49789, growth: -1.5 },
  { name: "粮油、食品类",    retail: 23991, growth:  9.3 },
  { name: "石油及制品类",    retail: 22505, growth: -5.7 },
  { name: "服装鞋帽针纺织",  retail: 15215, growth:  3.2 },
  { name: "家用电器音像器材", retail: 11695, growth: 11.0 },
  { name: "通讯器材类",      retail: 10076, growth: 20.9 },
  { name: "日用品类",         retail: 8675, growth:  6.3 },
  { name: "中西药品类",       retail: 7294, growth:  1.8 },
  { name: "烟酒类",           retail: 6425, growth:  2.7 },
  { name: "文化办公用品类",   retail: 5239, growth: 17.3 },
];

/** 动画时间线配置（单位：帧，30fps） */
export const timeline = {
  titleDuration: 60,       // 标题出现 2s
  metricsStart: 40,
  metricsDuration: 90,     // 核心指标展示 3s
  chartStart: 120,
  chartDuration: 210,      // 条形图展示 7s
  outroStart: 320,
  totalFrames: 360,        // 总时长 12s
};

/** 画布配置 - 9:16 竖屏 */
export const canvasConfig = {
  width: 1080,
  height: 1920,
  fps: 30,
};
