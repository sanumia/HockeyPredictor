import axios from "axios";
import * as cheerio from "cheerio";
import { DATA_SOURCE_META_PATH, RAW_DATA_PATH, STANDINGS_RAW_PATH } from "../../config/paths";
import { RawMatchRecord, StandingsRecord } from "../../types/domain";
import { writeJson } from "../../utils/fs";

const SOURCE_URL = "https://hcdinamo.by/matches/";
const STANDINGS_URL = "https://hcdinamo.by/matches/standings/";
const DINAMO_TEAM = "Динамо-Минск";
const MAX_MONTH_TOKENS = 18;
const DINAMO_ALIASES = ["Динамо Мн", "Динамо-Минск", "Динамо Минск", "Dinamo Minsk"];

interface DataSourceMeta {
  sourceUrl: string;
  mode: "scraped";
  records: number;
  reason?: string;
}

function parseNumber(value: string, fallback = 0): number {
  const normalized = value.replace(",", ".").replace(/[^\d.-]/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseGoalsPair(value: string): { forGoals: number; againstGoals: number } {
  const [left, right] = value.split("-").map((x) => parseNumber(x, 0));
  return { forGoals: left, againstGoals: right };
}

function parseDateRuToIso(value: string): string | null {
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

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseStandingsFromPage(html: string): StandingsRecord[] {
  const $ = cheerio.load(html);
  const rows = $("table tr");
  const standings: StandingsRecord[] = [];

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

function extractMonthTokens(html: string): string[] {
  const $ = cheerio.load(html);
  const tokens = new Set<string>();
  $("[data-date]").each((_, element) => {
    const token = ($(element).attr("data-date") ?? "").trim();
    if (token) {
      tokens.add(token);
    }
  });
  return [...tokens];
}

function parseMatchesListRows(html: string): RawMatchRecord[] {
  const $ = cheerio.load(html);
  const parsed: RawMatchRecord[] = [];

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

async function fetchMonthHtml(monthToken: string): Promise<string> {
  const payload = new URLSearchParams({
    ajax: "Y",
    data_calendar: monthToken,
    type: "list"
  });
  const response = await axios.post<string>(SOURCE_URL, payload.toString(), {
    timeout: 20000,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    }
  });
  return response.data;
}

export async function collectRawMatches(): Promise<RawMatchRecord[]> {
  const [matchesResponse, standingsResponse] = await Promise.all([
    axios.get<string>(SOURCE_URL, { timeout: 20000 }),
    axios.get<string>(STANDINGS_URL, { timeout: 20000 })
  ]);

  const standings = parseStandingsFromPage(standingsResponse.data);
  if (standings.length > 0) {
    await writeJson(STANDINGS_RAW_PATH, standings);
  }

  const allMatches: RawMatchRecord[] = [];
  const visitedTokens = new Set<string>();
  const queue = extractMonthTokens(matchesResponse.data);
  allMatches.push(...parseMatchesListRows(matchesResponse.data));

  while (queue.length > 0 && visitedTokens.size < MAX_MONTH_TOKENS) {
    const token = queue.shift()!;
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

  const uniqueMatches = new Map<string, RawMatchRecord>();
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

  const dinamoStanding = standings.find((row) => DINAMO_ALIASES.some((alias) => row.team.includes(alias)));
  let filtered = scraped;
  let filterReason = "all finished matches from list view";
  if (dinamoStanding && dinamoStanding.games > 0) {
    // Standings games count is regular season only. Filter out preseason/playoff by season start and game count.
    const firstYear = Number(scraped[0]?.date.slice(0, 4)) || new Date().getFullYear();
    const seasonStart = `${firstYear.toString().padStart(4, "0")}-09-01`;
    const fromSeasonStart = scraped.filter((row) => row.date >= seasonStart);
    if (fromSeasonStart.length >= dinamoStanding.games) {
      filtered = fromSeasonStart.slice(0, dinamoStanding.games);
      filterReason = `regular season only (${dinamoStanding.games} games by standings, from ${seasonStart})`;
    }
  }

  await writeJson(RAW_DATA_PATH, filtered);
  const meta: DataSourceMeta = {
    sourceUrl: SOURCE_URL,
    mode: "scraped",
    records: filtered.length,
    reason: `real match results from official list view, crawled month tokens: ${visitedTokens.size}; filter: ${filterReason}`
  };
  await writeJson(DATA_SOURCE_META_PATH, meta);
  return filtered;
}

if (require.main === module) {
  collectRawMatches()
    .then((data) => {
      console.log(`Collected ${data.length} matches to data/raw/matches.json`);
    })
    .catch((error: unknown) => {
      console.error("Failed to collect matches:", error);
      process.exit(1);
    });
}

