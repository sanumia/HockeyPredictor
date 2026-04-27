"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDirForFile = ensureDirForFile;
exports.writeJson = writeJson;
exports.readJson = readJson;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
async function ensureDirForFile(filePath) {
    await (0, promises_1.mkdir)(node_path_1.default.dirname(filePath), { recursive: true });
}
async function writeJson(filePath, data) {
    await ensureDirForFile(filePath);
    await (0, promises_1.writeFile)(filePath, JSON.stringify(data, null, 2), "utf-8");
}
async function readJson(filePath) {
    const raw = await (0, promises_1.readFile)(filePath, "utf-8");
    return JSON.parse(raw);
}
