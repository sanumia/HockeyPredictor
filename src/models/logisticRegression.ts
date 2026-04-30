import { FeatureRow, TrainTestSplit } from "../types/domain";
import { addIntercept, clamp, dot, sigmoid } from "../utils/math";

export interface LogisticModel {
  weights: number[];
  predictProba: (features: number[]) => number;
}

const MODEL_FEATURES: Array<keyof FeatureRow> = [
  "isHome",
  "restDaysHome",
  "restDaysAway",
  "formLast5Home",
  "formLast5Away",
  "goalsForAvgHome",
  "goalsForAvgAway",
  "goalsAgainstAvgHome",
  "goalsAgainstAvgAway"
];

export function toModelVector(row: FeatureRow): number[] {
  return MODEL_FEATURES.map((key) => Number(row[key]) || 0);
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
  // Simple gradient descent optimization of logistic log-loss.
  const x = addIntercept(rows.map(toModelVector));
  const y = rows.map((row) => row.homeWin);
  const weights = new Array(x[0]?.length ?? 0).fill(0);

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = new Array(weights.length).fill(0);

    for (let i = 0; i < x.length; i += 1) {
      const pred = sigmoid(dot(weights, x[i]));
      const error = pred - y[i];
      for (let j = 0; j < weights.length; j += 1) {
        gradient[j] += error * x[i][j];
      }
    }

    for (let j = 0; j < weights.length; j += 1) {
      weights[j] -= (lr * gradient[j]) / x.length;
    }
  }

  return {
    weights,
    predictProba: (features: number[]): number => {
      const withBias = [1, ...features];
      // Clamp protects log-loss from infinities at p=0 or p=1.
      return clamp(sigmoid(dot(weights, withBias)), 0.0001, 0.9999);
    }
  };
}

