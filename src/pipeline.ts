import path from "node:path";
import { collectRawMatches } from "./data/collect/fetchMatches";
import { buildFeatureDataset } from "./data/clean/buildDataset";
import { runCorrelationAnalysis } from "./eda/correlation";
import { accuracy, confusionMatrix, logLoss, mae, rmse } from "./eval/metrics";
import { REPORTS_DIR, STANDINGS_RAW_PATH } from "./config/paths";
import { trainLogisticRegression, splitByTime, toModelVector } from "./models/logisticRegression";
import { trainPoissonGoalsModels } from "./models/poissonRegression";
import { readJson, writeJson } from "./utils/fs";
import { generateVisualReport } from "./eda/visualReport";
import { StandingsRecord } from "./types/domain";

async function runPipeline(): Promise<void> {
  // 1) Collect and prepare dataset.
  const rawMatches = await collectRawMatches();
  const featureRows = await buildFeatureDataset(rawMatches);
  const corr = await runCorrelationAnalysis(featureRows);

  if (featureRows.length < 30) {
    throw new Error("Not enough rows for train/test. Collect more matches.");
  }

  // 2) Train/test split by time.
  const split = splitByTime(featureRows, 0.8);

  // 3) Classification model for win probability.
  const logistic = trainLogisticRegression(split.train);
  const clsProb = split.test.map((row) => logistic.predictProba(toModelVector(row)));
  const clsPred = clsProb.map((p) => (p >= 0.5 ? 1 : 0));
  const clsTrue = split.test.map((row) => row.homeWin);

  // 4) Goal count forecasting with Poisson models.
  const poissonModels = trainPoissonGoalsModels(split.train);
  const predHomeGoals = split.test.map((row) => poissonModels.homeGoalsModel.predictLambda(toModelVector(row)));
  const predAwayGoals = split.test.map((row) => poissonModels.awayGoalsModel.predictLambda(toModelVector(row)));

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
      accuracy: Number(accuracy(clsTrue, clsPred).toFixed(4)),
      logLoss: Number(logLoss(clsTrue, clsProb).toFixed(4)),
      confusionMatrix: confusionMatrix(clsTrue, clsPred)
    },
    goalsRegression: {
      homeGoals: {
        mae: Number(mae(trueHomeGoals, predHomeGoals).toFixed(4)),
        rmse: Number(rmse(trueHomeGoals, predHomeGoals).toFixed(4))
      },
      awayGoals: {
        mae: Number(mae(trueAwayGoals, predAwayGoals).toFixed(4)),
        rmse: Number(rmse(trueAwayGoals, predAwayGoals).toFixed(4))
      }
    },
    artifacts: {
      raw: "data/raw/matches.json",
      processed: "data/processed/features.json",
      correlationMatrix: "reports/correlation-matrix.json"
    }
  };

  await writeJson(path.join(REPORTS_DIR, "model-report.json"), report);
  await writeJson(path.join(REPORTS_DIR, "model-weights.json"), {
    logisticWeights: logistic.weights,
    poissonHomeWeights: poissonModels.homeGoalsModel.weights,
    poissonAwayWeights: poissonModels.awayGoalsModel.weights
  });
  let standings: StandingsRecord[] | undefined;
  try {
    standings = await readJson<StandingsRecord[]>(STANDINGS_RAW_PATH);
  } catch {
    standings = undefined;
  }
  await generateVisualReport({
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

runPipeline().catch((error: unknown) => {
  console.error("Pipeline failed:", error);
  process.exit(1);
});

