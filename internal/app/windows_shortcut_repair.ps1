function Write-ShortcutRepairLog {
    param([string]$Message)

    try {
        if (Get-Command -Name Write-UpdateLog -CommandType Function -ErrorAction SilentlyContinue) {
            Write-UpdateLog $Message
        }
    } catch {
        # Shortcut repair logging must never affect the update.
    }
}

function Get-NormalizedFilePath {
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

function Test-SameFilePath {
    param(
        [string]$Left,
        [string]$Right
    )

    $normalizedLeft = Get-NormalizedFilePath $Left
    $normalizedRight = Get-NormalizedFilePath $Right
    if ([string]::IsNullOrWhiteSpace($normalizedLeft) -or [string]::IsNullOrWhiteSpace($normalizedRight)) {
        return $false
    }
    return [string]::Equals($normalizedLeft, $normalizedRight, [StringComparison]::OrdinalIgnoreCase)
}

function Test-LegacyMissingMSIIcon {
    param(
        [object]$Shortcut,
        [string]$WindowsInstallerDirectory
    )

    $iconLocation = [string]$Shortcut.IconLocation
    if ([string]::IsNullOrWhiteSpace($iconLocation)) {
        return $false
    }

    $iconPath = $iconLocation.Trim()
    $indexedIcon = [regex]::Match($iconPath, '^(?<path>.+),\s*-?\d+$')
    if ($indexedIcon.Success) {
        $iconPath = $indexedIcon.Groups['path'].Value.Trim()
    }
    $iconPath = $iconPath.Trim('"')

    $normalizedIconPath = Get-NormalizedFilePath $iconPath
    $normalizedInstallerDirectory = Get-NormalizedFilePath $WindowsInstallerDirectory
    if ([string]::IsNullOrWhiteSpace($normalizedIconPath) -or [string]::IsNullOrWhiteSpace($normalizedInstallerDirectory)) {
        return $false
    }

    $installerPrefix = $normalizedInstallerDirectory
    if (-not $installerPrefix.EndsWith([IO.Path]::DirectorySeparatorChar)) {
        $installerPrefix += [IO.Path]::DirectorySeparatorChar
    }
    if (-not $normalizedIconPath.StartsWith($installerPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        return $false
    }

    $relativeIconPath = $normalizedIconPath.Substring($installerPrefix.Length)
    $relativeParts = $relativeIconPath -split '[\\/]'
    if ($relativeParts.Count -lt 2 -or $relativeParts[0] -notmatch '^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$') {
        return $false
    }
    if (-not [string]::Equals([IO.Path]::GetFileName($normalizedIconPath), 'GoNaviIcon', [StringComparison]::OrdinalIgnoreCase)) {
        return $false
    }

    return -not (Test-Path -LiteralPath $normalizedIconPath -PathType Leaf)
}

function Test-GoNaviShortcutWritable {
    param([string]$ShortcutPath)

    # Shortcuts in shared Start Menu directories are created by the installer with
    # administrator rights, so a standard user can only read them. Probe writability
    # first so one unwritable entry cannot fail the whole shortcut update batch.
    # Only an explicit permission denial counts as read-only. Sharing violations and
    # other errors must propagate, otherwise a temporarily locked shortcut would be
    # silently skipped and the update recorded as completed.
    try {
        $stream = [IO.File]::Open(
            $ShortcutPath,
            [IO.FileMode]::Open,
            [IO.FileAccess]::ReadWrite,
            [IO.FileShare]::Read
        )
        $stream.Close()
        return $true
    } catch [System.UnauthorizedAccessException] {
        return $false
    }
}

function Get-GoNaviDesktopDirectories {
    return @(
        [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory),
        [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonDesktopDirectory)
    )
}

function Save-GoNaviDesktopShortcutState {
    param(
        [string]$TargetPath,
        [string]$BackupDirectory,
        [string[]]$DesktopDirectories
    )

    if ($null -eq $DesktopDirectories -or $DesktopDirectories.Count -eq 0) {
        $DesktopDirectories = @(Get-GoNaviDesktopDirectories)
    }

    $state = [pscustomobject]@{
        Succeeded = $true
        InstallValue = '0'
        Entries = @()
    }
    try {
        if ([string]::IsNullOrWhiteSpace($BackupDirectory)) {
            throw 'desktop shortcut backup directory is missing'
        }
        if (-not (Test-Path -LiteralPath $BackupDirectory -PathType Container)) {
            [void](New-Item -ItemType Directory -Path $BackupDirectory -Force -ErrorAction Stop)
        }
        $shell = New-Object -ComObject WScript.Shell
        $entryIndex = 0
        foreach ($desktopDirectory in $DesktopDirectories) {
            if ([string]::IsNullOrWhiteSpace($desktopDirectory)) {
                continue
            }
            $shortcutPath = Join-Path $desktopDirectory 'GoNavi.lnk'
            if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
                continue
            }
            try {
                $shortcut = $shell.CreateShortcut($shortcutPath)
                $matchesTarget = Test-SameFilePath $shortcut.TargetPath $TargetPath
                $backupPath = Join-Path $BackupDirectory (('desktop-shortcut-{0}.lnk' -f $entryIndex))
                Copy-Item -LiteralPath $shortcutPath -Destination $backupPath -Force -ErrorAction Stop
                $state.Entries += [pscustomobject]@{
                    Path = $shortcutPath
                    BackupPath = $backupPath
                    MatchesTarget = $matchesTarget
                }
                if ($matchesTarget) {
                    $state.InstallValue = '1'
                }
                $entryIndex++
            } catch {
                $state.Succeeded = $false
                $state.InstallValue = '1'
                Write-ShortcutRepairLog ("desktop shortcut backup failed for " + $shortcutPath + ": " + $_.Exception.Message)
            }
        }
    } catch {
        $state.Succeeded = $false
        $state.InstallValue = '1'
        Write-ShortcutRepairLog ("desktop shortcut state backup failed: " + $_.Exception.Message)
    }
    return $state
}

function Remove-GoNaviDesktopShortcutsForTarget {
    param(
        [string]$TargetPath,
        [string[]]$DesktopDirectories
    )

    if ($null -eq $DesktopDirectories -or $DesktopDirectories.Count -eq 0) {
        $DesktopDirectories = @(Get-GoNaviDesktopDirectories)
    }
    $succeeded = $true
    try {
        $shell = New-Object -ComObject WScript.Shell
        foreach ($desktopDirectory in $DesktopDirectories) {
            if ([string]::IsNullOrWhiteSpace($desktopDirectory)) {
                continue
            }
            $shortcutPath = Join-Path $desktopDirectory 'GoNavi.lnk'
            if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
                continue
            }
            try {
                $shortcut = $shell.CreateShortcut($shortcutPath)
                if (Test-SameFilePath $shortcut.TargetPath $TargetPath) {
                    Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction Stop
                    Write-ShortcutRepairLog ("removed unexpected desktop shortcut: " + $shortcutPath)
                }
            } catch {
                $succeeded = $false
                Write-ShortcutRepairLog ("desktop shortcut removal failed for " + $shortcutPath + ": " + $_.Exception.Message)
            }
        }
    } catch {
        $succeeded = $false
        Write-ShortcutRepairLog ("desktop shortcut removal failed: " + $_.Exception.Message)
    }
    return $succeeded
}

