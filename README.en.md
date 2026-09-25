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

## Core module design

### Encryption & key management

- Each AI's `config.enc` / `memory.enc` is JSON, serialized and AES-256-GCM encrypted (random IV + auth tag — tamper-evident);
- The master key is a 32-byte random value generated on first run, wrapped by the KEK into `keys\master.key.enc`;
- The KEK is scrypt-derived from the GUI password: a wrong password cannot unwrap the master key, so **copy-the-whole-drive** and **read-a-single-file** defenses are both carried by the password;
- Dev mode can change the password: unwrap with old key → re-derive KEK → re-wrap and write back;
- Keys stay ciphertext alongside the program; no plaintext key ever touches the host.

### GUI password auth & session management

- First run: no `master.key.enc` → setup-password page (min 8 chars, upper/lowercase + digit) → generate master key + KEK;
- Login: `POST /api/login` issues a session token on success; 5 consecutive failures lock for 30 s;
- Session: token in an in-memory Map; 10 min idle expiry; destroyed on logout/exit;
- Guard: protected pages (main/dev) redirect to login when unauthenticated; `/api/*` returns 401 on invalid sessions;
- Dev mode: re-entering the password is required to open the dev page; destructive actions (password change, memory delete) need confirmation.

### Multi-AI config & isolation

