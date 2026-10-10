### Fixed

- **Approving a command after a minute no longer fails**: Time spent waiting for your approval counted against the tool's own time limit, so a shell command approved after more than a minute failed with "Tool execution timed out after 60000ms", and file reads or edits that asked for permission failed even sooner. A tool's time limit now pauses while it waits for your answer and covers only its own work. Approvals still expire after 30 minutes.
