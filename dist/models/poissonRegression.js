"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trainPoissonGoalsModels = trainPoissonGoalsModels;
const math_1 = require("../utils/math");
const logisticRegression_1 = require("./logisticRegression");
function trainSinglePoisson(features, target, epochs = 500, learningRate = 0.0001) {
    // Poisson GLM: lambda = exp(beta * x), optimized by gradient descent.
    const x = (0, math_1.addIntercept)(features);
    const weights = new Array(x[0]?.length ?? 0).fill(0);
    for (let epoch = 0; epoch < epochs; epoch += 1) {
        const gradient = new Array(weights.length).fill(0);
        for (let i = 0; i < x.length; i += 1) {
            const lambda = Math.exp((0, math_1.dot)(weights, x[i]));
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
        predictLambda: (row) => {
            const lambda = Math.exp((0, math_1.dot)(weights, [1, ...row]));
            // Hard bounds prevent unrealistic predictions on noisy samples.
            return (0, math_1.clamp)(lambda, 0.05, 12);
        }
    };
}
function trainPoissonGoalsModels(rows) {
    const features = rows.map(logisticRegression_1.toModelVector);
    const homeGoals = rows.map((row) => row.homeGoals);
    const awayGoals = rows.map((row) => row.awayGoals);
    return {
        homeGoalsModel: trainSinglePoisson(features, homeGoals),
        awayGoalsModel: trainSinglePoisson(features, awayGoals)
    };
}
