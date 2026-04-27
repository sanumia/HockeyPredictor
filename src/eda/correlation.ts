import { FeatureRow } from "../types/domain";
import { writeJson } from "../utils/fs";
import { REPORTS_DIR } from "../config/paths";
import path from "node:path";
import { sampleCorrelation } from "simple-statistics";

const EDA_FEATURES: Array<keyof FeatureRow> = [
  "restDaysHome",
  "restDaysAway",
  "formLast5Home",
  "formLast5Away",
  "shotsForAvgHome",
  "shotsForAvgAway",
  "shotsAgainstAvgHome",
  "shotsAgainstAvgAway",
  "faceoffPctHome",
  "faceoffPctAway",
  "ppPctHome",
  "ppPctAway",
  "goalieSvPctHome",
  "goalieSvPctAway",
  "homeGoals",
  "awayGoals",
  "homeWin"
];

function valuesByFeature(rows: FeatureRow[], feature: keyof FeatureRow): number[] {
  return rows.map((row) => Number(row[feature]) || 0);
}

export async function runCorrelationAnalysis(rows: FeatureRow[]): Promise<Record<string, Record<string, number>>> {
  // Pearson correlation matrix to identify strongest linear relationships.
  const matrix: Record<string, Record<string, number>> = {};

  for (const f1 of EDA_FEATURES) {
    matrix[f1] = {};
    for (const f2 of EDA_FEATURES) {
      const values1 = valuesByFeature(rows, f1);
      const values2 = valuesByFeature(rows, f2);
      // For short vectors correlation is unstable, so return 0.
      const corr = values1.length > 2 ? sampleCorrelation(values1, values2) : 0;
      matrix[f1][f2] = Number.isFinite(corr) ? Number(corr.toFixed(4)) : 0;
    }
  }

  await writeJson(path.join(REPORTS_DIR, "correlation-matrix.json"), matrix);
  return matrix;
}

