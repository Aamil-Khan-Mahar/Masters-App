<#
One-time move from the old single-repo layout (personal folders and app side by side,
one git repo for everything) to the split layout:

    <folder>/          the app: a fresh git repo with no personal history, safe to share
    <folder>/data/     your data: the OLD git repo moves here with its full history and remote

Because the old repo's paths (Common/..., Applications/...) are relative to its root, moving
its .git into data/ together with those folders keeps every file at the same path in its own
history. Nothing is rewritten and nothing is deleted.

Run from anywhere, after closing the app, VS Code and any Claude Code sessions in the folder:
    powershell -ExecutionPolicy Bypass -File scripts\migrate-to-data-folder.ps1 -DryRun
    powershell -ExecutionPolicy Bypass -File scripts\migrate-to-data-folder.ps1
#>
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$AppBranch = 'shareable-app',
    [string]$Baseline = 'app-baseline',
    [switch]$DryRun,
    [switch]$Force   # continue even if app/ changed since the baseline (those changes are overwritten)
)
$ErrorActionPreference = 'Stop'
Set-Location $Root
$Data = Join-Path $Root 'data'

function Step($text) { Write-Host "  - $text" }
function Stop-Migration($text) { Write-Host "`nStopped: $text" -ForegroundColor Red; exit 1 }
function Invoke-Git { & git @args; if ($LASTEXITCODE) { throw "git $args failed" } }

Write-Host "Masters: move personal data into data/  ($Root)`n"

# ---------------------------------------------------------------- checks
if (-not (Test-Path .git -PathType Container)) { Stop-Migration 'no .git folder here. Already migrated, or not the old layout.' }
if (-not ((Test-Path Common) -or (Test-Path Applications))) { Stop-Migration 'no Common/ or Applications/ at the top level, so there is nothing to move.' }
if ((Test-Path $Data) -and (Get-ChildItem -Force $Data | Select-Object -First 1)) { Stop-Migration 'data/ already exists and is not empty.' }

# Linked worktrees keep working: once .git has moved, they're re-pointed at data/.git.
$linked = @(git worktree list --porcelain | Select-String '^worktree (.+)$' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -Skip 1)
git rev-parse --verify -q "refs/heads/$AppBranch" | Out-Null
if ($LASTEXITCODE) { Stop-Migration "branch '$AppBranch' not found." }

# Has app/ changed since the copy the new repo was built from? Compare against the baseline tag with a scratch index.
git rev-parse --verify -q "refs/tags/$Baseline" | Out-Null
if (-not $LASTEXITCODE) {
    $index = Join-Path ([IO.Path]::GetTempPath()) "masters-migrate-index-$PID"
    $env:GIT_INDEX_FILE = $index
    try {
        Invoke-Git read-tree $Baseline
        # Runtime folders aren't app code, whatever the old .gitignore says. safecrlf=false only quiets line-ending warnings.
        $runtime = '.local/', '.venv/', 'node_modules/', 'dist/', '__pycache__/', '.env' | ForEach-Object { "--exclude=$_" }
        $changed = @(git -c core.safecrlf=false diff --name-only -- app .mcp.json .claude/mcp-servers) +
                   @(git ls-files --others --exclude-standard @runtime -- app .claude/mcp-servers)
    } finally {
        Remove-Item Env:GIT_INDEX_FILE
        Remove-Item $index -ErrorAction SilentlyContinue
    }
    $changed = $changed | Where-Object { $_ }
    if ($changed) {
        Write-Host "These app files changed after the shareable copy was made:" -ForegroundColor Yellow
        $changed | ForEach-Object { Write-Host "    $_" }
        if (-not $Force) { Stop-Migration "the new repo would overwrite them. Bring the changes over to the '$AppBranch' branch first, or rerun with -Force to drop them." }
    }
}
if ((Test-Path app\.env) -and (Select-String -Path app\.env -Pattern '^\s*DATA_ROOT\s*=' -Quiet)) {
    Write-Host "Note: app/.env sets DATA_ROOT. Remove that line afterwards so the app uses data/." -ForegroundColor Yellow
}

