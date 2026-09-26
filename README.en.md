# usb-ai-agent · Private AI Agent on USB

> Portable **Claude Code** on a USB drive + management console + switchable provider/prompt profiles, zero host residue.

**Positioning**: the web page is a **management console** (engine / providers / prompt profiles / local models), **not a chat page**. Conversation happens in the Claude Code terminal — Claude Code itself is the engine, carried on the drive.

> **Base note**: the portable packaging layer (two-stage launcher, `data/` tree, Claude Code engine install with native-binary stub repair, OpenAI→Anthropic local adapter, loopback hardening, portable Ollama) is transplanted from
> [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT). The password gate, crypto, and profile model are self-developed.

## What it does

- **Engine manager**: install/update/rollback the pinned official Claude Code into `engine\<platform>\current` (USB-safe `--no-bin-links` + stub repair).
- **Profile manager (CC-switch style, built-in)**: each profile is a work-object → a real Claude Code config dir `data/profiles/<slug>/` with `settings.json` (env + `systemPrompt`) + `CLAUDE.md`. Activate = switch `CLAUDE_CONFIG_DIR` + cwd. No extra tool needed.
- **Providers**: Anthropic / DeepSeek / OpenRouter / NVIDIA / Gemini / OpenAI / Ollama / LM Studio / Custom. Non-Anthropic go through a loopback OpenAI→Anthropic adapter.
- **Prompt library**: each profile has its own `systemPrompt` + `CLAUDE.md` (per work object), saved in the mainstream format, switchable.
- **Launch**: "命令行对话" opens a terminal with the active profile; type and go.
- **GUI password gate** + zero host residue + multi-tier cleanup + portable Node bootstrap + local Ollama.

## Quick start

1. Copy this repo to a USB root (≥8GB, NTFS/exFAT).
2. Run `start.bat` (or `./start.sh`) — first run auto-downloads pinned portable Node (~30MB).
3. Browser opens the console → set a **password**.
4. Click **Install / Update engine** → downloads pinned Claude Code (~300MB) into `engine\`.
5. Create a **profile** (provider/model/key + prompt) → activate → **🚀 命令行对话**.
6. Work in the terminal; return for command-line claude yourself or later change password. When done, "安全退出".

## Layout

```text
USB root/
├── start.bat / start.sh           # two-stage launcher (bootstrap → launcher)
├── clean.bat / clean.sh
├── package.json  LICENSE
├── lib/
│   ├── server.js                  # console HTTP (auth/session/loopback hardening)
│   ├── paths.js
│   └── modules/  auth · crypto · profiles · providers · adapter · runtime · cleanup · usb · local-models
├── dashboard/                      # console pages (login / main / exit)
├── tools/  bootstrap.ps1/.sh · launcher.mjs · runtime-manifest.json · Setup_Local_Models.*
├── templates/prompt.md
├── engine/                         # generated: portable Node + Claude Code
└── data/                           # generated
    ├── profiles/<slug>/ profile.json · settings.json · CLAUDE.md
    ├── keys/ cache/ logs/ npm-cache/ launch/ models/ ollama/
```

## Security (honest)

Protected: loopback-only + Host/Origin (DNS-rebind) guards; password gate; zero remote persistence; exit cleanup. **Not**: forensics, relay visibility, keyloggers, weak passwords. Note: profile `settings.json` is the **mainstream plaintext format Claude Code reads** (includes API key) — treat the USB as sensitive.

## License

MIT. Packaging transplant reference: [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT). See LICENSE.