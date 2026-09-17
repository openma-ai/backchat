# Local host power management

Power protection is automatic; no settings switch is required.

Backchat holds an Electron `prevent-app-suspension` assertion while it hosts an
OpenMA runner, including idle availability and temporary network loss. Local
prompt queue snapshots also hold it while a local turn, queued prompt or steering
turn is active. Pair sessions use the same activity sink before UI routing.
Cancellation requests do not release the assertion prematurely: the host's next
activity snapshot or session disposal settles it. Screen sleep is allowed.
Cloud-only observations do not acquire an assertion.

Closing windows preserves an enabled Backchat runner and its assertion. Disabling
the runner releases its hold; outstanding local tasks retain their own hold.
Explicit Quit first asks for confirmation when Backchat owns local agent processes
or a runner. Cancel keeps all processes running. Confirming terminates local
sessions and releases the assertion; there is no task handoff. This
does not make the embedded runner independent of the desktop process.

Electron's `powerMonitor.resume` refreshes the runner transport and active remote
task subscriptions. Native sessions, subscription owners and durable cursors
survive; user prompts are never resent. Disabled or expired runners stay stopped.

The standalone `oma bridge daemon` also automatically prevents idle sleep, from
host startup through shutdown/drain. Its outer platform adapter uses macOS
`caffeinate -i -w <daemon-pid>`, Linux `systemd-inhibit`, or Windows
`SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` through PowerShell.
Assertions end with the owner: macOS watches its PID; Linux/Windows watch pipe
EOF. Missing tools or denied OS requests warn and retry every 30 seconds without
preventing the daemon from serving tasks.

Process supervision remains the existing OpenMA service installation: launchd
KeepAlive and systemd Restart=always on macOS/Linux. Windows currently uses a
logon task; this change does not add Windows crash-restart settings. Backchat does
not silently replace an independently managed daemon or install a second service.
An updated build must be launched for these changes to apply to an existing host.

These are idle-sleep assertions, not a guarantee against explicit sleep, lid
closure, shutdown or OS policy. Linux requires systemd/logind and permission to
acquire an inhibitor. macOS native assertions have been exercised; Linux/Windows
native power APIs require platform integration validation.

References: [Electron powerSaveBlocker](https://www.electronjs.org/docs/latest/api/power-save-blocker),
[Electron powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor),
[Windows SetThreadExecutionState](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate),
and the installed macOS caffeinate(8) manual.
