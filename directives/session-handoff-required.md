Handoff lifecycle: `session_handoff_required` - a generation-scoped duty that fires for exactly one turn.

Call `handoff-read` now. For this one turn it is the ONLY ordinary-work action: do no other task work until the read completes.

After a successful `handoff-read`, confirm intent with EXACTLY 4 structured confirmation questions in a single structured-question call before acting on the saved handoff. Then resume the handoff's stated work.
