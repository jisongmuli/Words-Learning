@echo off
cd /d "%~dp0"
if defined WORD_STUDY_PYTHON (
  "%WORD_STUDY_PYTHON%" "%~dp0stop.py"
) else if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" "%~dp0stop.py"
) else (
  python "%~dp0stop.py"
)
if errorlevel 1 pause
