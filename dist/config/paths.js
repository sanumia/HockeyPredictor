"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPORTS_DIR = exports.PROCESSED_DATA_PATH = exports.STANDINGS_RAW_PATH = exports.DATA_SOURCE_META_PATH = exports.RAW_DATA_PATH = exports.DATA_DIR = exports.ROOT_DIR = void 0;
const node_path_1 = __importDefault(require("node:path"));
exports.ROOT_DIR = node_path_1.default.resolve(__dirname, "..", "..");
exports.DATA_DIR = node_path_1.default.join(exports.ROOT_DIR, "data");
exports.RAW_DATA_PATH = node_path_1.default.join(exports.DATA_DIR, "raw", "matches.json");
exports.DATA_SOURCE_META_PATH = node_path_1.default.join(exports.DATA_DIR, "raw", "data-source-meta.json");
exports.STANDINGS_RAW_PATH = node_path_1.default.join(exports.DATA_DIR, "raw", "standings.json");
exports.PROCESSED_DATA_PATH = node_path_1.default.join(exports.DATA_DIR, "processed", "features.json");
exports.REPORTS_DIR = node_path_1.default.join(exports.ROOT_DIR, "reports");