function Restore-GoNaviDesktopShortcutState {
    param(
        [object]$State,
        [switch]$OnlyForeign
    )

    if ($null -eq $State) {
        return $true
    }
    $succeeded = $true
    foreach ($entry in @($State.Entries)) {
        if ($OnlyForeign.IsPresent -and $entry.MatchesTarget) {
            continue
        }
        try {
            Copy-Item -LiteralPath $entry.BackupPath -Destination $entry.Path -Force -ErrorAction Stop
            Write-ShortcutRepairLog ("restored desktop shortcut: " + $entry.Path)
        } catch {
            $succeeded = $false
            Write-ShortcutRepairLog ("desktop shortcut restore failed for " + $entry.Path + ": " + $_.Exception.Message)
        }
    }
    return $succeeded
}

function Send-ShellItemUpdatedNotification {
    param([string]$Path)

    try {
        if (-not ('GoNaviShortcutShellNotification' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class GoNaviShortcutShellNotification
{
    private const uint SHCNE_UPDATEITEM = 0x00002000;
    private const uint SHCNF_PATHW = 0x0005;
    private const uint SHCNF_FLUSH = 0x1000;

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern void SHChangeNotify(uint eventId, uint flags, string item1, IntPtr item2);

    public static void NotifyItemUpdated(string path)
    {
        SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSH, path, IntPtr.Zero);
    }
}
'@
        }
        [GoNaviShortcutShellNotification]::NotifyItemUpdated($Path)
    } catch {
        Write-ShortcutRepairLog ("shell shortcut refresh failed for " + $Path + ": " + $_.Exception.Message)
    }
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
        if (-not ('GoNaviShortcutPropertyStore' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class GoNaviShortcutPropertyStore
{
    private const uint GPS_READWRITE = 0x00000002;
    private const ushort VT_LPWSTR = 31;
    private static readonly Guid IID_IPropertyStore = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    private static readonly Guid PKEY_AppUserModel = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");

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

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHGetPropertyStoreFromParsingName(
        string path,
        IntPtr bindContext,
        uint flags,
        ref Guid interfaceId,
        [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

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
        IPropertyStore store = null;
        Guid interfaceId = IID_IPropertyStore;
        int result = SHGetPropertyStoreFromParsingName(
            shortcutPath,
            IntPtr.Zero,
            GPS_READWRITE,
            ref interfaceId,
            out store);
        Marshal.ThrowExceptionForHR(result);
        try
        {
            // AppUserModel.ID must be written last. Windows uses that write to
            // notify the taskbar that the preceding relaunch values changed.
            SetString(store, new PROPERTYKEY(PKEY_AppUserModel, 2), "\"" + targetPath + "\"");
            SetString(store, new PROPERTYKEY(PKEY_AppUserModel, 3), iconPath + ",0");
            SetString(store, new PROPERTYKEY(PKEY_AppUserModel, 4), "GoNavi");
            SetString(store, new PROPERTYKEY(PKEY_AppUserModel, 5), applicationUserModelID);
            Marshal.ThrowExceptionForHR(store.Commit());
            return true;
        }
        finally
        {
            if (store != null)
            {
                Marshal.ReleaseComObject(store);
            }
        }
    }
}
'@
        }
        return [GoNaviShortcutPropertyStore]::SetRelaunchProperties($ShortcutPath, $TargetPath, $IconPath, $ApplicationUserModelID)
    } catch {
        Write-ShortcutRepairLog ("shortcut relaunch property update failed for " + $ShortcutPath + ": " + $_.Exception.Message)
        return $false
    }
}

function Repair-LegacyGoNaviTaskbarPins {
    param(
        [string]$TargetPath,
        [string]$PinsDirectory,
        [string]$WindowsInstallerDirectory
    )

    $repairCount = 0
    try {
        $normalizedTargetPath = Get-NormalizedFilePath $TargetPath
        if ([string]::IsNullOrWhiteSpace($normalizedTargetPath) -or -not (Test-Path -LiteralPath $normalizedTargetPath -PathType Leaf)) {
            return $repairCount
        }
        if ([string]::IsNullOrWhiteSpace($PinsDirectory)) {
            $applicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
            $PinsDirectory = Join-Path $applicationData 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
        }
        if ([string]::IsNullOrWhiteSpace($WindowsInstallerDirectory)) {
            if ([string]::IsNullOrWhiteSpace($env:WINDIR)) {
                return $repairCount
            }
            $WindowsInstallerDirectory = Join-Path $env:WINDIR 'Installer'
        }
        if (-not (Test-Path -LiteralPath $PinsDirectory -PathType Container)) {
            return $repairCount
        }

        $normalizedPinsDirectory = Get-NormalizedFilePath $PinsDirectory
        $applicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
        $knownTaskbarDirectory = Get-NormalizedFilePath (Join-Path $applicationData 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
        $useTaskbarPropertyStore = Test-SameFilePath $normalizedPinsDirectory $knownTaskbarDirectory

        $shell = New-Object -ComObject WScript.Shell
        $pins = Get-ChildItem -LiteralPath $PinsDirectory -Filter '*.lnk' -File -Force -ErrorAction Stop
        foreach ($pin in $pins) {
            try {
                $shortcut = $shell.CreateShortcut($pin.FullName)
                if (-not (Test-SameFilePath $shortcut.TargetPath $normalizedTargetPath)) {
                    continue
                }
                if (-not (Test-LegacyMissingMSIIcon $shortcut $WindowsInstallerDirectory)) {
                    continue
                }

                if ($useTaskbarPropertyStore) {
                    if (Set-GoNaviShortcutRelaunchProperties -ShortcutPath $pin.FullName -TargetPath $normalizedTargetPath -IconPath $normalizedTargetPath) {
                        Send-ShellItemUpdatedNotification $pin.FullName
                        $repairCount++
                        Write-ShortcutRepairLog ("repaired legacy taskbar pin properties: " + $pin.Name)
                    }
                    continue
                }
                $shortcut.IconLocation = $normalizedTargetPath + ',0'
                $shortcut.Save()
                Send-ShellItemUpdatedNotification $pin.FullName
                $repairCount++
                Write-ShortcutRepairLog ("repaired legacy taskbar pin icon: " + $pin.Name)
            } catch {
                Write-ShortcutRepairLog ("taskbar pin repair failed for " + $pin.Name + ": " + $_.Exception.Message)
            }
        }
    } catch {
        Write-ShortcutRepairLog ("taskbar pin repair failed: " + $_.Exception.Message)
    }
    return $repairCount
}

function Get-GoNaviShortcutAppUserModelID {
    param([string]$ShortcutPath)

    try {
        $folderPath = Split-Path -LiteralPath $ShortcutPath -Parent
        $fileName = Split-Path -LiteralPath $ShortcutPath -Leaf
        $namespace = (New-Object -ComObject Shell.Application).Namespace($folderPath)
        if ($null -eq $namespace) {
            return ''
        }
        $item = $namespace.ParseName($fileName)
        if ($null -eq $item) {
            return ''
        }
        return [string]$item.ExtendedProperty('System.AppUserModel.ID')
    } catch {
        return ''
    }
}

function Set-GoNaviShortcutBrandIcon {
    param(
        [string]$TargetPath,
        [string]$IconPath,
        [string]$ApplicationUserModelID = 'Syngnat.GoNavi',
        [string[]]$ShortcutDirectories,
        [string]$TaskbarDirectory
    )

    # Fold every requested identity back to the MSI shortcut value. A per-icon
    # ID (Syngnat.GoNavi.Icon.<hash>) makes Explorer split a pinned MSI button
    # or delete a portable pin. The bitmap changes through IconLocation.
    $ApplicationUserModelID = 'Syngnat.GoNavi'
    # Portable launches must not retouch a pin that points at another copy,
    # such as an MSI install beside the portable exe.
    $onlyMatchingTarget = $env:GONAVI_BRAND_MATCH_TARGET_ONLY -eq '1'
    $updatedCount = 0
    $failureMessages = [Collections.Generic.List[string]]::new()
    try {
        $normalizedTargetPath = Get-NormalizedFilePath $TargetPath
        $normalizedIconPath = Get-NormalizedFilePath $IconPath
        if ([string]::IsNullOrWhiteSpace($normalizedTargetPath) -or
            [string]::IsNullOrWhiteSpace($normalizedIconPath) -or
            -not (Test-Path -LiteralPath $normalizedTargetPath -PathType Leaf) -or
            -not (Test-Path -LiteralPath $normalizedIconPath -PathType Leaf)) {
            throw 'GoNavi shortcut target or icon does not exist'
        }
        $msiMarkerPath = Join-Path ([IO.Path]::GetDirectoryName($normalizedTargetPath)) '.gonavi-msi-install'
        $isMSITarget = Test-Path -LiteralPath $msiMarkerPath -PathType Leaf

        if ($null -eq $ShortcutDirectories -or $ShortcutDirectories.Count -eq 0) {
            $applicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
            $ShortcutDirectories = @(
                [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory),
                [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonDesktopDirectory),
                [Environment]::GetFolderPath([Environment+SpecialFolder]::Programs),
                [Environment]::GetFolderPath([Environment+SpecialFolder]::CommonPrograms),
                (Join-Path $applicationData 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
            )
        }

        if ([string]::IsNullOrWhiteSpace($TaskbarDirectory)) {
            $applicationData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
            $TaskbarDirectory = Join-Path $applicationData 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
        }
        $taskbarDirectory = Get-NormalizedFilePath $TaskbarDirectory
        $taskbarPrefix = $taskbarDirectory
        if (-not [string]::IsNullOrWhiteSpace($taskbarPrefix) -and -not $taskbarPrefix.EndsWith([IO.Path]::DirectorySeparatorChar)) {
            $taskbarPrefix += [IO.Path]::DirectorySeparatorChar
        }

        $shell = New-Object -ComObject WScript.Shell
        $visitedDirectories = @{}
        foreach ($directory in $ShortcutDirectories) {
            $normalizedDirectory = Get-NormalizedFilePath $directory
            if ([string]::IsNullOrWhiteSpace($normalizedDirectory) -or
                $visitedDirectories.ContainsKey($normalizedDirectory) -or
                -not (Test-Path -LiteralPath $normalizedDirectory -PathType Container)) {
                continue
            }
            $visitedDirectories[$normalizedDirectory] = $true
            $enumerationErrorAction = if (Test-SameFilePath $normalizedDirectory $taskbarDirectory) { 'Stop' } else { 'SilentlyContinue' }
            $shortcuts = Get-ChildItem -LiteralPath $normalizedDirectory -Filter '*.lnk' -File -Recurse -Force -ErrorAction $enumerationErrorAction
            foreach ($shortcutFile in $shortcuts) {
                try {
                    $shortcut = $shell.CreateShortcut($shortcutFile.FullName)
                    $matchesTarget = Test-SameFilePath $shortcut.TargetPath $normalizedTargetPath
                    if ($onlyMatchingTarget -and -not $matchesTarget) {
                        continue
                    }
                    $isTaskbarShortcut = -not [string]::IsNullOrWhiteSpace($taskbarPrefix) -and
                        $shortcutFile.FullName.StartsWith($taskbarPrefix, [StringComparison]::OrdinalIgnoreCase)
                    $isGoNaviTaskbarShortcut = $false
                    # Recognize pins created by older releases that rotated the
                    # identity inside the Syngnat.GoNavi family. An MSI launch
                    # repairs those pins to the current installed executable;
                    # development and portable launches preserve their target.
                    if (-not $matchesTarget -and $isTaskbarShortcut) {
                        $shortcutName = [IO.Path]::GetFileNameWithoutExtension($shortcutFile.Name)
                        $targetName = [IO.Path]::GetFileName($shortcut.TargetPath)
                        $looksLikeGoNaviPin =
                            $shortcutName -match '^GoNavi(?:[-_.].*|\s*\(\d+\))?$' -and
                            $targetName -match '^GoNavi(?:[-_.].*|\s*\(\d+\))?\.exe$'
                        $isGoNaviTaskbarShortcut = $looksLikeGoNaviPin -or
                            ((Get-GoNaviShortcutAppUserModelID $shortcutFile.FullName) -match '^Syngnat\.GoNavi(?:\.Icon\.[0-9a-f]+)?$')
                    }
                    if (-not $matchesTarget -and -not $isGoNaviTaskbarShortcut) {
                        continue
                    }
                    $shortcutTargetPath = $normalizedTargetPath
                    if (-not $matchesTarget -and -not $isMSITarget) {
                        $shortcutTargetPath = Get-NormalizedFilePath $shortcut.TargetPath
                        if ([string]::IsNullOrWhiteSpace($shortcutTargetPath)) {
                            continue
                        }
                    }
                    if ($isTaskbarShortcut) {
                        # Windows 11 may keep rendering a pinned shortcut's
                        # standard IconLocation even after the AppUserModel
                        # relaunch icon changed. Save both representations,
                        # then write the AppUserModel properties last because
                        # WScript.Shell.Save can discard custom properties.
                        # Capture the identity before that Save. Assigning one
                        # to a portable pin that never had one makes Explorer
                        # remove the pin, so only an MSI pin or a pin that
                        # already carries Syngnat.GoNavi is written back, and
                        # always as the stable ID.
                        $existingAumid = [string](Get-GoNaviShortcutAppUserModelID $shortcutFile.FullName)
                        $hasGoNaviIdentity = $existingAumid -match '^Syngnat\.GoNavi(?:\.Icon\.[0-9a-fA-F]+)?$'
                        $shouldWriteIdentity = $isMSITarget -or $hasGoNaviIdentity
                        $shortcutNeedsSave = $false
                        if ($isMSITarget -and -not $matchesTarget) {
                            $shortcut.TargetPath = $normalizedTargetPath
                            $shortcut.WorkingDirectory = [IO.Path]::GetDirectoryName($normalizedTargetPath)
                            $shortcutNeedsSave = $true
                        }
                        $wantedIconLocation = $normalizedIconPath + ',0'
                        if (-not [string]::Equals([string]$shortcut.IconLocation, $wantedIconLocation, [StringComparison]::OrdinalIgnoreCase)) {
                            $shortcut.IconLocation = $wantedIconLocation
                            $shortcutNeedsSave = $true
                        }
                        if ($shortcutNeedsSave) {
                            # Keep writing the AppUserModel properties even when the
                            # shortcut itself is not writable: a property-store failure
                            # must still throw so a broken pin is never recorded as fixed.
                            if (Test-GoNaviShortcutWritable $shortcutFile.FullName) {
                                $shortcut.Save()
                            } else {
                                Write-ShortcutRepairLog ("skipped read-only shortcut save: " + $shortcutFile.FullName)
                            }
                        }
                        if ($shouldWriteIdentity) {
                            if (-not (Set-GoNaviShortcutRelaunchProperties -ShortcutPath $shortcutFile.FullName -TargetPath $shortcutTargetPath -IconPath $normalizedIconPath -ApplicationUserModelID $ApplicationUserModelID)) {
                                throw ('taskbar property-store update failed for ' + $shortcutFile.FullName)
                            }
                        }
                        $updatedCount++
                        Send-ShellItemUpdatedNotification $shortcutFile.FullName
                        continue
                    }
                    $wantedIconLocation = $normalizedIconPath + ',0'
                    $needsSave = $false
                    if (-not [string]::Equals([string]$shortcut.IconLocation, $wantedIconLocation, [StringComparison]::OrdinalIgnoreCase)) {
                        $shortcut.IconLocation = $wantedIconLocation
                        $needsSave = $true
                    }
                    if ($needsSave) {
                        # Shared Start Menu shortcuts are read-only for a standard user:
                        # skip the save instead of failing the whole batch, while still
                        # notifying Explorer about the entry.
                        if (Test-GoNaviShortcutWritable $shortcutFile.FullName) {
                            $shortcut.Save()
                            $updatedCount++
                        } else {
                            Write-ShortcutRepairLog ("skipped read-only shortcut icon update: " + $shortcutFile.FullName)
                        }
                    }
                    Send-ShellItemUpdatedNotification $shortcutFile.FullName
                } catch {
                    $failureMessage = "brand icon update failed for " + $shortcutFile.FullName + ": " + $_.Exception.Message
                    Write-ShortcutRepairLog $failureMessage
                    [void]$failureMessages.Add($failureMessage)
                }
            }
        }
        Send-ShellItemUpdatedNotification $normalizedIconPath
    } catch {
        Write-ShortcutRepairLog ("brand icon shortcut update failed: " + $_.Exception.Message)
        throw
    }
    if ($failureMessages.Count -gt 0) {
        throw ('one or more GoNavi shortcut updates failed: ' + [string]::Join('; ', $failureMessages))
    }
    return $updatedCount
}
