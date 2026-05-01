import path from "node:path";
import { collectRawMatches } from "./data/collect/fetchMatches";
import { buildFeatureDataset } from "./data/clean/buildDataset";
import { runCorrelationAnalysis } from "./eda/correlation";
import { accuracy, confusionMatrix, logLoss, mae, rmse } from "./eval/metrics";
import { REPORTS_DIR, STANDINGS_RAW_PATH } from "./config/paths";
import {
  MODEL_FEATURE_NAMES,
  trainLogisticRegression,
  trainLogisticRegressionWithFeatures,
  toModelVector
} from "./models/logisticRegression";
import { trainPoissonGoalsModels, trainPoissonGoalsModelsWithFeatures } from "./models/poissonRegression";
import { readJson, writeJson } from "./utils/fs";
import { generateVisualReport } from "./eda/visualReport";
import { FeatureRow, StandingsRecord } from "./types/domain";
import { sampleCorrelation } from "simple-statistics";

function bestThresholdByTrainSet(yTrue: number[], probs: number[]): number {
  let bestThreshold = 0.5;
  let bestScore = -1;
  for (let t = 0.3; t <= 0.7; t += 0.02) {
    let tp = 0;
    let tn = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < yTrue.length; i += 1) {
      const pred = probs[i] >= t ? 1 : 0;
      const actual = yTrue[i];
      if (actual === 1 && pred === 1) tp += 1;
      if (actual === 0 && pred === 0) tn += 1;
      if (actual === 0 && pred === 1) fp += 1;
      if (actual === 1 && pred === 0) fn += 1;
    }
    const tpr = tp + fn > 0 ? tp / (tp + fn) : 0;
    const tnr = tn + fp > 0 ? tn / (tn + fp) : 0;
    const balancedAccuracy = (tpr + tnr) / 2;
    if (balancedAccuracy > bestScore) {
      bestScore = balancedAccuracy;
      bestThreshold = Number(t.toFixed(2));
    }
  }
  return bestThreshold;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function fitPlattScaler(validationTrue: number[], validationScores: number[]): {
  a: number;
  b: number;
  calibrateFromScore: (score: number) => number;
} {
  let a = 1;
  let b = 0;
  const lr = 0.02;
  const l2 = 0.01;
  for (let epoch = 0; epoch < 2800; epoch += 1) {
    let gradA = 0;
    let gradB = 0;
    for (let i = 0; i < validationTrue.length; i += 1) {
      const s = validationScores[i];
      const pred = sigmoid(a * s + b);
      const err = pred - validationTrue[i];
      gradA += err * s;
      gradB += err;
    }
    gradA += l2 * a;
    gradB += l2 * b;
    a -= (lr * gradA) / validationTrue.length;
    b -= (lr * gradB) / validationTrue.length;
  }
  return {
    a,
    b,
    calibrateFromScore: (score: number) => {
      return Math.min(0.9999, Math.max(0.0001, sigmoid(a * score + b)));
    }
  };
}

function maybeCalibratedProbs(yTrue: number[], scores: number[]): {
  a: number;
  b: number;
  calibrated: number[];
} {
  const rawProb = scores.map((s) => Math.min(0.9999, Math.max(0.0001, sigmoid(s))));
  const rawLoss = logLoss(yTrue, rawProb);
  const platt = fitPlattScaler(yTrue, scores);
  const calibrated = scores.map((s) => platt.calibrateFromScore(s));
  const calibratedLoss = logLoss(yTrue, calibrated);
  if (calibratedLoss <= rawLoss + 0.002) {
    return { a: platt.a, b: platt.b, calibrated };
  }
  return { a: 1, b: 0, calibrated: rawProb };
}

interface WalkForwardFold {
  train: FeatureRow[];
  validation: FeatureRow[];
  test: FeatureRow[];
}

