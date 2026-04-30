import { PROCESSED_DATA_PATH } from "../../config/paths";
import { FeatureRow, RawMatchRecord } from "../../types/domain";
import { writeJson } from "../../utils/fs";
import { mean } from "../../utils/math";

interface TeamState {
  lastDate: Date | null;
  goalsFor: number[];
  goalsAgainst: number[];
  shotsFor: number[];
  shotsAgainst: number[];
  faceoffPct: number[];
  ppPct: number[];
  goalieSvPct: number[];
  points: number[];
}

function createEmptyState(): TeamState {
  return {
    lastDate: null,
    goalsFor: [],
    goalsAgainst: [],
    shotsFor: [],
    shotsAgainst: [],
    faceoffPct: [],
    ppPct: [],
    goalieSvPct: [],
    points: []
  };
}

function lastN(values: number[], count: number): number[] {
  return values.slice(Math.max(0, values.length - count));
}

function calculateRestDays(lastDate: Date | null, currentDate: Date): number {
  if (!lastDate) {
    return 5;
  }
  const ms = currentDate.getTime() - lastDate.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}

export async function buildFeatureDataset(rawMatches: RawMatchRecord[]): Promise<FeatureRow[]> {
  // Temporal sort is critical to avoid data leakage from future matches.
  const sorted = [...rawMatches].sort((a, b) => a.date.localeCompare(b.date));
  const teamStates = new Map<string, TeamState>();
  const rows: FeatureRow[] = [];

  const getTeamState = (team: string): TeamState => {
    if (!teamStates.has(team)) {
      teamStates.set(team, createEmptyState());
    }
    return teamStates.get(team)!;
  };

  for (const match of sorted) {
    const homeState = getTeamState(match.homeTeam);
    const awayState = getTeamState(match.awayTeam);
    const matchDate = new Date(match.date);

    const row: FeatureRow = {
      date: match.date,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      isHome: 1,
      restDaysHome: calculateRestDays(homeState.lastDate, matchDate),
      restDaysAway: calculateRestDays(awayState.lastDate, matchDate),
      // Form is represented as rolling average points in the last 5 matches.
      formLast5Home: mean(lastN(homeState.points, 5)),
      formLast5Away: mean(lastN(awayState.points, 5)),
      goalsForAvgHome: mean(lastN(homeState.goalsFor, 10)),
      goalsForAvgAway: mean(lastN(awayState.goalsFor, 10)),
      goalsAgainstAvgHome: mean(lastN(homeState.goalsAgainst, 10)),
      goalsAgainstAvgAway: mean(lastN(awayState.goalsAgainst, 10)),
      // Rate features are rolling means over 10 matches for better stability.
      shotsForAvgHome: mean(lastN(homeState.shotsFor, 10)),
      shotsForAvgAway: mean(lastN(awayState.shotsFor, 10)),
      shotsAgainstAvgHome: mean(lastN(homeState.shotsAgainst, 10)),
      shotsAgainstAvgAway: mean(lastN(awayState.shotsAgainst, 10)),
      faceoffPctHome: mean(lastN(homeState.faceoffPct, 10)),
      faceoffPctAway: mean(lastN(awayState.faceoffPct, 10)),
      ppPctHome: mean(lastN(homeState.ppPct, 10)),
      ppPctAway: mean(lastN(awayState.ppPct, 10)),
      goalieSvPctHome: mean(lastN(homeState.goalieSvPct, 10)),
      goalieSvPctAway: mean(lastN(awayState.goalieSvPct, 10)),
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      // Binary target for logistic regression.
      homeWin: match.homeGoals > match.awayGoals ? 1 : 0
    };
    rows.push(row);

    // In this project setup we use 2 points for a win.
    const homePoints = match.homeGoals > match.awayGoals ? 2 : 0;
    const awayPoints = match.awayGoals > match.homeGoals ? 2 : 0;

    homeState.lastDate = matchDate;
    awayState.lastDate = matchDate;

    homeState.goalsFor.push(match.homeGoals);
    homeState.goalsAgainst.push(match.awayGoals);
    homeState.shotsFor.push(match.homeShots);
    homeState.shotsAgainst.push(match.awayShots);
    homeState.faceoffPct.push(match.homeFaceoffPct);
    homeState.ppPct.push(match.homePpPct);
    homeState.goalieSvPct.push(match.homeGoalieSvPct);
    homeState.points.push(homePoints);

    awayState.goalsFor.push(match.awayGoals);
    awayState.goalsAgainst.push(match.homeGoals);
    awayState.shotsFor.push(match.awayShots);
    awayState.shotsAgainst.push(match.homeShots);
    awayState.faceoffPct.push(match.awayFaceoffPct);
    awayState.ppPct.push(match.awayPpPct);
    awayState.goalieSvPct.push(match.awayGoalieSvPct);
    awayState.points.push(awayPoints);
  }

  const warmupTrim = Math.min(2, Math.floor(rows.length / 3));
  const readyRows = rows.slice(Math.min(warmupTrim, rows.length));
  await writeJson(PROCESSED_DATA_PATH, readyRows);
  return readyRows;
}

