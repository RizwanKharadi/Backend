@echo off
REM Start local MySQL for FinSync360 development (Phase 1)
set MYSQLBIN=C:\Program Files\MySQL\MySQL Server 8.4\bin
set INI=d:\Rizwan\Tally_sync\backend\my-local.ini
cd /d C:\
start "finsync-mysqld" /MIN "%MYSQLBIN%\mysqld.exe" --defaults-file=%INI% --console
echo Waiting for MySQL...
timeout /t 4 /nobreak >nul
"%MYSQLBIN%\mysqladmin.exe" --protocol=tcp -h 127.0.0.1 -u root ping
echo Done. Use: cd backend ^&^& npm run dev
