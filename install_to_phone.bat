@echo off
set "ADB=C:\Users\Administrator\platform-tools\adb.exe"

echo ========================================================
echo Installing and Testing Audenic on your Phone...
echo ========================================================
echo.

echo [1/4] Checking connected device...
"%ADB%" devices
echo.

echo [2/4] Uninstalling old version from phone (if present)...
"%ADB%" uninstall com.dywx.larkplayer
echo.

echo [3/4] Installing Audenic.apk...
"%ADB%" install -r "%~dp0Audenic.apk"
if errorlevel 1 (
    echo.
    echo Installation failed! Make sure you tapped 'Allow USB Debugging' on your phone screen.
    exit /b 1
)
echo.

echo [4/4] Launching Audenic on your phone screen...
"%ADB%" shell am start -n com.dywx.larkplayer/com.dywx.larkplayer.main.MainActivity

echo.
echo ========================================================
echo SUCCESS: Audenic has been installed and launched!
echo ========================================================
