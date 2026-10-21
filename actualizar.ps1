# =========================================================================
# actualizar.ps1
# Hace una COPIA DE RESPALDO del intro-data.yaml actual y LUEGO jala los
# cambios de la nube (git pull). Asi, antes de que se actualicen los datos,
# siempre queda una copia con la fecha en la carpeta "backups-locales".
#
# Uso:
#   - Doble clic en "actualizar.bat", o
#   - En la terminal del proyecto:  .\actualizar.ps1
# =========================================================================
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$file = "config\intro-data.yaml"
$dir = "backups-locales"

# 1) Backup del archivo actual (antes de jalar nada).
if (Test-Path $file) {
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  # Fecha en formato latino legible, ej: "25-May-2026 7.00 PM"
  $now = Get-Date
  $meses = @('Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic')
  $dia = $now.ToString('dd')
  $mes = $meses[$now.Month - 1]
  $anio = $now.ToString('yyyy')
  $ampm = if ($now.Hour -ge 12) { 'PM' } else { 'AM' }
  $h12 = $now.Hour % 12; if ($h12 -eq 0) { $h12 = 12 }
  $min = $now.ToString('mm')
  $stamp = "$dia-$mes-$anio $h12.$min $ampm"
  $dest = Join-Path $dir "intro-data $stamp.backup.yaml"
  Copy-Item $file $dest
  Write-Host "[OK] Backup creado: $dest" -ForegroundColor Green
} else {
  Write-Host "[!] No se encontro $file - se omite el backup." -ForegroundColor Yellow
}

# 2) Evita que un cambio menor en package-lock bloquee el pull.
try { git checkout -- package-lock.json 2>$null } catch {}

# 3) Jala los cambios de la nube.
Write-Host "Jalando cambios de la nube (git pull)..." -ForegroundColor Cyan
git pull

Write-Host "Listo. Tu carpeta local esta al dia." -ForegroundColor Green
