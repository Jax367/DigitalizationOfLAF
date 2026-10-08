const {spawn}=require('node:child_process');
const path=require('node:path');
const {prepare}=require('./prepare.cjs');
(async()=>{
 await prepare('viewer');
 for(const script of ['settings-smoke.cjs','web-editor-smoke.cjs'])await new Promise((resolve,reject)=>{
  const child=spawn(require('electron'),[path.join(__dirname,script)],{stdio:'inherit'});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(script+' failed: '+code)));
 });
})().catch(error=>{console.error(error);process.exitCode=1;});