function createWalkForwardFolds(rows: FeatureRow[], minTrain = 30, validationSize = 10, testSize = 8): WalkForwardFold[] {
  const folds: WalkForwardFold[] = [];
  let trainEnd = minTrain;
  while (trainEnd + validationSize + testSize <= rows.length) {
    folds.push({
      train: rows.slice(0, trainEnd),
      validation: rows.slice(trainEnd, trainEnd + validationSize),
      test: rows.slice(trainEnd + validationSize, trainEnd + validationSize + testSize)
    });
    trainEnd += testSize;
  }
  return folds;
}

function poissonGoalPmf(lambda: number, goal: number): number {
  if (goal === 0) {
    return Math.exp(-lambda);
  }
  let factorial = 1;
  for (let i = 2; i <= goal; i += 1) {
    factorial *= i;
  }
  return Math.exp(-lambda) * Math.pow(lambda, goal) / factorial;
}

function poissonHomeWinProb(lambdaHome: number, lambdaAway: number, maxGoals = 10): number {
  let probability = 0;
  for (let hg = 0; hg <= maxGoals; hg += 1) {
    const homeP = poissonGoalPmf(lambdaHome, hg);
    for (let ag = 0; ag <= maxGoals; ag += 1) {
      if (hg > ag) {
        probability += homeP * poissonGoalPmf(lambdaAway, ag);
      }
    }
  }
  return Math.min(0.9999, Math.max(0.0001, probability));
}

function safeCorrelation(a: number[], b: number[]): number {
  if (a.length < 3 || b.length < 3) {
    return 0;
  }
  const corr = sampleCorrelation(a, b);
  return Number.isFinite(corr) ? corr : 0;
}

function correlationPrefilterFeatureIndices(trainRows: FeatureRow[]): {
  selectedIndices: number[];
  targetCorrelationByFeature: Record<string, number>;
} {
  const vectors = trainRows.map(toModelVector);
  const y = trainRows.map((row) => row.homeWin);
  const featureCount = MODEL_FEATURE_NAMES.length;
  const targetCorr: number[] = [];

  for (let j = 0; j < featureCount; j += 1) {
    const col = vectors.map((row) => row[j] ?? 0);
    targetCorr[j] = safeCorrelation(col, y);
  }

  // 1) Keep features with strongest linear relation to target.
  const ranked = targetCorr
    .map((corr, idx) => ({ idx, absCorr: Math.abs(corr) }))
    .sort((a, b) => b.absCorr - a.absCorr);
  const initial = ranked.filter((x) => x.absCorr >= 0.03).slice(0, 10).map((x) => x.idx);
  const base = initial.length ? initial : ranked.slice(0, 6).map((x) => x.idx);

  // 2) Remove highly collinear pairs; keep stronger target-correlation feature.
  const selected: number[] = [];
  for (const idx of base) {
    let isCollinear = false;
    for (const kept of selected) {
      const corr = safeCorrelation(
        vectors.map((row) => row[idx] ?? 0),
        vectors.map((row) => row[kept] ?? 0)
      );
      if (Math.abs(corr) >= 0.85) {
        isCollinear = true;
        break;
      }
    }
    if (!isCollinear) {
      selected.push(idx);
    }
  }

  const targetCorrelationByFeature: Record<string, number> = {};
  MODEL_FEATURE_NAMES.forEach((name, idx) => {
    targetCorrelationByFeature[name] = Number(targetCorr[idx].toFixed(4));
  });

  return {
    selectedIndices: selected.length ? selected.sort((a, b) => a - b) : [0, 2, 3, 9],
    targetCorrelationByFeature
  };
}

