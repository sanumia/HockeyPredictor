import path from "node:path";
import { FeatureRow, StandingsRecord } from "../types/domain";
import { REPORTS_DIR } from "../config/paths";
import { ensureDirForFile } from "../utils/fs";
import { writeFile } from "node:fs/promises";

const FEATURE_LABELS_RU: Record<string, string> = {
  restDaysHome: "Дни отдыха (хозяева)",
  restDaysAway: "Дни отдыха (гости)",
  formLast5Home: "Форма за 5 матчей (хозяева)",
  formLast5Away: "Форма за 5 матчей (гости)",
  shotsForAvgHome: "Броски в створ, ср. (хозяева)",
  shotsForAvgAway: "Броски в створ, ср. (гости)",
  shotsAgainstAvgHome: "Броски против, ср. (хозяева)",
  shotsAgainstAvgAway: "Броски против, ср. (гости)",
  faceoffPctHome: "Вбрасывания %, ср. (хозяева)",
  faceoffPctAway: "Вбрасывания %, ср. (гости)",
  ppPctHome: "Большинство %, ср. (хозяева)",
  ppPctAway: "Большинство %, ср. (гости)",
  goalieSvPctHome: "Сэйвы вратаря %, ср. (хозяева)",
  goalieSvPctAway: "Сэйвы вратаря %, ср. (гости)",
  homeGoals: "Голы хозяев",
  awayGoals: "Голы гостей",
  homeWin: "Победа хозяев"
};

