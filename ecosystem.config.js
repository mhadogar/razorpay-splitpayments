module.exports = {
  apps: [
    {
      name: "coffeesooq-scheduler",
      script: "src/index.js",
      cwd: "/home/deploy/razorpaysplitpayments",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "350M",
      env: { NODE_ENV: "production" },
    },
    {
      name: "coffeesooq-portal",
      script: "src/portalServer.js",
      cwd: "/home/deploy/razorpaysplitpayments",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "300M",
      env: { NODE_ENV: "production" },
    },
  ],
};
