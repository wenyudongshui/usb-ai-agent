# 🔒 usb-ai-agent · Private AI Agent on USB

> **Portable Claude Code on a USB drive — management console, multi-account, zero host residue.**

![license](https://img.shields.io/badge/license-MIT-blue) ![runtime](https://img.shields.io/badge/runtime-Node.js_24-green) ![deps](https://img.shields.io/badge/dependencies-0-brightgreen)

---

## The problem it solves

On shared or borrowed machines you don't want your **API keys, prompts, and accounts** left behind. This project puts everything on a USB drive:

- **Engine**: the official **Claude Code** CLI, portable and install-free.
- **Config**: one account binds **multiple agents (API configs)** and **multiple work personas**.
- **Data**: keys encrypted, passwords never stored readably, cleaned on exit — zero host persistence.

The web page is a **management console** (engine / agents / personas / local models), not a chat page. Conversation happens in the **Claude Code terminal** or a **web dialog**.

> **Base**: the portable packaging layer (two-stage launcher, `data/` tree, engine install with native-binary stub repair, OpenAI→Anthropic local adapter, loopback hardening, portable Ollama) is transplanted from
> [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT). The multi-account / agent / persona model and the dialog mode are self-developed.

## Highlights

| Feature | Description |
|---|---|
| 🔐 **Multi-account** | Names visible, passwords never read from disk (scrypt-KEK-wrapped); deleting an account cascades to all its agents/personas/data |
| 🤖 **Agents (API configs)** | Multiple per account; **manual entry** or **drag-drop a CC Switch settings.json** to import; keys AES-256-GCM encrypted |
| 🧠 **Work personas** | Only name / description / persona / CLAUDE.md; activating writes mainstream Claude Code `settings.json` |
| 🚀 **Two run modes** | ⌨️ **CLI mode** (terminal, full power) / 💬 **Dialog mode** (web streaming + tool approval, Agent SDK) |
| 🛡️ **Security** | Loopback-only + Host/Origin (DNS-rebind) guards; zero host persistence; multi-tier residue cleanup |
| 🏠 **Offline** | Portable Ollama engine + GGUF models, usable without internet |
| ⚡ **Portable Node bootstrap** | First run auto-downloads a pinned Node.js (SHA256-verified) into `engine/` |

## Flow

```
① environment check → ② choose agent → ③ choose work persona → ④ run mode (CLI / dialog)
```

1. Copy the repo to a USB root (≥8GB); run `start.bat` (or `./start.sh`).
2. Login page: "＋ add account" with a name + password.
3. **① Environment check**: "check installed/update" and "confirm install" are two separate steps (~300MB, includes the Agent SDK).
4. **② Choose agent**: manual entry, or **drag-drop a CC Switch settings.json** to import; select as current.
5. **③ Choose work persona**: create (name/description/persona/CLAUDE.md) and activate.
6. **④ Run mode**: CLI (opens a terminal) or Dialog (web chat); press Launch.

## Layout

```text
USB root/
├── start.bat / start.sh          # two-stage launcher: bootstrap → launcher
├── clean.bat / clean.sh          # one-click host-residue cleanup
├── lib/                          # backend (Node.js built-ins only, zero deps)
│   ├── server.js  paths.js
│   └── modules/                  # auth · crypto · agents · personas · dialog
│                                 #  · providers · adapter · runtime · cleanup · usb · local-models
├── dashboard/                    # login / main(flow) / dialog / exit
├── tools/                        # bootstrap · launcher · runtime-manifest · Setup_Local_Models.*
├── engine/                       # generated: portable Node + Claude Code
└── data/                         # generated (PORTABLE_AI_DATA_DIR override)
    ├── users.json
    └── users/<account>/
        ├── master.key.enc        # password-KEK-wrapped master key (ciphertext)
        ├── agents.enc            # AES-256-GCM encrypted agent (API key) configs
        ├── prefs.json
        └── personas/<slug>/      # persona.json · CLAUDE.md · settings.json
```

## Security (honest)

**Protected**: loopback-only + Host/Origin (DNS-rebind) guards; passwords never stored readably; agent keys encrypted; cascade delete; zero remote persistence.

**Not**: professional forensics / monitored hosts; third-party API relay visibility into conversations; keyloggers capturing decrypted in-session content; brute force of weak passwords (mitigated by policy + lockout).

**Note**: an activated persona's `settings.json` is the mainstream **plaintext** Claude Code format (contains the key) — treat the USB as sensitive; pair with disk encryption for stronger protection.

## FAQ

- **Forgot an account password?** That account's data is unrecoverable; add a new account or delete the old one under "Account management".
- **Engine install fails?** Check network and USB free space (≥2GB); see the engine log; if it keeps failing, delete `engine/<platform>/staging` and retry.
- **Dialog mode says engine not installed?** Run ① check → ② confirm install first.
- **Drag-drop CC Switch settings.json does nothing?** It must contain `env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL`; unknown domains are treated as direct Anthropic-compatible endpoints.
- **Antivirus blocks start.bat?** Add the USB folder to exclusions.

## License

MIT. Portable-packaging reference: [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT).
