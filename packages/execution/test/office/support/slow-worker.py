"""Owned cancellation fixture: both parent and child must be gone after rejection."""
import json
import os
import subprocess
import sys
import time
request = json.load(sys.stdin)
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
with open(request['ready'], 'w') as stream:
    json.dump({'parent': os.getpid(), 'child': child.pid}, stream)
time.sleep(60)
