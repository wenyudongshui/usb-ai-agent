$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path "$ScriptDir\..").Path
$DataDir = if ($env:PORTABLE_AI_DATA_DIR) { (Resolve-Path $env:PORTABLE_AI_DATA_DIR -ErrorAction SilentlyContinue).Path } else { "$RootDir\data" }
$ModelsDir = "$DataDir\models"
$OllamaDir = "$DataDir\ollama"

$ModelCatalog = @(
    @{ Num=1; Category="Gemma 4 Family (Optimized GGUFs)"; Name="Gemma 4 E2B (Q4_K_M)"; Tag="https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf"; Size="3.1"; Input="Text"; Label="STANDARD"; Badge="BEST BALANCE" },
    @{ Num=2; Category="Gemma 4 Family (Optimized GGUFs)"; Name="Gemma 4 E2B (Q6_K)"; Tag="https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q6_K.gguf"; Size="4.5"; Input="Text"; Label="STANDARD"; Badge="STRONG CPU/GPU" },
    @{ Num=3; Category="Gemma 4 Family (Optimized GGUFs)"; Name="Gemma 4 E4B (Q4_K_M)"; Tag="https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf"; Size="5.0"; Input="Text"; Label="STANDARD"; Badge="MOST USERS" },
    @{ Num=4; Category="Qwen 3.5 & Ministral 3 (Daily Drivers)"; Name="Qwen 3.5 (9B)"; Tag="qwen3.5:9b"; Size="6.6"; Input="Text, Image"; Label="STANDARD"; Badge="RECOMMENDED" },
    @{ Num=5; Category="Qwen 3.5 & Ministral 3 (Daily Drivers)"; Name="Ministral 3 (8B)"; Tag="ministral-3:8b"; Size="6.0"; Input="Text, Image"; Label="STANDARD"; Badge="DAILY" }
)

function Get-USBFreeSpaceGB {
    try {
        $drive = Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -and $RootDir.StartsWith($_.Root) } | Select-Object -First 1
        if ($drive) { return [math]::Round($drive.Free / 1GB, 1) }
    } catch {}
    return -1
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   USB AI AGENT - Local Model Setup (Ollama, portable)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$freeGB = Get-USBFreeSpaceGB
if ($freeGB -gt 0) { Write-Host "  Free Space: $freeGB GB" -ForegroundColor DarkGray; Write-Host "" }

Write-Host "[1/4] Choose your AI model(s):" -ForegroundColor Yellow

$currentCategory = ""
foreach ($m in $ModelCatalog) {
    if ($m.Category -ne $currentCategory) {
        $currentCategory = $m.Category
        Write-Host "`n  --- $currentCategory ---" -ForegroundColor Cyan
    }
    $badgeStr = if ($m.Badge) { " - $($m.Badge)" } else { "" }
    $padNum = $m.Num.ToString().PadLeft(2)
    Write-Host "  [$padNum]" -ForegroundColor Yellow -NoNewline
    Write-Host " $($m.Name.PadRight(24))" -ForegroundColor White -NoNewline
    Write-Host ("[" + $m.Input + "]").PadRight(16) -ForegroundColor DarkCyan -NoNewline
    Write-Host ("(~$($m.Size) GB)").PadRight(12) -ForegroundColor DarkGray -NoNewline
    Write-Host " [STANDARD]" -ForegroundColor DarkCyan -NoNewline
    Write-Host $badgeStr -ForegroundColor Magenta
}

Write-Host "`n  [C] CUSTOM - Enter an Official Ollama Tag" -ForegroundColor Green
Write-Host "      Browse ALL models here: https://ollama.com/library" -ForegroundColor Blue
Write-Host "`n  ------------------------------------------------" -ForegroundColor DarkGray
Write-Host "  Enter number(s) separated by commas  (e.g. 1,4)" -ForegroundColor Gray

$UserChoice = Read-Host "  Your choice"
if ([string]::IsNullOrWhiteSpace($UserChoice)) {
    Write-Host "`n  No input! Defaulting to [3] Gemma 4 E4B..." -ForegroundColor Yellow
    $UserChoice = "3"
}

$SelectedModels = @()
$HasCustom = $false

foreach ($t in ($UserChoice -split "," | ForEach-Object { $_.Trim().ToLower() })) {
    if ($t -eq "c" -or $t -eq "custom") { $HasCustom = $true }
    elseif ($t -match '^\d+$') {
        $num = [int]$t
        $found = $ModelCatalog | Where-Object { $_.Num -eq $num }
        if ($found -and -Not ($SelectedModels | Where-Object { $_.Num -eq $num })) { $SelectedModels += $found }
    }
}

if ($HasCustom) {
    Write-Host "`n  ---- Custom Model Setup ----" -ForegroundColor Green
    $customTag = Read-Host "  Ollama Tag (e.g. mistral-nemo, phi3)"
    if ($customTag) {
        $SelectedModels += @{ Num=99; Name="Custom: $customTag"; Tag=$customTag.Trim(); Size="?"; Label="CUSTOM" }
        Write-Host "  Custom model added!" -ForegroundColor Green
    }
}

if ($SelectedModels.Count -eq 0) { Write-Host "`n  ERROR: No models selected!" -ForegroundColor Red; exit 1 }

# Directories
New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null
New-Item -ItemType Directory -Force -Path "$OllamaDir\data" | Out-Null
Write-Host "`n[2/4] Created storage folders." -ForegroundColor Green

# Ollama Engine Setup
Write-Host "`n[3/4] Setting up Portable Ollama Engine..." -ForegroundColor Yellow
$OllamaURL = "https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip"
$OllamaDest = "$OllamaDir\ollama.zip"
$OllamaExe = "$OllamaDir\ollama.exe"

