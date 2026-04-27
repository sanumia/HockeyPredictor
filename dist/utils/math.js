"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sigmoid = sigmoid;
exports.mean = mean;
exports.clamp = clamp;
exports.addIntercept = addIntercept;
exports.dot = dot;
function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}
function mean(values) {
    if (!values.length) {
        return 0;
    }
    return values.reduce((acc, value) => acc + value, 0) / values.length;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function addIntercept(features) {
    return features.map((row) => [1, ...row]);
}
function dot(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) {
        sum += a[i] * b[i];
    }
    return sum;
}
