// SPDX-License-Identifier: Apache-2.0
import net from 'node:net';
const server=net.createServer(socket=>{const start=Date.now();const timer=setInterval(()=>{const elapsed=(Date.now()-start)/1000;socket.write(JSON.stringify({vehicle:{speed:Math.round(60+30*Math.sin(elapsed))},battery:{soc:82}})+'\n');},100);socket.on('error',()=>{});socket.on('close',()=>clearInterval(timer));});
server.listen(9901,'127.0.0.1',()=>console.log('Read-only telemetry on 127.0.0.1:9901'));
