#!/usr/bin/env python3
"""Known-answer DBC C codec tests, including FD, big endian, signed and mux branches."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import cantools

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('dbc_codegen', ROOT / 'scripts/dbc_codegen.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
db = cantools.database.load_file(ROOT / 'examples/vehicle/vehicle.dbc')
mappings = {'DriveStatus.Speed': 'speed', 'DriveStatus.Warning': 'warning',
            'MotorData.Mode': 'mode', 'MotorData.Rpm': 'rpm', 'MotorData.Torque': 'torque',
            'BatteryDiagnostics.PackVoltage': 'voltage', 'BatteryDiagnostics.LastCellTemperature': 'cell'}
cases = [
    ('DriveStatus', {'Speed': 88.8, 'StateOfCharge': 75, 'MotorTemperature': -3, 'Left': 0, 'Right': 1, 'HighBeam': 0, 'Warning': 1, 'Trip': 99.9}, {'speed': 88.8, 'warning': 1}),
    ('MotorData', {'Mode': 0, 'Rpm': 4321}, {'mode': 0, 'rpm': 4321}),
    ('MotorData', {'Mode': 1, 'Torque': -123.4}, {'mode': 1, 'torque': -123.4}),
    ('BatteryDiagnostics', {'PackVoltage': 72.4, 'LastCellTemperature': -18}, {'voltage': 72.4, 'cell': -18})
]
with tempfile.TemporaryDirectory(prefix='lvglplus-dbc-') as temp:
    out = Path(temp)
    module.generate(ROOT / 'examples/vehicle/vehicle.dbc', mappings, out)
    before = [(out / n).read_bytes() for n in ['database.h', 'database.c', 'lvp_dbc.c']]
    module.generate(ROOT / 'examples/vehicle/vehicle.dbc', mappings, out)
    assert before == [(out / n).read_bytes() for n in ['database.h', 'database.c', 'lvp_dbc.c']]
    lines = ['#include "lvglplus.h"', '#include <stdio.h>',
             'extern int lvp_dbc_decode(const lvp_can_frame *,lvp_emit_fn,void *);',
             'static void emit(const char*n,double v,uint64_t t,void*u){(void)t;(void)u;printf("%s=%.8f\\n",n,v);}', 'int main(void){']
    expected = []
    for i, (name, values, result) in enumerate(cases):
        msg = db.get_message_by_name(name)
        data = msg.encode(values)
        lines += [f'lvp_can_frame f{i}={{0}};', f'f{i}.id={msg.frame_id}; f{i}.length={len(data)}; f{i}.fd={int(len(data)>8)};',
                  *[f'f{i}.data[{j}]={b};' for j, b in enumerate(data)],
                  f'if(lvp_dbc_decode(&f{i},emit,0)!=LVP_OK)return 1;']
        expected.append(result)
    lines += ['return 0;}']
    (out / 'test.c').write_text('\n'.join(lines))
    binary = out / 'test'
    subprocess.run(['cc', '-std=c99', '-I'+str(ROOT/'sdk/include'), '-I'+temp,
                    str(out/'test.c'), str(out/'database.c'), str(out/'lvp_dbc.c'), str(ROOT/'sdk/src/can.c'), '-lm', '-o', str(binary)], check=True)
    actual = subprocess.check_output([str(binary)], text=True).splitlines()
    wanted = [f'{name}={value:.8f}' for result in expected for name, value in result.items()]
    assert actual == wanted, (actual, wanted)
print('DBC C: deterministic generation, enum numeric values, little/big endian, signed, mux, CAN FD 64-byte passed')
