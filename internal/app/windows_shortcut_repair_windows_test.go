package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsShortcutRepairOnlyMigratesMissingMSIIconForCurrentTarget(t *testing.T) {
	powerShell, err := exec.LookPath("powershell.exe")
	if err != nil {
		t.Skip("powershell.exe is unavailable")
	}

	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "install", "GoNavi.exe")
	foreignTargetPath := filepath.Join(tempDir, "foreign", "GoNavi.exe")
	pinsDirectory := filepath.Join(tempDir, "pins")
	installerDirectory := filepath.Join(tempDir, "Windows", "Installer")
	desktopDirectory := filepath.Join(tempDir, "desktop")
	commonDesktopDirectory := filepath.Join(tempDir, "common-desktop")
	for _, directory := range []string{
		filepath.Dir(targetPath),
		filepath.Dir(foreignTargetPath),
		pinsDirectory,
		installerDirectory,
		desktopDirectory,
		commonDesktopDirectory,
	} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{targetPath, foreignTargetPath} {
		if err := os.WriteFile(path, []byte("test"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	existingIconPath := filepath.Join(installerDirectory, "{22222222-2222-2222-2222-222222222222}", "GoNaviIcon")
	if err := os.MkdirAll(filepath.Dir(existingIconPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(existingIconPath, []byte("icon"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(targetPath), ".gonavi-msi-install"), []byte("MSI"), 0o644); err != nil {
		t.Fatal(err)
	}

	harness := windowsShortcutRepairPowerShellScript + `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$shellApplication = New-Object -ComObject Shell.Application

function New-TestShortcut {
    param(
        [string]$Path,
        [string]$TargetPath,
        [string]$IconLocation
    )

    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $TargetPath
    if (-not [string]::IsNullOrEmpty($IconLocation)) {
        $shortcut.IconLocation = $IconLocation
    }
    $shortcut.Save()
}

function Test-ShortcutIconLocation {
    param(
        [string]$IconLocation,
        [string]$ExpectedPath
    )

    $indexedIcon = [regex]::Match($IconLocation, '^(?<path>.+),\s*(?<index>-?\d+)$')
    if (-not $indexedIcon.Success -or $indexedIcon.Groups['index'].Value -ne '0') {
        return $false
    }
    return Test-SameFilePath $indexedIcon.Groups['path'].Value.Trim('"') $ExpectedPath
}

$target = $env:GONAVI_TEST_TARGET
$foreignTarget = $env:GONAVI_TEST_FOREIGN_TARGET
$pins = $env:GONAVI_TEST_PINS
$installer = $env:GONAVI_TEST_INSTALLER
$desktop = $env:GONAVI_TEST_DESKTOP
$commonDesktop = $env:GONAVI_TEST_COMMON_DESKTOP
$missingIcon = Join-Path $installer '{11111111-1111-1111-1111-111111111111}\GoNaviIcon'
$existingIcon = Join-Path $installer '{22222222-2222-2222-2222-222222222222}\GoNaviIcon'

New-TestShortcut (Join-Path $pins 'missing-icon.lnk') $target ($missingIcon + ',0')
New-TestShortcut (Join-Path $pins 'foreign-target.lnk') $foreignTarget ($missingIcon + ',0')
New-TestShortcut (Join-Path $pins 'existing-icon.lnk') $target ($existingIcon + ',0')
New-TestShortcut (Join-Path $pins 'blank-icon.lnk') $target ''
New-TestShortcut (Join-Path $pins 'other-missing-icon.lnk') $target ((Join-Path $installer '{33333333-3333-3333-3333-333333333333}\OtherIcon') + ',0')
$alternateGoNaviTarget = Join-Path $env:GONAVI_TEST_ROOT 'alternate-install\GoNavi.exe'
New-TestShortcut (Join-Path $pins 'GoNavi.lnk') $alternateGoNaviTarget ''
[void](Set-GoNaviShortcutRelaunchProperties -ShortcutPath (Join-Path $pins 'GoNavi.lnk') -TargetPath $alternateGoNaviTarget -IconPath $missingIcon)
$duplicateGoNaviTarget = Join-Path $env:GONAVI_TEST_ROOT 'alternate-install\GoNavi (2).exe'
New-TestShortcut (Join-Path $pins 'GoNavi (2).lnk') $duplicateGoNaviTarget ''
# A pin left behind by a previous rotated brand identity only ties back to
# GoNavi through its AppUserModel.ID, so MSI repair must recognize every
# identity in the Syngnat.GoNavi family.
New-TestShortcut (Join-Path $pins 'GoNavi-rotated.lnk') $alternateGoNaviTarget ''
[void](Set-GoNaviShortcutRelaunchProperties -ShortcutPath (Join-Path $pins 'GoNavi-rotated.lnk') -TargetPath $alternateGoNaviTarget -IconPath $missingIcon -ApplicationUserModelID 'Syngnat.GoNavi.Icon.deadbeefdeadbeefdeadbeef')
$blankIconBefore = $shell.CreateShortcut((Join-Path $pins 'blank-icon.lnk')).IconLocation
$otherMissingIconBefore = $shell.CreateShortcut((Join-Path $pins 'other-missing-icon.lnk')).IconLocation

$repairCount = Repair-LegacyGoNaviTaskbarPins -TargetPath $target -PinsDirectory $pins -WindowsInstallerDirectory $installer
if ($repairCount -ne 1) {
    throw ('unexpected repair count: ' + $repairCount)
}

$missingShortcut = $shell.CreateShortcut((Join-Path $pins 'missing-icon.lnk'))
if (-not (Test-ShortcutIconLocation $missingShortcut.IconLocation $target)) {
    throw ('missing MSI icon was not migrated: ' + $missingShortcut.IconLocation)
}
$foreignShortcut = $shell.CreateShortcut((Join-Path $pins 'foreign-target.lnk'))
if (-not (Test-ShortcutIconLocation $foreignShortcut.IconLocation $missingIcon)) {
    throw ('foreign target was modified: ' + $foreignShortcut.IconLocation)
}
$existingShortcut = $shell.CreateShortcut((Join-Path $pins 'existing-icon.lnk'))
if (-not (Test-ShortcutIconLocation $existingShortcut.IconLocation $existingIcon)) {
    throw ('existing MSI icon was modified: ' + $existingShortcut.IconLocation)
}
$blankShortcut = $shell.CreateShortcut((Join-Path $pins 'blank-icon.lnk'))
if (-not [string]::Equals($blankShortcut.IconLocation, $blankIconBefore, [StringComparison]::OrdinalIgnoreCase)) {
    throw ('blank icon was modified: ' + $blankShortcut.IconLocation)
}
$otherMissingIconShortcut = $shell.CreateShortcut((Join-Path $pins 'other-missing-icon.lnk'))
if (-not [string]::Equals($otherMissingIconShortcut.IconLocation, $otherMissingIconBefore, [StringComparison]::OrdinalIgnoreCase)) {
    throw ('non-GoNavi MSI icon was modified: ' + $otherMissingIconShortcut.IconLocation)
}

$brandIcon = Join-Path $env:GONAVI_TEST_ROOT 'gonavi-brand-test.ico'
[IO.File]::WriteAllBytes($brandIcon, [byte[]](0, 0, 1, 0, 0, 0))
$brandUpdateCount = Set-GoNaviShortcutBrandIcon -TargetPath $target -IconPath $brandIcon -ShortcutDirectories @($pins) -TaskbarDirectory $pins
if ($brandUpdateCount -ne 7) {
    throw ('unexpected brand icon shortcut update count: ' + $brandUpdateCount)
}
foreach ($shortcutName in @('missing-icon.lnk', 'existing-icon.lnk', 'blank-icon.lnk', 'other-missing-icon.lnk')) {
    $updatedShortcut = $shell.CreateShortcut((Join-Path $pins $shortcutName))
    if (-not (Test-ShortcutIconLocation $updatedShortcut.IconLocation $brandIcon)) {
        throw ('brand icon was not applied to ' + $shortcutName + ': ' + $updatedShortcut.IconLocation)
    }
}
if (-not (Test-ShortcutIconLocation $shell.CreateShortcut((Join-Path $pins 'foreign-target.lnk')).IconLocation $missingIcon)) {
    throw 'brand icon update modified a foreign target shortcut'
}
$alternateShortcut = $shell.CreateShortcut((Join-Path $pins 'GoNavi.lnk'))
if (-not (Test-ShortcutIconLocation $alternateShortcut.IconLocation $brandIcon)) {
    throw ('brand icon was not applied to the alternate GoNavi pin: ' + $alternateShortcut.IconLocation)
}
if (-not (Test-SameFilePath $alternateShortcut.TargetPath $target)) {
    throw ('MSI GoNavi pin target was not repaired: ' + $alternateShortcut.TargetPath)
}
$alternateItem = $shellApplication.Namespace((Split-Path (Join-Path $pins 'GoNavi.lnk') -Parent)).ParseName('GoNavi.lnk')
if ($null -ne $alternateItem) {
    $alternateRelaunchCommand = [string]$alternateItem.ExtendedProperty('System.AppUserModel.RelaunchCommand')
    if (-not [string]::Equals($alternateRelaunchCommand, ('"' + $target + '"'), [StringComparison]::OrdinalIgnoreCase)) {
        throw ('MSI GoNavi relaunch target was not quoted and repaired: ' + $alternateRelaunchCommand)
    }
}
$rotatedShortcut = $shell.CreateShortcut((Join-Path $pins 'GoNavi-rotated.lnk'))
if (-not (Test-ShortcutIconLocation $rotatedShortcut.IconLocation $brandIcon)) {
    throw ('brand icon was not applied to the rotated-identity pin: ' + $rotatedShortcut.IconLocation)
}
if (-not (Test-SameFilePath $rotatedShortcut.TargetPath $target)) {
    throw ('rotated-identity MSI pin target was not repaired: ' + $rotatedShortcut.TargetPath)
}
$rotatedItemBefore = $shellApplication.Namespace($pins).ParseName('GoNavi-rotated.lnk')
if ($null -ne $rotatedItemBefore -and -not [string]::Equals([string]$rotatedItemBefore.ExtendedProperty('System.AppUserModel.ID'), 'Syngnat.GoNavi', [StringComparison]::OrdinalIgnoreCase)) {
    throw ('rotated-identity pin was not moved to the base identity: ' + $rotatedItemBefore.ExtendedProperty('System.AppUserModel.ID'))
}
$duplicateShortcut = $shell.CreateShortcut((Join-Path $pins 'GoNavi (2).lnk'))
if (-not (Test-SameFilePath $duplicateShortcut.TargetPath $target)) {
    throw ('numbered MSI GoNavi pin target was not repaired: ' + $duplicateShortcut.TargetPath)
}

# A later icon selection refreshes every recognized pin and must keep the
# installer identity. A rotated ID from an older caller is folded back so the
# pin stays attached to the running window.
$refreshedIcon = Join-Path $env:GONAVI_TEST_ROOT 'gonavi-brand-0123456789abcdef01234567.ico'
[IO.File]::WriteAllBytes($refreshedIcon, [byte[]](0, 0, 1, 0, 0, 0))
$refreshedAumid = 'Syngnat.GoNavi.Icon.0123456789abcdef01234567'
$refreshedBrandCount = Set-GoNaviShortcutBrandIcon -TargetPath $target -IconPath $refreshedIcon -ApplicationUserModelID $refreshedAumid -ShortcutDirectories @($pins) -TaskbarDirectory $pins
if ($refreshedBrandCount -ne 7) {
    throw ('unexpected refreshed brand icon shortcut update count: ' + $refreshedBrandCount)
}
foreach ($shortcutName in @('missing-icon.lnk', 'existing-icon.lnk', 'blank-icon.lnk', 'other-missing-icon.lnk', 'GoNavi.lnk', 'GoNavi (2).lnk', 'GoNavi-rotated.lnk')) {
    $updatedShortcut = $shell.CreateShortcut((Join-Path $pins $shortcutName))
    if (-not (Test-ShortcutIconLocation $updatedShortcut.IconLocation $refreshedIcon)) {
        throw ('refreshed brand icon was not applied to ' + $shortcutName + ': ' + $updatedShortcut.IconLocation)
    }
}
if (-not (Test-ShortcutIconLocation $shell.CreateShortcut((Join-Path $pins 'foreign-target.lnk')).IconLocation $missingIcon)) {
    throw 'refreshed brand icon update modified a foreign target shortcut'
}
$refreshedItem = $shellApplication.Namespace($pins).ParseName('GoNavi-rotated.lnk')
if ($null -ne $refreshedItem -and -not [string]::Equals([string]$refreshedItem.ExtendedProperty('System.AppUserModel.ID'), 'Syngnat.GoNavi', [StringComparison]::OrdinalIgnoreCase)) {
    throw ('brand icon update moved the pin off the stable identity: ' + $refreshedItem.ExtendedProperty('System.AppUserModel.ID'))
}

# Portable and development builds can refresh an installed pin's icon without
# redirecting the pin to the currently running executable.
$portableRoot = Join-Path $env:GONAVI_TEST_ROOT 'portable'
$portablePins = Join-Path $portableRoot 'pins'
$portableCurrentDir = Join-Path $portableRoot 'current'
$portableInstalledDir = Join-Path $portableRoot 'installed'
[void](New-Item -ItemType Directory -Path $portablePins, $portableCurrentDir, $portableInstalledDir -Force)
$portableTarget = Join-Path $portableCurrentDir 'GoNavi.exe'
$portableInstalledTarget = Join-Path $portableInstalledDir 'GoNavi.exe'
$portableIcon = Join-Path $portableRoot 'gonavi-brand-portable.ico'
[IO.File]::WriteAllBytes($portableTarget, [byte[]](1))
[IO.File]::WriteAllBytes($portableInstalledTarget, [byte[]](1))
[IO.File]::WriteAllBytes($portableIcon, [byte[]](0, 0, 1, 0, 0, 0))
$portableShortcutPath = Join-Path $portablePins 'GoNavi-history.lnk'
New-TestShortcut $portableShortcutPath $portableInstalledTarget ''
[void](Set-GoNaviShortcutRelaunchProperties -ShortcutPath $portableShortcutPath -TargetPath $portableInstalledTarget -IconPath $missingIcon -ApplicationUserModelID 'Syngnat.GoNavi.Icon.deadbeef')
$portableStablePath = Join-Path $portablePins 'GoNavi-stable.lnk'
New-TestShortcut $portableStablePath $portableTarget ''
[void](Set-GoNaviShortcutRelaunchProperties -ShortcutPath $portableStablePath -TargetPath $portableTarget -IconPath $missingIcon -ApplicationUserModelID 'Syngnat.GoNavi')
$portablePlainPath = Join-Path $portablePins 'GoNavi-plain.lnk'
New-TestShortcut $portablePlainPath $portableTarget ''
$portableUpdateCount = Set-GoNaviShortcutBrandIcon -TargetPath $portableTarget -IconPath $portableIcon -ApplicationUserModelID 'Syngnat.GoNavi.Icon.0123456789abcdef01234567' -ShortcutDirectories @($portablePins) -TaskbarDirectory $portablePins
if ($portableUpdateCount -ne 3) {
    throw ('unexpected portable shortcut update count: ' + $portableUpdateCount)
}
$portableShortcut = $shell.CreateShortcut($portableShortcutPath)
if (-not (Test-SameFilePath $portableShortcut.TargetPath $portableInstalledTarget)) {
    throw ('portable launch redirected an existing GoNavi pin: ' + $portableShortcut.TargetPath)
}
$portableItem = $shellApplication.Namespace($portablePins).ParseName('GoNavi-history.lnk')
if ($null -ne $portableItem) {
    $portableRelaunchCommand = [string]$portableItem.ExtendedProperty('System.AppUserModel.RelaunchCommand')
    if (-not [string]::Equals($portableRelaunchCommand, ('"' + $portableInstalledTarget + '"'), [StringComparison]::OrdinalIgnoreCase)) {
        throw ('portable relaunch target was not preserved and quoted: ' + $portableRelaunchCommand)
    }
    $portableIdentity = [string]$portableItem.ExtendedProperty('System.AppUserModel.ID')
    if (-not [string]::Equals($portableIdentity, 'Syngnat.GoNavi', [StringComparison]::OrdinalIgnoreCase)) {
        throw ('portable rotated pin was not returned to the stable identity: ' + $portableIdentity)
    }
}
$portableStableShortcut = $shell.CreateShortcut($portableStablePath)
if (-not (Test-SameFilePath $portableStableShortcut.TargetPath $portableTarget)) {
    throw ('stable portable pin target changed: ' + $portableStableShortcut.TargetPath)
}
if (-not (Test-ShortcutIconLocation $portableStableShortcut.IconLocation $portableIcon)) {
    throw ('stable portable pin icon was not updated: ' + $portableStableShortcut.IconLocation)
}
$portableStableItem = $shellApplication.Namespace($portablePins).ParseName('GoNavi-stable.lnk')
if ($null -ne $portableStableItem -and -not [string]::Equals([string]$portableStableItem.ExtendedProperty('System.AppUserModel.ID'), 'Syngnat.GoNavi', [StringComparison]::OrdinalIgnoreCase)) {
    throw ('stable portable pin identity changed: ' + $portableStableItem.ExtendedProperty('System.AppUserModel.ID'))
}
$portablePlainItem = $shellApplication.Namespace($portablePins).ParseName('GoNavi-plain.lnk')
if ($null -ne $portablePlainItem -and -not [string]::IsNullOrWhiteSpace([string]$portablePlainItem.ExtendedProperty('System.AppUserModel.ID'))) {
    throw ('portable pin without an identity was assigned one: ' + $portablePlainItem.ExtendedProperty('System.AppUserModel.ID'))
}
$env:GONAVI_BRAND_MATCH_TARGET_ONLY = '1'
$portableMatchedIcon = Join-Path $portableRoot 'gonavi-brand-matched.ico'
[IO.File]::WriteAllBytes($portableMatchedIcon, [byte[]](0, 0, 1, 0, 0, 0))
$matchedOnlyCount = Set-GoNaviShortcutBrandIcon -TargetPath $portableTarget -IconPath $portableMatchedIcon -ShortcutDirectories @($portablePins) -TaskbarDirectory $portablePins
if ($matchedOnlyCount -ne 2) {
    throw ('unexpected portable match-only update count: ' + $matchedOnlyCount)
}
$portableHistoryAfterMatchOnly = $shell.CreateShortcut($portableShortcutPath)
if (-not (Test-ShortcutIconLocation $portableHistoryAfterMatchOnly.IconLocation $portableIcon)) {
    throw ('match-only portable update rewrote a different install pin: ' + $portableHistoryAfterMatchOnly.IconLocation)
}
$portableStableAfterMatchOnly = $shell.CreateShortcut($portableStablePath)
if (-not (Test-ShortcutIconLocation $portableStableAfterMatchOnly.IconLocation $portableMatchedIcon)) {
    throw ('match-only portable update skipped the current executable pin: ' + $portableStableAfterMatchOnly.IconLocation)
}
$env:GONAVI_BRAND_MATCH_TARGET_ONLY = ''

# A failed property-store write must fail the PowerShell process. Otherwise Go
# records the identity state and permanently skips repairing the broken pin.
function Set-GoNaviShortcutRelaunchProperties { return $false }
$propertyFailure = $null
try {
    [void](Set-GoNaviShortcutBrandIcon -TargetPath $target -IconPath $refreshedIcon -ApplicationUserModelID $refreshedAumid -ShortcutDirectories @($pins) -TaskbarDirectory $pins)
} catch {
    $propertyFailure = $_
}
if ($null -eq $propertyFailure) {
    throw 'taskbar property-store failure was reported as success'
}

$desktopDirectories = @($desktop, $commonDesktop)
$absentState = Save-GoNaviDesktopShortcutState -TargetPath $target -BackupDirectory (Join-Path $env:GONAVI_TEST_ROOT 'backup-absent') -DesktopDirectories $desktopDirectories
if (-not $absentState.Succeeded -or $absentState.InstallValue -ne '0' -or $absentState.Entries.Count -ne 0) {
    throw 'desktop shortcut should remain absent'
}
New-TestShortcut (Join-Path $desktop 'GoNavi.lnk') $foreignTarget ''
$foreignState = Save-GoNaviDesktopShortcutState -TargetPath $target -BackupDirectory (Join-Path $env:GONAVI_TEST_ROOT 'backup-foreign') -DesktopDirectories $desktopDirectories
if (-not $foreignState.Succeeded -or $foreignState.InstallValue -ne '0' -or $foreignState.Entries.Count -ne 1) {
    throw 'foreign desktop shortcut state was not captured'
}
New-TestShortcut (Join-Path $desktop 'GoNavi.lnk') $target ''
if (-not (Remove-GoNaviDesktopShortcutsForTarget -TargetPath $target -DesktopDirectories $desktopDirectories)) {
    throw 'simulated unexpected desktop shortcut could not be removed'
}
if (-not (Restore-GoNaviDesktopShortcutState -State $foreignState -OnlyForeign)) {
    throw 'foreign desktop shortcut restore reported failure'
}
$restoredForeignShortcut = $shell.CreateShortcut((Join-Path $desktop 'GoNavi.lnk'))
if (-not (Test-SameFilePath $restoredForeignShortcut.TargetPath $foreignTarget)) {
    throw 'foreign desktop shortcut was not restored after simulated MSI overwrite'
}
New-TestShortcut (Join-Path $commonDesktop 'GoNavi.lnk') $target ''
$matchingState = Save-GoNaviDesktopShortcutState -TargetPath $target -BackupDirectory (Join-Path $env:GONAVI_TEST_ROOT 'backup-matching') -DesktopDirectories $desktopDirectories
if (-not $matchingState.Succeeded -or $matchingState.InstallValue -ne '1' -or $matchingState.Entries.Count -ne 2) {
    throw 'matching desktop shortcut should be preserved'
}
Remove-Item -LiteralPath (Join-Path $commonDesktop 'GoNavi.lnk') -Force
if (-not (Restore-GoNaviDesktopShortcutState -State $matchingState)) {
    throw 'matching desktop shortcut restore reported failure'
}
$restoredMatchingShortcut = $shell.CreateShortcut((Join-Path $commonDesktop 'GoNavi.lnk'))
if (-not (Test-SameFilePath $restoredMatchingShortcut.TargetPath $target)) {
    throw 'matching desktop shortcut was not restored after simulated MSI failure'
}
`
	scriptPath := filepath.Join(tempDir, "shortcut-repair-test.ps1")
	if err := os.WriteFile(scriptPath, []byte(strings.ReplaceAll(harness, "\n", "\r\n")), 0o644); err != nil {
		t.Fatal(err)
	}

	command := exec.Command(powerShell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned", "-File", scriptPath)
	command.Env = append(os.Environ(),
		"GONAVI_TEST_TARGET="+targetPath,
		"GONAVI_TEST_FOREIGN_TARGET="+foreignTargetPath,
		"GONAVI_TEST_PINS="+pinsDirectory,
		"GONAVI_TEST_INSTALLER="+installerDirectory,
		"GONAVI_TEST_DESKTOP="+desktopDirectory,
		"GONAVI_TEST_COMMON_DESKTOP="+commonDesktopDirectory,
		"GONAVI_TEST_ROOT="+tempDir,
	)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("shortcut repair integration failed: %v\n%s", err, output)
	}
}

// Shared Start Menu shortcuts under ProgramData are created by the installer and
// are not writable for a standard user. Their presence must not turn a whole brand
// icon update into a failure: the writable pins still update and the process must
// report success so the caller can persist the new identity.
func TestWindowsShortcutBrandIconSkipsUnwritableShortcut(t *testing.T) {
	powerShell, err := exec.LookPath("powershell.exe")
	if err != nil {
		t.Skip("powershell.exe is unavailable")
	}

	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "install", "GoNavi.exe")
	// shortcutsDirectory stands in for a ProgramData Start Menu location: plain
	// shortcuts that are not taskbar pins. taskbarDirectory stays separate so the
	// read-only entry exercises the non-taskbar branch.
	shortcutsDirectory := filepath.Join(tempDir, "shortcuts")
	taskbarDirectory := filepath.Join(tempDir, "taskbar")
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, directory := range []string{shortcutsDirectory, taskbarDirectory} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(targetPath, []byte("test"), 0o644); err != nil {
		t.Fatal(err)
	}

	harness := windowsShortcutRepairPowerShellScript + `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell

function New-TestShortcut {
    param([string]$Path, [string]$TargetPath)
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $TargetPath
    $shortcut.IconLocation = ',0'
    $shortcut.Save()
}

# Access-control work uses the .NET file APIs rather than Get-Acl/Set-Acl.
# Importing Microsoft.PowerShell.Security inside a non-interactive child process
# can fail on TypeData already being registered (AuditToString/AccessToString),
# and that has nothing to do with what this test verifies.
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

# Capture the repair log so the read-only skip stays observable. Reading the
# shortcut back is not an option after the deny rule: COM resolves an entry the
# user cannot write to an empty shell, so a log assertion is the reliable evidence
# that the read-only branch ran instead of failing the batch.
$script:GoNaviRepairLog = [Collections.Generic.List[string]]::new()
function Write-UpdateLog { param([string]$Message) [void]$script:GoNaviRepairLog.Add([string]$Message) }

$target = $env:GONAVI_TEST_TARGET
$shortcuts = $env:GONAVI_TEST_SHORTCUTS
$taskbar = $env:GONAVI_TEST_TASKBAR
$writableShortcut = Join-Path $shortcuts 'GoNavi.lnk'
$readonlyShortcut = Join-Path $shortcuts 'GoNavi-readonly.lnk'
New-TestShortcut $writableShortcut $target
New-TestShortcut $readonlyShortcut $target

# The read-only entry carries a stale icon location so the script genuinely tries
# to save it. Without a difference the icon already matches, the save branch never
# runs, and the read-only skip path would stay untested.
$readonlyStaleIcon = 'C:\stale-GoNavi-icon.ico,0'
$staleShortcut = $shell.CreateShortcut($readonlyShortcut)
$staleShortcut.IconLocation = $readonlyStaleIcon
$staleShortcut.Save()
$staleReadBack = [string]($shell.CreateShortcut($readonlyShortcut)).IconLocation
if (-not [string]::Equals($staleReadBack, $readonlyStaleIcon, [StringComparison]::OrdinalIgnoreCase)) {
    throw ('stale icon was not persisted before the deny rule: ' + $staleReadBack)
}

# Deny writes for the current user so WScript.Shell.Save fails like it does for
# a ProgramData Start Menu shortcut owned by the installer. The read-only entry
# lives outside the taskbar directory on purpose: the real ProgramData Start
# Menu path is not a taskbar shortcut, and it must be skipped rather than fail
# the whole batch.
#
# Only WriteData is denied. Denying the broader Write/Modify set would also block
# reading the shortcut, and COM would then resolve it to an empty shell whose empty
# target no longer matches, skipping the entry before the save branch is reached.
$readonlyAcl = [IO.File]::GetAccessControl($readonlyShortcut)
$deny = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $currentUser,
    'WriteData',
    'Deny')
$readonlyAcl.AddAccessRule($deny)
[IO.File]::SetAccessControl($readonlyShortcut, $readonlyAcl)

$denyCount = @([IO.File]::GetAccessControl($readonlyShortcut).Access | Where-Object { $_.AccessControlType -eq 'Deny' }).Count
if ($denyCount -lt 1) {
    throw 'deny rule was not applied to the read-only shortcut'
}
if (Test-GoNaviShortcutWritable $readonlyShortcut) {
    throw 'read-only shortcut was still reported writable'
}
if (-not (Test-GoNaviShortcutWritable $writableShortcut)) {
    throw 'writable shortcut was reported read-only'
}

# Only an explicit permission denial may be treated as read-only. A shortcut that
# is merely locked by another process must surface its error instead of being
# skipped, otherwise the caller records the update as done and never retries.
$probeLock = [IO.File]::Open($writableShortcut, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$lockThrew = $false
try {
    [void](Test-GoNaviShortcutWritable $writableShortcut)
} catch {
    $lockThrew = $true
}
$probeLock.Close()
if (-not $lockThrew) {
    throw 'a locked shortcut was treated as read-only instead of failing the batch'
}

$brandIcon = Join-Path $env:GONAVI_TEST_ROOT 'gonavi-brand-abcdefabcdefabcdefabcdef.ico'
[IO.File]::WriteAllBytes($brandIcon, [byte[]](0, 0, 1, 0, 0, 0))

# A read-only shortcut must be skipped instead of failing the whole batch.
$updateCount = Set-GoNaviShortcutBrandIcon -TargetPath $target -IconPath $brandIcon -ShortcutDirectories @($shortcuts) -TaskbarDirectory $taskbar
if ($updateCount -ne 1) {
    throw ('expected only the writable shortcut to update, got ' + $updateCount)
}
$updatedShortcut = $shell.CreateShortcut($writableShortcut)
if (-not [string]::Equals([string]$updatedShortcut.IconLocation, ($brandIcon + ',0'), [StringComparison]::OrdinalIgnoreCase)) {
    throw ('writable shortcut icon was not applied: ' + $updatedShortcut.IconLocation)
}
$skipLog = @($script:GoNaviRepairLog | Where-Object { $_ -like '*skipped read-only shortcut icon update*' })
if ($skipLog.Count -lt 1) {
    throw ('the read-only shortcut was not skipped: ' + [string]::Join(' | ', $script:GoNaviRepairLog))
}
if (-not ($skipLog[0] -like ('*' + $readonlyShortcut + '*'))) {
    throw ('the skip log did not name the read-only shortcut: ' + $skipLog[0])
}`
	scriptPath := filepath.Join(tempDir, "brand-icon-readonly-test.ps1")
	if err := os.WriteFile(scriptPath, []byte(strings.ReplaceAll(harness, "\n", "\r\n")), 0o644); err != nil {
		t.Fatal(err)
	}

	command := exec.Command(powerShell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "RemoteSigned", "-File", scriptPath)
	command.Env = append(os.Environ(),
		"GONAVI_TEST_TARGET="+targetPath,
		"GONAVI_TEST_SHORTCUTS="+shortcutsDirectory,
		"GONAVI_TEST_TASKBAR="+taskbarDirectory,
		"GONAVI_TEST_ROOT="+tempDir,
	)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("read-only shortcut brand icon update failed: %v\n%s", err, output)
	}
}
