"""Windows-only test controller: recycle an isolated MCP host Job, never a real host."""
import ctypes as c
from ctypes import wintypes as w
import json
import pathlib
import subprocess
import sys
import time

class Basic(c.Structure):
    _fields_ = [('processTime', c.c_longlong), ('jobTime', c.c_longlong), ('flags', w.DWORD),
                ('minWorkingSet', c.c_size_t), ('maxWorkingSet', c.c_size_t), ('processLimit', w.DWORD),
                ('affinity', c.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]

class Io(c.Structure):
    _fields_ = [(name, c.c_ulonglong) for name in ['readOps', 'writeOps', 'otherOps', 'readBytes', 'writeBytes', 'otherBytes']]

class Extended(c.Structure):
    _fields_ = [('basic', Basic), ('io', Io), ('processMemory', c.c_size_t), ('jobMemory', c.c_size_t),
                ('peakProcessMemory', c.c_size_t), ('peakJobMemory', c.c_size_t)]

node, script, installation, directory = sys.argv[1:]
root = pathlib.Path(directory).resolve()
assert root.name.startswith('host-lifecycle-') and '.tmp' in root.parts
k = c.WinDLL('kernel32', use_last_error=True)
k.CreateJobObjectW.restype = w.HANDLE
k.CreateJobObjectW.argtypes = [c.c_void_p, w.LPCWSTR]
k.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
k.CloseHandle.argtypes = [w.HANDLE]
job = k.CreateJobObjectW(None, None)
limits = Extended()
limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
assert k.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits)), c.get_last_error()
try:
    with (root / 'host.log').open('w', encoding='utf-8') as log:
        child = subprocess.Popen([node, '--import', 'tsx', script, '--host-child', installation, str(root)],
                                 stdin=subprocess.PIPE, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
        assert k.AssignProcessToJobObject(job, int(child._handle)), c.get_last_error()
        child.stdin.write(b'assigned\n')
        child.stdin.flush()
        deadline = time.monotonic() + 180
        while not (root / 'recycle-host').exists():
            if child.poll() is not None:
                raise RuntimeError('Fixture host exited before recycling; inspect host.log')
            if time.monotonic() > deadline:
                raise TimeoutError('Lifecycle test did not request host recycling')
            time.sleep(.1)
        k.CloseHandle(job)
        job = None
        child.wait(timeout=10)
        (root / 'host-closed.json').write_text(json.dumps({'jobClosed': True, 'exitCode': child.returncode}), encoding='utf-8')
finally:
    if job:
        k.CloseHandle(job)
