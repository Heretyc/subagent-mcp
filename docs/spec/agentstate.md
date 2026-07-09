# AgentState Structure

`AgentState` fields: `id` (UUID), `provider`, `model` (alias), `status`, `process` (driver process facade), `driver` (provider driver), `stdout` (full string), `stderr` (full string), `exitCode`, `startedAt` (ms), `lastActivity` (ms, stamped by visible-stream heartbeat), `cwd`, `recentStream` (last 3 parsed stream items), `ucSettingsPath?` (Claude ultracode temp file), `slotPath?`, `exitedAt?`, `waitReported?`.
