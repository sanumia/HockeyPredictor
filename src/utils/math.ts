export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function mean(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function addIntercept(features: number[][]): number[][] {
  return features.map((row) => [1, ...row]);
}

export function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

