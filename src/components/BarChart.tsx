import React from "react";
import { spring, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { Category } from "../data/consumerData";
import {
  POSITIVE,
  NEGATIVE,
  ACCENT_GLOW,
  TEXT_PRIMARY,
  TEXT_MUTED,
  OP,
  bgAlpha,
} from "../data/colors";

interface BarChartProps {
  data: Category[];
  startFrame?: number;
  barDelay?: number;       // 每个条形依次出现的帧间隔
}

export const BarChart: React.FC<BarChartProps> = ({
  data,
  startFrame = 0,
  barDelay = 8,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const maxRetail = Math.max(...data.map((d) => d.retail));

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      {data.map((item, index) => {
        const itemStart = startFrame + index * barDelay;

        // 条形宽度动画
        const barProgress = spring({
          frame: frame - itemStart,
          fps,
          config: { damping: 16, mass: 0.6, stiffness: 120 },
        });

        const barWidthPct = interpolate(barProgress, [0, 1], [0, (item.retail / maxRetail) * 100], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        // 行淡入
        const rowOpacity = interpolate(
          frame - itemStart - 5,
          [0, 10],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        const isPositive = item.growth >= 0;
        const barColor = isPositive ? POSITIVE : NEGATIVE;

        return (
          <div
            key={item.name}
            style={{
              opacity: rowOpacity,
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
            }}
          >
            {/* 排名 */}
            <div
              style={{
                width: 44,
                fontSize: 22,
                fontWeight: 700,
                color: index < 3 ? POSITIVE : TEXT_MUTED,
                fontFamily: "monospace",
                textAlign: "right",
                flexShrink: 0,
              }}
            >
              {String(index + 1).padStart(2, "0")}
            </div>

            {/* 品类名 */}
            <div
              style={{
                width: 140,
                fontSize: 26,
                color: TEXT_PRIMARY,
                fontWeight: 500,
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {item.name}
            </div>

            {/* 条形区 */}
            <div
              style={{
                flex: 1,
                height: 34,
                position: "relative",
                backgroundColor: bgAlpha(OP.subtle),
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              {/* 背景网格线 */}
              {[0.25, 0.5, 0.75].map((p) => (
                <div
                  key={p}
                  style={{
                    position: "absolute",
                    left: `${p * 100}%`,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    backgroundColor: bgAlpha(OP.medium),
                  }}
                />
              ))}

              {/* 主条形 */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${barWidthPct}%`,
                  background: `linear-gradient(90deg, ${barColor}CC, ${barColor})`,
                  borderRadius: 4,
                  boxShadow: `0 0 12px ${isPositive ? ACCENT_GLOW : "rgba(229,115,115,0.4)"}`,
                  transition: "none",
                }}
              />

              {/* 条形末端光点 */}
              {barWidthPct > 5 && (
                <div
                  style={{
                    position: "absolute",
                    left: `calc(${barWidthPct}% - 6px)`,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    backgroundColor: barColor,
                    boxShadow: `0 0 10px 3px ${barColor}`,
                  }}
                />
              )}
            </div>

            {/* 数值标签 */}
            <div
              style={{
                width: 110,
                flexShrink: 0,
                textAlign: "right",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 2,
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: TEXT_PRIMARY,
                  fontFamily: "monospace",
                }}
              >
                {item.retail.toLocaleString()}
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: isPositive ? POSITIVE : NEGATIVE,
                  fontFamily: "monospace",
                }}
              >
                {isPositive ? "▲" : "▼"} {Math.abs(item.growth).toFixed(1)}%
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
