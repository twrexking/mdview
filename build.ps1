# 把專案打包成可安裝的 .vsix（不需要 vsce；.vsix 本質是特定結構的 zip）。
# 用法：powershell -ExecutionPolicy Bypass -File build.ps1
# 產出：<專案根目錄>\mdview-<版號>.vsix
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$pkg  = Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$vsix = Join-Path $root ("{0}-{1}.vsix" -f $pkg.name, $pkg.version)
$stage = Join-Path $env:TEMP ("mdview-stage-" + [guid]::NewGuid().ToString('N'))

# 進包的檔案白名單（新增檔案要加進來，不然裝了會缺檔）
$files = @(
  'package.json',
  'extension.js',
  'README.md',
  'LICENSE',
  'media\view.js',
  'media\view.css',
  'media\edit-core.js',
  'media\render-core.js',
  'media\turndown-rules.js',
  'media\markdown-it.min.js',
  'media\turndown.js'
)

# 先跑測試，沒全過不打包
& node (Join-Path $root 'test\run-all.js')
if ($LASTEXITCODE -ne 0) { Write-Host '測試沒過，不打包' -ForegroundColor Red; exit 1 }
foreach ($js in @('extension.js', 'media\view.js', 'media\edit-core.js', 'media\render-core.js', 'media\turndown-rules.js')) {
  & node --check (Join-Path $root $js)
  if ($LASTEXITCODE -ne 0) { Write-Host "語法有錯：$js，不打包" -ForegroundColor Red; exit 1 }
}

New-Item -ItemType Directory -Path (Join-Path $stage 'extension\media') -Force | Out-Null
foreach ($f in $files) {
  $src = Join-Path $root $f
  if (-not (Test-Path -LiteralPath $src)) { Write-Host "缺檔：$f" -ForegroundColor Red; exit 1 }
  Copy-Item -LiteralPath $src (Join-Path $stage "extension\$f")
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="$($pkg.name)" Version="$($pkg.version)" Publisher="$($pkg.publisher)" />
    <DisplayName>$($pkg.displayName)</DisplayName>
    <Description xml:space="preserve">$($pkg.description)</Description>
    <Tags>markdown</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($pkg.engines.vscode)" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
"@
[System.IO.File]::WriteAllText((Join-Path $stage 'extension.vsixmanifest'), $manifest, $utf8)

$ctypes = @"
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="css" ContentType="text/css" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="xml" ContentType="text/xml" />
</Types>
"@
[System.IO.File]::WriteAllText((Join-Path $stage '[Content_Types].xml'), $ctypes, $utf8)
# LICENSE 沒有副檔名，zip 的內容類型表要另外列
$ctypesPath = Join-Path $stage '[Content_Types].xml'
$ct = [System.IO.File]::ReadAllText($ctypesPath)
$ct = $ct.Replace('</Types>', '  <Override PartName="/extension/LICENSE" ContentType="text/plain" />' + "`n</Types>")
[System.IO.File]::WriteAllText($ctypesPath, $ct, $utf8)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $vsix) { Remove-Item -LiteralPath $vsix -Force }
$zip = [System.IO.Compression.ZipFile]::Open($vsix, 'Create')
try {
  foreach ($full in [System.IO.Directory]::GetFiles($stage, '*', [System.IO.SearchOption]::AllDirectories)) {
    $rel = $full.Substring($stage.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $rel) | Out-Null
  }
} finally { $zip.Dispose() }
Remove-Item $stage -Recurse -Force
Write-Host ("完成: {0}  ({1:N0} bytes)" -f $vsix, (Get-Item -LiteralPath $vsix).Length)
