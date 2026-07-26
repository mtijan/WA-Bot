$ErrorActionPreference = "Stop"

Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

$localEnvPath = Join-Path (Get-Location) ".env"
if (Test-Path -LiteralPath $localEnvPath) {
  Write-Host "[Config] Menggunakan backend/.env lokal. Nilai environment proses tetap memiliki prioritas."
  npm start
  exit $LASTEXITCODE
}

if ([string]::IsNullOrWhiteSpace($env:WA_BOT_SECRET_ENCRYPTION_KEY)) {
  $secureEncryptionKey = Read-Host "Session/provider encryption key (minimal 32 karakter; gunakan nilai yang sama setiap restart)" -AsSecureString
  $encryptionKeyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureEncryptionKey)
  try {
    $encryptionKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($encryptionKeyPtr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($encryptionKeyPtr)
  }

  if ([string]::IsNullOrWhiteSpace($encryptionKey) -or $encryptionKey.Length -lt 32) {
    throw "WA_BOT_SECRET_ENCRYPTION_KEY wajib minimal 32 karakter. Launcher dihentikan agar sesi tidak ditulis dengan kunci yang tidak aman."
  }
  $env:WA_BOT_SECRET_ENCRYPTION_KEY = $encryptionKey
} elseif ($env:WA_BOT_SECRET_ENCRYPTION_KEY.Length -lt 32) {
  throw "WA_BOT_SECRET_ENCRYPTION_KEY wajib minimal 32 karakter."
}

$username = Read-Host "Admin username (default: admin)"
if ([string]::IsNullOrWhiteSpace($username)) {
  $username = "admin"
}

$securePassword = Read-Host "Admin password (kosongkan untuk mode lokal tanpa login)" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
}

if (-not [string]::IsNullOrWhiteSpace($password)) {
  $env:WA_BOT_ADMIN_USERNAME = $username
  $env:WA_BOT_ADMIN_PASSWORD = $password

  if ([string]::IsNullOrWhiteSpace($env:WA_BOT_ADMIN_SESSION_SECRET)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $env:WA_BOT_ADMIN_SESSION_SECRET = [Convert]::ToBase64String($bytes)
  }

  Write-Host "[Admin Auth] Aktif untuk user: $username"
} else {
  Remove-Item Env:\WA_BOT_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Write-Host "[Admin Auth] Nonaktif untuk sesi lokal ini."
}

npm start
