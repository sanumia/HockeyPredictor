import { FeatureRow, TrainTestSplit } from "../types/domain";
import { addIntercept, clamp, dot, sigmoid } from "../utils/math";

export interface LogisticModel {
  weights: number[];
  featureIndices: number[];
  predictScore: (features: number[]) => number;
  predictProba: (features: number[]) => number;
}

export const MODEL_FEATURE_NAMES = [
  "isHome",
  "restDiff",
  "formDiff",
  "attackDiff",
  "defenseDiff",
  "goalsForAvgHome",
  "goalsAgainstAvgHome",
  "goalsForAvgAway",
  "goalsAgainstAvgAway",
  "eloDiff",
  "opponentStrength",
  "rollingGoalDiffDelta",
  "venueFormDelta",
  "winStreakDelta"
] as const;

export function toModelVector(row: FeatureRow): number[] {
  const restDiff = row.restDaysHome - row.restDaysAway;
  const formDiff = row.formLast5Home - row.formLast5Away;
  const attackDiff = row.goalsForAvgHome - row.goalsForAvgAway;
  const defenseDiff = row.goalsAgainstAvgAway - row.goalsAgainstAvgHome;
  return [
    row.isHome,
    restDiff,
    formDiff,
    attackDiff,
    defenseDiff,
    row.goalsForAvgHome,
    row.goalsAgainstAvgHome,
    row.goalsForAvgAway,
    row.goalsAgainstAvgAway,
    row.eloDiff,
    row.opponentStrength,
    row.rollingGoalDiffHome - row.rollingGoalDiffAway,
    row.formHomeVenue - row.formAwayVenue,
    row.winStreakHome - row.winStreakAway
  ];
}

function selectFeatures(features: number[], indices: number[]): number[] {
  return indices.map((idx) => features[idx] ?? 0);
}

export function splitByTime<T>(rows: T[], trainRatio = 0.8): TrainTestSplit<T> {
  // Time-based split mirrors real forecasting conditions.
  const splitIndex = Math.max(1, Math.floor(rows.length * trainRatio));
  return {
    train: rows.slice(0, splitIndex),
    test: rows.slice(splitIndex)
  };
}

export function trainLogisticRegression(rows: FeatureRow[], epochs = 400, lr = 0.0005): LogisticModel {
  // Standardization helps gradient descent converge on heterogeneous hockey features.
  const fullX = rows.map(toModelVector);
  const defaultIndices = fullX[0] ? fullX[0].map((_, idx) => idx) : [];
  const featureIndices = defaultIndices;
  const rawX = fullX.map((row) => selectFeatures(row, featureIndices));
  const featureCount = rawX[0]?.length ?? 0;
  const means = new Array(featureCount).fill(0);
  const stds = new Array(featureCount).fill(1);
  for (let j = 0; j < featureCount; j += 1) {
    let sum = 0;
    for (let i = 0; i < rawX.length; i += 1) {
      sum += rawX[i][j];
    }
    const mean = rawX.length ? sum / rawX.length : 0;
    means[j] = mean;
    let varianceSum = 0;
    for (let i = 0; i < rawX.length; i += 1) {
      const diff = rawX[i][j] - mean;
      varianceSum += diff * diff;
    }
    const std = Math.sqrt(rawX.length ? varianceSum / rawX.length : 1);
    stds[j] = std > 1e-8 ? std : 1;
  }
  const xScaled = rawX.map((row) => row.map((value, j) => (value - means[j]) / stds[j]));
  const x = addIntercept(xScaled);
  const y = rows.map((row) => row.homeWin);
  const weights = new Array(x[0]?.length ?? 0).fill(0);
  const l2 = 0.01;

  for (let epoch = 0; epoch < Math.max(epochs, 2200); epoch += 1) {
    const gradient = new Array(weights.length).fill(0);

    for (let i = 0; i < x.length; i += 1) {
      const pred = sigmoid(dot(weights, x[i]));
      const error = pred - y[i];
      for (let j = 0; j < weights.length; j += 1) {
        gradient[j] += error * x[i][j];
      }
    }

    for (let j = 0; j < weights.length; j += 1) {
      // Do not regularize intercept term.
      const regularization = j === 0 ? 0 : l2 * weights[j];
      weights[j] -= (Math.max(lr, 0.01) * (gradient[j] + regularization)) / x.length;
    }
  }

  return {
    weights,
    featureIndices,
    predictScore: (features: number[]): number => {
      const selected = selectFeatures(features, featureIndices);
      const scaled = selected.map((value, j) => (value - means[j]) / stds[j]);
      return dot(weights, [1, ...scaled]);
    },
    predictProba: (features: number[]): number => {
      const selected = selectFeatures(features, featureIndices);
      const scaled = selected.map((value, j) => (value - means[j]) / stds[j]);
      const withBias = [1, ...scaled];
      // Clamp protects log-loss from infinities at p=0 or p=1.
      return clamp(sigmoid(dot(weights, withBias)), 0.0001, 0.9999);
    }
  };
}

