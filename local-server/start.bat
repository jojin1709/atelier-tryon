@echo off
setlocal
cd /d "%~dp0"
set PYTHONPATH=%~dp0;%~dp0\catvton_src
set PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
set CUDA_DEVICE_ORDER=PCI_BUS_ID
if not exist ".venv\Scripts\python.exe" (
  echo Venv missing - run setup first
  exit /b 1
)
echo Starting Anywear local server on 127.0.0.1:7860 ...
".venv\Scripts\python.exe" -m uvicorn server:app --host 127.0.0.1 --port 7860 --log-level info
