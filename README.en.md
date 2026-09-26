# usb-ai-agent · Private AI Agent on USB

> Portable **Claude Code** + multi-account console on a USB drive, zero host residue.

**Core binding**: one account → multiple **agents** (API configs) + multiple **work personas**. Flow: **environment check → choose agent → choose persona → run mode**. Web is a management console; conversation runs through Claude Code (terminal or dialog).

> Base note: portable packaging layer (two-stage launcher, `data/` tree, engine install + stub repair, OpenAI→Anthropic adapter, loopback hardening, portable Ollama) transplanted from [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT). Multi-account/agent/persona/dialog are self-developed.

## Flow

1. **Environment check** — "check installed/update" and "confirm install" are two separate steps.
2. **Choose agent** — add/delete; manual entry or drag-drop a CC Switch settings.json to import.
3. **Choose work persona** — add/delete; only name/description/persona/CLAUDE.md; activates mainstream settings.json.
4. **Run mode (one of two)** — ⌨️ terminal (CLI) or 💬 dialog (web streaming via Agent SDK, with tool approval).

- Account delete cascades to all its agents + personas + data (data boundary).
- Passwords never stored readably (scrypt-KEK-wrapped master key); API keys AES-encrypted.
- Exit: two modes only — wipe everything, or keep this session's host changes and clear all other data.

## Layout

```text
USB root/
├── start.bat / start.sh / clean.bat / clean.sh
├── lib/  server.js · paths.js · modules/ (auth · crypto · agents · personas · dialog · providers · adapter · runtime · cleanup · usb · local-models)
├── dashboard/  login / main(flow) / dialog / exit
├── tools/  bootstrap · launcher · runtime-manifest(claude-code + claude-agent-sdk) · Setup_Local_Models.*
├── engine/  generated: portable Node + Claude Code
└── data/  users.json · users/<account>/{master.key.enc, agents.enc, personas/<slug>/..., prefs.json}
```

## Security (honest)

Protected: loopback + Host/Origin guards; passwords not readable; agent keys encrypted; cascade delete; zero remote persistence. Not: forensics, relay visibility, keyloggers, weak passwords. Note: activated persona `settings.json` is mainstream Claude Code plaintext (contains the key).

## License

MIT. Packaging transplant reference: [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT).