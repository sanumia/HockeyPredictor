import path from "node:path";

export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const RAW_DATA_PATH = path.join(DATA_DIR, "raw", "matches.json");
export const DATA_SOURCE_META_PATH = path.join(DATA_DIR, "raw", "data-source-meta.json");
export const STANDINGS_RAW_PATH = path.join(DATA_DIR, "raw", "standings.json");
export const PROCESSED_DATA_PATH = path.join(DATA_DIR, "processed", "features.json");
export const REPORTS_DIR = path.join(ROOT_DIR, "reports");
