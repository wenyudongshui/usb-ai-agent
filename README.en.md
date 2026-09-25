# usb-ai-agent · Private AI Agent on USB

> Private AI agent on USB — encrypted & portable, zero host residue, password-gated.

**V4.0 · Pure USB + GUI password**: one USB drive + one password, nothing else. Implementable end-to-end.

> **Base note**: the portable packaging layer (two-stage launcher, `data/` tree, portable Ollama local models, loopback hardening) is transplanted from
> [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT — see LICENSE). The product itself (password gate,
> AES-256-GCM encryption, multi-AI isolation, chat shell) is self-developed.

---

## Overview

A private AI agent whose only data carrier is a USB drive. All configs, keys, persona rules and memory live on the drive; the host machine is a temporary runner and persists nothing. A **GUI password is the single credential**; supports multiple AI profiles, SSE streaming chat, and a multi-tier residue-cleanup policy.

**Use case**: use a personal AI assistant on shared/borrowed machines without leaving sensitive data (conversations, API keys, persona, memory) on that machine.

### Design principles

- Automate only what is deterministic; surface everything else to the user with explicit instructions.
- Honest security boundary: document both what is protected and what is not.
- Single credential: one GUI password; no hardware token / driver dependency.
- Zero third-party dependencies: only Node.js built-ins (`http`, `crypto`, `fs`, `fetch`).

### Security boundary (honest)

**Protected:** residue files not inspectable by other host users; ciphertext unreadable without the password; AES-256-GCM (random IV + auth tag) so a copied config file yields nothing; service binds loopback only, with Host/Origin (DNS-rebind) checks.

**Not protected:** professional forensics / monitored hosts; third-party API relays' visibility into conversation content; brute-force of weak passwords (mitigated by policy + lockout); keyloggers capturing decrypted in-session content.

## Quick start

1. Copy this repo to a USB drive root (≥8GB, NTFS or exFAT).
2. Double-click `start.bat` (mac/Linux: `./start.sh`). First run auto-downloads a pinned portable Node.js (~30MB, SHA256-verified) into `engine\`.
3. Browser opens `127.0.0.1:<free port>`. First use: set a password → add an AI (API base/model/key, optional connectivity test) → chat.
4. On exit: click **Save & Exit** or **Exit without saving** → host residue is cleaned automatically → unplug (optionally run `clean.bat`).

> Local/offline: run `tools\Setup_Local_Models.bat` once to install a portable Ollama engine + GGUF models; chat works without internet afterwards.

## Layout

```text
USB root/
├── start.bat / start.sh          # two-stage launcher (bootstrap → launcher)
├── clean.bat / clean.sh          # one-click host-residue cleanup
├── package.json                  # metadata only (zero dependencies)
├── LICENSE                       # MIT
├── lib/                          # self-developed shell
│   ├── server.js                 # HTTP router / SSE / session guard / loopback hardening
│   ├── paths.js                  # unified path resolution (PORTABLE_AI_DATA_DIR override)
│   └── modules/                  # auth · crypto · config · ai · memory · cleanup · usb · local-models
├── dashboard/                    # web pages (login / main / exit)
├── tools/                        # portable packaging base (from upstream)
│   ├── bootstrap.ps1 / .sh       # download + verify pinned Node → engine\
│   ├── launcher.mjs              # dashboard | status | clean | local-setup
│   ├── runtime-manifest.json     # pinned Node version
│   └── Setup_Local_Models.*      # portable Ollama + local model installer
├── templates/prompt.md           # persona seed (copied on AI creation)
├── engine/                       # generated: portable Node runtime
└── data/                         # generated (PORTABLE_AI_DATA_DIR override)
    ├── keys/                     # master.key.enc · cache_path.txt · unclean.flag
    ├── configs/ai_XXX/           # config.enc · prompt.md · memory.enc
    ├── workspace/ · logs/ · models/ · ollama/
```

## Security / crypto chain

- Password → scrypt (`N=2^15, r=8, p=1`, 16B salt) → KEK → unwrap 32B master key (magic `USB-AI-V4` check).
- Master key → AES-256-GCM for every `config.enc` / `memory.enc` / `master.key.enc`.
- Sessions: 32-byte random token, in-memory only, `HttpOnly + SameSite=Strict`, 10-min idle timeout; 5 failed logins → 30s lock (plus 0.5s per-failure delay).

## License

MIT. Packaging patterns reference [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT). See LICENSE in this repository.
