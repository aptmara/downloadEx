Add-Type -AssemblyName System.Drawing

function Resize-ImageWithPadding {
    param (
        [string]$SourcePath,
        [string]$DestPath,
        [int]$TargetWidth,
        [int]$TargetHeight
    )

    if (-not (Test-Path $SourcePath)) {
        Write-Host "Error: File not found - $SourcePath"
        return
    }

    $img = [System.Drawing.Image]::FromFile((Get-Item $SourcePath).FullName)
    $bmp = New-Object System.Drawing.Bitmap $TargetWidth, $TargetHeight
    $graph = [System.Drawing.Graphics]::FromImage($bmp)
    
    # Fill with black
    $graph.Clear([System.Drawing.Color]::Black)
    $graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $ratioX = $TargetWidth / $img.Width
    $ratioY = $TargetHeight / $img.Height
    $ratio = [Math]::Min($ratioX, $ratioY)

    $newWidth = [int]($img.Width * $ratio)
    $newHeight = [int]($img.Height * $ratio)

    $posX = [int](($TargetWidth - $newWidth) / 2)
    $posY = [int](($TargetHeight - $newHeight) / 2)

    $graph.DrawImage($img, $posX, $posY, $newWidth, $newHeight)
    
    $bmp.Save($DestPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $img.Dispose()
    $bmp.Dispose()
    $graph.Dispose()
    
    Write-Host "Processed $SourcePath -> $DestPath"
}

Resize-ImageWithPadding ".\スクリーンショット 2026-02-09 212130.png" ".\screenshot_1280x800_padded.png" 1280 800
Resize-ImageWithPadding ".\スクリーンショット 2026-02-09 212111.png" ".\screenshot2_1280x800_padded.png" 1280 800