if (Test-Path $OllamaExe) {
    Write-Host "      Engine already installed!" -ForegroundColor Green
} else {
    Write-Host "      Downloading Ollama Engine (~100MB)..." -ForegroundColor Yellow
    curl.exe -L --ssl-no-revoke $OllamaURL -o $OllamaDest
    if (Test-Path $OllamaDest) {
        Write-Host "      Extracting to USB..." -ForegroundColor Yellow
        Expand-Archive -Path $OllamaDest -DestinationPath $OllamaDir -Force
        Remove-Item $OllamaDest -Force -ErrorAction SilentlyContinue
        Write-Host "      Engine Installed successfully!" -ForegroundColor Green
    } else {
        Write-Host "      ERROR: Failed to download engine!" -ForegroundColor Red
        exit 1
    }
}

# Downloading Models via Ollama
Write-Host "`n[4/4] Pulling Models (local, offline-capable)..." -ForegroundColor Yellow
$downloadErrors = @()

$env:OLLAMA_MODELS = "$OllamaDir\data"
Write-Host "`n      Starting background Ollama server on USB..." -ForegroundColor DarkGray
$ServerProcess = Start-Process -FilePath $OllamaExe -ArgumentList "serve" -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 5

$idx = 1
foreach ($m in $SelectedModels) {
    if ($m.Tag -match "^http.*" -and $m.Tag -match "\.gguf") {
        $tagUrlNoQuery = $m.Tag.Split('?')[0]
        $fileName = $tagUrlNoQuery.Split('/')[-1]
        if (-not $fileName.EndsWith(".gguf")) { $fileName += ".gguf" }
        $dest = "$ModelsDir\$fileName"
        $baseName = $fileName -ireplace '\.gguf$', ''
        $modelNameLocal = "$baseName-local".ToLower() -replace '[^a-z0-9_-]', '-'

        Write-Host "`n  ($idx/$($SelectedModels.Count)) Checking $($m.Name)..." -ForegroundColor Yellow
        $idx++
        Write-Host "      Downloading $fileName ..." -ForegroundColor Cyan
        curl.exe -L -C - $($m.Tag) -o $dest

        $modelFileContent = "FROM ./$fileName`nPARAMETER temperature 0.7`nPARAMETER top_p 0.9"
        Set-Content -Path "$ModelsDir\Modelfile-$modelNameLocal" -Value $modelFileContent -Encoding Ascii
        Write-Host "      Importing into Ollama as '$modelNameLocal'..." -ForegroundColor Cyan
        Push-Location $ModelsDir
        $createArgs = "create $modelNameLocal -f Modelfile-$modelNameLocal"
        $createProcess = Start-Process -FilePath $OllamaExe -ArgumentList $createArgs -Wait -NoNewWindow -PassThru
        Pop-Location
        if ($createProcess.ExitCode -eq 0) { Write-Host "      Import complete!" -ForegroundColor Green; $m.Tag = $modelNameLocal }
        else { Write-Host "      FAILED to import custom model: $fileName" -ForegroundColor Red; $downloadErrors += $m.Name }
        continue
    }

    $showResult = & $OllamaExe show $($m.Tag) 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n  ($idx/$($SelectedModels.Count)) " -ForegroundColor Green -NoNewline
        Write-Host ("$([char]0x2705) {0} [{1}] already pulled - skipping!" -f $m.Name, $m.Tag) -ForegroundColor Green
        $idx++
        continue
    }
    Write-Host "`n  ($idx/$($SelectedModels.Count)) Pulling $($m.Name) [$($m.Tag)]..." -ForegroundColor Yellow
    $idx++
    try {
        $pullArgs = "pull $($m.Tag)"
        $pullProcess = Start-Process -FilePath $OllamaExe -ArgumentList $pullArgs -Wait -NoNewWindow -PassThru
        if ($pullProcess.ExitCode -ne 0) { throw "Exit code $($pullProcess.ExitCode)" }
        Write-Host "      Pull complete!" -ForegroundColor Green
    } catch {
        Write-Host "      FAILED to pull model: $($m.Tag)" -ForegroundColor Red
        $downloadErrors += $m.Name
    }
}

Write-Host "`n      Stopping background Ollama server..." -ForegroundColor DarkGray
Stop-Process -Id $ServerProcess.Id -Force -ErrorAction SilentlyContinue

# Record Models
$installedList = $SelectedModels | ForEach-Object { "$($_.Tag)|$($_.Name)|LOCAL" }
if (Test-Path "$ModelsDir\installed-models.txt") {
    $existing = Get-Content "$ModelsDir\installed-models.txt"
    $installedList = ($existing + $installedList) | Select-Object -Unique
}
Set-Content -Path "$ModelsDir\installed-models.txt" -Value ($installedList -join "`n") -Force -Encoding UTF8

Write-Host "`n==========================================================" -ForegroundColor Cyan
if ($downloadErrors.Count -gt 0) { Write-Host "   SETUP COMPLETE (with some download errors)" -ForegroundColor Yellow }
else { Write-Host "   SETUP COMPLETE! LOCAL AI AGENTS ARE READY!" -ForegroundColor Green }
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Next step (in the web UI):" -ForegroundColor Green
Write-Host "   1. 启动 start.bat 并登录"
Write-Host "   2. 「添加 AI」: API 地址 http://127.0.0.1:11434/v1"
Write-Host "      模型名: $($SelectedModels[0].Tag)  密钥: ollama(任意)"
Write-Host "   3. 先在「系统」页启动本地 Ollama,再选择该 AI 对话"
Write-Host ""