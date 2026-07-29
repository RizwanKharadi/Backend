# Regenerates Android launcher icons with adaptive-icon safe-zone padding.
# Source: playstore-icon.png (512x512)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sourcePath = Join-Path $PSScriptRoot '..\android\app\src\main\res\playstore-icon.png'
$resRoot = Join-Path $PSScriptRoot '..\android\app\src\main\res'
$backupPath = Join-Path $resRoot 'playstore-icon.source.png'

if (-not (Test-Path $backupPath)) {
  Copy-Item $sourcePath $backupPath
}

$sourcePath = $backupPath

$foregroundSizes = @{
  mdpi    = 108
  hdpi    = 162
  xhdpi   = 216
  xxhdpi  = 324
  xxxhdpi = 432
}

$launcherSizes = @{
  mdpi    = 48
  hdpi    = 72
  xhdpi   = 96
  xxhdpi  = 144
  xxxhdpi = 192
}

function Save-PaddedIcon {
  param(
    [System.Drawing.Image]$Source,
    [string]$OutPath,
    [int]$CanvasSize,
    [double]$ScaleRatio,
    [Nullable[System.Drawing.Color]]$BackgroundColor
  )

  $canvas = New-Object System.Drawing.Bitmap $CanvasSize, $CanvasSize
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    if ($BackgroundColor.HasValue) {
      $graphics.Clear($BackgroundColor.Value)
    } else {
      $graphics.Clear([System.Drawing.Color]::Transparent)
    }

    $logoSize = [int][Math]::Round($CanvasSize * $ScaleRatio)
    $x = [int][Math]::Round(($CanvasSize - $logoSize) / 2)
    $y = [int][Math]::Round(($CanvasSize - $logoSize) / 2)
    $graphics.DrawImage($Source, $x, $y, $logoSize, $logoSize)
  } finally {
    $graphics.Dispose()
  }

  $canvas.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Dispose()
}

$source = [System.Drawing.Image]::FromFile($sourcePath)
try {
  foreach ($density in $foregroundSizes.Keys) {
    $size = $foregroundSizes[$density]
    $folder = Join-Path $resRoot "mipmap-$density"
    $foregroundPath = Join-Path $folder 'ic_launcher_foreground.png'

    Save-PaddedIcon -Source $source -OutPath $foregroundPath -CanvasSize $size -ScaleRatio 0.58 -BackgroundColor $null
    Write-Host "Updated $foregroundPath ($size px)"
  }

  foreach ($density in $launcherSizes.Keys) {
    $size = $launcherSizes[$density]
    $folder = Join-Path $resRoot "mipmap-$density"
    $launcherPath = Join-Path $folder 'ic_launcher.png'
    $roundPath = Join-Path $folder 'ic_launcher_round.png'

    Save-PaddedIcon -Source $source -OutPath $launcherPath -CanvasSize $size -ScaleRatio 0.54 -BackgroundColor ([System.Drawing.Color]::White)
    Copy-Item -Force $launcherPath $roundPath
    Write-Host "Updated $launcherPath ($size px)"
  }

  $playstoreOut = Join-Path $resRoot 'playstore-icon.png'
  Save-PaddedIcon -Source $source -OutPath $playstoreOut -CanvasSize 512 -ScaleRatio 0.62 -BackgroundColor ([System.Drawing.Color]::White)
  Write-Host 'Updated playstore-icon.png'
} finally {
  $source.Dispose()
}

Write-Host 'Android icons regenerated successfully.'
