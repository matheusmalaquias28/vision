import React from "react";
import { Composition } from "remotion";
import { outputDuration, type Recipe } from "@vision/recipe";
import { VisionComposition } from "./VisionComposition";
import { placeholderRecipe } from "./placeholder";

export const COMPOSITION_ID = "Vision";

export function recipeMetadata(recipe: Recipe) {
  return {
    durationInFrames: Math.max(
      1,
      Math.round(outputDuration(recipe.timeline.segments) * recipe.render.fps)
    ),
    fps: recipe.render.fps,
    width: recipe.render.width,
    height: recipe.render.height,
  };
}

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={VisionComposition}
      defaultProps={{ recipe: placeholderRecipe }}
      calculateMetadata={({ props }) => recipeMetadata(props.recipe)}
      durationInFrames={30}
      fps={30}
      width={1080}
      height={1920}
    />
  );
};
