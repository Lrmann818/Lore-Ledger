[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Url,

    [ValidateSet('auto', 'edge', 'chrome', 'firefox')]
    [string]$Browser = 'auto',

    [switch]$KeepProfile
)

$ErrorActionPreference = 'Stop'

function Resolve-BrowserCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $candidates = switch ($Name) {
        'edge' { @('msedge', 'microsoft-edge') }
        'chrome' { @('chrome', 'chrome.exe', 'google-chrome') }
        'firefox' { @('firefox', 'firefox.exe') }
        default { @() }
    }

    foreach ($candidate in $candidates) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd) {
            return $cmd.Source
        }
    }

    return $null
}

$browserOrder = if ($Browser -eq 'auto') {
    @('edge', 'chrome', 'firefox')
} else {
    @($Browser)
}

$selected = $null
$selectedCmd = $null
foreach ($b in $browserOrder) {
    $cmd = Resolve-BrowserCommand -Name $b
    if ($cmd) {
        $selected = $b
        $selectedCmd = $cmd
        break
    }
}

if (-not $selectedCmd) {
    throw "No supported browser executable found. Tried: $($browserOrder -join ', ')."
}

$profileDir = Join-Path ([System.IO.Path]::GetTempPath()) ("lore-ledger-smoke-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null

$args = switch ($selected) {
    'edge' {
        @(
            "--user-data-dir=$profileDir",
            '--new-window',
            '--no-first-run',
            '--no-default-browser-check',
            $Url
        )
    }
    'chrome' {
        @(
            "--user-data-dir=$profileDir",
            '--new-window',
            '--no-first-run',
            '--no-default-browser-check',
            $Url
        )
    }
    'firefox' {
        @(
            '-no-remote',
            '-profile',
            $profileDir,
            $Url
        )
    }
    default {
        throw "Unsupported browser selection: $selected"
    }
}

$proc = Start-Process -FilePath $selectedCmd -ArgumentList $args -PassThru
Write-Output "Launched $selected with temporary profile: $profileDir"

if ($KeepProfile) {
    Write-Output 'Keeping profile directory for inspection.'
    return
}

try {
    Wait-Process -Id $proc.Id
} finally {
    if (Test-Path -LiteralPath $profileDir) {
        Remove-Item -LiteralPath $profileDir -Recurse -Force
        Write-Output 'Temporary profile removed.'
    }
}
