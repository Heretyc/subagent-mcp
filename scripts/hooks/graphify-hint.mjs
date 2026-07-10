import { existsSync } from "node:fs";

const input = await readStdin();
let payload;

try {
  payload = JSON.parse(input);
} catch {
  process.exit(0);
}

let command = "";

if (payload?.tool_input?.command != null) {
  command = String(payload.tool_input.command);
} else if (payload?.command != null) {
  command = String(payload.command);
}

if (
  /\b(grep|rg|ripgrep|find|fd|ack|ag)\b/i.test(command) &&
  existsSync("graphify-out/graph.json")
) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext:
          "graphify: Knowledge graph exists. Read graphify-out/GRAPH_REPORT.md for god nodes and community structure before searching raw files.",
      },
    }),
  );
}

process.exit(0);

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
