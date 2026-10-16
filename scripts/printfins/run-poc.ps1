param(
    [Parameter(Mandatory = $true)][string]$RunDirectory,
    [string]$Executable
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$runRoot = (Resolve-Path -LiteralPath $RunDirectory).Path
if (-not $Executable) { $Executable = Join-Path $repoRoot 'build\src\Release\bambu-studio.exe' }
$Executable = (Resolve-Path -LiteralPath $Executable).Path
$output = Join-Path $runRoot 'result'
if (Test-Path -LiteralPath $output) { throw 'Use a fresh prepared run directory.' }
$settings = @{
    BBS_PRINTFINS_POC_ENABLE = '1'
    BBS_PRINTFINS_POC_OUTPUT = $output
    BBS_PRINTFINS_POC_ASSETS = Join-Path $repoRoot 'resources\printfins'
    BBS_PRINTFINS_POC_OPTIONS = Join-Path $runRoot 'options.json'
    BBS_PRINTFINS_POC_AUTOCLOSE = '1'
    WEBVIEW2_USER_DATA_FOLDER = Join-Path $runRoot 'webview-profile'
}
$saved = @{}
try {
    foreach ($name in $settings.Keys) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process')
    }
    $profileArgument = '"{0}"' -f (Join-Path $runRoot 'profile')
    $meshArgument = '"{0}"' -f (Join-Path $runRoot 'input.stl')
    $process = Start-Process -FilePath $Executable -WorkingDirectory $runRoot -WindowStyle Hidden `
        -ArgumentList @('--datadir', $profileArgument, $meshArgument) -PassThru
    Write-Output "PoC process: $($process.Id); report: $output\report.json"
} finally {
    foreach ($name in $saved.Keys) {
        [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
    }
}
