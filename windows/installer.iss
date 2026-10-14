; Inno Setup script — build with: iscc installer.iss  (after: dotnet publish GuardianLink -c Release -r win-x64 --self-contained -o publish)
[Setup]
AppName=GuardianLink
AppVersion=2.0.0
AppPublisher=GuardianLink
DefaultDirName={autopf}\GuardianLink
DefaultGroupName=GuardianLink
UninstallDisplayIcon={app}\GuardianLink.exe
OutputBaseFilename=GuardianLink-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
; Sign the output with signtool (SignTool= directive) once you have a code-signing certificate.
[Files]
Source: "publish\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
[Icons]
Name: "{group}\GuardianLink"; Filename: "{app}\GuardianLink.exe"
Name: "{group}\Uninstall GuardianLink"; Filename: "{uninstallexe}"
[Run]
Filename: "{app}\GuardianLink.exe"; Description: "Launch GuardianLink"; Flags: nowait postinstall skipifsilent
; The app is NOT auto-started or hidden. Users start it from the Start menu and can uninstall it normally.
