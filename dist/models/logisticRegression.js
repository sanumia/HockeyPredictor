"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toModelVector = toModelVector;
exports.splitByTime = splitByTime;
exports.trainLogisticRegression = trainLogisticRegression;
const math_1 = require("../utils/math");
const MODEL_FEATURES = [
    "restDaysHome",
    "restDaysAway",
    "formLast5Home",
    "formLast5Away",
    "shotsForAvgHome",
    "shotsForAvgAway",
    "ppPctHome",
    "ppPctAway",
    "goalieSvPctHome",
    "goalieSvPctAway"
];
function toModelVector(row) {
    return MODEL_FEATURES.map((key) => Number(row[key]) || 0);
}
function splitByTime(rows, trainRatio = 0.8) {
    // Time-based split mirrors real forecasting conditions.
    const splitIndex = Math.max(1, Math.floor(rows.length * trainRatio));
    return {
        train: rows.slice(0, splitIndex),
        test: rows.slice(splitIndex)
    };
}
function trainLogisticRegression(rows, epochs = 400, lr = 0.0005) {
    // Simple gradient descent optimization of logistic log-loss.
    const x = (0, math_1.addIntercept)(rows.map(toModelVector));
    const y = rows.map((row) => row.homeWin);
    const weights = new Array(x[0]?.length ?? 0).fill(0);
    for (let epoch = 0; epoch < epochs; epoch += 1) {
        const gradient = new Array(weights.length).fill(0);
        for (let i = 0; i < x.length; i += 1) {
            const pred = (0, math_1.sigmoid)((0, math_1.dot)(weights, x[i]));
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
        predictProba: (features) => {
            const withBias = [1, ...features];
            // Clamp protects log-loss from infinities at p=0 or p=1.
            return (0, math_1.clamp)((0, math_1.sigmoid)((0, math_1.dot)(weights, withBias)), 0.0001, 0.9999);
        }
    };
}
