# usb-ai-agent · Private AI Agent on USB

> Private AI agent on USB — encrypted & portable, zero host residue, password-gated.
> 基于U盘的私有化AI智能体：配置/密钥/人设/记忆加密随盘携带，本机零残留，GUI密码认证。

**Version V4.0 · Pure USB + GUI Password**: no hardware token required — just a USB drive and a password. Fully implementable as-is.

---

## Overview

This project builds a **private AI agent system that treats a USB drive as its only data carrier**. All configuration, keys, agent personas and memory live exclusively on the USB drive; the host computer is only a temporary runtime — it never persists AI privacy data to disk. Authentication is a single **GUI password**, it supports dynamic switching between multiple AI configurations, and provides a two-tier cleanup: **manual cleanup on exit + best-effort cleanup on unplug** (followed by catch-up cleanup on next start).

**Use case**: using a personal AI assistant on a shared or temporary computer, where chat history, API keys and persona rules must travel with the USB stick, require a password to use, and leave nothing behind on the host.

### Design principles

- **Automate only what can be automated deterministically** — the program automates only actions it can complete reliably;
- **Tell the user what can't be done** — any cleanup the program cannot guarantee is left to an explicit manual step for the user;
- **Honest security boundary** — the docs and UI clearly state what is and isn't protected; no over-promising;
- **Single-credential principle** — authentication relies on one GUI password only; no hardware that needs extra drivers or setup.

### Security scope

**Protected:**

- Casual users of a shared computer cannot read leftover temp files;
- If the USB drive is lost, others cannot read config/memory directly (ciphertext unreadable without the password);
- A config file copied out alone cannot be read as plaintext (AES-256-GCM, key protected by the password).

**Not protected:**

- Professional forensics environments and monitored computers;
- Visibility of conversations to third-party API relay services;
- Brute force against a weak password (mitigated by password policy + login throttling);
- Keyloggers or other malware capturing already-decrypted session content while it runs.

## Key features

| Feature | Description |
|---|---|
| 🛡️ GUI password auth | The login password is both *access control* and the *data-encryption key source* (replaces the ESP32 hardware token) |
| 🔐 AES-256-GCM encryption | Config / keys / personas / memory all stored as ciphertext; scrypt-derived KEK protects the master key |
| 💾 Data never leaves the drive | Zero host persistence; sessions live only in memory and are released on exit |
| 🧹 Three-tier cleanup | Full cleanup on clean exit → best-effort on unplug → catch-up on next start; `clean.bat` wipes host residue |
| 🧠 Multi-AI isolation | Each AI has its own `config.enc / prompt.md / memory.enc`, never overwriting each other |
| 🌐 Multiple models | OpenAI-compatible protocol; one mechanism for DeepSeek / NVIDIA / OpenRouter / Ollama / etc. |
| 🖥️ Self-built local web shell | All pages self-contained and controllable, zero third-party dependencies (only a portable Node.js) |

## Quick start

