"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectRawMatches = collectRawMatches;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const paths_1 = require("../../config/paths");
const fs_1 = require("../../utils/fs");
const SOURCE_URL = "https://hcdinamo.by/matches/standings/";
function parseNumber(value, fallback = 0) {
    const normalized = value.replace(",", ".").replace(/[^\d.-]/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function parseGoalsPair(value) {
    const [left, right] = value.split("-").map((x) => parseNumber(x, 0));
    return { forGoals: left, againstGoals: right };
}
function parseStandingsFromPage(html) {
    const $ = cheerio.load(html);
    const rows = $("table tr");
    const standings = [];
    rows.each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 10) {
            return;
        }
        const place = parseNumber($(cells[0]).text(), -1);
        const team = $(cells[1]).text().trim();
        const games = parseNumber($(cells[2]).text(), 0);
        const wins = parseNumber($(cells[3]).text(), 0);
        const winsOt = parseNumber($(cells[4]).text(), 0);
        const winsSo = parseNumber($(cells[5]).text(), 0);
        const lossesSo = parseNumber($(cells[6]).text(), 0);
        const lossesOt = parseNumber($(cells[7]).text(), 0);
        const losses = parseNumber($(cells[8]).text(), 0);
        const goals = parseGoalsPair($(cells[9]).text());
        const points = parseNumber($(cells[10]).text(), 0);
        if (place <= 0 || !team || games <= 0) {
            return;
        }
        standings.push({
            place,
            team,
            games,
            wins,
            winsOt,
            winsSo,
            lossesSo,
            lossesOt,
            losses,
            goalsFor: goals.forGoals,
            goalsAgainst: goals.againstGoals,
            points
        });
    });
    // The page has multiple tables (league, conferences, divisions), so keep the first full table only.
    const firstLeagueSlice = standings.slice(0, 22);
    return firstLeagueSlice.length >= 10 ? firstLeagueSlice : standings;
}
function generateSyntheticData(matchesPerTeam = 30) {
    const teams = [
        "Dinamo Minsk",
        "SKA",
        "CSKA",
        "Lokomotiv",
        "Ak Bars",
        "Salavat Yulaev",
        "Avangard",
        "Traktor"
    ];
    const records = [];
    const start = new Date("2025-09-01");
    let dayOffset = 0;
    for (let t = 0; t < teams.length; t += 1) {
        for (let k = 0; k < matchesPerTeam; k += 1) {
            const opponent = teams[(t + k + 1) % teams.length];
            const homeGoals = Math.max(0, Math.round(2 + Math.random() * 3));
            const awayGoals = Math.max(0, Math.round(1 + Math.random() * 3));
            const date = new Date(start);
            date.setDate(start.getDate() + dayOffset);
            dayOffset += 1;
            records.push({
                date: date.toISOString().slice(0, 10),
                homeTeam: teams[t],
                awayTeam: opponent,
                homeGoals,
                awayGoals,
                homeShots: Math.round(23 + Math.random() * 15),
                awayShots: Math.round(22 + Math.random() * 14),
                homeFaceoffPct: Math.round((45 + Math.random() * 12) * 10) / 10,
                awayFaceoffPct: Math.round((43 + Math.random() * 12) * 10) / 10,
                homePpPct: Math.round((15 + Math.random() * 15) * 10) / 10,
                awayPpPct: Math.round((14 + Math.random() * 16) * 10) / 10,
                homeGoalieSvPct: Math.round((88 + Math.random() * 8) * 10) / 10,
                awayGoalieSvPct: Math.round((87 + Math.random() * 8) * 10) / 10
            });
        }
    }
    return records;
}
function scrapeFromStandingsPage(html) {
    const $ = cheerio.load(html);
    const rows = $("table tr");
    const parsed = [];
    rows.each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 8) {
            return;
        }
        const homeTeam = $(cells[1]).text().trim();
        const awayTeam = $(cells[2]).text().trim();
        const score = $(cells[3]).text().trim();
        if (!homeTeam || !awayTeam || !score.includes(":")) {
            return;
        }
        const [homeScore, awayScore] = score.split(":");
        parsed.push({
            date: $(cells[0]).text().trim() || "2025-01-01",
            homeTeam,
            awayTeam,
            homeGoals: parseNumber(homeScore),
            awayGoals: parseNumber(awayScore),
            homeShots: parseNumber($(cells[4]).text(), 30),
            awayShots: parseNumber($(cells[5]).text(), 29),
            homeFaceoffPct: parseNumber($(cells[6]).text(), 50),
            awayFaceoffPct: parseNumber($(cells[7]).text(), 50),
            homePpPct: parseNumber($(cells[8]).text(), 20),
            awayPpPct: parseNumber($(cells[9]).text(), 20),
            homeGoalieSvPct: parseNumber($(cells[10]).text(), 91),
            awayGoalieSvPct: parseNumber($(cells[11]).text(), 90)
        });
    });
    return parsed;
}
async function collectRawMatches() {
    try {
        const response = await axios_1.default.get(SOURCE_URL, { timeout: 15000 });
        const standings = parseStandingsFromPage(response.data);
        if (standings.length > 0) {
            await (0, fs_1.writeJson)(paths_1.STANDINGS_RAW_PATH, standings);
        }
        const scraped = scrapeFromStandingsPage(response.data);
        if (scraped.length >= 20) {
            await (0, fs_1.writeJson)(paths_1.RAW_DATA_PATH, scraped);
            const meta = {
                sourceUrl: SOURCE_URL,
                mode: "scraped",
                records: scraped.length
            };
            await (0, fs_1.writeJson)(paths_1.DATA_SOURCE_META_PATH, meta);
            return scraped;
        }
        const fallback = generateSyntheticData(20);
        await (0, fs_1.writeJson)(paths_1.RAW_DATA_PATH, fallback);
        const meta = {
            sourceUrl: SOURCE_URL,
            mode: "synthetic_fallback",
            records: fallback.length,
            reason: "standings page does not contain enough per-match rows with scores; standings saved separately"
        };
        await (0, fs_1.writeJson)(paths_1.DATA_SOURCE_META_PATH, meta);
        return fallback;
    }
    catch {
        // Ignore and fallback to synthetic data.
    }
    const fallback = generateSyntheticData(20);
    await (0, fs_1.writeJson)(paths_1.RAW_DATA_PATH, fallback);
    const meta = {
        sourceUrl: SOURCE_URL,
        mode: "synthetic_fallback",
        records: fallback.length,
        reason: "http request failed or parser error"
    };
    await (0, fs_1.writeJson)(paths_1.DATA_SOURCE_META_PATH, meta);
    return fallback;
}
if (require.main === module) {
    collectRawMatches()
        .then((data) => {
        console.log(`Collected ${data.length} matches to data/raw/matches.json`);
    })
        .catch((error) => {
        console.error("Failed to collect matches:", error);
        process.exit(1);
    });
}
