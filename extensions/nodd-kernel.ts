// nodd-kernel — the pi-facing half of NODD.
//
// This entrypoint is where pi event registration lives. The rules themselves
// are pure functions under `src/`, so they run under `node --test` with no pi
// runtime. T008 fills this in; for now it registers nothing and, notably,
// blocks nothing.

export default function register(): void {
  // T008: tool_call / tool_result / session_start.
}
