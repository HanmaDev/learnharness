# Laptop + PC sync — plan (2026-11-08)

Decisions: OneDrive folder, one device at a time · laptop is Windows · move Ucenje into OneDrive · keys entered per device (never synced) · if the other device still has the app open: warn, then allow "use it here anyway".

## Where things live after the change

| What | Where | Synced |
|---|---|---|
| App data (chats, cards, notes, graph, settings, study time) | `OneDrive\LearnHarness\data` | yes |
| Course material (Kursevi, Lekcije, Anki, Beleske, LearnHarness-izvori, Plan.md, Napredak.md, README.md …) | `OneDrive\Ucenje` | yes |
| `Documents\Ucenje` | a **junction** (link) to `OneDrive\Ucenje`, on both devices — so every old path like `C:\Users\computer\Documents\Ucenje\Kursevi\…` in your lessons keeps working | — |
| LearnHarness source code (3.4 GB with node_modules) | moved out to `Documents\LearnHarness` (it is on GitHub; never goes to OneDrive) | no |
| Keys (`auth.json`), Claude Code / ChatGPT logins, window state, caches | per device in `%APPDATA%\LearnHarness` | no |
| Automatic backups | per device, `Documents\LearnHarness-rezervne-kopije` (local, so a bad sync can't destroy them) | no |

If the laptop's Windows user name is not `computer`, the app also rewrites old `C:\Users\computer\Documents\Ucenje\…` paths to that device's Ucenje folder when the teacher reads files.

## What gets built

1. **Data folder setting (per device).** `%APPDATA%\LearnHarness\sync.json` holds this device's data folder and Ucenje folder. The app starts its server on that folder. Settings → General → "Sinhronizacija" shows the current folders, OneDrive status and the device name.
2. **Move to OneDrive (this PC, once).** A button copies the data to `OneDrive\LearnHarness\data`, verifies every file, switches to it, restarts the app, and keeps the old local folder as a backup. The files are pinned "always keep on this device" so OneDrive never turns them into online-only placeholders.
3. **Laptop first start.** If the app finds `OneDrive\LearnHarness\data` with your courses and no local data, it asks "Koristi podatke iz OneDrive-a?" and switches to it.
4. **Device lock.** While open, the app writes `device-lock.json` (device name, since, a heartbeat every minute) in the data folder and removes it on quit. On start, if another device's lock is fresh (< 10 min): a window says "Otvoreno na LAPTOP od 14:05 · poslednji signal pre 2 min" with "Sačekaj" (close) and "Koristi ovde ipak". While running, if the other device takes over, this one shows a notice, makes a backup and closes, so the two never write at the same time.
5. **Conflict copies.** If OneDrive still produced a conflict copy (`chat_x-LAPTOP.json`), the app never drops either version: a chat copy becomes a separate course "(kopija sa LAPTOP) …"; study-time copies are merged; other files' copies are moved to the backup folder.
6. **Paths and folders.** Notes go to `<Ucenje>\Beleske` on each device; the teacher's allowed file folders follow this device's Ucenje folder.
7. **Laptop setup guide** (in the plan folder): install OneDrive + sign in, wait for sync, run `LearnHarness-instalacija.exe`, install Claude Code and log in, paste the Deepgram key once.

## The one-time move on this PC (I do it, after a full backup)

1. Close the app; full backup of `%APPDATA%\LearnHarness` and `Documents\Ucenje` (without node_modules).
2. Move the source code `Documents\Ucenje\LearnHarness` → `Documents\LearnHarness` (update the build script and my notes).
3. Move the rest of `Documents\Ucenje` → `OneDrive\Ucenje`; replace `Documents\Ucenje` with a junction to it.
4. Start the new app and use "Move to OneDrive" for the data; verify both courses open, cards, notes, stats.

Consequence: this Claude Code project folder (`Documents\Ucenje`) keeps working through the junction; the code moves to `Documents\LearnHarness`.

## Order of work

Build → tests (lock, conflict handling, path remap, setup flows on copies in temp folders) → reviewer pass → installer → the one-time move above → install → verify on this PC. The laptop part is yours (guide), and I can check it remotely only if you later run Claude Code there.