# ---------------------------------------------------------------- plan
$move = '.git', 'Common', 'Applications', 'Private', 'context.md', 'README.md', 'CLAUDE.md', '.gitignore' | Where-Object { Test-Path $_ }
Write-Host 'Plan:'
$move | ForEach-Object { Step "move $_ -> data/$_" }
if (Test-Path .vscode) { Step 'copy .vscode -> data/.vscode (your old repo tracks it; VS Code keeps using the top-level one)' }
if (Test-Path app\.local) { Step 'move app/.local history (usage, agents, searches, fx) -> data/.app/' }
Step "add .app/ to data/.gitignore"
if ($linked) { Step "re-point $($linked.Count) linked worktree(s) at data/.git" }
if (Test-Path CLAUDE.md) { Step 'create CLAUDE.local.md (git-ignored) importing data/CLAUDE.md, so Claude Code keeps your personal context' }
Step "create a new git repo here from branch '$AppBranch' (fresh history, nothing personal)"
if ($DryRun) { Write-Host "`nDry run: nothing changed."; exit 0 }

# ---------------------------------------------------------------- move
Write-Host "`nMoving..."
New-Item -ItemType Directory -Force $Data | Out-Null
# .git goes first: if something holds it open, nothing else has moved yet.
foreach ($item in $move) { Move-Item -LiteralPath $item -Destination (Join-Path $Data $item) }
if ($linked) { & git -C $Data worktree repair @linked }
if ((Test-Path (Join-Path $Data 'CLAUDE.md')) -and -not (Test-Path CLAUDE.local.md)) {
    [IO.File]::WriteAllText((Join-Path $Root 'CLAUDE.local.md'),
        "# Personal context (not shared; ignored by git)`n`n@data/CLAUDE.md`n", (New-Object Text.UTF8Encoding $false))
}
if (Test-Path .vscode) { Copy-Item -Recurse .vscode (Join-Path $Data '.vscode') }
if (Test-Path app\.local) {
    $state = Join-Path $Data '.app'
    New-Item -ItemType Directory -Force $state | Out-Null
    Get-ChildItem -Force app\.local | Where-Object { $_.Name -notlike 'autostart*' } | Move-Item -Destination $state
}
$dataIgnore = Join-Path $Data '.gitignore'
if (-not (Test-Path $dataIgnore) -or -not (Select-String -Path $dataIgnore -Pattern '^\.app/?$' -Quiet)) {
    Add-Content -Path $dataIgnore -Value "`n# The Masters app's own history (usage, agent logs, searches)`n.app/" -Encoding utf8
}

# ---------------------------------------------------------------- new app repo
Write-Host 'Creating the app repo...'
Invoke-Git init -q -b main
Invoke-Git fetch -q ./data $AppBranch
Invoke-Git reset -q FETCH_HEAD          # index = the shareable app; files on disk untouched
Invoke-Git checkout -- .                # write the shareable versions of the app's files

# ---------------------------------------------------------------- verify
$leak = git ls-files -- data Common Applications Private context.md
if ($leak) { Stop-Migration "the new repo tracks personal paths: $leak" }
git check-ignore -q data/Common/Profile.md
if ($LASTEXITCODE) { Stop-Migration 'data/ is not ignored by the new repo.' }

Write-Host "`nDone." -ForegroundColor Green
Write-Host @"

  App repo (shareable):  $Root
      git status should be clean. To share it, create an EMPTY repo on GitHub, then:
        git remote add origin https://github.com/<you>/<repo>.git
        git push -u origin main

  Your data (private):   $Data
      This is your old repo, with its history and its existing (private) remote.
      Its status now shows .mcp.json and .claude/ (plus the old skills) as removed: they live in the app repo now.
        cd data; git add -A; git commit -m "Move the app out; this repo is data only"; git push

  Start the app as before:  python app/start.py
"@
