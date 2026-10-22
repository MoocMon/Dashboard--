import { Composition, registerRoot } from "remotion";
import { ConsumerDashboard } from "./components/ConsumerDashboard";
import { canvasConfig, timeline } from "./data/consumerData";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="ConsumerDashboard"
        component={ConsumerDashboard}
        durationInFrames={timeline.totalFrames}
        fps={canvasConfig.fps}
        width={canvasConfig.width}
        height={canvasConfig.height}
      />
    </>
  );
};

registerRoot(RemotionRoot);
