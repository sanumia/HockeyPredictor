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
const SOURCE_URL = "https://hcdinamo.by/matches/";
const STANDINGS_URL = "https://hcdinamo.by/matches/standings/";
const DINAMO_TEAM = "Динамо-Минск";
const MAX_MONTH_TOKENS = 18;
function parseNumber(value, fallback = 0) {
    const normalized = value.replace(",", ".").replace(/[^\d.-]/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function parseGoalsPair(value) {
    const [left, right] = value.split("-").map((x) => parseNumber(x, 0));
    return { forGoals: left, againstGoals: right };
}
function parseDateRuToIso(value) {
    const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) {
        return null;
    }
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    if (!day || !month || !year) {
        return null;
    }
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}
function normalizeSpaces(value) {
    return value.replace(/\s+/g, " ").trim();
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
function extractMonthTokens(html) {
    const $ = cheerio.load(html);
    const tokens = new Set();
    $("[data-date]").each((_, element) => {
        const token = ($(element).attr("data-date") ?? "").trim();
        if (token) {
            tokens.add(token);
        }
    });
    return [...tokens];
}
function parseMatchesListRows(html) {
    const $ = cheerio.load(html);
    const parsed = [];
    $("span.date").each((_, dateEl) => {
        const dateSpan = $(dateEl);
        const dateText = normalizeSpaces(dateSpan.text());
        const dateIso = parseDateRuToIso(dateText);
        if (!dateIso) {
            return;
        }
        const row = dateSpan.closest("tr");
        const rival = normalizeSpaces(row.find("span.rival").text());
        const score = normalizeSpaces(row.find("span.score").first().text());
        if (!rival || !/^\d+:\d+$/.test(score)) {
            return;
        }
        const [leftGoalsRaw, rightGoalsRaw] = score.split(":");
        const leftGoals = parseNumber(leftGoalsRaw, -1);
        const rightGoals = parseNumber(rightGoalsRaw, -1);
        if (leftGoals < 0 || rightGoals < 0) {
            return;
        }
        const className = dateSpan.attr("class") ?? "";
        const isHome = className.includes("blue");
        const isAway = className.includes("violet");
        if (!isHome && !isAway) {
            return;
        }
        const homeTeam = isHome ? DINAMO_TEAM : rival;
        const awayTeam = isHome ? rival : DINAMO_TEAM;
        parsed.push({
            date: dateIso,
            homeTeam,
            awayTeam,
            homeGoals: leftGoals,
            awayGoals: rightGoals,
            homeShots: 0,
            awayShots: 0,
            homeFaceoffPct: 0,
            awayFaceoffPct: 0,
            homePpPct: 0,
            awayPpPct: 0,
            homeGoalieSvPct: 0,
            awayGoalieSvPct: 0
        });
    });
    return parsed;
}
async function fetchMonthHtml(monthToken) {
    const payload = new URLSearchParams({
        ajax: "Y",
        data_calendar: monthToken,
        type: "list"
    });
    const response = await axios_1.default.post(SOURCE_URL, payload.toString(), {
        timeout: 20000,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        }
    });
    return response.data;
}
async function collectRawMatches() {
    const [matchesResponse, standingsResponse] = await Promise.all([
        axios_1.default.get(SOURCE_URL, { timeout: 20000 }),
        axios_1.default.get(STANDINGS_URL, { timeout: 20000 })
    ]);
    const standings = parseStandingsFromPage(standingsResponse.data);
    if (standings.length > 0) {
        await (0, fs_1.writeJson)(paths_1.STANDINGS_RAW_PATH, standings);
    }
    const allMatches = [];
    const visitedTokens = new Set();
    const queue = extractMonthTokens(matchesResponse.data);
    allMatches.push(...parseMatchesListRows(matchesResponse.data));
    while (queue.length > 0 && visitedTokens.size < MAX_MONTH_TOKENS) {
        const token = queue.shift();
        if (visitedTokens.has(token)) {
            continue;
        }
        visitedTokens.add(token);
        const monthHtml = await fetchMonthHtml(token);
        allMatches.push(...parseMatchesListRows(monthHtml));
        for (const nextToken of extractMonthTokens(monthHtml)) {
            if (!visitedTokens.has(nextToken)) {
                queue.push(nextToken);
            }
        }
    }
    const uniqueMatches = new Map();
    for (const row of allMatches) {
        const key = `${row.date}|${row.homeTeam}|${row.awayTeam}|${row.homeGoals}:${row.awayGoals}`;
        if (!uniqueMatches.has(key)) {
            uniqueMatches.set(key, row);
        }
    }
    const scraped = [...uniqueMatches.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (scraped.length < 4) {
        throw new Error("Official matches list returned too few finished games for analysis.");
    }
    await (0, fs_1.writeJson)(paths_1.RAW_DATA_PATH, scraped);
    const meta = {
        sourceUrl: SOURCE_URL,
        mode: "scraped",
        records: scraped.length,
        reason: `real match results from official list view, crawled month tokens: ${visitedTokens.size}`
    };
    await (0, fs_1.writeJson)(paths_1.DATA_SOURCE_META_PATH, meta);
    return scraped;
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
