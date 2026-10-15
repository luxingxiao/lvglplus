#!/usr/bin/env python3
"""Real Linux vcan integration, not a mocked transport. Requires vcan0 and a DBC-enabled gateway."""
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import cantools
import can

ROOT = Path(__file__).resolve().parent.parent
database = cantools.database.load_file(ROOT / 'examples/vehicle/vehicle.dbc')
process = subprocess.Popen([sys.argv[1], 'vcan0'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
events = queue.Queue()

def collect():
    for line in process.stdout:
        events.put(json.loads(line))

threading.Thread(target=collect, daemon=True).start()

def wait(predicate, timeout=5):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            event = events.get(timeout=max(.01, end-time.monotonic()))
        except queue.Empty:
            break
        if predicate(event):
            return event
    raise AssertionError('Timed out waiting for gateway event')

try:
    assert wait(lambda e: e.get('type') == 'connection')['connected']
    with can.Bus(interface='socketcan', channel='vcan0', fd=True) as bus:
        values = {'Speed': 88.8, 'StateOfCharge': 71, 'MotorTemperature': -12,
                  'Left': 1, 'Right': 0, 'HighBeam': 1, 'Warning': 0, 'Trip': 128.4}
        message = database.get_message_by_name('DriveStatus')
        bus.send(can.Message(arbitration_id=message.frame_id, is_extended_id=False, data=message.encode(values)))
        received = {}
        while len(received) < 8:
            event = wait(lambda e: e.get('type') == 'signal')
            received[event['signal']] = event['value']
        assert abs(received['vehicle.speed']-88.8) < 1e-8
        assert received['motor.temperature'] == -12
        assert received['lights.left'] == 1
        # The same mapped 8-byte message must decode when transported as CAN FD.
        bus.send(can.Message(arbitration_id=message.frame_id, is_extended_id=False,
                             data=message.encode({**values, 'Speed': 103.2}), is_fd=True, bitrate_switch=True))
        event = wait(lambda e: e.get('signal') == 'vehicle.speed' and abs(e['value']-103.2) < 1e-8)
        assert event['timestampMs'] > 0
        bus.send(can.Message(arbitration_id=message.frame_id, is_extended_id=False, data=b'\0\0'))
        assert wait(lambda e: e.get('type') == 'decode-error')
        # Extended IDs cannot alias a standard-ID message.
        bus.send(can.Message(arbitration_id=message.frame_id, is_extended_id=True, data=message.encode(values)))
        bus.send(can.Message(arbitration_id=512, is_extended_id=False, data=bytes(64), is_fd=True))
        wait(lambda e: e.get('type') == 'stats')
    print(json.dumps({'passed': True, 'transport': 'Linux SocketCAN vcan0', 'classic': True,
                      'canFD': True, 'signedTemperature': True, 'malformedFrame': True}))
finally:
    process.terminate()
    process.wait(timeout=5)
