"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const fetchMatches_1 = require("./data/collect/fetchMatches");
const buildDataset_1 = require("./data/clean/buildDataset");
const correlation_1 = require("./eda/correlation");
const metrics_1 = require("./eval/metrics");
const paths_1 = require("./config/paths");
const logisticRegression_1 = require("./models/logisticRegression");
const poissonRegression_1 = require("./models/poissonRegression");
const fs_1 = require("./utils/fs");
const visualReport_1 = require("./eda/visualReport");
async function runPipeline() {
    // 1) Collect and prepare dataset.
    const rawMatches = await (0, fetchMatches_1.collectRawMatches)();
    const featureRows = await (0, buildDataset_1.buildFeatureDataset)(rawMatches);
    const corr = await (0, correlation_1.runCorrelationAnalysis)(featureRows);
    if (featureRows.length < 30) {
        throw new Error("Not enough rows for train/test. Collect more matches.");
    }
    // 2) Train/test split by time.
    const split = (0, logisticRegression_1.splitByTime)(featureRows, 0.8);
    // 3) Classification model for win probability.
    const logistic = (0, logisticRegression_1.trainLogisticRegression)(split.train);
    const clsProb = split.test.map((row) => logistic.predictProba((0, logisticRegression_1.toModelVector)(row)));
    const clsPred = clsProb.map((p) => (p >= 0.5 ? 1 : 0));
    const clsTrue = split.test.map((row) => row.homeWin);
    // 4) Goal count forecasting with Poisson models.
    const poissonModels = (0, poissonRegression_1.trainPoissonGoalsModels)(split.train);
    const predHomeGoals = split.test.map((row) => poissonModels.homeGoalsModel.predictLambda((0, logisticRegression_1.toModelVector)(row)));
    const predAwayGoals = split.test.map((row) => poissonModels.awayGoalsModel.predictLambda((0, logisticRegression_1.toModelVector)(row)));
    const trueHomeGoals = split.test.map((row) => row.homeGoals);
    const trueAwayGoals = split.test.map((row) => row.awayGoals);
    // 5) Save metrics and visual artifacts.
    const report = {
        sampleSizes: {
            rawMatches: rawMatches.length,
            features: featureRows.length,
            train: split.train.length,
            test: split.test.length
        },
        classification: {
            accuracy: Number((0, metrics_1.accuracy)(clsTrue, clsPred).toFixed(4)),
            logLoss: Number((0, metrics_1.logLoss)(clsTrue, clsProb).toFixed(4)),
            confusionMatrix: (0, metrics_1.confusionMatrix)(clsTrue, clsPred)
        },
        goalsRegression: {
            homeGoals: {
                mae: Number((0, metrics_1.mae)(trueHomeGoals, predHomeGoals).toFixed(4)),
                rmse: Number((0, metrics_1.rmse)(trueHomeGoals, predHomeGoals).toFixed(4))
            },
            awayGoals: {
                mae: Number((0, metrics_1.mae)(trueAwayGoals, predAwayGoals).toFixed(4)),
                rmse: Number((0, metrics_1.rmse)(trueAwayGoals, predAwayGoals).toFixed(4))
            }
        },
        artifacts: {
            raw: "data/raw/matches.json",
            processed: "data/processed/features.json",
            correlationMatrix: "reports/correlation-matrix.json"
        }
    };
    await (0, fs_1.writeJson)(node_path_1.default.join(paths_1.REPORTS_DIR, "model-report.json"), report);
    await (0, fs_1.writeJson)(node_path_1.default.join(paths_1.REPORTS_DIR, "model-weights.json"), {
        logisticWeights: logistic.weights,
        poissonHomeWeights: poissonModels.homeGoalsModel.weights,
        poissonAwayWeights: poissonModels.awayGoalsModel.weights
    });
    let standings;
    try {
        standings = await (0, fs_1.readJson)(paths_1.STANDINGS_RAW_PATH);
    }
    catch {
        standings = undefined;
    }
    await (0, visualReport_1.generateVisualReport)({
        rows: featureRows,
        correlationMatrix: corr,
        modelReport: report,
        standings
    });
    console.log("Pipeline finished.");
    console.log("Artifacts:");
    console.log("- data/raw/matches.json");
    console.log("- data/processed/features.json");
    console.log("- reports/correlation-matrix.json");
    console.log("- reports/model-report.json");
    console.log("- reports/model-weights.json");
    console.log("- reports/visual-report.html");
}
runPipeline().catch((error) => {
    console.error("Pipeline failed:", error);
    process.exit(1);
});