function selectFeatureIndicesByValidation(trainRows: FeatureRow[], valRows: FeatureRow[]): number[] {
  const prefiltered = correlationPrefilterFeatureIndices(trainRows).selectedIndices;
  const allIndices = MODEL_FEATURE_NAMES.map((_, idx) => idx);
  const chosen: number[] = [...prefiltered];
  const maxFeatures = Math.min(6, prefiltered.length || allIndices.length);
  const baseModel = trainLogisticRegressionWithFeatures(trainRows, chosen);
  const valTrue = valRows.map((row) => row.homeWin);
  const baseProb = valRows.map((row) => baseModel.predictProba(toModelVector(row)));
  let bestScore = logLoss(valTrue, baseProb);

  while (chosen.length < maxFeatures) {
    let bestCandidate: number | null = null;
    let bestCandidateScore = Number.POSITIVE_INFINITY;
    for (const idx of prefiltered) {
      if (chosen.includes(idx)) {
        continue;
      }
      const candidate = [...chosen, idx];
      const model = trainLogisticRegressionWithFeatures(trainRows, candidate);
      const valProb = valRows.map((row) => model.predictProba(toModelVector(row)));
      const score = logLoss(valTrue, valProb);
      if (score < bestCandidateScore) {
        bestCandidateScore = score;
        bestCandidate = idx;
      }
    }
    if (bestCandidate === null) {
      break;
    }
    if (bestCandidateScore <= bestScore - 0.0035) {
      chosen.push(bestCandidate);
      bestScore = bestCandidateScore;
    } else {
      break;
    }
  }

  return chosen.length ? chosen.sort((a, b) => a - b) : prefiltered;
}

function bestEnsembleWeight(yTrue: number[], logisticProb: number[], poissonProb: number[]): number {
  let bestW = 0.5;
  let bestLoss = Number.POSITIVE_INFINITY;
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const probs = logisticProb.map((p, i) => Math.min(0.98, Math.max(0.02, w * p + (1 - w) * poissonProb[i])));
    const loss = logLoss(yTrue, probs);
    if (loss < bestLoss) {
      bestLoss = loss;
      bestW = Number(w.toFixed(2));
    }
  }
  return bestW;
}

