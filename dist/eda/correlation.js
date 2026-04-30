"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCorrelationAnalysis = runCorrelationAnalysis;
const fs_1 = require("../utils/fs");
const paths_1 = require("../config/paths");
const node_path_1 = __importDefault(require("node:path"));
const simple_statistics_1 = require("simple-statistics");
const EDA_FEATURES = [
    "isHome",
    "restDaysHome",
    "restDaysAway",
    "formLast5Home",
    "formLast5Away",
    "goalsForAvgHome",
    "goalsForAvgAway",
    "goalsAgainstAvgHome",
    "goalsAgainstAvgAway",
    "homeGoals",
    "awayGoals",
    "homeWin"
];
function valuesByFeature(rows, feature) {
    return rows.map((row) => Number(row[feature]) || 0);
}
async function runCorrelationAnalysis(rows) {
    // Pearson correlation matrix to identify strongest linear relationships.
    const matrix = {};
    for (const f1 of EDA_FEATURES) {
        matrix[f1] = {};
        for (const f2 of EDA_FEATURES) {
            const values1 = valuesByFeature(rows, f1);
            const values2 = valuesByFeature(rows, f2);
            // For short vectors correlation is unstable, so return 0.
            const corr = values1.length > 2 ? (0, simple_statistics_1.sampleCorrelation)(values1, values2) : 0;
            matrix[f1][f2] = Number.isFinite(corr) ? Number(corr.toFixed(4)) : 0;
        }
    }
    await (0, fs_1.writeJson)(node_path_1.default.join(paths_1.REPORTS_DIR, "correlation-matrix.json"), matrix);
    return matrix;
}