1. Prepare a **USB drive** (8GB+ recommended, NTFS or exFAT) and lay out the structure below;
2. Extract a portable **Node.js** (Windows x64 zip, LTS) into `node\`;
3. Double-click `start.bat` — your browser opens `127.0.0.1:8787`;
4. **First run**: set a login password → add your first AI (model API key) → start chatting;
5. When done: click **Save & Exit / Exit without saving** → run `clean.bat` → unplug the drive.

> Tip: no administrator rights needed for normal use; consider adding the USB app directory to your antivirus exclusions.

## Directory layout

```text
USB root/
├── start.bat            # Double-click to launch: detect drive letter, start server, open browser
├── clean.bat            # One-click cleanup of host residue (reads keys\cache_path.txt)
├── README.txt           # Usage notes & user guide
├── app/                 # Self-built shell (Node.js)
│   ├── server.js        # Local web server (routing / static / session guard)
│   ├── modules/
│   │   ├── auth.js      # Password auth, key derivation, session tokens
│   │   ├── crypto.js    # AES-256-GCM encrypt/decrypt, scrypt KEK
│   │   ├── config.js    # AI config scanning & read/write
│   │   ├── ai.js        # OpenAI-compatible API client
│   │   ├── memory.js    # Memory store read/write
│   │   ├── cleanup.js   # Cleanup & cache_path management
│   │   └── usb.js       # Drive-letter watcher (unplug fallback)
│   └── public/          # Frontend pages (login / main / dev / exit)
├── node/                # Portable Node.js runtime
├── configs/ai_001/      # Per-AI directory (multiple allowed)
│   ├── config.enc       # Encrypted API config (base URL / model / key)
│   ├── prompt.md        # Persona & skill rules (plaintext, editable)
│   └── memory.enc       # Encrypted memory store
├── keys/                # Password-encrypted master key / cache_path / unclean flag
└── workspace/           # Default output directory for work files
```

## Tech stack

| Category | Choice |
|---|---|
| Runtime | Portable Node.js (Windows x64 zip, LTS) |
| Backend shell | Node.js built-ins (http / crypto / fs / child_process / fetch) — zero third-party deps |
| GUI | Self-built local web pages (HTML/CSS/JS) + 127.0.0.1 local server |
| Encryption | AES-256-GCM (node:crypto), random IV + auth tag |
| Password KDF | scrypt (built-in, N=2^15, r=8, p=1), ~0.2–0.5 s derivation |
| AI access | OpenAI-compatible (`/chat/completions`), native fetch |
| Cleanup | `clean.bat` + shell `cleanup` module |
| Platform | Windows 10 / 11 (Node is cross-platform: Win / macOS / Linux) |

## Architecture

Three layers:

1. **USB layer** — the only data source: launcher scripts, portable Node runtime, encrypted config, persona rules and memory store;
2. **In-memory runtime layer** — the Node server runs in host memory; the browser talks to `127.0.0.1`; no business data is persisted to the host disk;
3. **Network API layer** — OpenAI-compatible model endpoints do the reasoning.

### Data flow

```text
Run start.bat → detect drive letter → start Node server → browser opens login page
Enter password → scrypt-derive KEK → decrypt master key (memory only)
Pick an AI → decrypt config.enc, read prompt.md → build session context
Chat via /chat/completions → response appended to in-memory session
Only if "save memory" chosen → session summary encrypted back to memory.enc
Exit / unplug → cleanup runs; clean.bat removes host residue
```

### Password → key derivation chain

```text
GUI password ──scrypt(N=2^15,r=8,p=1,salt=16B)──▶ KEK(32B) ──decrypt──▶ MasterKey(32B) ──AES-256-GCM──▶ config.enc / memory.enc
```

- **Login check**: `master.key.enc` contains a magic string encrypted with the KEK; if it decrypts and validates, the password is correct;
- **Sessions**: a 32-byte random token (kept in an in-memory Map) is issued after login via an httpOnly + SameSite=Strict cookie; every protected page and `/api/*` route validates it; destroyed on logout / exit / timeout;
- **Anti-brute-force**: failed responses delayed 0.5 s; 5 consecutive failures lock login for 30 s (in-memory counter).

## Requirements

| Category | Item | Requirement |
|---|---|---|
| USB drive | Capacity | 8GB+ recommended (16GB preferred; Node ~200MB, shell + config <10MB) |
| USB drive | Port/speed | USB 3.0+; USB 2.0 works but starts slower |
| USB drive | Filesystem | NTFS preferred; exFAT for cross-device compatibility |
| Computer | OS | Windows 10 / 11 64-bit (Node is cross-platform; macOS/Linux need matching runtime) |
| Computer | RAM/ports | 4GB+ RAM (8GB recommended), USB port |
| Computer | Permissions/AV | No admin rights needed; add the USB app dir to AV exclusions |
| Network | Model service | At least one OpenAI-compatible API key; multiple configurable |
| Network | Proxy | Overseas model services need a compliant proxy/relay; local models (e.g. Ollama) optional as offline fallback |

> Hardware requirement is simply *a usable USB drive + an internet-connected computer*. No hardware token.

## Testing & acceptance

- **Functional**: startup & self-check; first-run password setup; login / wrong password / 5-try lock; multi-AI switching; persona effect; save vs. don't-save exit;
- **Cleanup**: no residue in host temp dirs after exit; workspace outputs intact; no business files on host after unplug; clean.bat re-runnable;
- **Security**: any `/api/*` unauthenticated returns 401; the three `.enc` files unreadable as plaintext; 5 wrong passwords trigger the lock; changed password invalidates the old one;
- **Edge cases**: direct unplug; offline; AV warnings; write-protected drive; missing Node runtime; port occupied (auto-increments from 8787).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Antivirus false positives | Optional code signing, guide users to add exclusions, avoid self-destruct-like behavior patterns |
| API unavailable / rate limited | Multiple AI / keys with failover |
| Relay sees conversations | UI discloses cloud visibility; sensitive tasks use a local model (e.g. Ollama) |
| USB lost / damaged | Back up workspace; memory export; ciphertext unreadable — reinitialize on loss |
| Forgotten password | Documented: data unrecoverable, reinitialize; suggest a password manager |
| Port occupied | Probe for a free port at startup (increment from 8787) |
| Multi-computer use | Data lives only on USB, never the host — inherently conflict-free |

## Extension roadmap (optional)

V4.0 is the minimal closed loop — *pure USB + password*. Everything below layers onto the same shell without disturbing the main line:

### Hardware

- **ESP32 hardware token / fingerprint**: optional stronger auth factor stacked on top of the password (integration point: an extra check in auth.js);
- **Secure Element (SE) + TPM integration**: keys resistant to physical extraction; USB + host dual auth;
- Voice interaction, status display, power-loss protection, etc.

### Software

- AI skill plug-in system (package Prompt + function-call schemas as plug-ins);
- Memory vector search (local lightweight embeddings for long-term / similarity recall);
- Smart routing (pick a model per task type to balance cost & quality);
- Session export & migration (standard format, continue across devices);
- Audit logging (written only to the USB, encrypted).

### Scenarios

- Team sharing (multi-fingerprint multi-role, each with isolated AI config & memory);
- Guest mode (read-only public AI when unauthenticated).

## References & acknowledgments

This project references and builds on the following open-source project:

- **ClaudeCode-Portable** (a.k.a. **OpenClaude-Portable**)
  - GitHub repository: <https://github.com/techjarves/ClaudeCode-Portable>
  - License: MIT
  - What we take from it: the portable-deployment approach — one-click deployment of the Node runtime into the USB drive's `node\` folder. On top of it, this project adds a self-built privacy shell: encryption, password auth, multi-AI isolation, and exit/unplug cleanup.

## License

The license of this repository is governed by the `LICENSE` file in the repo; the referenced upstream project ClaudeCode-Portable is MIT-licensed.
