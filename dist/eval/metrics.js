"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accuracy = accuracy;
exports.logLoss = logLoss;
exports.confusionMatrix = confusionMatrix;
exports.mae = mae;
exports.rmse = rmse;
const math_1 = require("../utils/math");
function accuracy(yTrue, yPred) {
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
function logLoss(yTrue, probs) {
    if (!yTrue.length) {
        return 0;
    }
    let total = 0;
    for (let i = 0; i < yTrue.length; i += 1) {
        const p = (0, math_1.clamp)(probs[i], 0.0001, 0.9999);
        total += yTrue[i] * Math.log(p) + (1 - yTrue[i]) * Math.log(1 - p);
    }
    return -total / yTrue.length;
}
function confusionMatrix(yTrue, yPred) {
    let tn = 0;
    let fp = 0;
    let fn = 0;
    let tp = 0;
    for (let i = 0; i < yTrue.length; i += 1) {
        const actual = yTrue[i];
        const predicted = yPred[i];
        if (actual === 1 && predicted === 1)
            tp += 1;
        if (actual === 0 && predicted === 1)
            fp += 1;
        if (actual === 1 && predicted === 0)
            fn += 1;
        if (actual === 0 && predicted === 0)
            tn += 1;
    }
    return [
        [tn, fp],
        [fn, tp]
    ];
}
function mae(yTrue, yPred) {
    if (!yTrue.length) {
        return 0;
    }
    let sum = 0;
    for (let i = 0; i < yTrue.length; i += 1) {
        sum += Math.abs(yTrue[i] - yPred[i]);
    }
    return sum / yTrue.length;
}
function rmse(yTrue, yPred) {
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
