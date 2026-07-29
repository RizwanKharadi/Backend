# Removes white/near-white background from Finny mascot PNGs.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$mascotDir = Join-Path $PSScriptRoot '..\src\assets\mascot'
$threshold = 245

Get-ChildItem $mascotDir -Filter '*.png' | ForEach-Object {
  $bmp = [System.Drawing.Bitmap]::FromFile($_.FullName)
  try {
    $bmp.MakeTransparent([System.Drawing.Color]::White)

    for ($x = 0; $x -lt $bmp.Width; $x++) {
      for ($y = 0; $y -lt $bmp.Height; $y++) {
        $pixel = $bmp.GetPixel($x, $y)
        if ($pixel.R -ge $threshold -and $pixel.G -ge $threshold -and $pixel.B -ge $threshold) {
          $bmp.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, $pixel.R, $pixel.G, $pixel.B))
        }
      }
    }

    $bmp.Save($_.FullName, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "Transparent background: $($_.Name)"
  } finally {
    $bmp.Dispose()
  }
}

Write-Host 'Mascot backgrounds removed.'
