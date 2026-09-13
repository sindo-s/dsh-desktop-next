param([string]$Executable='D:\DSH-Next\app\dsh-desktop-next.exe')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$embedded=[Drawing.Icon]::ExtractAssociatedIcon($Executable)
if(-not $embedded){throw 'No embedded Windows icon'}
$bitmap=$embedded.ToBitmap()
$bitmap.Save((Join-Path (Get-Location) 'ui-exe-icon.png'),[Drawing.Imaging.ImageFormat]::Png)
$bluePixels=0
for($y=0;$y -lt $bitmap.Height;$y++){for($x=0;$x -lt $bitmap.Width;$x++){
    $pixel=$bitmap.GetPixel($x,$y)
    if($pixel.A -gt 128 -and $pixel.B -gt $pixel.R+40){$bluePixels++}
}}
if($bluePixels -lt 150){throw 'Embedded icon is not the expected blue whale design'}
$bitmap.Dispose();$embedded.Dispose()
'EMBEDDED_BLUE_WHALE_ICON_OK'
