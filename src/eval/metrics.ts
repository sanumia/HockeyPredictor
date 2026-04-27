import { clamp } from "../utils/math";

export function accuracy(yTrue: number[], yPred: number[]): number {
  if (!yTrue.length) {
    return 0;
  }
  let correct = 0;
  for (let i = 0; i < yTrue.length; i += 1) {
    if (yTrue[i] === yPred[i]) {
      correct += 1;
    }
  }
  return correct / yTrue.length;
}

export function logLoss(yTrue: number[], probs: number[]): number {
  if (!yTrue.length) {
    return 0;
  }
  let total = 0;
  for (let i = 0; i < yTrue.length; i += 1) {
    const p = clamp(probs[i], 0.0001, 0.9999);
    total += yTrue[i] * Math.log(p) + (1 - yTrue[i]) * Math.log(1 - p);
  }
  return -total / yTrue.length;
}

export function confusionMatrix(yTrue: number[], yPred: number[]): [[number, number], [number, number]] {
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let tp = 0;

  for (let i = 0; i < yTrue.length; i += 1) {
    const actual = yTrue[i];
    const predicted = yPred[i];
    if (actual === 1 && predicted === 1) tp += 1;
    if (actual === 0 && predicted === 1) fp += 1;
    if (actual === 1 && predicted === 0) fn += 1;
    if (actual === 0 && predicted === 0) tn += 1;
  }

  return [
    [tn, fp],
    [fn, tp]
  ];
}

export function mae(yTrue: number[], yPred: number[]): number {
  if (!yTrue.length) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < yTrue.length; i += 1) {
    sum += Math.abs(yTrue[i] - yPred[i]);
  }
  return sum / yTrue.length;
}

export function rmse(yTrue: number[], yPred: number[]): number {
  if (!yTrue.length) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < yTrue.length; i += 1) {
    const err = yTrue[i] - yPred[i];
    sum += err * err;
  }
  return Math.sqrt(sum / yTrue.length);
}

