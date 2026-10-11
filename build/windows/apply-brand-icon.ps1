# Applies the persisted GoNavi brand icon to the installer-created shortcuts
# during an MSI install, so a reinstall restores the previously selected icon
# before the first launch: the in-app restore only runs once GoNavi starts,
# which left a reinstalled machine on the default icon until then.
# The data-root resolution mirrors internal/appdata/root.go: the root defaults
# to <USERPROFILE>\.gonavi and can be redirected by the dataRoot field of
# <USERPROFILE>\.gonavi\storage_root.json. The brand state lives in
# <dataRoot>\application-icons\active-icon.txt (empty content = cleared) next
# to the content-addressed gonavi-brand-*.ico files. The installing user's
# profile is derived from the MSI AppDataFolder property because the deferred
# action runs as SYSTEM. Every failure is logged and ignored: the install must
# never fail for a cosmetic restore, and a machine without persisted state
# keeps the default icon.
param(
    [string]$ApplicationDataFolder,
    [string]$StartMenuShortcut,
    [string]$DesktopShortcut,
    # Uninstall mode: remove the app's user-layer leftovers (the startup
    # migration moves the machine Start Menu shortcut into the user profile,
    # so MSI RemoveFiles never sees it, and the taskbar pin keeps launching
    # the uninstalled executable).
    [switch]$UninstallCleanup,
    [string]$ExpectedTarget
)

$ErrorActionPreference = 'Stop'

function Write-ApplyBrandIconLog {
    param([string]$Message)

    try {
        if (-not [string]::IsNullOrWhiteSpace($script:ApplyBrandIconLogFile)) {
            Add-Content -LiteralPath $script:ApplyBrandIconLogFile -Value ("[" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + "] " + $Message)
        }
    } catch {
        # Logging must never fail the install.
    }
}

function Get-BrandNormalizedFilePath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }
    try {
        $expandedPath = [Environment]::ExpandEnvironmentVariables($Path.Trim())
        return [IO.Path]::GetFullPath($expandedPath)
    } catch {
        return $null
    }
}

function Test-BrandSameFilePath {
    param(
        [string]$Left,
        [string]$Right
    )

    $normalizedLeft = Get-BrandNormalizedFilePath $Left
    $normalizedRight = Get-BrandNormalizedFilePath $Right
    if ([string]::IsNullOrWhiteSpace($normalizedLeft) -or [string]::IsNullOrWhiteSpace($normalizedRight)) {
        return $false
    }
    return [string]::Equals($normalizedLeft, $normalizedRight, [StringComparison]::OrdinalIgnoreCase)
}

function Ensure-BrandCleanupShellNotificationType {
    if ('GoNaviBrandCleanupShellNotification' -as [type]) {
        return
    }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class GoNaviBrandCleanupShellNotification
{
    private const uint SHCNE_UPDATEDIR = 0x04000000;
    private const uint SHCNF_PATHW = 0x0005;
    private const uint SHCNF_FLUSH = 0x1000;

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern void SHChangeNotify(uint eventId, uint flags, string item1, IntPtr item2);

    public static void NotifyDirectoryUpdated(string path)
    {
        SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_PATHW | SHCNF_FLUSH, path, IntPtr.Zero);
    }
}
'@
}

function Restart-BrandStartMenuHost {
    # The all-apps list snapshots shortcuts into its own database and ignores
    # shell notifications; restarting its host is the same refresh mechanism
    # the runtime repair script uses, and the system respawns the process on
    # demand.
    try {
        $startMenuHost = Get-Process -Name 'StartMenuExperienceHost' -ErrorAction SilentlyContinue
        if ($null -ne $startMenuHost) {
            Stop-Process -InputObject $startMenuHost -Force -ErrorAction SilentlyContinue
            Write-ApplyBrandIconLog ("restarted StartMenuExperienceHost after uninstall cleanup")
        }
    } catch {
        Write-ApplyBrandIconLog ("StartMenuExperienceHost restart failed: " + $_.Exception.Message)
    }
}