export function trainLogisticRegressionWithFeatures(
  rows: FeatureRow[],
  featureIndices: number[],
  epochs = 400,
  lr = 0.0005
): LogisticModel {
  const normalizedIndices = [...featureIndices].sort((a, b) => a - b);
  const fullX = rows.map(toModelVector);
  const rawX = fullX.map((row) => selectFeatures(row, normalizedIndices));
  const featureCount = rawX[0]?.length ?? 0;
  const means = new Array(featureCount).fill(0);
  const stds = new Array(featureCount).fill(1);

  for (let j = 0; j < featureCount; j += 1) {
    let sum = 0;
    for (let i = 0; i < rawX.length; i += 1) {
      sum += rawX[i][j];
    }
    const mean = rawX.length ? sum / rawX.length : 0;
    means[j] = mean;
    let varianceSum = 0;
    for (let i = 0; i < rawX.length; i += 1) {
      const diff = rawX[i][j] - mean;
      varianceSum += diff * diff;
    }
    const std = Math.sqrt(rawX.length ? varianceSum / rawX.length : 1);
    stds[j] = std > 1e-8 ? std : 1;
  }

  const xScaled = rawX.map((row) => row.map((value, j) => (value - means[j]) / stds[j]));
  const x = addIntercept(xScaled);
  const y = rows.map((row) => row.homeWin);
  const weights = new Array(x[0]?.length ?? 0).fill(0);
  const l2 = 0.01;

  for (let epoch = 0; epoch < Math.max(epochs, 2200); epoch += 1) {
    const gradient = new Array(weights.length).fill(0);

    for (let i = 0; i < x.length; i += 1) {
      const pred = sigmoid(dot(weights, x[i]));
      const error = pred - y[i];
      for (let j = 0; j < weights.length; j += 1) {
        gradient[j] += error * x[i][j];
      }
    }

    for (let j = 0; j < weights.length; j += 1) {
      const regularization = j === 0 ? 0 : l2 * weights[j];
      weights[j] -= (Math.max(lr, 0.01) * (gradient[j] + regularization)) / x.length;
    }
  }

  return {
    weights,
    featureIndices: normalizedIndices,
    predictScore: (features: number[]): number => {
      const selected = selectFeatures(features, normalizedIndices);
      const scaled = selected.map((value, j) => (value - means[j]) / stds[j]);
      return dot(weights, [1, ...scaled]);
    },
    predictProba: (features: number[]): number => {
      const selected = selectFeatures(features, normalizedIndices);
      const scaled = selected.map((value, j) => (value - means[j]) / stds[j]);
      const withBias = [1, ...scaled];
      return clamp(sigmoid(dot(weights, withBias)), 0.0001, 0.9999);
    }
  };
}

