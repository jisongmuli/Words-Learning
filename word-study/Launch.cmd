@echo off
cd /d "%~dp0"
if defined WORD_STUDY_PYTHON (
  "%WORD_STUDY_PYTHON%" "%~dp0launch.py" %*
) else if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" "%~dp0launch.py" %*
) else (
  python "%~dp0launch.py" %*
)
if errorlevel 1 pause
