$ErrorActionPreference = "Stop"

Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

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
