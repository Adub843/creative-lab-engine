// Stacy's shifts on the server: a run starts the Claude command line with the job's prompt plus Aaron's request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Runner } from "../server/runner.mjs";

test("fire runs the job, logs it, and reports the result like a scheduled task", async () => {
  const dir = mkdtempSync(join(tmpdir(), "labrun-"));
  const cli = join(dir, "fake-claude.sh");
  writeFileSync(cli, `#!/bin/sh\necho "args: $*"\ncat\n[ "$LAB_JOB_ID" = "job_x" ] || exit 3\n`); chmodSync(cli, 0o755);
  const ends = [];
  const r = new Runner(join(dir, "runner.db"), { claudeCli: cli, workDir: join(dir, "work"), logDir: join(dir, "logs"), mcpConfig: "/srv/lab/mcp.json", onRunEnd: (j, s) => ends.push(s) });
  r.upsert({ id: "job_x", name: "Evening review", cron_expression: "0 22 * * *", prompt: "Review the day.", model: "opus" });
  const f = r.fire("job_x", "check the C3D quotes too");
  assert.equal(f.fired, true);
  assert.equal(r.fire("job_x").already_running, true);
  await new Promise(res => { const t = setInterval(() => { if (ends.length) { clearInterval(t); res(); } }, 20); });
  assert.deepEqual(ends, ["SUCCEEDED"]);
  const j = r.get("job_x");
  assert.equal(j.last_run.status, "ROUTINE_RUN_STATUS_SUCCEEDED");
  assert.equal(j.derived_state.prompt, "Review the day.");
  const log = readFileSync(join(dir, "logs", f.run_id + ".log"), "utf8");
  assert.match(log, /--permission-mode acceptEdits --mcp-config \/srv\/lab\/mcp.json --model opus/);
  assert.match(log, /Review the day\.[\s\S]*Aaron's request for this run[\s\S]*check the C3D quotes too/);
  r.update("job_x", { enabled: false });
  assert.equal(r.get("job_x").enabled, false); assert.equal(r.get("job_x").next_run_at, null);
  assert.deepEqual(r.remove("job_x"), { deleted: true });
  r.close();
});