async function runPipeline(): Promise<void> {
  // 1) Collect and prepare dataset.
  const rawMatches = await collectRawMatches();
  const featureRows = await buildFeatureDataset(rawMatches);
  const corr = await runCorrelationAnalysis(featureRows);

  if (featureRows.length < 50) {
    throw new Error("Not enough real matches for walk-forward validation. Need at least 50 finished games.");
  }

  // 2) Walk-forward validation with train -> validation (for calibration) -> test.
  const folds = createWalkForwardFolds(featureRows);
  if (!folds.length) {
    throw new Error("Failed to construct walk-forward folds.");
  }

  const allClsTrue: number[] = [];
  const allClsProb: number[] = [];
  const allClsPred: number[] = [];
  const allTrueHomeGoals: number[] = [];
  const allTrueAwayGoals: number[] = [];
  const allPredHomeGoals: number[] = [];
  const allPredAwayGoals: number[] = [];
  const foldSummaries: Array<{
    train: number;
    validation: number;
    test: number;
    selectedFeatures: string[];
    selectedFeatureCount: number;
    featureTargetCorrelations: Record<string, number>;
    plattA: number;
    plattB: number;
    ensembleWeightLogistic: number;
    threshold: number;
    accuracy: number;
    logLoss: number;
  }> = [];
  const featureSelectionFrequency = new Map<string, number>();
  const foldAccuracies: number[] = [];
  const foldLogLosses: number[] = [];

  for (const fold of folds) {
    const correlationInfo = correlationPrefilterFeatureIndices(fold.train);
    const selectedFeatureIndices = selectFeatureIndicesByValidation(fold.train, fold.validation);
    const selectedFeatures = selectedFeatureIndices.map((idx) => MODEL_FEATURE_NAMES[idx]);
    selectedFeatures.forEach((name) => {
      featureSelectionFrequency.set(name, (featureSelectionFrequency.get(name) ?? 0) + 1);
    });

    const logistic = trainLogisticRegressionWithFeatures(fold.train, selectedFeatureIndices);
    const valScores = fold.validation.map((row) => logistic.predictScore(toModelVector(row)));
    const valTrue = fold.validation.map((row) => row.homeWin);
    const calibration = maybeCalibratedProbs(valTrue, valScores);
    const calibratedValProbs = calibration.calibrated;
    const poissonModels = trainPoissonGoalsModelsWithFeatures(fold.train, selectedFeatureIndices);
    const valPoissonProb = fold.validation.map((row) => {
      const vector = toModelVector(row);
      const lambdaHome = poissonModels.homeGoalsModel.predictLambda(vector);
      const lambdaAway = poissonModels.awayGoalsModel.predictLambda(vector);
      return poissonHomeWinProb(lambdaHome, lambdaAway);
    });
    const ensembleWeight = bestEnsembleWeight(valTrue, calibratedValProbs, valPoissonProb);
    const blendedValProbs = calibratedValProbs.map((p, i) => ensembleWeight * p + (1 - ensembleWeight) * valPoissonProb[i]);
    const threshold = bestThresholdByTrainSet(valTrue, blendedValProbs);

    const testProbs = fold.test.map((row) => {
      const vector = toModelVector(row);
      const logisticScore = logistic.predictScore(vector);
      const logisticProb = Math.min(0.9999, Math.max(0.0001, sigmoid(calibration.a * logisticScore + calibration.b)));
      const lambdaHome = poissonModels.homeGoalsModel.predictLambda(vector);
      const lambdaAway = poissonModels.awayGoalsModel.predictLambda(vector);
      const poissonProb = poissonHomeWinProb(lambdaHome, lambdaAway);
      return Math.min(0.98, Math.max(0.02, ensembleWeight * logisticProb + (1 - ensembleWeight) * poissonProb));
    });
    const testTrue = fold.test.map((row) => row.homeWin);
    const testPred = testProbs.map((p) => (p >= threshold ? 1 : 0));

    allClsTrue.push(...testTrue);
    allClsProb.push(...testProbs);
    allClsPred.push(...testPred);
    foldSummaries.push({
      train: fold.train.length,
      validation: fold.validation.length,
      test: fold.test.length,
      selectedFeatures,
      selectedFeatureCount: selectedFeatures.length,
      featureTargetCorrelations: Object.fromEntries(
        selectedFeatures.map((name) => [name, correlationInfo.targetCorrelationByFeature[name]])
      ),
      plattA: Number(calibration.a.toFixed(4)),
      plattB: Number(calibration.b.toFixed(4)),
      ensembleWeightLogistic: ensembleWeight,
      threshold,
      accuracy: Number(accuracy(testTrue, testPred).toFixed(4)),
      logLoss: Number(logLoss(testTrue, testProbs).toFixed(4))
    });
    foldAccuracies.push(accuracy(testTrue, testPred));
    foldLogLosses.push(logLoss(testTrue, testProbs));

    const predHomeGoals = fold.test.map((row) => poissonModels.homeGoalsModel.predictLambda(toModelVector(row)));
    const predAwayGoals = fold.test.map((row) => poissonModels.awayGoalsModel.predictLambda(toModelVector(row)));
    const trueHomeGoals = fold.test.map((row) => row.homeGoals);
    const trueAwayGoals = fold.test.map((row) => row.awayGoals);

    allTrueHomeGoals.push(...trueHomeGoals);
    allTrueAwayGoals.push(...trueAwayGoals);
    allPredHomeGoals.push(...predHomeGoals);
    allPredAwayGoals.push(...predAwayGoals);
  }

  const sortedFeatureCounts = [...featureSelectionFrequency.entries()].sort((a, b) => b[1] - a[1]);
  const finalFeatureIndices = sortedFeatureCounts
    .slice(0, Math.min(8, sortedFeatureCounts.length))
    .map(([name]) => MODEL_FEATURE_NAMES.indexOf(name as (typeof MODEL_FEATURE_NAMES)[number]))
    .filter((idx) => idx >= 0);

  const finalLogistic =
    finalFeatureIndices.length > 0
      ? trainLogisticRegressionWithFeatures(featureRows, finalFeatureIndices)
      : trainLogisticRegression(featureRows);
  const finalPoissonModels =
    finalFeatureIndices.length > 0
      ? trainPoissonGoalsModelsWithFeatures(featureRows, finalFeatureIndices)
      : trainPoissonGoalsModels(featureRows);

  // 5) Save metrics and visual artifacts.
  const report = {
    sampleSizes: {
      rawMatches: rawMatches.length,
      features: featureRows.length,
      folds: folds.length,
      walkForwardTestSamples: allClsTrue.length
    },
    classification: {
      accuracy: Number(accuracy(allClsTrue, allClsPred).toFixed(4)),
      logLoss: Number(logLoss(allClsTrue, allClsProb).toFixed(4)),
      confusionMatrix: confusionMatrix(allClsTrue, allClsPred)
    },
    aggregationPolicy: {
      pooled: {
        description: "Metrics on concatenated predictions from all fold test windows",
        accuracy: Number(accuracy(allClsTrue, allClsPred).toFixed(4)),
        logLoss: Number(logLoss(allClsTrue, allClsProb).toFixed(4))
      },
      macro: {
        description: "Unweighted mean of per-fold metrics",
        accuracy: Number((foldAccuracies.reduce((a, b) => a + b, 0) / foldAccuracies.length).toFixed(4)),
        logLoss: Number((foldLogLosses.reduce((a, b) => a + b, 0) / foldLogLosses.length).toFixed(4))
      }
    },
    walkForward: {
      minTrain: 30,
      validation: 10,
      test: 8,
      folds: foldSummaries
    },
    modelingDetails: {
      targetVariable: "homeWin (1 = Dinamo Minsk win, 0 = Dinamo Minsk loss)",
      calibrationInput: "Raw logistic decision score s = beta0 + beta'x (Platt uses sigmoid(a*s + b))",
      ensemble: "p = w * p_logistic_calibrated + (1 - w) * p_poisson",
      poissonWinProbability:
        "p_poisson = sum_{hg>ag} Pois(hg; lambda_home) * Pois(ag; lambda_away), hg/ag in [0..10]",
      featureSelectionRule:
        "1) prefilter by |corr(feature, target)| on train; 2) drop collinear pairs |corr|>=0.85; 3) validation refinement",
      logisticFeaturePool: MODEL_FEATURE_NAMES,
      featureSelectionFrequency: Object.fromEntries(sortedFeatureCounts),
      finalSelectedFeatures:
        finalFeatureIndices.length > 0 ? finalFeatureIndices.map((idx) => MODEL_FEATURE_NAMES[idx]) : MODEL_FEATURE_NAMES
    },
    goalsRegression: {
      homeGoals: {
        mae: Number(mae(allTrueHomeGoals, allPredHomeGoals).toFixed(4)),
        rmse: Number(rmse(allTrueHomeGoals, allPredHomeGoals).toFixed(4))
      },
      awayGoals: {
        mae: Number(mae(allTrueAwayGoals, allPredAwayGoals).toFixed(4)),
        rmse: Number(rmse(allTrueAwayGoals, allPredAwayGoals).toFixed(4))
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
    logisticWeights: finalLogistic.weights,
    poissonHomeWeights: finalPoissonModels.homeGoalsModel.weights,
    poissonAwayWeights: finalPoissonModels.awayGoalsModel.weights
  });
  let standings: StandingsRecord[] | undefined;
  try {
    standings = await readJson<StandingsRecord[]>(STANDINGS_RAW_PATH);
  } catch {
    standings = undefined;
  }
  const dinamoExpectedVsReal = featureRows
    .filter((row) => row.homeTeam.includes("Динамо") || row.awayTeam.includes("Динамо"))
    .map((row, idx) => {
      const vector = toModelVector(row);
      const isDinamoHome = row.homeTeam.includes("Динамо");
      const expectedGoals = isDinamoHome
        ? finalPoissonModels.homeGoalsModel.predictLambda(vector)
        : finalPoissonModels.awayGoalsModel.predictLambda(vector);
      const realGoals = isDinamoHome ? row.homeGoals : row.awayGoals;
      const opponent = isDinamoHome ? row.awayTeam : row.homeTeam;
      return {
        label: `Матч ${idx + 1}`,
        date: row.date,
        opponent,
        expectedGoals: Number(expectedGoals.toFixed(2)),
        realGoals
      };
    });

  await generateVisualReport({
    rows: featureRows,
    correlationMatrix: corr,
    modelReport: report,
    standings,
    dinamoExpectedVsReal
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

