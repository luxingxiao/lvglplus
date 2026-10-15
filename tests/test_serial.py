#!/usr/bin/env python3
"""Real POSIX pseudo-terminal integration; no physical serial device claim."""
import json
import os
import pty
from pathlib import Path
import select
import subprocess
import time
ROOT = Path(__file__).resolve().parent.parent
master, slave = pty.openpty()
source = """
import { ProtocolAdapter } from './packages/cli/dist/protocols.js';
import { loadProject } from './packages/cli/dist/project.js';
const ir=(await loadProject('examples/vehicle')).ir;
const a=new ProtocolAdapter({name:'serial',kind:'serial-json',device:process.argv[1],baud:115200,mappings:{speed:'vehicle.speed'}},ir,ok=>{if(ok)console.log('ready');});
a.start();const timer=setInterval(()=>{const events=a.drain();if(events.length){console.log(JSON.stringify(events));clearInterval(timer);a.stop();process.exit(0);}},10);
setTimeout(()=>{console.error('Serial timeout');process.exit(1);},5000).unref();
"""
child = subprocess.Popen(['node','--input-type=module','-e',source,os.ttyname(slave)],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
try:
    assert select.select([child.stdout],[],[],8)[0], 'Serial open timeout'
    assert child.stdout.readline().strip() == 'ready'
    os.write(master,b'{"speed":'); time.sleep(0.02); os.write(master,b'61}\n')
    output,error=child.communicate(timeout=8)
    assert child.returncode == 0, error
    events=json.loads(output.strip())
    assert events[0]['signal']=='vehicle.speed' and events[0]['value']==61
    print('POSIX PTY serial: actual stty/open/read, fragmented JSON and mapping passed')
finally:
    if child.poll() is None: child.kill(); child.wait()
    os.close(master); os.close(slave)
