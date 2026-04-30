"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFeatureDataset = buildFeatureDataset;
const paths_1 = require("../../config/paths");
const fs_1 = require("../../utils/fs");
const math_1 = require("../../utils/math");
function createEmptyState() {
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
function lastN(values, count) {
    return values.slice(Math.max(0, values.length - count));
}
function calculateRestDays(lastDate, currentDate) {
    if (!lastDate) {
        return 5;
    }
    const ms = currentDate.getTime() - lastDate.getTime();
    return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
}
async function buildFeatureDataset(rawMatches) {
    // Temporal sort is critical to avoid data leakage from future matches.
    const sorted = [...rawMatches].sort((a, b) => a.date.localeCompare(b.date));
    const teamStates = new Map();
    const rows = [];
    const getTeamState = (team) => {
        if (!teamStates.has(team)) {
            teamStates.set(team, createEmptyState());
        }
        return teamStates.get(team);
    };
    for (const match of sorted) {
        const homeState = getTeamState(match.homeTeam);
        const awayState = getTeamState(match.awayTeam);
        const matchDate = new Date(match.date);
        const row = {
            date: match.date,
            homeTeam: match.homeTeam,
            awayTeam: match.awayTeam,
            isHome: 1,
            restDaysHome: calculateRestDays(homeState.lastDate, matchDate),
            restDaysAway: calculateRestDays(awayState.lastDate, matchDate),
            // Form is represented as rolling average points in the last 5 matches.
            formLast5Home: (0, math_1.mean)(lastN(homeState.points, 5)),
            formLast5Away: (0, math_1.mean)(lastN(awayState.points, 5)),
            goalsForAvgHome: (0, math_1.mean)(lastN(homeState.goalsFor, 10)),
            goalsForAvgAway: (0, math_1.mean)(lastN(awayState.goalsFor, 10)),
            goalsAgainstAvgHome: (0, math_1.mean)(lastN(homeState.goalsAgainst, 10)),
            goalsAgainstAvgAway: (0, math_1.mean)(lastN(awayState.goalsAgainst, 10)),
            // Rate features are rolling means over 10 matches for better stability.
            shotsForAvgHome: (0, math_1.mean)(lastN(homeState.shotsFor, 10)),
            shotsForAvgAway: (0, math_1.mean)(lastN(awayState.shotsFor, 10)),
            shotsAgainstAvgHome: (0, math_1.mean)(lastN(homeState.shotsAgainst, 10)),
            shotsAgainstAvgAway: (0, math_1.mean)(lastN(awayState.shotsAgainst, 10)),
            faceoffPctHome: (0, math_1.mean)(lastN(homeState.faceoffPct, 10)),
            faceoffPctAway: (0, math_1.mean)(lastN(awayState.faceoffPct, 10)),
            ppPctHome: (0, math_1.mean)(lastN(homeState.ppPct, 10)),
            ppPctAway: (0, math_1.mean)(lastN(awayState.ppPct, 10)),
            goalieSvPctHome: (0, math_1.mean)(lastN(homeState.goalieSvPct, 10)),
            goalieSvPctAway: (0, math_1.mean)(lastN(awayState.goalieSvPct, 10)),
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
    await (0, fs_1.writeJson)(paths_1.PROCESSED_DATA_PATH, readyRows);
    return readyRows;
}
