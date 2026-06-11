const fs = require("fs/promises");
const path = require("path");

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
  isJobRunInProgress,
};
