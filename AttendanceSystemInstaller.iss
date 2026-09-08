; ------------------------------------------------------------
; Attendance System – Inno Setup 7 Installer
; ------------------------------------------------------------

[Setup]
AppName=Attendance System
AppVersion=1.1.0
AppPublisher=Your School
DefaultDirName={pf}\AttendanceSystem
DefaultGroupName=Attendance System
OutputDir=Output
OutputBaseFilename=AttendanceSystemSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
AllowNoIcons=yes

[Files]
Source: "dist\main.exe";          DestDir: "{app}"; Flags: ignoreversion
Source: "python_app\attendance.db";  DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "python_app\.encryption_key"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "frontend\*";             DestDir: "{app}\frontend"; Flags: recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Attendance System";       Filename: "{app}\main.exe"
Name: "{userdesktop}\Attendance System"; Filename: "{app}\main.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Run]
Filename: "{app}\main.exe"; Description: "Launch Attendance System"; Flags: nowait postinstall skipifsilent