function topTeamsByMatches(rows: FeatureRow[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.homeTeam, (counts.get(row.homeTeam) ?? 0) + 1);
    counts.set(row.awayTeam, (counts.get(row.awayTeam) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([team]) => team);
}

function buildFormSeries(rows: FeatureRow[], teams: string[]): Record<string, number[]> {
  const series: Record<string, number[]> = {};
  for (const team of teams) {
    series[team] = rows
      .filter((r) => r.homeTeam === team)
      .map((r) => Number(r.formLast5Home.toFixed(3)));
  }
  return series;
}

function buildDinamoSummary(rows: FeatureRow[], teamName = "Dinamo Minsk"): {
  team: string;
  matches: number;
  wins: number;
  winRate: number;
  avgGoalsFor: number;
  avgGoalsAgainst: number;
  avgRestDays: number;
  avgForm: number;
  avgShotsFor: number;
  avgPpPct: number;
} {
  const teamRows = rows.filter((r) => r.homeTeam === teamName || r.awayTeam === teamName);
  if (!teamRows.length) {
    return {
      team: teamName,
      matches: 0,
      wins: 0,
      winRate: 0,
      avgGoalsFor: 0,
      avgGoalsAgainst: 0,
      avgRestDays: 0,
      avgForm: 0,
      avgShotsFor: 0,
      avgPpPct: 0
    };
  }

  let wins = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let restDays = 0;
  let form = 0;
  let shotsFor = 0;
  let ppPct = 0;

  for (const row of teamRows) {
    const isHome = row.homeTeam === teamName;
    const teamGoals = isHome ? row.homeGoals : row.awayGoals;
    const oppGoals = isHome ? row.awayGoals : row.homeGoals;
    if (teamGoals > oppGoals) {
      wins += 1;
    }
    goalsFor += teamGoals;
    goalsAgainst += oppGoals;
    restDays += isHome ? row.restDaysHome : row.restDaysAway;
    form += isHome ? row.formLast5Home : row.formLast5Away;
    shotsFor += isHome ? row.shotsForAvgHome : row.shotsForAvgAway;
    ppPct += isHome ? row.ppPctHome : row.ppPctAway;
  }

  const n = teamRows.length;
  return {
    team: teamName,
    matches: n,
    wins,
    winRate: Number(((wins / n) * 100).toFixed(2)),
    avgGoalsFor: Number((goalsFor / n).toFixed(2)),
    avgGoalsAgainst: Number((goalsAgainst / n).toFixed(2)),
    avgRestDays: Number((restDays / n).toFixed(2)),
    avgForm: Number((form / n).toFixed(2)),
    avgShotsFor: Number((shotsFor / n).toFixed(2)),
    avgPpPct: Number((ppPct / n).toFixed(2))
  };
}

function findDinamoInStandings(standings: StandingsRecord[] | undefined): StandingsRecord | undefined {
  if (!standings?.length) {
    return undefined;
  }
  const aliases = ["Динамо Мн", "Dinamo Minsk", "Динамо Минск"];
  return standings.find((row) => aliases.some((alias) => row.team.includes(alias)));
}

function buildDinamoGoalTimeline(rows: FeatureRow[], teamName = "Dinamo Minsk"): {
  labels: string[];
  goalsFor: number[];
  goalsAgainst: number[];
} {
  const teamRows = rows.filter((r) => r.homeTeam === teamName || r.awayTeam === teamName);
  const labels: string[] = [];
  const goalsFor: number[] = [];
  const goalsAgainst: number[] = [];

  teamRows.forEach((row, idx) => {
    const isHome = row.homeTeam === teamName;
    labels.push(`Матч ${idx + 1}`);
    goalsFor.push(isHome ? row.homeGoals : row.awayGoals);
    goalsAgainst.push(isHome ? row.awayGoals : row.homeGoals);
  });

  return { labels, goalsFor, goalsAgainst };
}

export async function generateVisualReport(params: {
  rows: FeatureRow[];
  correlationMatrix: Record<string, Record<string, number>>;
  modelReport: Record<string, unknown>;
  standings?: StandingsRecord[];
}): Promise<string> {
  const { rows, correlationMatrix, modelReport, standings } = params;
  const targetFile = path.join(REPORTS_DIR, "visual-report.html");

  const corrFeatures = Object.keys(correlationMatrix);
  const corrLabelsRu = corrFeatures.map((f) => FEATURE_LABELS_RU[f] ?? f);
  const corrZ = corrFeatures.map((f1) => corrFeatures.map((f2) => correlationMatrix[f1][f2]));

  const homeGoals = rows.map((r) => r.homeGoals);
  const awayGoals = rows.map((r) => r.awayGoals);
  const goalDiff = rows.map((r) => r.homeGoals - r.awayGoals);
  const teams = topTeamsByMatches(rows, 6);
  const formSeries = buildFormSeries(rows, teams);
  const dinamoSummary = buildDinamoSummary(rows);
  const dinamoStandings = findDinamoInStandings(standings);
  const dinamoTimeline = buildDinamoGoalTimeline(rows);

  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HockeyPredictor Визуальный отчет</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #0f172a; color: #e2e8f0; }
    h1, h2 { margin: 8px 0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 10px; padding: 12px; }
    .wide { grid-column: span 2; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .stat-box { background: #0b1220; border: 1px solid #243042; border-radius: 8px; padding: 10px; }
    .stat-label { font-size: 12px; color: #94a3b8; margin-bottom: 6px; }
    .stat-value { font-size: 22px; font-weight: 700; color: #f8fafc; }
    .formula { margin: 8px 0; background: #0b1220; border: 1px solid #243042; border-radius: 8px; padding: 10px; }
    .formula code { color: #e2e8f0; font-size: 14px; }
    #metricsTable table { width: 100%; border-collapse: collapse; }
    #metricsTable th, #metricsTable td { border: 1px solid #243042; padding: 8px; text-align: left; }
    #metricsTable th { background: #0b1220; }
  </style>
</head>
<body>
  <h1>HockeyPredictor: Визуальный отчет</h1>
  <p>EDA-анализ, фокус на Динамо Минск, метрики моделей.</p>

  <div class="grid">
    <div class="card wide">
      <h2>Динамо Минск: ключевая статистика</h2>
      <div id="dinamoSummary" class="stats-grid"></div>
    </div>

    <div class="card wide">
      <h2>Формулы расчета</h2>
      <div class="formula">
        <div><b>Коэффициент корреляции Пирсона:</b></div>
        <code>r = Σ((xᵢ - x̄)(yᵢ - ȳ)) / √(Σ(xᵢ - x̄)² Σ(yᵢ - ȳ)²)</code>
      </div>
      <div class="formula">
        <div><b>Логистическая регрессия (вероятность победы хозяев):</b></div>
        <code>p(homeWin=1|x) = 1 / (1 + e^(-(β₀ + β₁x₁ + ... + βₖxₖ)))</code>
      </div>
      <div class="formula">
        <div><b>Пуассоновская модель голов:</b></div>
        <code>λ(x) = exp(β₀ + β₁x₁ + ... + βₖxₖ),  P(Y=y) = e^-λ * λʸ / y!</code>
      </div>
      <div class="formula">
        <div><b>Метрики:</b></div>
        <code>Accuracy = (TP+TN)/N, LogLoss = -(1/N)Σ[y log(p)+(1-y) log(1-p)], RMSE = √((1/N)Σ(y-ŷ)²)</code>
      </div>
    </div>

    <div class="card wide">
      <h2>Тепловая карта корреляций</h2>
      <div id="corr" style="height: 520px;"></div>
    </div>

    <div class="card">
      <h2>Распределение голов</h2>
      <div id="goalsDist" style="height: 360px;"></div>
    </div>

    <div class="card">
      <h2>Распределение разницы голов</h2>
      <div id="goalDiffDist" style="height: 360px;"></div>
    </div>

    <div class="card wide">
      <h2>Динамика формы команд (средние очки за 5 матчей)</h2>
      <div id="teamForm" style="height: 420px;"></div>
    </div>

    <div class="card wide">
      <h2>Динамо Минск: голы по матчам</h2>
      <div id="dinamoGoals" style="height: 360px;"></div>
    </div>

    <div class="card wide">
      <h2>Метрики моделей</h2>
      <div id="metricsTable"></div>
    </div>
  </div>

  <script>
    const corrFeatures = ${JSON.stringify(corrFeatures)};
    const corrLabelsRu = ${JSON.stringify(corrLabelsRu)};
    const corrZ = ${JSON.stringify(corrZ)};
    const homeGoals = ${JSON.stringify(homeGoals)};
    const awayGoals = ${JSON.stringify(awayGoals)};
    const goalDiff = ${JSON.stringify(goalDiff)};
    const formSeries = ${JSON.stringify(formSeries)};
    const dinamoSummary = ${JSON.stringify(dinamoSummary)};
    const dinamoTimeline = ${JSON.stringify(dinamoTimeline)};
    const dinamoStandings = ${JSON.stringify(dinamoStandings ?? null)};
    const modelReport = ${JSON.stringify(modelReport)};

    const statItems = dinamoStandings
      ? [
          { label: "Место в таблице", value: dinamoStandings.place },
          { label: "Матчей", value: dinamoStandings.games },
          { label: "Побед (в осн. время)", value: dinamoStandings.wins },
          { label: "Побед ОТ/Б", value: (dinamoStandings.winsOt + dinamoStandings.winsSo) },
          { label: "Поражений ОТ/Б", value: (dinamoStandings.lossesOt + dinamoStandings.lossesSo) },
          { label: "Поражений", value: dinamoStandings.losses },
          { label: "Шайбы", value: dinamoStandings.goalsFor + " - " + dinamoStandings.goalsAgainst },
          { label: "Очки", value: dinamoStandings.points }
        ]
      : [
          { label: "Матчей", value: dinamoSummary.matches },
          { label: "Побед", value: dinamoSummary.wins },
          { label: "Процент побед", value: dinamoSummary.winRate + "%" },
          { label: "Ср. голы забитые", value: dinamoSummary.avgGoalsFor },
          { label: "Ср. голы пропущенные", value: dinamoSummary.avgGoalsAgainst },
          { label: "Ср. дни отдыха", value: dinamoSummary.avgRestDays },
          { label: "Ср. форма (5 матчей)", value: dinamoSummary.avgForm },
          { label: "Ср. броски в створ", value: dinamoSummary.avgShotsFor },
          { label: "Ср. большинство, %", value: dinamoSummary.avgPpPct }
        ];

    const statsHtml = statItems
      .map((item) => '<div class="stat-box"><div class="stat-label">' + item.label + '</div><div class="stat-value">' + item.value + '</div></div>')
      .join("");
    document.getElementById("dinamoSummary").innerHTML = statsHtml;

    Plotly.newPlot("corr", [{
      type: "heatmap",
      x: corrLabelsRu,
      y: corrLabelsRu,
      z: corrZ,
      colorscale: "RdBu",
      zmid: 0
    }], {
      paper_bgcolor: "#111827",
      plot_bgcolor: "#111827",
      font: { color: "#e2e8f0" },
      xaxis: { automargin: true, tickangle: -25, tickfont: { size: 11 } },
      yaxis: { automargin: true, tickfont: { size: 11 } },
      margin: { l: 280, r: 20, t: 20, b: 170 }
    });

    Plotly.newPlot("goalsDist", [
      { x: homeGoals, type: "histogram", name: "Голы хозяев", opacity: 0.7 },
      { x: awayGoals, type: "histogram", name: "Голы гостей", opacity: 0.7 }
    ], {
      barmode: "overlay",
      paper_bgcolor: "#111827",
      plot_bgcolor: "#111827",
      font: { color: "#e2e8f0" },
      xaxis: { title: "Количество голов" },
      yaxis: { title: "Частота" },
      margin: { l: 40, r: 20, t: 20, b: 40 }
    });

    Plotly.newPlot("goalDiffDist", [{
      x: goalDiff,
      type: "histogram",
      marker: { color: "#38bdf8" }
    }], {
      paper_bgcolor: "#111827",
      plot_bgcolor: "#111827",
      font: { color: "#e2e8f0" },
      xaxis: { title: "Разница голов (хозяева - гости)" },
      yaxis: { title: "Частота" },
      margin: { l: 40, r: 20, t: 20, b: 40 }
    });

    const traces = Object.entries(formSeries).map(([team, points]) => ({
      y: points,
      mode: "lines+markers",
      name: team
    }));
    Plotly.newPlot("teamForm", traces, {
      paper_bgcolor: "#111827",
      plot_bgcolor: "#111827",
      font: { color: "#e2e8f0" },
      xaxis: { title: "Порядковый номер домашнего матча" },
      yaxis: { title: "Средние очки за последние 5 матчей" },
      margin: { l: 60, r: 20, t: 20, b: 50 }
    });

    Plotly.newPlot("dinamoGoals", [
      { x: dinamoTimeline.labels, y: dinamoTimeline.goalsFor, mode: "lines+markers", name: "Забитые" },
      { x: dinamoTimeline.labels, y: dinamoTimeline.goalsAgainst, mode: "lines+markers", name: "Пропущенные" }
    ], {
      paper_bgcolor: "#111827",
      plot_bgcolor: "#111827",
      font: { color: "#e2e8f0" },
      xaxis: { title: "Матчи Динамо Минск" },
      yaxis: { title: "Количество голов" },
      margin: { l: 60, r: 20, t: 20, b: 70 }
    });

    const classification = modelReport.classification || {};
    const goalsRegression = modelReport.goalsRegression || {};
    const homeGoalsMetrics = goalsRegression.homeGoals || {};
    const awayGoalsMetrics = goalsRegression.awayGoals || {};

    const metricsTableHtml = [
      '<table>',
      '<thead><tr><th>Модель</th><th>Метрика</th><th>Значение</th></tr></thead>',
      '<tbody>',
      '<tr><td>Логистическая</td><td>Accuracy</td><td>' + (classification.accuracy ?? "-") + '</td></tr>',
      '<tr><td>Логистическая</td><td>LogLoss</td><td>' + (classification.logLoss ?? "-") + '</td></tr>',
      '<tr><td>Пуассон (голы хозяев)</td><td>MAE</td><td>' + (homeGoalsMetrics.mae ?? "-") + '</td></tr>',
      '<tr><td>Пуассон (голы хозяев)</td><td>RMSE</td><td>' + (homeGoalsMetrics.rmse ?? "-") + '</td></tr>',
      '<tr><td>Пуассон (голы гостей)</td><td>MAE</td><td>' + (awayGoalsMetrics.mae ?? "-") + '</td></tr>',
      '<tr><td>Пуассон (голы гостей)</td><td>RMSE</td><td>' + (awayGoalsMetrics.rmse ?? "-") + '</td></tr>',
      '</tbody>',
      '</table>'
    ].join("");
    document.getElementById("metricsTable").innerHTML = metricsTableHtml;
  </script>
</body>
</html>`;

  await ensureDirForFile(targetFile);
  await writeFile(targetFile, html, "utf-8");
  return targetFile;
}

