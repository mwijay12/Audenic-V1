@echo off
rem ===========================================================================
rem  Audenic APK builder - Made by Mwijay
rem
rem  One build path, no hardcoded folders: this is a thin wrapper around
rem  build_audenic.py, which resolves java, the signer, the source APK and the
rem  Studio by itself and refuses to ship an APK whose Studio is out of date.
rem
rem    double-click ............ build + sign + verify + copy Audenic.apk
rem    build_audenic.bat --doctor ....... show what is missing
rem    build_audenic.bat --fetch-tools .. download uber-apk-signer
rem    drag an .apk onto me ............. verify it carries the current Studio
rem ===========================================================================
setlocal EnableExtensions
chcp 65001 >nul 2>nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 goto no_python

if /i "%~x1"=="" goto build
if /i "%~x1"==".apk" goto verify

:build
python build_audenic.py %*
if errorlevel 1 goto failed
echo.
echo Audenic.apk is ready in this folder and on your Desktop.
goto done

:verify
echo Checking %~nx1 against this repo's Studio...
python build_audenic.py --verify "%~1"
if errorlevel 1 goto failed
echo.
echo This APK already carries the current Studio.
goto done

:no_python
echo.
echo Python 3 was not found on PATH.
echo Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
goto failed

:failed
echo.
echo FAILED - see the messages above.

:done
echo.
rem Pause only when double-clicked, so scripted and CI use never hangs.
echo %cmdcmdline% | find /i "%~nx0" >nul
if not errorlevel 1 pause
endlocal
exit /b 0
