// SPDX-License-Identifier: Apache-2.0
import { app, BrowserWindow, dialog } from 'electron';
import { serve } from '@lvglplus/cli/dist/server.js';
import path from 'node:path';
let server;
await app.whenReady();
const projectArg=process.argv.find(a=>a.startsWith('--project='));
const folder=projectArg ? path.resolve(projectArg.slice(10)) : (await dialog.showOpenDialog({title:'Open LVGL Plus project folder',properties:['openDirectory']})).filePaths[0];
if(!folder){app.quit();}else{
try {
 server=await serve(folder,0);
 const window=new BrowserWindow({width:1500,height:1000,title:'LVGL Plus Studio',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 const local=new URL(server.url).origin;
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==local)event.preventDefault();});
 window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 await window.loadURL(server.url);
} catch(error){dialog.showErrorBox('LVGL Plus',error.message);app.quit();}
}
app.on('window-all-closed',()=>app.quit());
let closing=false;app.on('before-quit',event=>{if(server&&!closing){event.preventDefault();closing=true;server.close().finally(()=>app.quit());}});
