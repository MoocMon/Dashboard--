import React from "react";
import { spring, useCurrentFrame, useVideoConfig, interpolate } from "remotion";

interface AnimatedNumberProps {
  value: number;
  from?: number;
  startFrame?: number;
  durationInFrames?: number;
  format?: (v: number) => string;
  className?: string;
  style?: React.CSSProperties;
  decimals?: number;
}

/** 带缓动的数字滚动动画 */
export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  from = 0,
  startFrame = 0,
  durationInFrames = 60,
  format,
  className,
  style,
  decimals = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const springProgress = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 200, mass: 0.5, stiffness: 100 },
    durationInFrames,
  });

  const eased = interpolate(springProgress, [0, 1], [0, 1]);
  const currentValue = interpolate(eased, [0, 1], [from, value], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const display = format
    ? format(currentValue)
    : decimals > 0
    ? currentValue.toFixed(decimals)
    : Math.round(currentValue).toLocaleString();

  return (
    <span className={className} style={style}>
      {display}
    </span>
  );
};
