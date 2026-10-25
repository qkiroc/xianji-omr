param(
 [string]$Origin = 'http://116.62.12.100:8790',
 [string]$OutputRoot = '',
 [string]$PythonExe = '',
 [string[]]$DatasetIds = @(),
 [ValidateRange(1,1000)][int]$Epochs = 100,
 [ValidateSet(640,960,1280,1536)][int]$ImageSize = 1280,
 [ValidateRange(1,64)][int]$Batch = 4,
 [switch]$WorkerOnly,
 [switch]$SkipSync,
 [switch]$NoServe,
 [string]$Publish = '',
 [string]$Resume = ''
)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $OutputRoot) { $OutputRoot = Join-Path $repository '.artifacts/training' }
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$env:UV_CACHE_DIR = Join-Path $OutputRoot 'uv-cache'
$env:YOLO_CONFIG_DIR = Join-Path $OutputRoot 'settings'
$env:PYTHONUNBUFFERED = '1'
$env:PYTHONUTF8 = '1'
$env:WANDB_DISABLED = 'true'
function Run-Checked([string]$Program, [string[]]$Arguments) {
 & $Program @Arguments
 if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $Program" }
}
try {
 Push-Location -LiteralPath $repository
 $nodeOptions = @()
 $hasEnvProxyFlag = & node -p "process.allowedNodeEnvironmentFlags.has('--use-env-proxy')"
 if ($LASTEXITCODE -ne 0) { throw 'Node.js 22.18+ is required; Node.js 24 is recommended.' }
 if ($hasEnvProxyFlag -eq 'true') { $nodeOptions += '--use-env-proxy' }
 Run-Checked 'node' ($nodeOptions + @((Join-Path $PSScriptRoot 'preflight.mjs'),$Origin))
 if (-not $PythonExe) {
  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if ($uv) {
   $candidate = & $uv.Source python find --offline 3.11 2>$null
   if ($LASTEXITCODE -eq 0 -and $candidate) { $PythonExe = [string]($candidate | Select-Object -Last 1) }
  }
 }
 if (-not $PythonExe) {
  $candidate = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
  if (Test-Path -LiteralPath $candidate) { $PythonExe = $candidate }
 }
 if (-not $PythonExe) { throw 'Python 3.11/3.12 is required. Pass -PythonExe with its full path.' }
 Run-Checked $PythonExe @('-c',"import sys; assert (3,11)<=sys.version_info[:2]<=(3,12), 'Python 3.11 or 3.12 is required'")
 $venvName = if ($WorkerOnly) { '.venv-worker' } else { '.venv' }
 $venv = Join-Path $OutputRoot $venvName
 $python = Join-Path $venv 'Scripts/python.exe'
 if (-not (Test-Path -LiteralPath $python)) {
  Run-Checked $PythonExe @('-c','import shutil,sys; assert shutil.disk_usage(sys.argv[1]).free>8*1024**3, "At least 8 GiB free is required before installing dependencies"',$OutputRoot)
  Run-Checked $PythonExe @('-m','venv',$venv)
 }
 if ($WorkerOnly) {
  & $python -c 'import onnxruntime,numpy,PIL' 2>$null
  if ($LASTEXITCODE -ne 0) { Run-Checked $python @('-m','pip','install','--no-cache-dir','onnxruntime>=1.20,<2','numpy>=1.26,<3','pillow>=11,<13') }
  Run-Checked $python @((Join-Path $PSScriptRoot 'worker.py'),'--origin',$Origin,'--cache',(Join-Path $OutputRoot 'inference-cache'))
 } else {
  & $python -c 'import torch,torchvision,ultralytics,onnx,onnxruntime,PIL' 2>$null
  if ($LASTEXITCODE -ne 0) {
   Run-Checked $python @('-m','pip','install','--no-cache-dir','torch==2.10.0','torchvision==0.25.0','--index-url','https://download.pytorch.org/whl/cu128')
   Run-Checked $python @('-m','pip','install','--no-cache-dir','-r',(Join-Path $PSScriptRoot 'requirements.txt'),'-c',(Join-Path $PSScriptRoot 'constraints.txt'))
  }
  $trainArguments = @((Join-Path $PSScriptRoot 'train.py'),'--origin',$Origin,'--data-root',(Join-Path $OutputRoot 'data'),'--runs-root',(Join-Path $OutputRoot 'runs'),'--epochs',"$Epochs",'--imgsz',"$ImageSize",'--batch',"$Batch")
  foreach ($dataset in $DatasetIds) { $trainArguments += @('--dataset',$dataset) }
  if ($SkipSync) { $trainArguments += '--skip-sync' }
  if ($Publish) { $trainArguments += @('--publish',$Publish) }
  if ($Resume) { $trainArguments += @('--resume',$Resume) }
  if (-not $NoServe) { $trainArguments += '--serve' }
  Run-Checked $python $trainArguments
 }
} catch {
 Write-Host ''
 Write-Host ('STOPPED: '+$_.Exception.Message) -ForegroundColor Red
 Write-Host 'Downloaded assets, checkpoints, and pending upload events are retained.'
 exit 1
} finally { Pop-Location }
