const fs = require("fs/promises");
const path = require("path");

const DEFAULT_MAX_HISTORY = 100;

async function readJobRunStatus(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJobRunStatus(filePath, status) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(status, null, 2));
}

async function readJobRunHistory(historyFile, limit = 50) {
  try {
    const raw = await fs.readFile(historyFile, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.slice(0, limit);
  } catch {
    return [];
  }
}

async function appendJobRunHistory(historyFile, entry, maxEntries = DEFAULT_MAX_HISTORY) {
  const history = await readJobRunHistory(historyFile, maxEntries);
  const record = {
    id: entry.id || entry.startedAt || new Date().toISOString(),
    ...entry,
  };
  history.unshift(record);
  const trimmed = history.slice(0, maxEntries);
  await fs.mkdir(path.dirname(historyFile), { recursive: true });
  await fs.writeFile(historyFile, JSON.stringify(trimmed, null, 2));
}

async function recordJobRun(statusFile, historyFile, result) {
  await writeJobRunStatus(statusFile, result);
  if (result.status && result.status !== "running") {
    await appendJobRunHistory(historyFile, result);
  }
}

function isJobRunInProgress(status, maxRunningMs = 30 * 60 * 1000) {
  if (!status || status.status !== "running" || !status.startedAt) {
    return false;
  }
  const started = new Date(status.startedAt).getTime();
  if (!Number.isFinite(started)) {
    return false;
  }
  return Date.now() - started < maxRunningMs;
}

module.exports = {
  readJobRunStatus,
  writeJobRunStatus,
  readJobRunHistory,
  appendJobRunHistory,
  recordJobRun,
  isJobRunInProgress,
};
