# 🔒 usb-ai-agent · Private AI Agent on USB

> **Portable Claude Code on a USB drive — management console, single account, zero host residue.**

![license](https://img.shields.io/badge/license-MIT-blue) ![runtime](https://img.shields.io/badge/runtime-Node.js_24-green) ![deps](https://img.shields.io/badge/dependencies-0-brightgreen)

---

## The problem it solves

On shared or borrowed machines you don't want your **API keys, prompts, and accounts** left behind. This project puts everything on a USB drive:

- **Engine**: the official **Claude Code** CLI, portable and install-free.
- **Config**: one account binds **multiple agents (API configs)** and **multiple work personas**.
- **Data**: keys encrypted, passwords never stored readably, cleaned on exit — zero host persistence.

The web page is a **management console** (engine / agents / personas / local models), not a chat page. Conversation happens in the **Claude Code terminal**.

> **Base**: the portable packaging layer (two-stage launcher, `data/` tree, engine install with native-binary stub repair, OpenAI→Anthropic local adapter, loopback hardening, portable Ollama) is transplanted from
> [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT). The single-account / agent / persona model is self-developed.

## Highlights

| Feature | Description |
|---|---|
| 🔐 **Single account** | First use sets an account name + password (no confirm); later the same name+password logs in; no account management UI |
| 🤖 **Agents (API configs)** | Multiple per account; **manual entry** or **drag-drop a CC Switch settings.json** to import; keys AES-256-GCM encrypted |
| 🧠 **Work personas** | Only name / description / persona / CLAUDE.md; activating writes mainstream Claude Code `settings.json` |
| 🚀 **CLI conversation** | Launches Claude Code in the terminal with the active agent + persona |
| 🛡️ **Security** | Loopback-only + Host/Origin (DNS-rebind) guards; zero host persistence; multi-tier residue cleanup |
| 🏠 **Offline** | Portable Ollama engine + GGUF models, usable without internet |
| ⚡ **Portable Node bootstrap** | First run auto-downloads a pinned Node.js (SHA256-verified) into `engine/` |

## Flow

```
① environment check → ② choose agent → ③ choose work persona → ④ launch CLI
```

1. Copy the repo to a USB root (≥8GB); run `start.bat` (or `./start.sh`).
2. Login page: first use sets an **account name + password** (no confirm); later the same name+password logs in.
3. **① Environment check**: "check installed/update" and "confirm install" are two separate steps (~300MB).
4. **② Choose agent**: manual entry, or **drag-drop a CC Switch settings.json** to import; select as current.
5. **③ Choose work persona**: create (name/description/persona/CLAUDE.md) and activate.
6. **④ Launch**: press "命令行对话" to open the Claude Code terminal.

## Layout

```text
USB root/
├── start.bat / start.sh          # two-stage launcher: bootstrap → launcher
├── clean.bat / clean.sh          # one-click host-residue cleanup
├── lib/                          # backend (Node.js built-ins only, zero deps)
│   ├── server.js  paths.js
│   └── modules/                  # auth · crypto · agents · personas
│                                 #  · providers · adapter · runtime · cleanup · usb · local-models
├── dashboard/                    # login / main(flow) / exit
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

**Protected**: loopback-only + Host/Origin (DNS-rebind) guards; password never stored readably; agent keys encrypted; zero remote persistence.

**Not**: professional forensics / monitored hosts; third-party API relay visibility into conversations; keyloggers capturing decrypted in-session content; brute force of weak passwords (mitigated by policy + lockout).

**Note**: an activated persona's `settings.json` is the mainstream **plaintext** Claude Code format (contains the key) — treat the USB as sensitive; pair with disk encryption for stronger protection.

## FAQ

- **Forgot the account password?** That account's data is unrecoverable; delete `data\users\` (or the whole `data\`) to re-initialize (single account, no management UI).
- **Engine install fails?** Check network and USB free space (≥2GB); see the engine log; if it keeps failing, delete `engine/<platform>/staging` and retry.
- **CLI doesn't launch?** Make sure the engine is installed and an agent + persona are active.
- **Drag-drop CC Switch settings.json does nothing?** It must contain `env.ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_MODEL`; unknown domains are treated as direct Anthropic-compatible endpoints.
- **Antivirus blocks start.bat?** Add the USB folder to exclusions.

## License

MIT. Portable-packaging reference: [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT).