function Remove-GoNaviUserShortcutsForUninstall {
    param(
        [string]$UserProfile,
        [string]$Target
    )

    $userPrograms = [IO.Path]::Combine($UserProfile, 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs')
    $taskbarPins = [IO.Path]::Combine($UserProfile, 'AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
    $iconDirectory = [IO.Path]::Combine($UserProfile, '.gonavi\application-icons')
    $ownedIconPrefix = [IO.Path]::GetFullPath($iconDirectory)
    if (-not $ownedIconPrefix.EndsWith([IO.Path]::DirectorySeparatorChar)) {
        $ownedIconPrefix += [IO.Path]::DirectorySeparatorChar
    }
    $normalizedTarget = Get-BrandNormalizedFilePath $Target
    $deletedCount = 0
    $startMenuDeleted = $false
    $changedDirectories = @()

    $shell = New-Object -ComObject WScript.Shell
    foreach ($directory in @($userPrograms, $taskbarPins)) {
        if ([string]::IsNullOrWhiteSpace($directory) -or -not [IO.Directory]::Exists($directory)) {
            Write-ApplyBrandIconLog ("uninstall cleanup skipped missing directory: " + $directory)
            continue
        }
        $isPinsDirectory = Test-BrandSameFilePath $directory $taskbarPins
        $entries = @(Get-ChildItem -LiteralPath $directory -Filter 'GoNavi*.lnk' -File -ErrorAction SilentlyContinue)
        Write-ApplyBrandIconLog ("uninstall cleanup scanned " + (@($entries).Count) + " GoNavi shortcut(s) in " + $directory)
        foreach ($entry in $entries) {
            try {
                $shortcut = $shell.CreateShortcut($entry.FullName)
                $targetPath = [string]$shortcut.TargetPath
                $matchesTarget = $false
                if (-not [string]::IsNullOrWhiteSpace($normalizedTarget)) {
                    $matchesTarget = Test-BrandSameFilePath $targetPath $normalizedTarget
                }
                if (-not $matchesTarget) {
                    # A shortcut targeting this exact install is always ours.
                    # Everything else must be a dead GoNavi-named pin whose
                    # icon ownership points into this user's brand-icon
                    # directory; foreign or live shortcuts stay untouched.
                    $targetMissing = [string]::IsNullOrWhiteSpace($targetPath) -or -not [IO.File]::Exists($targetPath)
                    if (-not $isPinsDirectory -or -not $targetMissing) {
                        continue
                    }
                    $classicIcon = Get-BrandNormalizedFilePath ((([string]$shortcut.IconLocation) -replace ',\d+$', ''))
                    $owned = (-not [string]::IsNullOrWhiteSpace($classicIcon)) -and
                        $classicIcon.StartsWith($ownedIconPrefix, [StringComparison]::OrdinalIgnoreCase)
                    if (-not $owned) {
                        continue
                    }
                }
                Remove-Item -LiteralPath $entry.FullName -Force -ErrorAction Stop
                $deletedCount++
                if (-not $isPinsDirectory) {
                    $startMenuDeleted = $true
                }
                if (-not ($changedDirectories -contains $directory)) {
                    $changedDirectories += $directory
                }
                Write-ApplyBrandIconLog ("uninstall removed GoNavi shortcut: " + $entry.FullName)
            } catch {
                Write-ApplyBrandIconLog ("uninstall shortcut cleanup failed for " + $entry.FullName + ": " + $_.Exception.Message)
            }
        }
    }
    if ($deletedCount -gt 0) {
        try {
            Ensure-BrandCleanupShellNotificationType
            foreach ($directory in $changedDirectories) {
                [GoNaviBrandCleanupShellNotification]::NotifyDirectoryUpdated($directory)
            }
        } catch {
            Write-ApplyBrandIconLog ("uninstall cleanup shell refresh failed: " + $_.Exception.Message)
        }
        if ($startMenuDeleted) {
            Restart-BrandStartMenuHost
        }
    }
    return $deletedCount
}

function Set-GoNaviShortcutRelaunchProperties {
    param(
        [string]$ShortcutPath,
        [string]$TargetPath,
        [string]$IconPath,
        [string]$ApplicationUserModelID = 'Syngnat.GoNavi'
    )

    if ([string]::IsNullOrWhiteSpace($ApplicationUserModelID)) {
        $ApplicationUserModelID = 'Syngnat.GoNavi'
    }
    try {
        if (-not ('GoNaviInstallerPropertyStore' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class GoNaviInstallerPropertyStore
{
    private const ushort VT_LPWSTR = 31;
    private static readonly Guid PKEY_AppUserModel = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");

    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLink { }

    [ComImport]
    [Guid("0000010B-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPersistFile
    {
        void GetClassID(out Guid classId);
        [PreserveSig] int IsDirty();
        void Load([MarshalAs(UnmanagedType.LPWStr)] string fileName, uint mode);
        void Save([MarshalAs(UnmanagedType.LPWStr)] string fileName, bool remember);
        void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string fileName);
        void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string fileName);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROPERTYKEY
    {
        public Guid fmtid;
        public uint pid;

        public PROPERTYKEY(Guid formatId, uint propertyId)
        {
            fmtid = formatId;
            pid = propertyId;
        }
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct PROPVARIANT
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr pointerValue;
    }

    [ComImport]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PROPERTYKEY key);
        [PreserveSig] int GetValue(ref PROPERTYKEY key, IntPtr value);
        [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
        [PreserveSig] int Commit();
    }

    private static void SetString(IPropertyStore store, PROPERTYKEY key, string value)
    {
        IntPtr text = Marshal.StringToCoTaskMemUni(value ?? String.Empty);
        PROPVARIANT variant = new PROPVARIANT { vt = VT_LPWSTR, pointerValue = text };
        try
        {
            Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref variant));
        }
        finally
        {
            Marshal.FreeCoTaskMem(text);
        }
    }

    public static bool SetRelaunchProperties(string shortcutPath, string targetPath, string iconPath, string applicationUserModelID)
    {
        if (String.IsNullOrWhiteSpace(applicationUserModelID))
        {
            applicationUserModelID = "Syngnat.GoNavi";
        }
        object shellLink = new ShellLink();
        try
        {
            IPersistFile persistence = (IPersistFile)shellLink;
            persistence.Load(shortcutPath, 2);
            IPropertyStore store = (IPropertyStore)shellLink;
            // AppUserModel.ID must be written last. Windows uses that write to
            // notify the taskbar that the preceding relaunch values changed.
            // RelaunchIconResource uses the plain .ico path: a trailing ',0'
            // makes Explorer parse it as a PE resource index, which fails for
            // .ico files and blanks the taskbar button.
            SetString(store, new PROPERTYKEY(PKEY_AppUserModel, 2), "\"" + targetPath + "\"");
            SetString(store, new PROPERTYKEY(PKEY_AppUserModel, 3), iconPath);
            SetString(store, new PROPERTYKEY(PKEY_AppUserModel, 4), "GoNavi");
            SetString(store, new PROPERTYKEY(PKEY_AppUserModel, 5), applicationUserModelID);
            Marshal.ThrowExceptionForHR(store.Commit());
            persistence.Save(shortcutPath, true);
            return true;
        }
        finally
        {
            Marshal.ReleaseComObject(shellLink);
        }
    }
}
'@
        }
        return [GoNaviInstallerPropertyStore]::SetRelaunchProperties($ShortcutPath, $TargetPath, $IconPath, $ApplicationUserModelID)
    } catch {
        Write-ApplyBrandIconLog ("shortcut relaunch property update failed for " + $ShortcutPath + ": " + $_.Exception.Message)
        return $false
    }
}

function Restore-GoNaviShortcutUserModifyGrant {
    param([string]$ShortcutPath)

    # The whole-file replacement builds the shortcut fresh from the parent
    # directory's inherited ACLs, which silently drops the per-file
    # Users-Modify grant the GrantUsersModify custom actions applied to the
    # original file. The runtime repair script treats a machine shortcut
    # that is read-only for standard users as a hard failure (a brand switch
    # must never leave the public entries on a stale icon), so leaving the
    # replacement read-only would break the very next in-app switch.
    # Re-grant while this action still runs as SYSTEM, using the same
    # well-known SID form as the installer custom actions. Best effort:
    # failures are logged and ignored.
    try {
        if ([string]::IsNullOrWhiteSpace($ShortcutPath) -or -not [IO.File]::Exists($ShortcutPath)) {
            return
        }
        $icacls = [IO.Path]::Combine([Environment]::SystemDirectory, 'icacls.exe')
        & $icacls $ShortcutPath /grant '*S-1-5-32-545:M' | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-ApplyBrandIconLog ("shortcut ACL grant failed for " + $ShortcutPath + " exit=" + $LASTEXITCODE)
        }
    } catch {
        Write-ApplyBrandIconLog ("shortcut ACL grant failed for " + $ShortcutPath + ": " + $_.Exception.Message)
    }
}

