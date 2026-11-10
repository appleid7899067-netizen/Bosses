# Bosses Skills

Skills are small, auditable instruction packs used to guide the agent for a specific task.

Each skill lives in `skills/<name>/SKILL.md` and is registered in `skills/skills_config.json`.

Rules:
- Keep skills focused and composable.
- Never place secrets, tokens, private keys, or local machine paths in a skill.
- Skills may describe actions, but runtime authorization remains in server code.
- GitHub mutations require authentication, repository allowlisting, and explicit server enablement.
- Shell execution must use the configured sandbox; never expose a host shell to the browser.
