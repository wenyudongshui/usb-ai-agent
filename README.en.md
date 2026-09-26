# usb-ai-agent · Private AI Agent on USB

> Portable **Claude Code** + multi-account management console on a USB drive, zero host residue.

The web page is a **management console** (not a chat page). Conversation happens in the Claude Code terminal.

> Base note: the portable packaging layer (two-stage launcher, `data/` tree, Claude Code engine install with native-binary stub repair, OpenAI→Anthropic local adapter, loopback hardening, portable Ollama) is transplanted from
> [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT).

## Highlights

- **Multi-account login**: account names shown in a sidebar selector + "＋ add account"; passwords are never stored readably (scrypt-KEK-wrapped master key). A dev page can **delete** accounts.
- **Engine, check-then-install**: "① check installed/update" and "② confirm install/update" are two separate steps, with live logs and rollback.
- **API-key management**: two methods — manual fill, or **drag & drop a CC Switch settings.json** to import. Keys stored encrypted.
- **Profiles (work objects)**: create with only name / description / CLAUDE.md / persona (no provider/model/key); activating generates mainstream Claude Code `settings.json`.
- **Terminal launch**: opens Claude Code with the active API key + active profile; non-Anthropic providers auto-start a loopback adapter.
- **Exit, two modes only**: ① wipe everything + host residue; ② keep this session's host changes, clear all other data.
- Portable Node bootstrap; local Ollama offline models.

## Layout

```text
USB root/
├── start.bat / start.sh / clean.bat / clean.sh
├── package.json  LICENSE
├── lib/          server.js · paths.js · modules/ (auth · crypto · api-keys · profiles · providers · adapter · runtime · cleanup · usb · local-models)
├── dashboard/    login / main / exit
├── tools/        bootstrap · launcher · runtime-manifest · Setup_Local_Models.*
├── engine/       generated: portable Node + Claude Code
└── data/         generated
    ├── users.json
    └── users/<account>/
        ├── master.key.enc   # password-KEK-wrapped master key (ciphertext)
        ├── api.enc          # encrypted API-key configs
        ├── prefs.json
        └── profiles/<slug>/ # profile.json · CLAUDE.md · settings.json
```

## Security (honest)

Protected: loopback + Host/Origin guards; multi-account passwords not readable from files; API keys encrypted; zero remote persistence; account delete removes all its data. Not: forensics, relay visibility, keyloggers, weak passwords. Note: activated `settings.json` is mainstream Claude Code plaintext (contains the key) — treat the USB as sensitive.

## License

MIT. Packaging transplant reference: [ClaudeCode-Portable](https://github.com/techjarves/ClaudeCode-Portable) (MIT).