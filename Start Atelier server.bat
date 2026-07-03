@echo off
REM Double-click this to serve Atelier to your iPad over Wi-Fi.
REM Then on the iPad (same Wi-Fi) open Safari at the address shown below.
cd /d "%~dp0"
echo.
echo  Atelier is being served. On your iPad's Safari, open:
echo.
echo     http://192.168.50.131:8000/Atelier.html
echo.
echo  (Keep this window open while you use it. Close it to stop.)
echo.
python -m http.server 8000 --bind 0.0.0.0
pause
