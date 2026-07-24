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
