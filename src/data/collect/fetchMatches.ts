import axios from "axios";
import * as cheerio from "cheerio";
import { DATA_SOURCE_META_PATH, RAW_DATA_PATH, STANDINGS_RAW_PATH } from "../../config/paths";
import { RawMatchRecord, StandingsRecord } from "../../types/domain";
import { writeJson } from "../../utils/fs";

const SOURCE_URL = "https://hcdinamo.by/matches/standings/";

interface DataSourceMeta {
  sourceUrl: string;
  mode: "scraped" | "synthetic_fallback";
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

function generateSyntheticData(matchesPerTeam = 30): RawMatchRecord[] {
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

  const records: RawMatchRecord[] = [];
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

function scrapeFromStandingsPage(html: string): RawMatchRecord[] {
  const $ = cheerio.load(html);
  const rows = $("table tr");
  const parsed: RawMatchRecord[] = [];

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

export async function collectRawMatches(): Promise<RawMatchRecord[]> {
  try {
    const response = await axios.get<string>(SOURCE_URL, { timeout: 15000 });
    const standings = parseStandingsFromPage(response.data);
    if (standings.length > 0) {
      await writeJson(STANDINGS_RAW_PATH, standings);
    }

    const scraped = scrapeFromStandingsPage(response.data);

    if (scraped.length >= 20) {
      await writeJson(RAW_DATA_PATH, scraped);
      const meta: DataSourceMeta = {
        sourceUrl: SOURCE_URL,
        mode: "scraped",
        records: scraped.length
      };
      await writeJson(DATA_SOURCE_META_PATH, meta);
      return scraped;
    }

    const fallback = generateSyntheticData(20);
    await writeJson(RAW_DATA_PATH, fallback);
    const meta: DataSourceMeta = {
      sourceUrl: SOURCE_URL,
      mode: "synthetic_fallback",
      records: fallback.length,
      reason: "standings page does not contain enough per-match rows with scores; standings saved separately"
    };
    await writeJson(DATA_SOURCE_META_PATH, meta);
    return fallback;
  } catch {
    // Ignore and fallback to synthetic data.
  }

  const fallback = generateSyntheticData(20);
  await writeJson(RAW_DATA_PATH, fallback);
  const meta: DataSourceMeta = {
    sourceUrl: SOURCE_URL,
    mode: "synthetic_fallback",
    records: fallback.length,
    reason: "http request failed or parser error"
  };
  await writeJson(DATA_SOURCE_META_PATH, meta);
  return fallback;
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

