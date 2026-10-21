import React from "react";
import { Composition } from "remotion";
import { PromoVideo } from "./PromoVideo";

const defaults = {
  organizationName: "Your Organization", tagline: "Together, we make a difference", websiteUrl: "", qrPath: "",
  primaryColor: "#2563eb", secondaryColor: "#7c3aed", backgroundColor: "#0b1020",
  cause: "community", style: "news", logoPath: "",
  scenes: [{ id: "intro", narration: "Introducing your organization.", caption: "ORGANIZATION SPOTLIGHT", durationInFrames: 90, audioPath: "", mediaPath: "", subline: null, footnote: "" }],
};

export const RemotionRoot = () => <Composition id="PromoVideo" component={PromoVideo} defaultProps={defaults} fps={30} width={1280} height={720}
  calculateMetadata={({ props }) => ({
    durationInFrames: Math.max(90, (props.scenes || defaults.scenes).reduce((sum, scene) => sum + Math.max(45, Number(scene.durationInFrames) || 90), 0)),
  })} />;
