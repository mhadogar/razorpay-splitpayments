function timestamp() {
  return new Date().toISOString();
}

function log(level, message, extra) {
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[${timestamp()}] [${level}] ${message}${payload}`);
}

module.exports = {
  info(message, extra) {
    log("INFO", message, extra);
  },
  warn(message, extra) {
    log("WARN", message, extra);
  },
  error(message, extra) {
    log("ERROR", message, extra);
  },
};