- Scans `configs\` for all `ai_*` folders;
- Each AI has its own folder: `config.enc` (API config), `prompt.md` (persona), `memory.enc` (memory) — never overlapping;
- Picking an AI decrypts its config and spins up an independent session context (in-memory `Map<aiId, messages>`);
- Switching AIs keeps sessions fully separate; all decrypted data is released on exit.

### Persona & memory

- **Persona injection**: the full `prompt.md` is read as the system message — role definition, skill rules, output format and behavior constraints; templates come only from local USB files, never downloaded;
- **Memory store**: `memory.enc` holds a JSON array of messages; saving memory appends a session summary (`role:"summary"` + timestamp);
- **Memory load**: on session start the stored memory can be fed into context (user's choice);
- Dev mode supports memory delete / export / archive.

### Sessions & three-tier cleanup

- Session context lives only in memory and is released when it ends;
- Save memory → summary encrypted to `memory.enc`; don't save → context simply dropped;
- Three tiers: full cleanup on clean exit → best-effort on unplug → catch-up on next start;
- Mechanism: on startup the app writes its cache directory paths to `keys\cache_path.txt`; `clean.bat` reads it and deletes those dirs plus host workspace residue; it never touches the pagefile or system logs.

### Dev mode

- Requires re-entering the password;
- AI config CRUD with an automatic low-cost connectivity test before saving (max_tokens=1, no key printed);
- Prompt template editor;
- Memory delete / export / archive;
- Password change & reset.

## Usage flows

### First start

```text
Plug in USB → run start.bat → self-check (node.exe present, drive writable)
→ set initial password → config wizard (add first AI's API key) → pick AI → start session
```

### Normal use

```text
Run start.bat → enter password → pick AI → start session
→ chat (context in memory) → switch AIs anytime (each session independent)
```

### Exit (main path)

```text
Click "Save & Exit" or "Exit without saving" → destroy sessions, close connections, release memory
→ dialog shows cleanup notice → run clean.bat → unplug
```

### Unplug fallback

```text
Background thread checks the drive letter every 1 s → on disappearance
→ best-effort memory cleanup + write keys\unclean.flag → next start shows a catch-up-cleaning notice
```

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

## Implementation steps (each phase independently shippable)

Five phases, each with its own acceptance criteria. Completing all of them yields a working minimal loop.

### Phase 1: Project skeleton & login auth

**Goal**: double-click to run; login page can set & verify a password; nothing reachable without login.

1. Create the USB directory structure: `app\`, `node\`, `configs\`, `keys\`, `workspace\` with placeholder `start.bat`, `clean.bat`, `README.txt`;
2. Deploy portable Node: download the Windows x64 zip (LTS, e.g. v22.x) from nodejs.org, extract into `node\`, verify with `node\node -v`;
3. Write `app\server.js`: `http.createServer` on `127.0.0.1:8787`; serve static files by extension; route `/api/*` to handlers, everything else to `app\public\`; session middleware parsing the token cookie against an in-memory SessionMap;
4. Write `app\modules\crypto.js`: `randomKey()` (32 bytes); `encrypt/decrypt` (AES-256-GCM, JSON → `{iv, tag, data}` base64); `deriveKEK(password, salt)` (scrypt);
5. Write `app\modules\auth.js`: first run detects missing `master.key.enc` → generate master key + random salt → deriveKEK → write wrapped key, return "needs setup"; `login()` verifies magic → cache MasterKey in memory → issue token; failure counter, 5 tries → 30 s lock;
6. Write `app\public\login.html`: password input + error display; `GET /api/setup` (first-run check), `POST /api/login`, `POST /api/logout`;
7. Protected-page guard: main.html / dev.html call `GET /api/session` on load, redirect to login if absent; `/api/*` unified 401;
8. Write `start.bat`: `%~d0` for the drive letter → check `node\node.exe` → launch in background → `open http://127.0.0.1:8787` after a delay.

**Acceptance**: first run shows the setup-password page; wrong password rejected, 5 tries → 30 s lock; correct password lands on main; direct access to main.html unauthenticated gets redirected.

### Phase 2: Encryption & config storage

**Goal**: AI config encrypted to disk; wizard can create entries and test connectivity.

1. Write `app\modules\config.js`: `scanConfigs()` walks `configs\` for `ai_*\`, decrypts `config.enc`, reads `prompt.md`, returns a list (API keys masked); `readConfig/writeConfig` wrap encrypted I/O;
2. New-AI wizard: form (name, base URL, model, API key, optional temperature) → create `ai_XXX\` folder → AES-encrypt JSON into `config.enc`, plus default `prompt.md` and empty `memory.enc`;
3. Connectivity test: `POST /api/test` → `fetch` `{baseURL}/chat/completions` with max_tokens=1, 10 s timeout; pass/fail feedback; never prints the key;
4. Self-check: opening `config.enc` shows base64 ciphertext, not plaintext JSON.

**Acceptance**: new AI → connectivity passes → still decryptable after restart; `config.enc` unreadable; unauthenticated `/api/ais` returns 401.

### Phase 3: Multi-AI & chat

**Goal**: pick an AI and chat; sessions isolated; persona active.

1. Write `app\modules\ai.js`: `chat(ai, messages)` → `{baseURL}/chat/completions`, body `{model, messages, temperature}`, unified error handling (timeout / 401 / network); optional SSE streaming;
2. Add routes in server.js: `POST /api/ai/select` (record current AI, cache decrypted result); `POST /api/chat` (assemble messages: system = full prompt.md + optional memory + session history → call ai.chat → append to in-memory session);
3. Write `app\public\main.html`: top AI-switcher bar (cards, active highlighted); persona summary; message bubbles, input, send, "save memory" toggle; error area (offline / invalid key / rate limit);
4. Session context isolation: in-memory `Map<aiId, messages[]>`; switching AIs reads/writes independent contexts;
5. Persona test: put a role rule in `prompt.md` and confirm the chat follows it.

**Acceptance**: login → pick AI → chat works; switching AIs doesn't leak context; persona takes effect; offline produces a clear error.

### Phase 4: Memory & dev mode

**Goal**: memory persisted encrypted; dev page handles config CRUD, prompt editing, memory management and password change.

1. Write `app\modules\memory.js`: `read(aiId)` decrypts memory.enc; `saveSummary(aiId, summary)` appends `{role:"summary", content, ts}` and re-encrypts; export / archive / clear endpoints;
2. Session-end handling: on "Save & Exit" with the toggle on → build summary → encrypt back;
3. Write `app\public\dev.html`: second password check; AI list + CRUD + connectivity test; prompt editor; memory management (view / export / archive / clear); password change;
4. Add `/api/dev/*` routes, all under the double guard: session + dev second check.

**Acceptance**: saving memory survives restart; exported JSON readable; old password fails & new one works after change; deleting one AI doesn't affect the rest.

### Phase 5: Cleanup, unplug fallback & polish

**Goal**: exit / unplug leaves no residue; edge cases handled; deliverables complete.

1. Write `app\modules\cleanup.js`: `registerCachePath()` writes its cache dir paths to `keys\cache_path.txt` at startup; `cleanupLocal()` deletes listed dirs, cleans host workspace cache, closes active connections;
2. Write `clean.bat`: reads `cache_path.txt`, deletes each entry with feedback; usage notice; never touches pagefile or system logs;
3. Exit flow: page offers "Save & Exit / Exit without saving" → backend destroys sessions and calls cleanupLocal → dialog reminds to run clean.bat then unplug;
4. Write `app\modules\usb.js`: background thread polls the drive letter every 1 s; on disappearance → best-effort cleanup + write `keys\unclean.flag`;
5. Next-start detection: if unclean.flag exists → banner after login: "last exit was abnormal, please run clean.bat to finish cleaning";
6. README.txt: startup, exit flow, cleanup notice, security boundary (cloud visibility etc.), FAQ, forgotten-password note;
7. UI polish: consistent styling; login page shows a security notice.

**Acceptance**: clean exit → no project residue in host %TEMP%; direct unplug → catch-up notice on next start; clean.bat re-runnable; start.bat not blocked by AV (or excluded).

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

## License

Some design aspects reference the open-source project [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT). See the LICENSE file in this repository for details.
