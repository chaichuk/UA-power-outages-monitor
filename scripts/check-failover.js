import { execSync } from "node:child_process";
import fs from "node:fs";

const THRESHOLD_MINUTES = parseInt(process.env.FAILOVER_THRESHOLD_MINUTES || "20", 10);
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;
const IS_MANUAL_TRIGGER = process.env.GITHUB_EVENT_NAME === "workflow_dispatch" || process.argv.includes("--force");

function setOutput(name, value) {
  console.log(`[OUTPUT] ${name}=${value}`);
  if (GITHUB_OUTPUT && fs.existsSync(GITHUB_OUTPUT)) {
    fs.appendFileSync(GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function checkNucStatus() {
  console.log("🔍 Checking primary NUC status...");

  if (IS_MANUAL_TRIGGER) {
    console.log("⚡ Triggered manually or forced. Proceeding with execution regardless of NUC status.");
    setOutput("should_run", "true");
    setOutput("reason", "manual_trigger");
    return;
  }

  let lastCommitTimestamp = 0;
  try {
    const rawTs = execSync("git log -1 --format=%ct artifacts/last-message.json", {
      stdio: ["pipe", "pipe", "ignore"],
      encoding: "utf8"
    }).trim();

    if (rawTs) {
      lastCommitTimestamp = parseInt(rawTs, 10);
    }
  } catch (err) {
    console.warn("⚠️ Could not get git commit timestamp for artifacts/last-message.json:", err.message);
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);

  if (lastCommitTimestamp === 0) {
    console.warn("⚠️ No commit history found for artifacts/last-message.json. Triggering failover just in case.");
    setOutput("should_run", "true");
    setOutput("reason", "no_history");
    return;
  }

  const diffSeconds = currentTimestamp - lastCommitTimestamp;
  const diffMinutes = Math.floor(diffSeconds / 60);

  const lastCommitDate = new Date(lastCommitTimestamp * 1000).toISOString();
  const currentDate = new Date(currentTimestamp * 1000).toISOString();

  console.log(`🕒 Current Time:      ${currentDate}`);
  console.log(`🕒 Last NUC Commit:   ${lastCommitDate}`);
  console.log(`⏱️ Elapsed time:      ${diffMinutes} minute(s) (Threshold: ${THRESHOLD_MINUTES} minutes)`);

  if (diffMinutes < THRESHOLD_MINUTES) {
    console.log(`🟢 NUC is ONLINE and healthy (updated ${diffMinutes}m ago < ${THRESHOLD_MINUTES}m threshold).`);
    console.log("💤 Standby mode: Skipping cloud scraper run to conserve resources and avoid DTEK blocks.");
    setOutput("should_run", "false");
    setOutput("reason", "nuc_healthy");
  } else {
    console.log(`🚨 NUC appears OFFLINE or lagging! (${diffMinutes}m ago >= ${THRESHOLD_MINUTES}m threshold).`);
    console.log("🚀 Activating Cloud Failover scraper to update outage schedules...");
    setOutput("should_run", "true");
    setOutput("reason", "nuc_offline");
  }
}

checkNucStatus();
