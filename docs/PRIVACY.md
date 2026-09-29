# Privacy

Flight Recorder is a **local** timeline for a machine you already control. It is not a monitoring product for other people.

## Who this is for

- You, on your own PC.
- Developers reconstructing “what just happened” after a spike, a failed build, or a crash.

## Who this is not for

- Employers silently monitoring staff.
- Parents or partners using it as spyware.
- Cloud analytics, telemetry vendors, or uploading other people’s activity.

If you need those things, this repo is the wrong tool. Do not run the collector on a machine unless you are allowed to inspect that machine.

## What is recorded

Each event is a small record: timestamp, kind, title, optional JSON detail, optional process id, severity.

v1 kinds:

- App start / exit / foreground change (process name, not window contents)
- Download file **names and paths** from watched folders
- CPU / memory spikes and long `node` / `cargo` style build processes
- Best-effort crash signal when Windows Error Reporting appears
- Manual “mark a moment” pins you create from the phone or browser

## What is never recorded

- Keystrokes
- Clipboard
- Passwords
- Message or document contents
- File insides (downloads are name + path only)
- Screenshots of other apps
- Microphone or camera

## Where data lives

SQLite on disk, default path:

`%LOCALAPPDATA%\flight-recorder`

Nothing is uploaded to a server we run. The phone UI is a viewer on the same LAN after pairing. Localhost can open the timeline without a code. Demo mode does not listen on the LAN.

## Who can connect

- Pages served by this app, on localhost or on a LAN address of this PC.
- A paired phone, after it enters the short-lived pairing code.
- The tray helper on this PC.

A website you happen to have open cannot read the timeline. The server refuses cross-site browser requests, refuses a `Host` header that is not this machine, and does not send a wildcard CORS header. Pairing guesses are limited to eight failures in ten minutes.

The pairing token is stored in `%LOCALAPPDATA%\flight-recorder\pairing.json` so a phone stays paired across restarts. Refreshing the code does not disconnect a phone that already paired. Delete that file to require pairing again.

## Controls

- Pause from the tray, settings, or `POST /api/pause`
- Wipe the database in one click (settings)
- Retention: 24 hours, 7 days (default), or 30 days, then events are dropped
- Export last 24 hours as JSON only when you ask

## Open source

The collector is in this repository so you can audit what it samples. If a future change cannot keep the promises above, that kind of event should not ship.
