[CmdletBinding()]
param(
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$webUrl = 'http://localhost:5173'
$healthUrl = 'http://localhost:3000/api/health'
$minimumNodeVersion = [version]'22.12.0'

function Write-Step {
    param([Parameter(Mandatory = $true)][string]$Message)

    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    # Use cmd /c to avoid PowerShell misparsing arguments with colons (e.g. npm run db:generate)
    $encodedArgs = ($Arguments | ForEach-Object { $_ -replace '"', '\"' }) -join ' '
    cmd /c "$Command $encodedArgs"
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code: $LASTEXITCODE)"
    }
}

function Test-DockerEngine {
    try {
        & docker info *> $null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
}

function Test-HttpEndpoint {
    param([Parameter(Mandatory = $true)][string]$Url)

    try {
        $request = [System.Net.WebRequest]::Create($Url)
        $request.Timeout = 1500
        $response = $request.GetResponse()
        $response.Close()
        return $true
    }
    catch {
        return $false
    }
}

function Get-ListeningProcess {
    param([Parameter(Mandatory = $true)][int]$Port)

    try {
        return Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
            Select-Object -First 1
    }
    catch {
        return $null
    }
}

try {
    Set-Location -LiteralPath $projectRoot

    Write-Host "Idea2Screenplay development launcher" -ForegroundColor Green
    Write-Host "Project: $projectRoot"

    if ((Test-HttpEndpoint -Url $healthUrl) -and (Test-HttpEndpoint -Url $webUrl)) {
        Write-Host "The project is already running: $webUrl" -ForegroundColor Green
        if (-not $NoBrowser) {
            Start-Process $webUrl
        }
        exit 0
    }

    foreach ($requiredCommand in @('node', 'npm', 'docker')) {
        if (-not (Get-Command $requiredCommand -ErrorAction SilentlyContinue)) {
            throw "Required command '$requiredCommand' was not found in PATH."
        }
    }

    $nodeVersionOutput = & node --version
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to read the Node.js version.'
    }

    $nodeVersionText = ([string]($nodeVersionOutput | Select-Object -Last 1)).Trim() -replace '^v', ''
    try {
        $nodeVersion = [version]$nodeVersionText
    }
    catch {
        throw "Unrecognized Node.js version: $nodeVersionText"
    }

    if ($nodeVersion -lt $minimumNodeVersion) {
        throw "Node.js $minimumNodeVersion or newer is required; found $nodeVersion."
    }
    Write-Host "Node.js $nodeVersion is ready."

    Write-Step 'Checking Docker Desktop'
    if (-not (Test-DockerEngine)) {
        $dockerDesktopCandidates = @()
        if ($env:ProgramFiles) {
            $dockerDesktopCandidates += Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
        }
        if (${env:ProgramFiles(x86)}) {
            $dockerDesktopCandidates += Join-Path ${env:ProgramFiles(x86)} 'Docker\Docker\Docker Desktop.exe'
        }
        if ($env:LOCALAPPDATA) {
            $dockerDesktopCandidates += Join-Path $env:LOCALAPPDATA 'Docker\Docker Desktop.exe'
        }

        $dockerDesktopPath = $dockerDesktopCandidates |
            Where-Object { Test-Path -LiteralPath $_ } |
            Select-Object -First 1

        if (-not $dockerDesktopPath) {
            throw 'Docker is installed, but Docker Desktop could not be started automatically. Start Docker Desktop and run this launcher again.'
        }

        Write-Host 'Docker Engine is not running. Starting Docker Desktop...'
        Start-Process -FilePath $dockerDesktopPath -WindowStyle Hidden

        $dockerDeadline = (Get-Date).AddSeconds(120)
        while ((Get-Date) -lt $dockerDeadline -and -not (Test-DockerEngine)) {
            Write-Host '.' -NoNewline
            Start-Sleep -Seconds 2
        }
        Write-Host ''

        if (-not (Test-DockerEngine)) {
            throw 'Docker Desktop did not become ready within 120 seconds.'
        }
    }
    Write-Host 'Docker Engine is ready.'

    Write-Step 'Preparing local configuration'
    if (-not (Test-Path -LiteralPath '.env')) {
        if (-not (Test-Path -LiteralPath '.env.example')) {
            throw '.env.example is missing.'
        }
        Copy-Item -LiteralPath '.env.example' -Destination '.env'
        Write-Host 'Created .env from .env.example (demo mode enabled).'
    }
    else {
        Write-Host 'Using the existing .env file.'
    }

    $dependenciesNeedInstall = -not (Test-Path -LiteralPath 'node_modules')
    $installedLockPath = 'node_modules\.package-lock.json'
    if (-not $dependenciesNeedInstall -and (Test-Path -LiteralPath 'package-lock.json')) {
        if (-not (Test-Path -LiteralPath $installedLockPath)) {
            $dependenciesNeedInstall = $true
        }
        else {
            $sourceLock = Get-Item -LiteralPath 'package-lock.json'
            $installedLock = Get-Item -LiteralPath $installedLockPath
            $dependenciesNeedInstall = $sourceLock.LastWriteTimeUtc -gt $installedLock.LastWriteTimeUtc
        }
    }

    if ($dependenciesNeedInstall) {
        Write-Step 'Installing npm dependencies'
        Invoke-CheckedCommand -Command 'npm' -Arguments @('install') -FailureMessage 'npm install failed.'
    }
    else {
        Write-Host 'npm dependencies are already installed.'
    }

    Write-Step 'Starting PostgreSQL'
    Invoke-CheckedCommand -Command 'docker' -Arguments @('compose', 'up', '-d', 'postgres') -FailureMessage 'Unable to start PostgreSQL.'

    $containerIdOutput = & docker compose ps -q postgres
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to inspect the PostgreSQL container.'
    }
    $containerId = ([string]($containerIdOutput | Select-Object -First 1)).Trim()
    if (-not $containerId) {
        throw 'The PostgreSQL container was not created.'
    }

    $databaseDeadline = (Get-Date).AddSeconds(90)
    $databaseReady = $false
    while ((Get-Date) -lt $databaseDeadline) {
        $containerStatusOutput = & docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $containerId 2>$null
        if ($LASTEXITCODE -eq 0) {
            $containerStatus = ([string]($containerStatusOutput | Select-Object -Last 1)).Trim()
            if ($containerStatus -in @('healthy', 'running')) {
                $databaseReady = $true
                break
            }
            if ($containerStatus -in @('unhealthy', 'exited', 'dead')) {
                & docker compose logs --tail 50 postgres
                throw "PostgreSQL entered state '$containerStatus'."
            }
        }
        Start-Sleep -Seconds 2
    }

    if (-not $databaseReady) {
        & docker compose logs --tail 50 postgres
        throw 'PostgreSQL did not become ready within 90 seconds.'
    }
    Write-Host 'PostgreSQL is ready on localhost:5433.'

    Write-Step 'Generating the Prisma client'
    Invoke-CheckedCommand -Command 'npm' -Arguments @('run', 'db:generate') -FailureMessage 'Prisma client generation failed.'

    Write-Step 'Applying database migrations'
    Invoke-CheckedCommand -Command 'npm' -Arguments @('run', 'db:migrate') -FailureMessage 'Database migration failed.'

    foreach ($port in @(3000, 5173)) {
        $listener = Get-ListeningProcess -Port $port
        if ($null -ne $listener) {
            throw "Port $port is already in use by process $($listener.OwningProcess)."
        }
    }

    Write-Step 'Starting API and Web development servers'
    Write-Host "Web:        $webUrl"
    Write-Host "API health: $healthUrl"
    Write-Host 'Press Ctrl+C to stop the development servers.' -ForegroundColor Yellow

    $browserJob = $null
    if (-not $NoBrowser) {
        $browserJob = Start-Job -ScriptBlock {
            param([string]$TargetUrl)

            $deadline = (Get-Date).AddSeconds(90)
            while ((Get-Date) -lt $deadline) {
                try {
                    $request = [System.Net.WebRequest]::Create($TargetUrl)
                    $request.Timeout = 1000
                    $response = $request.GetResponse()
                    $response.Close()
                    Start-Process $TargetUrl
                    return
                }
                catch {
                    Start-Sleep -Seconds 1
                }
            }
        } -ArgumentList $webUrl
    }

    $devExitCode = 0
    try {
        cmd /c "npm run dev"
        $devExitCode = $LASTEXITCODE
    }
    finally {
        if ($null -ne $browserJob) {
            Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
        }
        Write-Host ''
        Write-Host 'Development servers stopped. PostgreSQL is still running.' -ForegroundColor Yellow
        Write-Host 'To stop PostgreSQL: docker compose stop postgres'
    }

    if ($devExitCode -ne 0) {
        throw "The development servers exited with code $devExitCode."
    }
}
catch {
    Write-Host ''
    Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
