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
  homePoints: number[];
  awayPoints: number[];
  results: number[];
  goalDiff: number[];
  elo: number;
}

const DINAMO_TEAM = "Динамо-Минск";

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
    points: [],
    homePoints: [],
    awayPoints: [],
    results: [],
    goalDiff: [],
    elo: 1500
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

function expectedScore(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

function winStreak(values: number[]): number {
  let streak = 0;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] === 1) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
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
    const isDinamoHome = match.homeTeam === DINAMO_TEAM;
    const dinamoState = isDinamoHome ? homeState : awayState;
    const opponentState = isDinamoHome ? awayState : homeState;
    const opponent = isDinamoHome ? match.awayTeam : match.homeTeam;
    const dinamoGoals = isDinamoHome ? match.homeGoals : match.awayGoals;
    const opponentGoals = isDinamoHome ? match.awayGoals : match.homeGoals;
    const dinamoResult = dinamoGoals > opponentGoals ? 1 : 0;
    const opponentResult = 1 - dinamoResult;
    const preEloDinamo = dinamoState.elo;
    const preEloOpp = opponentState.elo;

    const row: FeatureRow = {
      date: match.date,
      // Keep "home*" model fields as the target team (Dinamo) perspective.
      homeTeam: DINAMO_TEAM,
      awayTeam: opponent,
      isHome: isDinamoHome ? 1 : 0,
      restDaysHome: calculateRestDays(dinamoState.lastDate, matchDate),
      restDaysAway: calculateRestDays(opponentState.lastDate, matchDate),
      // Form is represented as rolling average points in the last 5 matches.
      formLast5Home: mean(lastN(dinamoState.points, 5)),
      formLast5Away: mean(lastN(opponentState.points, 5)),
      goalsForAvgHome: mean(lastN(dinamoState.goalsFor, 10)),
      goalsForAvgAway: mean(lastN(opponentState.goalsFor, 10)),
      goalsAgainstAvgHome: mean(lastN(dinamoState.goalsAgainst, 10)),
      goalsAgainstAvgAway: mean(lastN(opponentState.goalsAgainst, 10)),
      // Rate features are rolling means over 10 matches for better stability.
      shotsForAvgHome: mean(lastN(dinamoState.shotsFor, 10)),
      shotsForAvgAway: mean(lastN(opponentState.shotsFor, 10)),
      shotsAgainstAvgHome: mean(lastN(dinamoState.shotsAgainst, 10)),
      shotsAgainstAvgAway: mean(lastN(opponentState.shotsAgainst, 10)),
      faceoffPctHome: mean(lastN(dinamoState.faceoffPct, 10)),
      faceoffPctAway: mean(lastN(opponentState.faceoffPct, 10)),
      ppPctHome: mean(lastN(dinamoState.ppPct, 10)),
      ppPctAway: mean(lastN(opponentState.ppPct, 10)),
      goalieSvPctHome: mean(lastN(dinamoState.goalieSvPct, 10)),
      goalieSvPctAway: mean(lastN(opponentState.goalieSvPct, 10)),
      eloHome: preEloDinamo,
      eloAway: preEloOpp,
      eloDiff: preEloDinamo - preEloOpp,
      opponentStrength: mean(lastN(opponentState.points, 10)),
      rollingGoalDiffHome: mean(lastN(dinamoState.goalDiff, 5)),
      rollingGoalDiffAway: mean(lastN(opponentState.goalDiff, 5)),
      formHomeVenue: mean(lastN(isDinamoHome ? dinamoState.homePoints : dinamoState.awayPoints, 5)),
      formAwayVenue: mean(lastN(isDinamoHome ? opponentState.awayPoints : opponentState.homePoints, 5)),
      winStreakHome: winStreak(dinamoState.results),
      winStreakAway: winStreak(opponentState.results),
      homeGoals: dinamoGoals,
      awayGoals: opponentGoals,
      // Binary target for logistic regression ("1" = Dinamo win).
      homeWin: dinamoResult
    };
    rows.push(row);

    // In this project setup we use 2 points for a win.
    const homePoints = match.homeGoals > match.awayGoals ? 2 : 0;
    const awayPoints = match.awayGoals > match.homeGoals ? 2 : 0;
    const eloK = 24;
    const homeExpected = expectedScore(homeState.elo, awayState.elo);
    const awayExpected = 1 - homeExpected;
    const homeScore = match.homeGoals > match.awayGoals ? 1 : 0;
    const awayScore = 1 - homeScore;

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
    homeState.homePoints.push(homePoints);
    homeState.results.push(homeScore);
    homeState.goalDiff.push(match.homeGoals - match.awayGoals);

    awayState.goalsFor.push(match.awayGoals);
    awayState.goalsAgainst.push(match.homeGoals);
    awayState.shotsFor.push(match.awayShots);
    awayState.shotsAgainst.push(match.homeShots);
    awayState.faceoffPct.push(match.awayFaceoffPct);
    awayState.ppPct.push(match.awayPpPct);
    awayState.goalieSvPct.push(match.awayGoalieSvPct);
    awayState.points.push(awayPoints);
    awayState.awayPoints.push(awayPoints);
    awayState.results.push(awayScore);
    awayState.goalDiff.push(match.awayGoals - match.homeGoals);

    homeState.elo += eloK * (homeScore - homeExpected);
    awayState.elo += eloK * (awayScore - awayExpected);
  }

  const warmupTrim = Math.min(2, Math.floor(rows.length / 3));
  const readyRows = rows.slice(Math.min(warmupTrim, rows.length));
  await writeJson(PROCESSED_DATA_PATH, readyRows);
  return readyRows;
}

