import { FeatureRow } from "../types/domain";
import { addIntercept, clamp, dot } from "../utils/math";
import { toModelVector } from "./logisticRegression";

export interface PoissonModel {
  weights: number[];
  featureIndices: number[];
  predictLambda: (features: number[]) => number;
}

function trainSinglePoisson(
  features: number[][],
  target: number[],
  epochs = 500,
  learningRate = 0.0001
): PoissonModel {
  // Poisson GLM: lambda = exp(beta * x), optimized by gradient descent.
  const featureCount = features[0]?.length ?? 0;
  const means = new Array(featureCount).fill(0);
  const stds = new Array(featureCount).fill(1);
  for (let j = 0; j < featureCount; j += 1) {
    let sum = 0;
    for (let i = 0; i < features.length; i += 1) {
      sum += features[i][j];
    }
    const mean = features.length ? sum / features.length : 0;
    means[j] = mean;
    let varianceSum = 0;
    for (let i = 0; i < features.length; i += 1) {
      const diff = features[i][j] - mean;
      varianceSum += diff * diff;
    }
    const std = Math.sqrt(features.length ? varianceSum / features.length : 1);
    stds[j] = std > 1e-8 ? std : 1;
  }
  const scaled = features.map((row) => row.map((value, j) => (value - means[j]) / stds[j]));
  const x = addIntercept(scaled);
  const weights = new Array(x[0]?.length ?? 0).fill(0);
  const l2 = 0.01;

  for (let epoch = 0; epoch < Math.max(epochs, 2000); epoch += 1) {
    const gradient = new Array(weights.length).fill(0);

    for (let i = 0; i < x.length; i += 1) {
      const lambda = Math.exp(clamp(dot(weights, x[i]), -8, 8));
      const error = lambda - target[i];
      for (let j = 0; j < weights.length; j += 1) {
        gradient[j] += error * x[i][j];
      }
    }

    for (let j = 0; j < weights.length; j += 1) {
      const regularization = j === 0 ? 0 : l2 * weights[j];
      weights[j] -= (Math.max(learningRate, 0.003) * (gradient[j] + regularization)) / x.length;
    }
  }

  return {
    weights,
    featureIndices: features[0] ? features[0].map((_, idx) => idx) : [],
    predictLambda: (row: number[]): number => {
      const rowScaled = row.map((value, j) => (value - means[j]) / stds[j]);
      const lambda = Math.exp(clamp(dot(weights, [1, ...rowScaled]), -8, 8));
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

export function trainPoissonGoalsModelsWithFeatures(
  rows: FeatureRow[],
  featureIndices: number[]
): {
  homeGoalsModel: PoissonModel;
  awayGoalsModel: PoissonModel;
} {
  const indices = [...featureIndices].sort((a, b) => a - b);
  const fullFeatures = rows.map(toModelVector);
  const features = fullFeatures.map((row) => indices.map((idx) => row[idx] ?? 0));
  const homeGoals = rows.map((row) => row.homeGoals);
  const awayGoals = rows.map((row) => row.awayGoals);

  const homeModel = trainSinglePoisson(features, homeGoals);
  const awayModel = trainSinglePoisson(features, awayGoals);

  return {
    homeGoalsModel: {
      ...homeModel,
      featureIndices: indices,
      predictLambda: (fullRow: number[]) => {
        const selected = indices.map((idx) => fullRow[idx] ?? 0);
        return homeModel.predictLambda(selected);
      }
    },
    awayGoalsModel: {
      ...awayModel,
      featureIndices: indices,
      predictLambda: (fullRow: number[]) => {
        const selected = indices.map((idx) => fullRow[idx] ?? 0);
        return awayModel.predictLambda(selected);
      }
    }
  };
}

