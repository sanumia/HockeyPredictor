export interface RawMatchRecord {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  homeShots: number;
  awayShots: number;
  homeFaceoffPct: number;
  awayFaceoffPct: number;
  homePpPct: number;
  awayPpPct: number;
  homeGoalieSvPct: number;
  awayGoalieSvPct: number;
}

export interface FeatureRow {
  date: string;
  homeTeam: string;
  awayTeam: string;
  isHome: number;
  restDaysHome: number;
  restDaysAway: number;
  formLast5Home: number;
  formLast5Away: number;
  shotsForAvgHome: number;
  shotsForAvgAway: number;
  shotsAgainstAvgHome: number;
  shotsAgainstAvgAway: number;
  faceoffPctHome: number;
  faceoffPctAway: number;
  ppPctHome: number;
  ppPctAway: number;
  goalieSvPctHome: number;
  goalieSvPctAway: number;
  homeGoals: number;
  awayGoals: number;
  homeWin: number;
}

export interface TrainTestSplit<T> {
  train: T[];
  test: T[];
}

export interface StandingsRecord {
  place: number;
  team: string;
  games: number;
  wins: number;
  winsOt: number;
  winsSo: number;
  lossesSo: number;
  lossesOt: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

