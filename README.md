# HockeyPredictor

KHL match prediction project on `Node.js + TypeScript`.

## What this project does

- Collects match stats from a real source page (`hcdinamo.by`) with fallback synthetic generation.
- Builds a pre-match feature dataset (form, shots, special teams, goalie save %, rest days).
- Runs correlation analysis and saves a correlation matrix.
- Trains:
  - Logistic regression for match result (`homeWin` probability)
  - Poisson regression for goals (`homeGoals`, `awayGoals`)
- Evaluates quality with standard metrics (accuracy, confusion matrix, log loss, MAE, RMSE).

## Install

```bash
npm install
```

## Run full pipeline

```bash
npm run dev
```

or build + run:

```bash
npm run build
npm start
```

## Output artifacts

- `data/raw/matches.json` - collected raw matches
- `data/processed/features.json` - engineered dataset
- `reports/correlation-matrix.json` - correlation matrix
- `reports/model-report.json` - metrics report
- `reports/model-weights.json` - model coefficients
- `reports/visual-report.html` - interactive charts report (open in browser)

## Project structure

- `src/data/collect` - scraping and collection
- `src/data/clean` - feature engineering
- `src/eda` - exploratory analysis and correlations
- `src/models` - logistic and Poisson models
- `src/eval` - metrics
- `src/pipeline.ts` - end-to-end runner