try {
    if ($UninstallCleanup) {
        # The deferred uninstall action runs as SYSTEM; AppDataFolder still
        # carries the installing user's roaming directory, and the profile is
        # two levels up (mirrors the install path below).
        if ([string]::IsNullOrWhiteSpace($ApplicationDataFolder)) {
            exit 0
        }
        $appDataRoot = [IO.Path]::GetFullPath($ApplicationDataFolder.Trim())
        $userProfile = [IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($appDataRoot))
        if ([string]::IsNullOrWhiteSpace($userProfile) -or -not [IO.Directory]::Exists($userProfile)) {
            exit 0
        }
        try {
            $brandIconDirectory = [IO.Path]::Combine($userProfile, '.gonavi\application-icons')
            [void](New-Item -ItemType Directory -Path $brandIconDirectory -Force -ErrorAction SilentlyContinue)
            $script:ApplyBrandIconLogFile = [IO.Path]::Combine($brandIconDirectory, 'installer-brand-icon.log')
        } catch {
            # Logging stays best effort.
        }
        [void](Remove-GoNaviUserShortcutsForUninstall -UserProfile $userProfile -Target $ExpectedTarget)
        exit 0
    }
    if ([string]::IsNullOrWhiteSpace($ApplicationDataFolder)) {
        exit 0
    }
    # AppDataFolder is <user>\AppData\Roaming; two levels up is the profile.
    # System.IO.Path helpers instead of the Split-Path cmdlet: Windows
    # PowerShell 5.1 throws AmbiguousParameterSet for its -Parent form
    # combined with literal paths (silently swallowed by catch blocks).
    $appDataRoot = [IO.Path]::GetFullPath($ApplicationDataFolder.Trim())
    $userProfile = [IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($appDataRoot))
    if ([string]::IsNullOrWhiteSpace($userProfile) -or -not [IO.Directory]::Exists($userProfile)) {
        exit 0
    }

    $gonaviRoot = [IO.Path]::Combine($userProfile, '.gonavi')
    $activeRoot = $gonaviRoot
    $bootstrapPath = [IO.Path]::Combine($gonaviRoot, 'storage_root.json')
    if ([IO.File]::Exists($bootstrapPath)) {
        try {
            $bootstrap = Get-Content -LiteralPath $bootstrapPath -Raw | ConvertFrom-Json
            $configuredRoot = [string]$bootstrap.dataRoot
            if (-not [string]::IsNullOrWhiteSpace($configuredRoot)) {
                $activeRoot = [IO.Path]::GetFullPath($configuredRoot.Trim())
            }
        } catch {
            # A malformed bootstrap file falls back to the default root.
        }
    }

    $iconDir = [IO.Path]::Combine($activeRoot, 'application-icons')
    $script:ApplyBrandIconLogFile = [IO.Path]::Combine($iconDir, 'installer-brand-icon.log')
    $statePath = [IO.Path]::Combine($iconDir, 'active-icon.txt')

    $iconName = $null
    if ([IO.File]::Exists($statePath)) {
        $rawLine = Get-Content -LiteralPath $statePath -TotalCount 1
        $candidate = ''
        if ($null -ne $rawLine) {
            $candidate = ([string]$rawLine).Trim()
        }
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            # An empty pointer is the explicit cleared state: keep the default.
            exit 0
        }
        $iconName = $candidate
    } elseif ([IO.Directory]::Exists($iconDir)) {
        # Versions before the startup pointer already left content-addressed
        # ICO files behind; pick the newest one so an existing user's selected
        # icon is restored without a manual re-selection.
        $newest = Get-ChildItem -LiteralPath $iconDir -Filter 'gonavi-brand-*.ico' -File -ErrorAction SilentlyContinue |
            Sort-Object -Property LastWriteTime, Name | Select-Object -Last 1
        if ($null -ne $newest) {
            $iconName = $newest.Name
        }
    }
    if ([string]::IsNullOrWhiteSpace($iconName)) {
        exit 0
    }
    # Same contract as the Go loader: the pointer holds a bare .ico file name.
    if ([IO.Path]::GetFileName($iconName) -ne $iconName) {
        exit 0
    }
    if (-not [string]::Equals([IO.Path]::GetExtension($iconName), '.ico', [StringComparison]::OrdinalIgnoreCase)) {
        exit 0
    }
    $iconPath = [IO.Path]::Combine($iconDir, $iconName)
    if (-not [IO.File]::Exists($iconPath)) {
        exit 0
    }

    # Remove replacement stubs a previous killed run may have left behind.
    foreach ($directory in @([IO.Path]::GetDirectoryName($StartMenuShortcut), [IO.Path]::GetDirectoryName($DesktopShortcut))) {
        if ([string]::IsNullOrWhiteSpace($directory) -or -not [IO.Directory]::Exists($directory)) {
            continue
        }
        Get-ChildItem -LiteralPath $directory -Filter '*-gonavi-apply-*.lnk' -File -ErrorAction SilentlyContinue |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }

    foreach ($shortcutPath in @($StartMenuShortcut, $DesktopShortcut)) {
        if ([string]::IsNullOrWhiteSpace($shortcutPath) -or -not [IO.File]::Exists($shortcutPath)) {
            continue
        }
        try {
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($shortcutPath)
            $targetPath = [string]$shortcut.TargetPath
            if ([string]::IsNullOrWhiteSpace($targetPath) -or -not [IO.File]::Exists($targetPath)) {
                continue
            }
            $wantedIconLocation = $iconPath + ',0'
            if ([string]::Equals([string]$shortcut.IconLocation, $wantedIconLocation, [StringComparison]::OrdinalIgnoreCase)) {
                continue
            }
            $shortcut.IconLocation = $wantedIconLocation
            # The Start menu never re-reads an in-place IconLocation rewrite;
            # a whole-file replacement is what makes it pick up the new icon
            # immediately (the same mechanism the runtime repair script and the
            # MSI's own shortcut creation use).
            $replaced = $false
            $replacementPath = ''
            try {
                $replacementPath = [IO.Path]::Combine(
                    [IO.Path]::GetDirectoryName($shortcutPath),
                    ([IO.Path]::GetFileNameWithoutExtension($shortcutPath) + '-gonavi-apply-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.lnk'))
                $replacement = $shell.CreateShortcut($replacementPath)
                $replacement.TargetPath = $shortcut.TargetPath
                $replacement.Arguments = $shortcut.Arguments
                $replacement.WorkingDirectory = $shortcut.WorkingDirectory
                $replacement.WindowStyle = $shortcut.WindowStyle
                $replacement.Description = $shortcut.Description
                $replacement.IconLocation = $wantedIconLocation
                $replacement.Save()
                Move-Item -LiteralPath $replacementPath -Destination $shortcutPath -Force
                $replaced = $true
            } catch {
                if (-not [string]::IsNullOrWhiteSpace($replacementPath) -and [IO.File]::Exists($replacementPath)) {
                    Remove-Item -LiteralPath $replacementPath -Force -ErrorAction SilentlyContinue
                }
                Write-ApplyBrandIconLog ("replacement failed, falling back to in-place save: " + $shortcutPath + ": " + $_.Exception.Message)
            }
            if (-not $replaced) {
                $shortcut.Save()
            }
            # The rewrite must not leave the machine shortcut read-only for
            # standard users. The grant runs before the relaunch property
            # restore below, whose failure path skips the rest of the
            # iteration.
            Restore-GoNaviShortcutUserModifyGrant -ShortcutPath $shortcutPath
            # A WScript.Shell save - and any replacement - drops the
            # AppUserModel property bag the MSI wrote on the shortcut. Restore
            # the relaunch identity with the ID (pid 5) written last so
            # Explorer re-reads the taskbar group.
            if (-not (Set-GoNaviShortcutRelaunchProperties -ShortcutPath $shortcutPath -TargetPath $targetPath -IconPath $iconPath)) {
                continue
            }
            Write-ApplyBrandIconLog ("applied persisted brand icon: " + $shortcutPath + " -> " + $iconPath)
        } catch {
            Write-ApplyBrandIconLog ("brand icon apply failed for " + $shortcutPath + ": " + $_.Exception.Message)
        }
    }
} catch {
    # The installer must never fail because of a cosmetic brand-icon restore,
    # but the failure must be diagnosable: persist it next to the brand state.
    Write-ApplyBrandIconLog ("apply flow failed: " + $_.Exception.Message)
    exit 0
}
exit 0
