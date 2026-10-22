import React from "react";
import { spring, useCurrentFrame, useVideoConfig, interpolate, AbsoluteFill } from "remotion";
import { AnimatedNumber } from "./AnimatedNumber";
import { BarChart } from "./BarChart";
import { coreMetrics, topCategories, timeline, canvasConfig } from "../data/consumerData";
import {
  BG_PRIMARY,
  BG_SECONDARY,
  ACCENT,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  OP,
  accentAlpha,
  bgAlpha,
  NEGATIVE,
} from "../data/colors";

const formatYiw = (v: number) => {
  if (v >= 10000) {
    return (v / 10000).toFixed(2) + " 万亿";
  }
  return Math.round(v).toLocaleString() + " 亿";
};

const formatPct = (v: number) => {
  const sign = v >= 0 ? "+" : "";
  return sign + v.toFixed(1) + "%";
};

export const ConsumerDashboard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 标题淡入
  const titleOpacity = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 100 },
    durationInFrames: 30,
  });

  // 整体内容区向上滑动淡入
  const contentSlide = interpolate(
    frame,
    [timeline.metricsStart - 20, timeline.metricsStart + 10],
    [40, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const contentOpacity = interpolate(
    frame,
    [timeline.metricsStart - 20, timeline.metricsStart + 10],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // 条形区出现
  const chartOpacity = interpolate(
    frame,
    [timeline.chartStart - 10, timeline.chartStart + 10],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG_PRIMARY,

        backgroundImage: `
                radial-gradient(ellipse at 20% 0%, ${accentAlpha(OP.medium)} 0%, transparent 55%),
                radial-gradient(ellipse at 85% 95%, ${accentAlpha(OP.subtle + 0.03)} 0%, transparent 60%),
                linear-gradient(180deg, ${BG_PRIMARY} 0%, ${BG_SECONDARY} 100%)
              `,

        fontFamily: "\"SF Pro Display\", -apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif",
        overflow: "hidden",
        scale: 1
      }}
    >
      {/* 网格装饰 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(${accentAlpha(OP.subtle)} 1px, transparent 1px),
            linear-gradient(90deg, ${accentAlpha(OP.subtle)} 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }}
      />

      {/* 扫描线装饰 */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`,
          opacity: interpolate(frame, [0, timeline.totalFrames], [0.6, 0.2]),
          transform: `translateY(${interpolate(
            frame,
            [0, timeline.totalFrames],
            [0, canvasConfig.height]
          )}px)`,
          filter: "blur(1px)",
        }}
      />

      {/* 主内容容器 */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          padding: "90px 60px 70px",
          display: "flex",
          flexDirection: "column",
          gap: 50,
        }}
      >
        {/* 顶部标题区 */}
        <div style={{ opacity: titleOpacity }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                width: 6,
                height: 48,
                background: `linear-gradient(180deg, ${ACCENT}, transparent)`,
                borderRadius: 3,
              }}
            />
            <div
              style={{
                fontSize: 44,
                fontWeight: 800,
                color: TEXT_PRIMARY,
                letterSpacing: 2,
              }}
            >
              中国消费数据看板
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              paddingLeft: 22,
              fontSize: 24,
              color: TEXT_SECONDARY,
              fontWeight: 400,
            }}
          >
            <span>
              <span style={{ color: ACCENT, fontWeight: 600 }}>{coreMetrics.year}</span>
              年度 · 社会消费品零售总额
            </span>
            <span
              style={{
                fontSize: 18,
                padding: "4px 12px",
                border: `1px solid ${accentAlpha(OP.bold)}`,
                borderRadius: 4,
                color: ACCENT,
              }}
            >
              DATA · STATS
            </span>
          </div>
        </div>

        {/* 核心指标卡片 */}
        <div
          style={{
            opacity: contentOpacity,
            transform: `translateY(${contentSlide}px)`,
          }}
        >
          {/* 总额大字 */}
          <div
            style={{
              background: `linear-gradient(135deg, ${accentAlpha(OP.medium)}, ${accentAlpha(OP.subtle)})`,
              border: `1px solid ${accentAlpha(OP.strong)}`,
              borderRadius: 12,
              padding: "40px 44px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* 角装饰 */}
            <div
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                width: 60,
                height: 60,
                borderTop: `2px solid ${ACCENT}`,
                borderRight: `2px solid ${ACCENT}`,
                opacity: 0.5,
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: 16,
                left: 16,
                width: 60,
                height: 60,
                borderBottom: `2px solid ${ACCENT}`,
                borderLeft: `2px solid ${ACCENT}`,
                opacity: 0.5,
              }}
            />

            <div
              style={{
                fontSize: 22,
                color: TEXT_SECONDARY,
                fontWeight: 500,
                marginBottom: 8,
              }}
            >
              社会消费品零售总额
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
              <AnimatedNumber
                value={coreMetrics.totalRetail}
                startFrame={timeline.metricsStart}
                durationInFrames={60}
                format={formatYiw}
                style={{
                  fontSize: 80,
                  fontWeight: 800,
                  fontFamily: "monospace",
                  background: `linear-gradient(90deg, ${TEXT_PRIMARY}, ${ACCENT})`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  lineHeight: 1,
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginTop: 16,
              }}
            >
              <span
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  fontFamily: "monospace",
                  color: ACCENT,
                }}
              >
                同比
              </span>
              <AnimatedNumber
                value={coreMetrics.totalGrowth}
                startFrame={timeline.metricsStart + 15}
                durationInFrames={45}
                format={formatPct}
                style={{
                  fontSize: 40,
                  fontWeight: 800,
                  fontFamily: "monospace",
                  color: ACCENT,
                }}
                decimals={1}
              />
            </div>
          </div>

          {/* 次级指标 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
              marginTop: 24,
            }}
          >
            <MetricCard
              label="城镇消费"
              value={coreMetrics.urbanRetail}
              growth={coreMetrics.urbanGrowth}
              startFrame={timeline.metricsStart + 20}
            />
            <MetricCard
              label="乡村消费"
              value={coreMetrics.ruralRetail}
              growth={coreMetrics.ruralGrowth}
              startFrame={timeline.metricsStart + 25}
            />
            <MetricCard
              label="商品零售"
              value={coreMetrics.goodsRetail}
              growth={coreMetrics.goodsGrowth}
              startFrame={timeline.metricsStart + 30}
            />
            <MetricCard
              label="餐饮收入"
              value={coreMetrics.cateringRetail}
              growth={coreMetrics.cateringGrowth}
              startFrame={timeline.metricsStart + 35}
            />
          </div>

          {/* 网上零售横条 */}
          <div
            style={{
              marginTop: 20,
              background: `linear-gradient(90deg, ${accentAlpha(OP.strong)}, ${accentAlpha(OP.subtle)})`,
              border: `1px solid ${accentAlpha(OP.medium)}`,
              borderRadius: 8,
              padding: "20px 28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontSize: 22, color: TEXT_PRIMARY, fontWeight: 600 }}>
              网上零售额
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
              <AnimatedNumber
                value={coreMetrics.onlineRetail}
                startFrame={timeline.metricsStart + 40}
                durationInFrames={45}
                format={formatYiw}
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  fontFamily: "monospace",
                  color: TEXT_PRIMARY,
                }}
              />
              <AnimatedNumber
                value={coreMetrics.onlineGrowth}
                startFrame={timeline.metricsStart + 45}
                durationInFrames={40}
                format={formatPct}
                decimals={1}
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  fontFamily: "monospace",
                  color: ACCENT,
                }}
              />
            </div>
          </div>
        </div>

        {/* Top 10 消费品类 */}
        <div style={{ opacity: chartOpacity, flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 28,
            }}
          >
            <div
              style={{
                width: 4,
                height: 28,
                background: ACCENT,
                borderRadius: 2,
              }}
            />
            <div
              style={{
                fontSize: 30,
                fontWeight: 700,
                color: TEXT_PRIMARY,
              }}
            >
              Top 10 消费品类
            </div>
            <div
              style={{
                fontSize: 18,
                color: TEXT_SECONDARY,
                marginLeft: 8,
              }}
            >
              按零售额排序（亿元）
            </div>
          </div>

          <BarChart
            data={topCategories}
            startFrame={timeline.chartStart}
            barDelay={10}
          />
        </div>

        {/* 底部来源 */}
        <div
          style={{
            position: "absolute",
            bottom: 32,
            right: 60,
            fontSize: 18,
            color: TEXT_SECONDARY,
            opacity: 0.7,
            fontFamily: "monospace",
          }}
        >
          数据来源 · 国家统计局
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** 次级指标卡片 */
const MetricCard: React.FC<{
  label: string;
  value: number;
  growth: number;
  startFrame: number;
}> = ({ label, value, growth, startFrame }) => {
  const isPositive = growth >= 0;
  return (
    <div
      style={{
        background: bgAlpha(OP.subtle),
        border: `1px solid ${bgAlpha(OP.medium + 0.04)}`,
        borderRadius: 10,
        padding: "20px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 20, color: TEXT_SECONDARY, fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <AnimatedNumber
          value={value}
          startFrame={startFrame}
          durationInFrames={50}
          format={formatYiw}
          style={{
            fontSize: 32,
            fontWeight: 800,
            fontFamily: "monospace",
            color: TEXT_PRIMARY,
          }}
        />
        <AnimatedNumber
          value={growth}
          startFrame={startFrame + 10}
          durationInFrames={40}
          format={formatPct}
          decimals={1}
          style={{
            fontSize: 20,
            fontWeight: 700,
            fontFamily: "monospace",
            color: isPositive ? ACCENT : NEGATIVE,
          }}
        />
      </div>
    </div>
  );
};
