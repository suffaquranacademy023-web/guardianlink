# GuardianLink for Windows

.NET 8 WPF. **Not compiled in the authoring sandbox** (Linux, no .NET SDK / no Windows) — build on Windows:

    dotnet publish GuardianLink -c Release -r win-x64 --self-contained -o publish
    iscc installer.iss            # Inno Setup 6 → Output\GuardianLink-Setup.exe

Edit `GuardianLink/server.txt` (https URL) before publishing. Sign the installer with your code-signing certificate and publish its SHA-256 in RELEASES.md.
The app is a normal visible window (no hidden mode, no silent autostart; a tray icon is a future task); “Leave family” and a normal uninstaller are always available.
