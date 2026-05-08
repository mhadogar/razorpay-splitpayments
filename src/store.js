const fs = require("fs/promises");
const path = require("path");

async function ensureFile(filePath, defaultData) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2));
  }
}

async function readJson(filePath, defaultData) {
  await ensureFile(filePath, defaultData);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

module.exports = {
  async loadState(stateFilePath) {
    return readJson(stateFilePath, { transferredPayments: {} });
  },

  async saveState(stateFilePath, state) {
    await writeJson(stateFilePath, state);
  },

  async loadVendors(vendorFilePath) {
    return readJson(vendorFilePath, { vendors: [] });
  },
};
