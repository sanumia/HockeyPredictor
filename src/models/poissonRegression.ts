import { FeatureRow } from "../types/domain";
import { addIntercept, clamp, dot } from "../utils/math";
import { toModelVector } from "./logisticRegression";

export interface PoissonModel {
  weights: number[];
  predictLambda: (features: number[]) => number;
}

function trainSinglePoisson(
  features: number[][],
  target: number[],
  epochs = 500,
  learningRate = 0.0001
): PoissonModel {
  // Poisson GLM: lambda = exp(beta * x), optimized by gradient descent.
  const x = addIntercept(features);
  const weights = new Array(x[0]?.length ?? 0).fill(0);

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = new Array(weights.length).fill(0);

    for (let i = 0; i < x.length; i += 1) {
      const lambda = Math.exp(dot(weights, x[i]));
      const error = lambda - target[i];
      for (let j = 0; j < weights.length; j += 1) {
        gradient[j] += error * x[i][j];
      }
    }

    for (let j = 0; j < weights.length; j += 1) {
      weights[j] -= (learningRate * gradient[j]) / x.length;
    }
  }

  return {
    weights,
    predictLambda: (row: number[]): number => {
      const lambda = Math.exp(dot(weights, [1, ...row]));
      // Hard bounds prevent unrealistic predictions on noisy samples.
      return clamp(lambda, 0.05, 12);
    }
  };
}

export function trainPoissonGoalsModels(rows: FeatureRow[]): {
  homeGoalsModel: PoissonModel;
  awayGoalsModel: PoissonModel;
} {
  const features = rows.map(toModelVector);
  const homeGoals = rows.map((row) => row.homeGoals);
  const awayGoals = rows.map((row) => row.awayGoals);

  return {
    homeGoalsModel: trainSinglePoisson(features, homeGoals),
    awayGoalsModel: trainSinglePoisson(features, awayGoals)
  };
}

