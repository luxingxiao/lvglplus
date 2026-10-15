// SPDX-License-Identifier: Apache-2.0
figma.showUI(__html__,{width:420,height:320});
figma.ui.onmessage=async message=>{
 if(message.type!=='export')return;
 try{
  const root=figma.currentPage.selection[0];if(!root||!['FRAME','COMPONENT'].includes(root.type))throw Error('Select a Frame or Component');
  const assets=[],warnings=[];
  const color=paint=>paint&&paint.type==='SOLID'?'#'+[paint.color.r,paint.color.g,paint.color.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join(''):undefined;
  async function convert(node){
   if(node.visible===false)return null;
   const id='f_'+node.id.replace(/[^A-Za-z0-9_]/g,'_');
   const out={id,name:node.name,type:node.type,x:Math.round(node.x||0),y:Math.round(node.y||0),width:Math.max(1,Math.round(node.width)),height:Math.max(1,Math.round(node.height)),children:[]};
   if(node.rotation)warnings.push(node.name+': rotation rasterized or approximated');
   const fills=Array.isArray(node.fills)?node.fills:[];out.bg=color(fills.find(f=>f.visible!==false));
   if(node.type==='TEXT'){out.text=node.characters;out.color=out.bg;delete out.bg;out.fontSize=typeof node.fontSize==='number'?node.fontSize:20;}
   else if(['FRAME','GROUP','COMPONENT','INSTANCE','RECTANGLE'].includes(node.type)&&!fills.some(f=>f.type==='IMAGE')&&!node.rotation){
    if(node.layoutMode&&node.layoutMode!=='NONE'){out.direction=node.layoutMode==='HORIZONTAL'?'row':'column';out.gap=Math.round(node.itemSpacing||0);out.padding=Math.round(node.paddingLeft||0);}
    if(typeof node.cornerRadius==='number')out.radius=Math.round(node.cornerRadius);
    for(const child of node.children||[]){const value=await convert(child);if(value)out.children.push(value);}
   }else{
    const bytes=await node.exportAsync({format:'PNG',constraint:{type:'SCALE',value:1}});out.type='IMAGE';out.src='assets/'+id+'.png';assets.push({path:out.src,bytes:Array.from(bytes)});
   }
   // Annotations are authored through the Plugin Data API and exported without code execution.
   const signal=node.getPluginData('lvglplus.signal'),command=node.getPluginData('lvglplus.command');if(signal)out.signal=signal;if(command)out.command=command;
   return out;
  }
  const frame=await convert(root);frame.x=0;frame.y=0;
  figma.ui.postMessage({type:'export',value:{format:'lvglplus-figma',version:1,frame,assets,warnings}});
 }catch(e){figma.ui.postMessage({type:'error',message:String(e.message||e)});}
};
