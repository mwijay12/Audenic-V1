@echo off
setlocal
set "JAVA_EXE=C:\Users\Administrator\AppData\Local\Temp\opencode\tools\jdk\jdk-21.0.13+9\bin\java.exe"
set "APKTOOL_JAR=C:\Users\Administrator\AppData\Local\Temp\opencode\tools\apktool.jar"
set "SIGNER_JAR=C:\Users\Administrator\AppData\Local\Temp\opencode\tools\uber-apk-signer.jar"

echo [1/3] Cleaning cached build output...
if exist "%~dp0work\decoded\build" rmdir /S /Q "%~dp0work\decoded\build"

echo [2/3] Building Audenic APK with Apktool...
"%JAVA_EXE%" -jar "%APKTOOL_JAR%" b "%~dp0work\decoded" -o "%~dp0work\build\Audenic.apk"
if errorlevel 1 (
    echo Error building APK!
    exit /b 1
)

echo [3/3] Zip-aligning and Signing with uber-apk-signer...
"%JAVA_EXE%" -jar "%SIGNER_JAR%" -a "%~dp0work\build\Audenic.apk" -o "%~dp0work\signed" --allowResign --ks "%~dp0work\custom.jks" --ksAlias larkcustom --ksPass larkcustom --ksKeyPass larkcustom
if errorlevel 1 (
    echo Error signing APK!
    exit /b 1
)

echo Copying signed APK to project folder and Desktop...
copy /Y "%~dp0work\signed\Audenic-aligned-signed.apk" "%~dp0Audenic.apk" >nul
copy /Y "%~dp0work\signed\Audenic-aligned-signed.apk" "%USERPROFILE%\Desktop\Audenic.apk" >nul

echo.
echo ========================================================
echo Audenic.apk successfully built and signed!
echo Location: %~dp0Audenic.apk
echo Desktop:  %USERPROFILE%\Desktop\Audenic.apk
echo ========================================================
endlocal
